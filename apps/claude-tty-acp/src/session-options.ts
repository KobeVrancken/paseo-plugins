import type { SessionModeState, SessionModelState } from "@agentclientprotocol/sdk";

export const MODEL_IDS = ["default", "sonnet", "opus", "haiku"] as const;
export const MODE_IDS = ["default", "acceptEdits", "plan", "auto"] as const;

export type ModelId = (typeof MODEL_IDS)[number];
export type ModeId = (typeof MODE_IDS)[number];

export function modelState(currentModelId: string): SessionModelState {
  return {
    currentModelId,
    availableModels: [
      { modelId: "default", name: "Default", description: "Use Claude Code's configured default model" },
      { modelId: "sonnet", name: "Sonnet" },
      { modelId: "opus", name: "Opus" },
      { modelId: "haiku", name: "Haiku" },
    ],
  };
}

export function modeState(currentModeId: string): SessionModeState {
  return {
    currentModeId,
    availableModes: [
      { id: "default", name: "Default", description: "Ask before edits and commands according to Claude settings" },
      { id: "acceptEdits", name: "Accept Edits", description: "Automatically accept file edits" },
      { id: "plan", name: "Plan", description: "Explore and plan without making changes" },
      { id: "auto", name: "Auto", description: "Let Claude Code handle permissions automatically" },
    ],
  };
}

export function assertModelId(value: string): asserts value is ModelId {
  if (!(MODEL_IDS as readonly string[]).includes(value)) throw new Error(`Unsupported Claude model ${value}`);
}

export function assertModeId(value: string): asserts value is ModeId {
  if (!(MODE_IDS as readonly string[]).includes(value)) throw new Error(`Unsupported Claude mode ${value}`);
}
