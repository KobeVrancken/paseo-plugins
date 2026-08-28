import type { TranscriptTranslator } from "./transcript-translator.ts";
import { TranscriptReader } from "./transcript-reader.ts";

const POLL_INTERVAL_MS = 40;
const FLUSH_INTERVAL_MS = 20;
const FLUSH_ATTEMPTS = 15;

export class TranscriptWatcher {
  private readonly reader: TranscriptReader;
  private readonly translator: TranscriptTranslator;
  private readonly pollIntervalMs: number;
  private timer: NodeJS.Timeout | null = null;
  private queue: Promise<void> = Promise.resolve();

  constructor(reader: TranscriptReader, translator: TranscriptTranslator, pollIntervalMs = POLL_INTERVAL_MS) {
    this.reader = reader;
    this.translator = translator;
    this.pollIntervalMs = pollIntervalMs;
  }

  async start(): Promise<void> {
    if (this.timer) return;
    await this.sync();
    this.timer = setInterval(() => void this.sync().catch(() => undefined), this.pollIntervalMs);
    this.timer.unref();
  }

  sync(): Promise<void> {
    const operation = this.queue.then(
      () => this.syncOnce(),
      () => this.syncOnce(),
    );
    this.queue = operation.catch(() => undefined);
    return operation;
  }

  async flushUntilStable(): Promise<void> {
    let previousSize: number | null | undefined;
    let stableReads = 0;
    let sawFile = false;
    for (let attempt = 0; attempt < FLUSH_ATTEMPTS; attempt += 1) {
      const size = await this.syncWithSize();
      if (size !== null) sawFile = true;
      stableReads = sawFile && size === previousSize ? stableReads + 1 : 0;
      if (stableReads >= 2) return;
      previousSize = size;
      await delay(FLUSH_INTERVAL_MS);
    }
  }

  async close(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.queue;
  }

  private async syncOnce(): Promise<void> {
    const result = await this.reader.read();
    await this.translator.translate(result.records);
  }

  private syncWithSize(): Promise<number | null> {
    let size: number | null = null;
    const operation = this.queue.then(
      async () => {
        const result = await this.reader.read();
        size = result.size;
        await this.translator.translate(result.records);
      },
      async () => {
        const result = await this.reader.read();
        size = result.size;
        await this.translator.translate(result.records);
      },
    );
    this.queue = operation.catch(() => undefined);
    return operation.then(() => size);
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
