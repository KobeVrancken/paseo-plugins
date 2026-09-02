export const IDLE_TIMEOUT_ENV = "CLAUDE_TTY_ACP_IDLE_TIMEOUT_MS";
export const DEFAULT_IDLE_TIMEOUT_MS = 60 * 60 * 1_000;
export const MAX_IDLE_TIMEOUT_MS = 2_147_483_647;

export function idleTimeoutFromEnv(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env[IDLE_TIMEOUT_ENV]?.trim();
  if (!raw) return DEFAULT_IDLE_TIMEOUT_MS;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_IDLE_TIMEOUT_MS) {
    throw new Error(`${IDLE_TIMEOUT_ENV} must be an integer from 0 through ${MAX_IDLE_TIMEOUT_MS} milliseconds`);
  }
  return value;
}
