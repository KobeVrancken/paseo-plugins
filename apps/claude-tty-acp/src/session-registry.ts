import { randomUUID } from "node:crypto";
import path from "node:path";

export type PendingSession = {
  id: string;
  cwd: string;
  createdAt: number;
  started: false;
};

export class SessionRegistry {
  private readonly sessions = new Map<string, PendingSession>();

  create(cwd: string): PendingSession {
    if (!path.isAbsolute(cwd)) throw new Error("ACP session cwd must be an absolute path");
    const session: PendingSession = {
      id: randomUUID(),
      cwd: path.normalize(cwd),
      createdAt: Date.now(),
      started: false,
    };
    this.sessions.set(session.id, session);
    return session;
  }

  get(sessionId: string): PendingSession | null {
    return this.sessions.get(sessionId) ?? null;
  }

  delete(sessionId: string): void {
    this.sessions.delete(sessionId);
  }

  clear(): void {
    this.sessions.clear();
  }

  get size(): number {
    return this.sessions.size;
  }
}
