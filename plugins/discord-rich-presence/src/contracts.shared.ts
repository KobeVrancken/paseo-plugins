import { defineRpc } from "@getpaseo/plugin/server";
import { z } from "zod";

const MutedProjectSchema = z.object({
  rootPath: z.string(),
  displayName: z.string(),
});

export const SettingsSchema = z.object({
  enabled: z.boolean(),
  applicationId: z.string().nullable(),
  detailLevel: z.enum(["detailed", "projects", "anonymous"]),
  mutedProjects: z.array(MutedProjectSchema),
});

const ActivitySchema = z.object({
  details: z.string(),
  state: z.string().optional(),
  largeImageKey: z.string(),
  largeImageText: z.string(),
  smallImageKey: z.string().optional(),
  smallImageText: z.string().optional(),
  startTimestamp: z.number(),
});

const StatusSchema = z.object({
  settings: SettingsSchema,
  discord: z.object({
    status: z.enum(["idle", "connecting", "connected", "unavailable", "rejected"]),
    error: z.string().optional(),
  }),
  daemon: z.object({
    status: z.enum(["connecting", "connected", "failed"]),
    error: z.string().optional(),
  }),
  activity: ActivitySchema.nullable(),
  projects: z.array(MutedProjectSchema.extend({ muted: z.boolean() })),
});

export type PresenceStatusPayload = z.output<typeof StatusSchema>;

export const getStatus = defineRpc({
  name: "presence.status",
  input: z.object({}),
  output: StatusSchema,
});

export const setSettings = defineRpc({
  name: "presence.settings.set",
  input: SettingsSchema,
  output: StatusSchema,
});

export const setEnabled = defineRpc({
  name: "presence.enabled.set",
  input: z.object({ enabled: z.boolean() }),
  output: StatusSchema,
});

export const muteProject = defineRpc({
  name: "presence.project.mute",
  input: MutedProjectSchema.extend({ muted: z.boolean() }),
  output: StatusSchema,
});
