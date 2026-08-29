import type { PluginContext } from "@getpaseo/plugin";
import * as contracts from "./src/contracts.shared.ts";
import {
  doctorHandler,
  installStatusHandler,
  lastDoctorHandler,
  quarantineSessionHandler,
  releaseLockHandler,
  releaseStaleLocksHandler,
  sessionsHandler,
  startInstallHandler,
  statusHandler,
  uninstallHandler,
} from "./src/server/handlers.server.ts";
import { ClaudeTtySurface } from "./src/client/surface.client.tsx";

export const SURFACE_ID = "claude-tty";

export default function contribute(plugin: PluginContext) {
  plugin.handle(contracts.getStatus, (_input, { paseo }) => statusHandler(paseo));
  plugin.handle(contracts.startInstall, (input, { paseo }) => startInstallHandler(paseo, input));
  plugin.handle(contracts.getInstall, () => installStatusHandler());
  plugin.handle(contracts.runDoctor, (_input, { paseo }) => doctorHandler(paseo));
  plugin.handle(contracts.getDoctor, () => lastDoctorHandler());
  plugin.handle(contracts.getSessions, () => sessionsHandler());
  plugin.handle(contracts.releaseLock, (input) => releaseLockHandler(input));
  plugin.handle(contracts.quarantineSession, (input) => quarantineSessionHandler(input));
  plugin.handle(contracts.releaseStaleLocks, () => releaseStaleLocksHandler());
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
    title: "Claude TTY adapter: install or update",
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
    title: "Claude TTY adapter: run diagnostics",
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
    title: "Claude TTY adapter: release stale session locks",
    icon: "LockOpen",
    keywords: ["claude", "adapter", "acp", "lock", "session", "stale"],
    context: "global",
    async onSelect({ rpc }) {
      await rpc(contracts.releaseStaleLocks, {});
    },
  });

  return () => {};
}
