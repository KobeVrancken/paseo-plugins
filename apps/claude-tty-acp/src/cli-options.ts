import { APP_NAME, APP_VERSION } from "./constants.ts";

export type CliAction = { kind: "serve" } | { kind: "print"; text: string } | { kind: "diagnose"; json: boolean };

const HELP = `Usage: ${APP_NAME} [--help | --version | --diagnose [--json]]

Runs the interactive Claude Code ACP adapter over stdin/stdout.
Use --diagnose to check this host without starting ACP, and --json to get one machine-readable line instead of the report.
`;

export function parseCliArgs(args: string[]): CliAction {
  if (args.length === 0) return { kind: "serve" };
  if (args.length === 1 && (args[0] === "--help" || args[0] === "-h")) {
    return { kind: "print", text: HELP };
  }
  if (args.length === 1 && (args[0] === "--version" || args[0] === "-V")) {
    return { kind: "print", text: APP_VERSION };
  }
  if (args.length === 1 && args[0] === "--diagnose") return { kind: "diagnose", json: false };
  if (args.length === 2 && args.includes("--diagnose") && args.includes("--json")) return { kind: "diagnose", json: true };
  throw new Error(`Unknown arguments: ${args.join(" ")}`);
}
