import { useEffect, useRef, useState } from "react";

/**
 * Paseo decides in the daemon whether a terminal notification is worth firing, and the one thing
 * that stops it is a trusted session reporting that terminal as the one being looked at.
 * The app reports its focused tab; a panel is not a tab, so it says so itself — but only while it
 * really is what the user is looking at, which is what this works out.
 */
const PING_INTERVAL_MS = 10_000;
/**
 * How long after the last keystroke or mouse move the panel still counts as watched.
 * Paseo stops honouring a claim like this after three minutes of the user doing nothing, and the
 * claim should lapse before that rather than outlive the attention it stands for.
 */
const ACTIVE_WITHIN_MS = 120_000;

const INPUT_EVENTS = ["pointerdown", "pointermove", "keydown", "wheel"] as const;

/**
 * The panel counts as the thing on screen when the app window has the user's attention and the
 * panel's own node is laid out, which a tab sitting behind another one is not.
 */
export function isPanelWatching(node: unknown): boolean {
  const doc = (globalThis as { document?: { visibilityState?: string; hasFocus?: () => boolean } })
    .document;
  if (doc?.visibilityState !== "visible" || doc.hasFocus?.() !== true) return false;
  const element = node as { getClientRects?: () => { length: number } } | null;
  return typeof element?.getClientRects === "function" && element.getClientRects().length > 0;
}

type EventTargetLike = {
  addEventListener?: (type: string, listener: () => void, options?: { passive: boolean }) => void;
  removeEventListener?: (type: string, listener: () => void) => void;
};

/** Records when the user last did anything, the way the app's own presence tracking does. */
function useLastInputAt(): { current: number } {
  const lastInputAt = useRef(Date.now());
  useEffect(() => {
    const target = globalThis as EventTargetLike;
    if (!target.addEventListener || !target.removeEventListener) return;
    const note = () => {
      lastInputAt.current = Date.now();
    };
    for (const type of INPUT_EVENTS) target.addEventListener(type, note, { passive: true });
    return () => {
      for (const type of INPUT_EVENTS) target.removeEventListener?.(type, note);
    };
  }, []);
  return lastInputAt;
}

/**
 * Tells the server the panel is watching this terminal, often enough that the claim never lapses
 * while it is true and stops within seconds of it not being.
 * Returns false once the server answers that it has no way to make the claim.
 */
export function useWatchingPing(input: {
  terminalId: string | null;
  watching: () => boolean;
  claim: (terminalId: string) => Promise<{ claimed: boolean }>;
}): boolean {
  const { terminalId, watching } = input;
  const [supported, setSupported] = useState(true);
  const lastInputAt = useLastInputAt();
  const claimRef = useRef(input.claim);
  claimRef.current = input.claim;

  useEffect(() => {
    if (terminalId === null) return;
    let stopped = false;
    const ping = () => {
      if (!watching() || Date.now() - lastInputAt.current > ACTIVE_WITHIN_MS) return;
      void claimRef.current(terminalId).then(
        (result) => {
          if (!stopped) setSupported(result.claimed);
        },
        () => {},
      );
    };
    ping();
    const timer = setInterval(ping, PING_INTERVAL_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [terminalId, watching, lastInputAt]);

  return supported;
}
