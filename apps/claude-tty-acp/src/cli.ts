#!/usr/bin/env node

import { parseCliArgs } from "./cli-options.ts";
import { writeLog } from "./log.ts";
import { runAcpServer } from "./main.ts";

async function main(): Promise<void> {
  const action = parseCliArgs(process.argv.slice(2));
  if (action.kind === "print") {
    process.stdout.write(`${action.text.trimEnd()}\n`);
    return;
  }
  await runAcpServer();
}

main().catch((error: unknown) => {
  writeLog({
    level: "error",
    message: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
  });
  process.exitCode = 1;
});
