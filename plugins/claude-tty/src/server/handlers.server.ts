import type { PaseoApi } from "@getpaseo/client";
import type { StatusPayload } from "../contracts.shared.ts";
import { readStatus } from "./status.server.ts";

export function statusHandler(paseo: PaseoApi): Promise<StatusPayload> {
  return readStatus(paseo);
}
