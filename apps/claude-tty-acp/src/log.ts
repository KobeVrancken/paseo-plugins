import { APP_NAME } from "./constants.ts";

export type LogLevel = "debug" | "info" | "warn" | "error";

export type LogRecord = {
  level: LogLevel;
  message: string;
  [key: string]: unknown;
};

export function writeLog(record: LogRecord): void {
  process.stderr.write(`${JSON.stringify({ app: APP_NAME, time: new Date().toISOString(), ...record })}\n`);
}
