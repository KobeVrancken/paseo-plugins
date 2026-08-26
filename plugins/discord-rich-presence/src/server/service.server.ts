import type { PresenceActivity, PresenceSettings, PresenceSnapshot } from "../presence.shared.ts";
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
  muted: boolean;
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
  private snapshot: PresenceSnapshot = { workspaces: [], agents: { running: 0, needsAttention: 0 } };
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

  /** Muted projects stay listed even when none of their workspaces is open, so they can be unmuted. */
  private knownProjects(settings: PresenceSettings): KnownProject[] {
    const projects = new Map<string, KnownProject>();
    for (const muted of settings.mutedProjects) {
      projects.set(muted.rootPath, { ...muted, muted: true });
    }
    for (const workspace of this.snapshot.workspaces) {
      if (projects.has(workspace.projectRootPath)) continue;
      projects.set(workspace.projectRootPath, {
        rootPath: workspace.projectRootPath,
        displayName: workspace.projectDisplayName,
        muted: false,
      });
    }
    return [...projects.values()].sort((left, right) =>
      left.displayName.localeCompare(right.displayName),
    );
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
