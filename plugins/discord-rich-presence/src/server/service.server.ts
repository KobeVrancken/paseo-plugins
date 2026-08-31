import type {
  DetailLevel,
  PresenceActivity,
  PresenceSettings,
  PresenceSnapshot,
} from "../presence.shared.ts";
import { renderActivity } from "../presence.shared.ts";
import { decideWrite, MIN_WRITE_INTERVAL_MS } from "../throttle.shared.ts";
import { DaemonConnection, type DaemonState } from "./daemon.server.ts";
import { DiscordConnection, type DiscordState } from "./discord.server.ts";
import { SettingsStore } from "./settings-store.server.ts";

/** A burst of agent events is one presence write, and the debounce doubles as the rate-limit floor. */
const REFRESH_DEBOUNCE_MS = MIN_WRITE_INTERVAL_MS;
/** Covers anything the update stream misses, including a subscription lost to a reconnect. */
const REFRESH_INTERVAL_MS = 60_000;

export type KnownProject = {
  rootPath: string;
  displayName: string;
  /** null when the project follows the default level. */
  level: DetailLevel | null;
};

export type PresenceStatus = {
  settings: PresenceSettings;
  discord: DiscordState;
  daemon: DaemonState;
  activity: PresenceActivity | null;
  projects: KnownProject[];
};

export class PresenceService {
  private readonly store = new SettingsStore();
  private readonly startedAt = Date.now();
  private readonly daemon: DaemonConnection;
  private readonly discord: DiscordConnection;
  private settings: PresenceSettings | null = null;
  private snapshot: PresenceSnapshot = { workspaces: [], agents: [], projects: [] };
  private activity: PresenceActivity | null = null;
  private lastPayload: string | null = null;
  private lastSentAt: number | null = null;
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;
  private writeTimer: ReturnType<typeof setTimeout> | null = null;
  private intervalTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.daemon = new DaemonConnection({ onUpdate: () => this.scheduleRefresh() });
    this.discord = new DiscordConnection({ onReady: () => this.publish() });
  }

  async start(): Promise<void> {
    this.settings = await this.store.read();
    this.applyConnection();
    await this.daemon.start();
    this.intervalTimer = setInterval(() => void this.refresh(), REFRESH_INTERVAL_MS);
    this.intervalTimer.unref?.();
    await this.refresh();
  }

  async status(): Promise<PresenceStatus> {
    const settings = this.settings ?? (await this.store.read());
    return {
      settings,
      discord: this.discord.currentState(),
      daemon: this.daemon.currentState(),
      activity: this.activity,
      projects: this.knownProjects(settings),
    };
  }

  async update(settings: PresenceSettings): Promise<PresenceStatus> {
    this.settings = await this.store.write(settings);
    this.applyConnection();
    await this.refresh();
    return this.status();
  }

  /**
   * Every project the daemon has registered, so a level can be set on one that is not running.
   * The saved settings only contribute a name for a project the daemon has since forgotten, which
   * is what keeps a level assigned to it undoable.
   */
  private knownProjects(settings: PresenceSettings): KnownProject[] {
    const names = new Map<string, string>();
    for (const project of settings.projectDetailLevels) names.set(project.rootPath, project.displayName);
    for (const workspace of this.snapshot.workspaces) {
      names.set(workspace.projectRootPath, workspace.projectDisplayName);
    }
    for (const project of this.snapshot.projects) names.set(project.rootPath, project.displayName);

    const levels = new Map(
      settings.projectDetailLevels.map((project) => [project.rootPath, project.level] as const),
    );
    return [...names]
      .map(([rootPath, displayName]) => ({
        rootPath,
        displayName,
        level: levels.get(rootPath) ?? null,
      }))
      .sort((left, right) => left.displayName.localeCompare(right.displayName));
  }

  private applyConnection(): void {
    const settings = this.settings;
    if (!settings?.enabled || !settings.applicationId) {
      this.lastPayload = null;
      this.lastSentAt = null;
      this.discord.disconnect();
      return;
    }
    this.discord.use(settings.applicationId);
  }

  private scheduleRefresh(): void {
    if (this.refreshTimer) return;
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = null;
      void this.refresh();
    }, REFRESH_DEBOUNCE_MS);
    this.refreshTimer.unref?.();
  }

  private async refresh(): Promise<void> {
    const snapshot = await this.daemon.snapshot();
    if (snapshot) this.snapshot = snapshot;
    await this.publish();
  }

  private async publish(): Promise<void> {
    const settings = this.settings;
    if (!settings) return;
    const now = Date.now();
    this.activity = renderActivity(this.snapshot, settings, this.startedAt, now);
    const payload = this.activity ? JSON.stringify(this.activity) : null;
    const decision = decideWrite({
      payload,
      lastPayload: this.lastPayload,
      lastSentAt: this.lastSentAt,
      now,
    });
    if (decision.send) {
      this.lastPayload = payload;
      this.lastSentAt = now;
      this.discord.setActivity(this.activity);
      return;
    }
    if (decision.retryInMs !== null) this.scheduleWrite(decision.retryInMs);
  }

  private scheduleWrite(delay: number): void {
    if (this.writeTimer) return;
    this.writeTimer = setTimeout(() => {
      this.writeTimer = null;
      void this.publish();
    }, delay);
    this.writeTimer.unref?.();
  }

  async stop(): Promise<void> {
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    if (this.writeTimer) clearTimeout(this.writeTimer);
    if (this.intervalTimer) clearInterval(this.intervalTimer);
    this.discord.disconnect();
    await this.daemon.stop();
  }
}

export const service = new PresenceService();

void service.start().catch((error: unknown) => {
  console.error("discord-rich-presence failed to start", error);
});
