import type { PluginContext } from "@getpaseo/plugin";
import * as contracts from "./contracts.shared.ts";
import { getTimelineHandler, listSessionsHandler } from "./handlers.server.ts";
import { ClaudeCodePanel } from "./main.client.tsx";

export const PANEL_ID = "claude-code-cli";

export default function contribute(plugin: PluginContext) {
  plugin.handle(contracts.listSessions, (input) => listSessionsHandler(input));
  plugin.handle(contracts.getTimeline, (input) => getTimelineHandler(input));

  plugin.addWorkspacePanel({
    id: PANEL_ID,
    title: "Claude Code",
    icon: "MessageSquareText",
    context: "workspace",
    Component: ClaudeCodePanel,
  });

  plugin.addCommandCenterItem({
    id: "claude-code-cli-open",
    title: "Open Claude Code panel",
    icon: "MessageSquareText",
    keywords: ["claude", "cli", "session", "transcript"],
    context: "workspace",
    onSelect({ openPanel }) {
      openPanel(PANEL_ID);
    },
  });

  return () => {};
}
