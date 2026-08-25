const ESC = String.fromCharCode(27);

export const ARROW_UP = `${ESC}[A`;
export const ARROW_DOWN = `${ESC}[B`;
export const ARROW_RIGHT = `${ESC}[C`;
export const ARROW_LEFT = `${ESC}[D`;
export const SHIFT_TAB = `${ESC}[Z`;
export const PASTE_START = `${ESC}[200~`;
export const PASTE_END = `${ESC}[201~`;

/**
 * The CLI's Chat keybindings, read out of Claude Code 2.1.x: a terminal sends Alt as an Escape prefix.
 * `chat:modelPicker` opens the menu that carries both the model and the effort level.
 */
export const MODEL_MENU = `${ESC}p`;
export const FAST_MODE_TOGGLE = `${ESC}o`;
export const THINKING_TOGGLE = `${ESC}t`;

/**
 * Keystrokes that answer a CLI option dialog, verified against Claude Code 2.1.x:
 * a digit picks (single-select) or toggles (multi-select) an option, and a multi-select is submitted
 * by moving right to the review tab and choosing its first option.
 * Everything version-specific about answering lives here.
 */
export function answerKeys(optionIndices: number[], multiSelect: boolean): string[] {
  const digits = optionIndices.filter((index) => index >= 1 && index <= 9).map(String);
  if (digits.length === 0) return [];
  if (!multiSelect) return [digits[0]!];
  return [...digits, ARROW_RIGHT, "1"];
}

/**
 * "Type something" and "Chat about this" open a field instead of answering, so they are a single
 * keypress even in a multi-select, and the dialog is expected to stay on screen afterwards.
 */
export function metaOptionKeys(optionIndex: number): string[] {
  return optionIndex >= 1 && optionIndex <= 9 ? [String(optionIndex)] : [];
}
