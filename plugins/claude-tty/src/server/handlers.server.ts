import type { PaseoApi } from "@getpaseo/client";
import type {
  DoctorPayload,
  InstallJobPayload,
  SessionsPayload,
  StatusPayload,
  UninstallPayload,
} from "../contracts.shared.ts";
import { lastDoctorReport, runDoctor } from "./doctor.server.ts";
import { currentInstall, startInstall } from "./install.server.ts";
import { listSessions, quarantineSession, releaseLock, releaseStaleLocks } from "./sessions.server.ts";
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

export function sessionsHandler(): Promise<SessionsPayload> {
  return listSessions();
}

export function releaseLockHandler(input: { id: string }): Promise<SessionsPayload> {
  return releaseLock(input.id);
}

export function quarantineSessionHandler(input: { id: string }): Promise<SessionsPayload> {
  return quarantineSession(input.id);
}

export function lastDoctorHandler(): DoctorPayload | null {
  return lastDoctorReport();
}

export function releaseStaleLocksHandler(): Promise<SessionsPayload> {
  return releaseStaleLocks();
}

export function uninstallHandler(paseo: PaseoApi, input: { removeState: boolean }): Promise<UninstallPayload> {
  return runUninstall(paseo, input);
}
