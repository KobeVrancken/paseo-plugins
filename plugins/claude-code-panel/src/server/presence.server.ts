/**
 * Paseo drops a terminal notification entirely when a trusted session says it is looking at that
 * terminal, which it hears as a `client_heartbeat` naming it.
 * The plugin's own daemon session is trusted — it is the one `context.paseo` speaks over, reaching
 * the daemon as `paseo_frame` messages on this process's IPC channel — so the panel can say it is
 * watching in the same words the app uses for a focused terminal tab.
 */

/**
 * How far back the heartbeat dates the user's last activity.
 * Presence lapses after three minutes, and paseo notifies whichever present session reported the
 * most recent activity, so this sits far enough back that any session the user is really using wins
 * that contest and near enough the edge that the claim expires seconds after the panel stops making
 * it.
 */
const REPORTED_ACTIVITY_AGE_MS = 150_000;

export type Frame = { type: "paseo_frame"; data: string; isBinary: false };

export function watchingFrame(terminalId: string, now = Date.now()): Frame {
  return {
    type: "paseo_frame",
    isBinary: false,
    data: JSON.stringify({
      type: "session",
      message: {
        type: "client_heartbeat",
        // The protocol knows only "web" and "mobile"; the panel is drawn by the app, so "web" it is.
        deviceType: "web",
        focusedAgentId: null,
        focusedTerminalId: terminalId,
        appVisible: true,
        lastActivityAt: new Date(now - REPORTED_ACTIVITY_AGE_MS).toISOString(),
      },
    }),
  };
}

export type Send = (frame: Frame, done: (error: Error | null) => void) => void;

/**
 * A send down a channel that has gone away is reported as an `error` event on the process rather
 * than thrown, and an unhandled one of those ends the plugin, so the channel is asked for a callback
 * and asked whether it is still there.
 */
function sendOverIpc(frame: Frame, done: (error: Error | null) => void): void {
  if (process.connected !== true || typeof process.send !== "function") {
    done(new Error("no daemon channel"));
    return;
  }
  process.send(frame, undefined, undefined, done);
}

/** False when the claim could not be made at all, which is worth telling the user about. */
export function sendWatchingFrame(
  terminalId: string,
  send: Send = sendOverIpc,
  now = Date.now(),
): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      send(watchingFrame(terminalId, now), (error) => resolve(error === null || error === undefined));
    } catch {
      resolve(false);
    }
  });
}
