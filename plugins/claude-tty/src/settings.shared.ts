export const IDLE_TIMEOUT_ENV = "CLAUDE_TTY_ACP_IDLE_TIMEOUT_MS";
export const DEFAULT_IDLE_TIMEOUT_MS = 60 * 60 * 1_000;
export const MAX_IDLE_TIMEOUT_MS = 2_147_483_647;

export const IDLE_TIMEOUT_OPTIONS = [
  { value: 15 * 60 * 1_000, label: "15 minutes" },
  { value: 30 * 60 * 1_000, label: "30 minutes" },
  { value: DEFAULT_IDLE_TIMEOUT_MS, label: "1 hour" },
  { value: 2 * 60 * 60 * 1_000, label: "2 hours" },
  { value: 4 * 60 * 60 * 1_000, label: "4 hours" },
  { value: 8 * 60 * 60 * 1_000, label: "8 hours" },
  { value: 0, label: "Never" },
] as const;
