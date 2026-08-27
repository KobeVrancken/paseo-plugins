/**
 * `/clear` does not clear the transcript file: the CLI abandons the session id it was launched with and starts writing a new one, which records nothing about what it succeeds.
 * A successor is only looked for while a prompt the panel delivered has gone unwritten, because that is the one moment a silent transcript is evidence of a rotation rather than of an idle session.
 */
const GRACE_MS = 1500;
const GIVE_UP_MS = 120_000;

/** Where the session stood when the keys went in, which is what a later poll is measured against. */
export type Delivery = { at: number; entryTotal: number };

const deliveries = new Map<string, Delivery>();

export function noteDelivery(sessionId: string, delivery: Delivery): void {
  deliveries.set(sessionId, delivery);
}

export function forgetDelivery(sessionId: string): void {
  deliveries.delete(sessionId);
}

export function deliveryFor(sessionId: string): Delivery | null {
  return deliveries.get(sessionId) ?? null;
}

/**
 * A prompt that landed becomes an entry, so the entry count is the test rather than the mtime: on its way out a cleared session appends a `cost-state` line to the file it is abandoning, which nothing renders.
 * Null is a transcript that is not on disk at all, which is a session cleared before its first prompt.
 */
export function transcriptTookThePrompt(delivery: Delivery, entryTotal: number | null): boolean {
  return entryTotal !== null && entryTotal > delivery.entryTotal;
}

export function shouldLookForSuccessor(options: {
  delivery: Delivery | null;
  entryTotal: number | null;
  now?: number;
}): boolean {
  const { delivery } = options;
  if (delivery === null) return false;
  if (transcriptTookThePrompt(delivery, options.entryTotal)) return false;
  const elapsed = (options.now ?? Date.now()) - delivery.at;
  return elapsed >= GRACE_MS && elapsed <= GIVE_UP_MS;
}
