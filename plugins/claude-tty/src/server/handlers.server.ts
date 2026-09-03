import type { PaseoApi } from "@getpaseo/client";
import type {
  DoctorPayload,
  InstallJobPayload,
  SessionsPayload,
  StatusPayload,
  SubagentsPayload,
  SubagentTranscriptPayload,
  UninstallPayload,
} from "../contracts.shared.ts";
import { lastDoctorReport, runDoctor } from "./doctor.server.ts";
import { currentInstall, startInstall } from "./install.server.ts";
import { listSessions, quarantineSession, releaseLock, releaseStaleLocks, stopSession } from "./sessions.server.ts";
import { listSubagents, readSubagentTranscript } from "./subagents.server.ts";
import { runUninstall } from "./uninstall.server.ts";
import { readStatus } from "./status.server.ts";
import { updateSettings } from "./settings.server.ts";

export function statusHandler(paseo: PaseoApi): Promise<StatusPayload> {
  return readStatus(paseo);
}

export function settingsHandler(paseo: PaseoApi, input: { idleTimeoutMs: number }): Promise<StatusPayload> {
  return updateSettings(paseo, input.idleTimeoutMs);
}

export function startInstallHandler(paseo: PaseoApi, input: { repair: boolean }): InstallJobPayload {
  return startInstall(paseo, input);
}

export function installStatusHandler(): InstallJobPayload | null {
  return currentInstall();
}

export function doctorHandler(paseo: PaseoApi): Promise<DoctorPayload> {
  return runDoctor(paseo);
}

export function sessionsHandler(paseo: PaseoApi): Promise<SessionsPayload> {
  return listSessions(paseo);
}

export function releaseLockHandler(paseo: PaseoApi, input: { id: string }): Promise<SessionsPayload> {
  return releaseLock(paseo, input.id);
}

export function quarantineSessionHandler(paseo: PaseoApi, input: { id: string }): Promise<SessionsPayload> {
  return quarantineSession(paseo, input.id);
}

export function stopSessionHandler(paseo: PaseoApi, input: { id: string }): Promise<SessionsPayload> {
  return stopSession(paseo, input.id);
}

export function subagentsHandler(): Promise<SubagentsPayload> {
  return listSubagents();
}

export function readSubagentHandler(input: { sessionId: string; agentId: string }): Promise<SubagentTranscriptPayload> {
  return readSubagentTranscript(input.sessionId, input.agentId);
}

export function lastDoctorHandler(): DoctorPayload | null {
  return lastDoctorReport();
}

export function releaseStaleLocksHandler(paseo: PaseoApi): Promise<SessionsPayload> {
  return releaseStaleLocks(paseo);
}

export function uninstallHandler(paseo: PaseoApi, input: { removeState: boolean }): Promise<UninstallPayload> {
  return runUninstall(paseo, input);
}
