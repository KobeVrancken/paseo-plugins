import type { PluginContext } from "@getpaseo/plugin";
import * as contracts from "./src/contracts.shared.ts";
import {
  muteProjectHandler,
  setEnabledHandler,
  setSettingsHandler,
  statusHandler,
} from "./src/server/handlers.server.ts";
import { DiscordPresenceSurface } from "./src/client/settings.client.tsx";

export const SURFACE_ID = "settings";

export default function contribute(plugin: PluginContext) {
  plugin.handle(contracts.getStatus, () => statusHandler());
  plugin.handle(contracts.setSettings, (input) => setSettingsHandler(input));
  plugin.handle(contracts.setEnabled, (input) => setEnabledHandler(input));
  plugin.handle(contracts.muteProject, (input) => muteProjectHandler(input));

  plugin.addSurface(SURFACE_ID, DiscordPresenceSurface);

  plugin.addSidebarItem({
    id: "discord-presence",
    title: "Discord Presence",
    icon: "Gamepad2",
    surface: SURFACE_ID,
  });

  plugin.addCommandCenterItem({
    id: "discord-presence-off",
    title: "Discord presence: turn off",
    icon: "EyeOff",
    keywords: ["discord", "presence", "status", "privacy"],
    context: "global",
    async onSelect({ rpc }) {
      await rpc(contracts.setEnabled, { enabled: false });
    },
  });

  plugin.addCommandCenterItem({
    id: "discord-presence-on",
    title: "Discord presence: turn on",
    icon: "Eye",
    keywords: ["discord", "presence", "status"],
    context: "global",
    async onSelect({ rpc }) {
      await rpc(contracts.setEnabled, { enabled: true });
    },
  });

  plugin.addCommandCenterItem({
    id: "discord-presence-mute-project",
    title: "Discord presence: mute this project",
    icon: "EyeOff",
    keywords: ["discord", "presence", "mute", "project", "privacy"],
    context: "workspace",
    async onSelect({ rpc, workspace }) {
      await rpc(contracts.muteProject, {
        rootPath: workspace.projectRootPath,
        displayName: workspace.projectDisplayName,
        muted: true,
      });
    },
  });

  plugin.addCommandCenterItem({
    id: "discord-presence-unmute-project",
    title: "Discord presence: unmute this project",
    icon: "Eye",
    keywords: ["discord", "presence", "unmute", "project"],
    context: "workspace",
    async onSelect({ rpc, workspace }) {
      await rpc(contracts.muteProject, {
        rootPath: workspace.projectRootPath,
        displayName: workspace.projectDisplayName,
        muted: false,
      });
    },
  });

  return () => {};
}
