import os from "node:os";
import type { PaseoApi } from "@getpaseo/client";
import type { DoctorPayload } from "../contracts.shared.ts";
import { parseDiagnosticsReport } from "../diagnostics.shared.ts";
import { adapterBinaryPath } from "../paths.shared.ts";
import { PROVIDER_ID, commandOf } from "../provider.shared.ts";
import { runCommand } from "./exec.server.ts";
import { messageOf, resolveRepoRoot } from "./paths.server.ts";
import { readProviderEntry } from "./status.server.ts";

const DIAGNOSE_TIMEOUT_MS = 60_000;

/** Kept so a report run from the command centre is still there when the surface opens. */
let lastReport: DoctorPayload | null = null;

export function lastDoctorReport(): DoctorPayload | null {
  return lastReport;
}

export async function runDoctor(paseo: PaseoApi): Promise<DoctorPayload> {
  const [repo, existing] = await Promise.all([resolveRepoRoot(paseo), readProviderEntry(paseo)]);
  /** What the daemon would launch, which is the only executable worth diagnosing. */
  const binary = commandOf(existing)?.[0] ?? (repo.root === null ? null : adapterBinaryPath(repo.root));
  const [adapter, daemon, snapshot] = await Promise.all([
    checkAdapter(binary, repo.root ?? os.tmpdir()),
    readDaemonDiagnostic(paseo),
    readSnapshotEntry(paseo),
  ]);
  lastReport = { ranAt: Date.now(), adapter: { binary, ...adapter }, daemon, snapshot };
  return lastReport;
}

async function checkAdapter(binary: string | null, cwd: string): Promise<Omit<DoctorPayload["adapter"], "binary">> {
  if (binary === null) return { ok: false, problem: "There is no adapter to diagnose yet.", checks: [] };
  const result = await runCommand(binary, ["--diagnose", "--json"], { cwd, timeoutMs: DIAGNOSE_TIMEOUT_MS });
  if (result.spawnError !== null) return { ok: false, problem: `${binary} could not run: ${result.spawnError}`, checks: [] };
  const report = parseDiagnosticsReport(result.stdout);
  if (report === null) {
    const output = [result.stdout.trimEnd(), result.stderr.trimEnd()].filter((part) => part !== "").join("\n");
    return {
      ok: false,
      problem: `${binary} did not report its checks as JSON${result.exitCode === null ? "" : ` and exited ${result.exitCode}`}.${output === "" ? "" : `\n${output}`}`,
      checks: [],
    };
  }
  return { ok: report.ok, problem: null, checks: report.checks };
}

async function readDaemonDiagnostic(paseo: PaseoApi): Promise<DoctorPayload["daemon"]> {
  try {
    const payload = await paseo.providers.diagnostic(PROVIDER_ID);
    return { diagnostic: payload.diagnostic, error: null };
  } catch (error) {
    return { diagnostic: null, error: messageOf(error) };
  }
}

async function readSnapshotEntry(paseo: PaseoApi): Promise<DoctorPayload["snapshot"]> {
  try {
    const payload = await paseo.providers.snapshot();
    const entry = payload.entries.find((candidate) => candidate.provider === PROVIDER_ID);
    if (entry === undefined) return { status: null, error: null, registered: false };
    return { status: entry.status, error: entry.error ?? null, registered: true };
  } catch (error) {
    return { status: null, error: messageOf(error), registered: false };
  }
}
