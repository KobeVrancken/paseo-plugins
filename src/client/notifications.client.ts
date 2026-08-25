import { useEffect, useState } from "react";

/**
 * Paseo decides in the daemon whether a terminal notification is worth firing, and the only thing
 * that suppresses one is a client heartbeat naming that terminal as the focused tab.
 * A panel is not a tab and a plugin cannot send a heartbeat, so the last place left to drop a
 * notification for the terminal this panel is already showing is the app's own notification bridge.
 */
export function notificationTerminalId(payload: unknown): string | null {
  const data = (payload as { data?: unknown } | null)?.data;
  const id = (data as { terminalId?: unknown } | null)?.terminalId;
  return typeof id === "string" ? id : null;
}

export function isMuted(payload: unknown, terminalId: string | null, watching: boolean): boolean {
  return watching && terminalId !== null && notificationTerminalId(payload) === terminalId;
}

type Restore = () => void;

/**
 * The desktop bridge arrives over Electron's context bridge, which hands the page a frozen object,
 * so an assignment is only the first way in and each one is checked by reading the property back
 * rather than trusted.
 */
function replaceMethod(host: Record<string, unknown>, key: string, next: unknown): Restore | null {
  const original = host[key];
  const settled = () => host[key] === next;
  try {
    host[key] = next;
    if (settled()) return () => void (host[key] = original);
  } catch {
    /* frozen */
  }
  try {
    Object.defineProperty(host, key, { value: next, configurable: true, writable: true });
    if (settled()) {
      return () => void Object.defineProperty(host, key, { value: original, configurable: true, writable: true });
    }
  } catch {
    /* non-configurable */
  }
  return null;
}

type Bridge = { notification?: Record<string, unknown> };

/**
 * Whether the panel is dropping the bound terminal's notifications, which is worth reporting: the
 * app hands the page a bridge it is entitled to freeze, and a mute that quietly did nothing would
 * look exactly like one that worked until a notification arrived.
 */
export type MuteStatus = "off" | "muted" | "blocked" | "unavailable";

function muteDesktopBridge(muted: (payload: unknown) => boolean): Restore | null | "unavailable" {
  const host = globalThis as { paseoDesktop?: Bridge };
  const bridge = host.paseoDesktop?.notification;
  const send = bridge?.sendNotification;
  if (!bridge || typeof send !== "function") return "unavailable";
  const original = send as (payload: unknown) => Promise<boolean>;
  const wrapper = (payload: unknown) => (muted(payload) ? Promise.resolve(true) : original(payload));

  const restore = replaceMethod(bridge, "sendNotification", wrapper);
  if (restore) return restore;

  // A frozen bridge still leaves the window property, and a copy of it reads the same to the app.
  const copy = { ...host.paseoDesktop, notification: { ...bridge, sendNotification: wrapper } };
  return replaceMethod(host as Record<string, unknown>, "paseoDesktop", copy);
}

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

/**
 * Drops the app's "terminal finished" notification for the terminal this panel is bound to, for as
 * long as the panel is the thing on screen.
 * `watching` is asked at the moment a notification is raised rather than kept in state, so a panel
 * sitting behind another tab still lets one through.
 */
export function useMutedTerminalNotifications(
  terminalId: string | null,
  watching: () => boolean,
): MuteStatus {
  const [status, setStatus] = useState<MuteStatus>("off");
  useEffect(() => {
    if (terminalId === null) {
      setStatus("off");
      return;
    }
    const muted = (payload: unknown) => isMuted(payload, terminalId, watching());
    // Only the desktop bridge is touched: in a browser the app raises a `Notification` itself, and
    // standing in for that constructor means standing in for its permission accessors too.
    const restore = muteDesktopBridge(muted);
    setStatus(restore === "unavailable" ? "unavailable" : restore === null ? "blocked" : "muted");
    return typeof restore === "function" ? restore : undefined;
  }, [terminalId, watching]);
  return status;
}
