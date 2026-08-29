import type { PaseoApi } from "@getpaseo/client";
import type { DoctorPayload, InstallJobPayload, StatusPayload } from "../contracts.shared.ts";
import { runDoctor } from "./doctor.server.ts";
import { currentInstall, startInstall } from "./install.server.ts";
import { readStatus } from "./status.server.ts";

export function statusHandler(paseo: PaseoApi): Promise<StatusPayload> {
  return readStatus(paseo);
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
