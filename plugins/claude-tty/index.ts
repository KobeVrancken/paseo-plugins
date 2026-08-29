import type { PluginContext } from "@getpaseo/plugin";
import * as contracts from "./src/contracts.shared.ts";
import { installStatusHandler, startInstallHandler, statusHandler } from "./src/server/handlers.server.ts";
import { ClaudeTtySurface } from "./src/client/surface.client.tsx";

export const SURFACE_ID = "claude-tty";

export default function contribute(plugin: PluginContext) {
  plugin.handle(contracts.getStatus, (_input, { paseo }) => statusHandler(paseo));
  plugin.handle(contracts.startInstall, (input, { paseo }) => startInstallHandler(paseo, input));
  plugin.handle(contracts.getInstall, () => installStatusHandler());

  plugin.addSurface(SURFACE_ID, ClaudeTtySurface);

  plugin.addSidebarItem({
    id: "claude-tty",
    title: "Claude Code",
    icon: "SquareTerminal",
    surface: SURFACE_ID,
  });

  return () => {};
}
