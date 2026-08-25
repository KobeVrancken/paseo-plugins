import type { PluginContext } from "@getpaseo/plugin";
import * as contracts from "./contracts.shared.ts";
import {
  attachTerminalHandler,
  detachTerminalHandler,
  enableHooksHandler,
  getHooksStatusHandler,
  getSettingsHandler,
  getTimelineHandler,
  listAttachableTerminalsHandler,
  listSessionsHandler,
  resumeSessionHandler,
  sendPromptHandler,
  setSettingsHandler,
  startSessionHandler,
} from "./handlers.server.ts";
import { ClaudeCodePanel } from "./main.client.tsx";

export const PANEL_ID = "claude-code-cli";

export default function contribute(plugin: PluginContext) {
  plugin.handle(contracts.listSessions, (input) => listSessionsHandler(input));
  plugin.handle(contracts.getTimeline, (input, context) => getTimelineHandler(input, context));
  plugin.handle(contracts.getHooksStatus, (input, context) => getHooksStatusHandler(input, context));
  plugin.handle(contracts.enableHooks, (input, context) => enableHooksHandler(input, context));
  plugin.handle(contracts.getSettings, () => getSettingsHandler());
  plugin.handle(contracts.setSettings, (input) => setSettingsHandler(input));
  plugin.handle(contracts.startSession, (input) => startSessionHandler(input));
  plugin.handle(contracts.resumeSession, (input) => resumeSessionHandler(input));
  plugin.handle(contracts.listAttachableTerminals, (input) => listAttachableTerminalsHandler(input));
  plugin.handle(contracts.attachTerminal, (input) => attachTerminalHandler(input));
  plugin.handle(contracts.detachTerminal, (input) => detachTerminalHandler(input));
  plugin.handle(contracts.sendPrompt, (input, context) => sendPromptHandler(input, context));

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
