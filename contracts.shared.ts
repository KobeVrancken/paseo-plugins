import { defineRpc } from "@getpaseo/plugin/server";
import { z } from "zod";
import { RenderEntrySchema, SessionStatusSchema, SessionSummarySchema } from "./render-types.shared.ts";

export const listSessions = defineRpc({
  name: "sessions.list",
  input: z.object({ workspaceDir: z.string() }),
  output: z.object({
    sessions: z.array(SessionSummarySchema),
    projectDir: z.string().nullable(),
  }),
});

export const getTimeline = defineRpc({
  name: "timeline.get",
  input: z.object({
    workspaceDir: z.string(),
    sessionId: z.string(),
    sinceRevision: z.number().int().min(0),
  }),
  output: z.object({
    /** Entries created or changed since `sinceRevision`, addressed by their stable `index`. */
    entries: z.array(RenderEntrySchema),
    total: z.number().int(),
    revision: z.number().int(),
    /** The client must discard everything it has cached for this session before merging. */
    reset: z.boolean(),
    unsupportedCount: z.number().int(),
    sessionStatus: SessionStatusSchema,
  }),
});
