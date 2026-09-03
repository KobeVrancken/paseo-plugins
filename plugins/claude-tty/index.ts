import type { PluginContext } from "@getpaseo/plugin";
import * as contracts from "./src/contracts.shared.ts";
import {
  doctorHandler,
  installStatusHandler,
  lastDoctorHandler,
  quarantineSessionHandler,
  readSubagentHandler,
  releaseLockHandler,
  releaseStaleLocksHandler,
  sessionsHandler,
  settingsHandler,
  startInstallHandler,
  statusHandler,
  stopSessionHandler,
  subagentsHandler,
  uninstallHandler,
} from "./src/server/handlers.server.ts";
import { ClaudeTtySurface } from "./src/client/surface.client.tsx";

export const SURFACE_ID = "claude-tty";

export default function contribute(plugin: PluginContext) {
  plugin.handle(contracts.getStatus, (_input, { paseo }) => statusHandler(paseo));
  plugin.handle(contracts.setSettings, (input, { paseo }) => settingsHandler(paseo, input));
  plugin.handle(contracts.startInstall, (input, { paseo }) => startInstallHandler(paseo, input));
  plugin.handle(contracts.getInstall, () => installStatusHandler());
  plugin.handle(contracts.runDoctor, (_input, { paseo }) => doctorHandler(paseo));
  plugin.handle(contracts.getDoctor, () => lastDoctorHandler());
  plugin.handle(contracts.getSessions, (_input, { paseo }) => sessionsHandler(paseo));
  plugin.handle(contracts.releaseLock, (input, { paseo }) => releaseLockHandler(paseo, input));
  plugin.handle(contracts.quarantineSession, (input, { paseo }) => quarantineSessionHandler(paseo, input));
  plugin.handle(contracts.stopSession, (input, { paseo }) => stopSessionHandler(paseo, input));
  plugin.handle(contracts.getSubagents, () => subagentsHandler());
  plugin.handle(contracts.readSubagent, (input) => readSubagentHandler(input));
  plugin.handle(contracts.releaseStaleLocks, (_input, { paseo }) => releaseStaleLocksHandler(paseo));
  plugin.handle(contracts.runUninstall, (input, { paseo }) => uninstallHandler(paseo, input));

  plugin.addSurface(SURFACE_ID, ClaudeTtySurface);

  plugin.addSidebarItem({
    id: "claude-tty",
    title: "Claude TTY",
    icon: "SquareTerminal",
    surface: SURFACE_ID,
  });

  plugin.addCommandCenterItem({
    id: "claude-tty-install",
    title: "Claude TTY: install or update",
    icon: "Download",
    keywords: ["claude", "adapter", "acp", "install", "build", "provider"],
    context: "global",
    async onSelect({ rpc, openSurface }) {
      openSurface(SURFACE_ID);
      await rpc(contracts.startInstall, { repair: false });
    },
  });

  plugin.addCommandCenterItem({
    id: "claude-tty-doctor",
    title: "Claude TTY: run diagnostics",
    icon: "Stethoscope",
    keywords: ["claude", "adapter", "acp", "diagnose", "doctor", "provider"],
    context: "global",
    async onSelect({ rpc, openSurface }) {
      await rpc(contracts.runDoctor, {});
      openSurface(SURFACE_ID);
    },
  });

  plugin.addCommandCenterItem({
    id: "claude-tty-release-stale-locks",
    title: "Claude TTY: release stale session locks",
    icon: "LockOpen",
    keywords: ["claude", "adapter", "acp", "lock", "session", "stale"],
    context: "global",
    async onSelect({ rpc }) {
      await rpc(contracts.releaseStaleLocks, {});
    },
  });

  return () => {};
}
