import type { PresenceSettings } from "../presence.shared.ts";
import { withMutedProject } from "../settings.shared.ts";
import { service, type PresenceStatus } from "./service.server.ts";

export function statusHandler(): Promise<PresenceStatus> {
  return service.status();
}

export function setSettingsHandler(input: PresenceSettings): Promise<PresenceStatus> {
  return service.update(input);
}

export async function setEnabledHandler(input: { enabled: boolean }): Promise<PresenceStatus> {
  const { settings } = await service.status();
  return service.update({ ...settings, enabled: input.enabled });
}

export async function muteProjectHandler(input: {
  rootPath: string;
  displayName: string;
  muted: boolean;
}): Promise<PresenceStatus> {
  const { settings } = await service.status();
  const next = withMutedProject(
    settings,
    { rootPath: input.rootPath, displayName: input.displayName },
    input.muted,
  );
  return service.update(next);
}
