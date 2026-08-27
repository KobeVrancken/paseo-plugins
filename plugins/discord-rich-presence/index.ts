import type { PluginContext } from "@getpaseo/plugin";
import * as contracts from "./src/contracts.shared.ts";
import {
  setEnabledHandler,
  setProjectLevelHandler,
  setSettingsHandler,
  statusHandler,
} from "./src/server/handlers.server.ts";
import { DiscordPresenceSurface } from "./src/client/settings.client.tsx";

export const SURFACE_ID = "settings";

export default function contribute(plugin: PluginContext) {
  plugin.handle(contracts.getStatus, () => statusHandler());
  plugin.handle(contracts.setSettings, (input) => setSettingsHandler(input));
  plugin.handle(contracts.setEnabled, (input) => setEnabledHandler(input));
  plugin.handle(contracts.setProjectLevel, (input) => setProjectLevelHandler(input));

  plugin.addSurface(SURFACE_ID, DiscordPresenceSurface);

  plugin.addSidebarItem({
    id: "discord-rich-presence",
    title: "Discord",
    icon: "Gamepad2",
    surface: SURFACE_ID,
  });

  plugin.addCommandCenterItem({
    id: "discord-rich-presence-off",
    title: "Discord rich presence: turn off",
    icon: "EyeOff",
    keywords: ["discord", "presence", "status", "privacy"],
    context: "global",
    async onSelect({ rpc }) {
      await rpc(contracts.setEnabled, { enabled: false });
    },
  });

  plugin.addCommandCenterItem({
    id: "discord-rich-presence-on",
    title: "Discord rich presence: turn on",
    icon: "Eye",
    keywords: ["discord", "presence", "status"],
    context: "global",
    async onSelect({ rpc }) {
      await rpc(contracts.setEnabled, { enabled: true });
    },
  });

  plugin.addCommandCenterItem({
    id: "discord-rich-presence-project-detailed",
    title: "Discord rich presence: show this project as Detailed",
    icon: "Eye",
    keywords: ["discord", "presence", "project", "detail", "privacy"],
    context: "workspace",
    async onSelect({ rpc, workspace }) {
      await rpc(contracts.setProjectLevel, {
        rootPath: workspace.projectRootPath,
        displayName: workspace.projectDisplayName,
        level: "detailed",
      });
    },
  });

  plugin.addCommandCenterItem({
    id: "discord-rich-presence-project-projects",
    title: "Discord rich presence: show this project as Projects only",
    icon: "Folder",
    keywords: ["discord", "presence", "project", "detail", "privacy"],
    context: "workspace",
    async onSelect({ rpc, workspace }) {
      await rpc(contracts.setProjectLevel, {
        rootPath: workspace.projectRootPath,
        displayName: workspace.projectDisplayName,
        level: "projects",
      });
    },
  });

  plugin.addCommandCenterItem({
    id: "discord-rich-presence-project-hidden",
    title: "Discord rich presence: show this project as Hidden",
    icon: "EyeOff",
    keywords: ["discord", "presence", "project", "hide", "privacy"],
    context: "workspace",
    async onSelect({ rpc, workspace }) {
      await rpc(contracts.setProjectLevel, {
        rootPath: workspace.projectRootPath,
        displayName: workspace.projectDisplayName,
        level: "hidden",
      });
    },
  });

  plugin.addCommandCenterItem({
    id: "discord-rich-presence-project-default",
    title: "Discord rich presence: show this project at the default level",
    icon: "Settings2",
    keywords: ["discord", "presence", "project", "default", "detail"],
    context: "workspace",
    async onSelect({ rpc, workspace }) {
      await rpc(contracts.setProjectLevel, {
        rootPath: workspace.projectRootPath,
        displayName: workspace.projectDisplayName,
        level: null,
      });
    },
  });

  return () => {};
}
