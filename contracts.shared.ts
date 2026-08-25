import { defineRpc } from "@getpaseo/plugin/server";
import { z } from "zod";
import {
  RenderEntrySchema,
  SendBehaviorSchema,
  SessionStatusSchema,
  SessionSummarySchema,
} from "./render-types.shared.ts";

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
    workspaceId: z.string().optional(),
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

export const getHooksStatus = defineRpc({
  name: "hooks.status",
  input: z.object({}),
  output: z.object({ enabled: z.boolean() }),
});

export const enableHooks = defineRpc({
  name: "hooks.enable",
  input: z.object({}),
  output: z.object({ enabled: z.boolean() }),
});

export const getSettings = defineRpc({
  name: "settings.get",
  input: z.object({}),
  output: z.object({ sendBehavior: SendBehaviorSchema }),
});

export const setSettings = defineRpc({
  name: "settings.set",
  input: z.object({ sendBehavior: SendBehaviorSchema }),
  output: z.object({ sendBehavior: SendBehaviorSchema }),
});

export const startSession = defineRpc({
  name: "session.start",
  input: z.object({ workspaceDir: z.string() }),
  output: z.object({ sessionId: z.string(), terminalId: z.string() }),
});

export const resumeSession = defineRpc({
  name: "session.resume",
  input: z.object({ workspaceDir: z.string(), sessionId: z.string() }),
  output: z.object({ sessionId: z.string(), terminalId: z.string() }),
});

export const listAttachableTerminals = defineRpc({
  name: "terminals.attachable",
  input: z.object({ workspaceDir: z.string() }),
  output: z.object({
    terminals: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        cwd: z.string(),
        looksLikeClaude: z.boolean(),
      }),
    ),
  }),
});

export const attachTerminal = defineRpc({
  name: "session.attach",
  input: z.object({ workspaceDir: z.string(), sessionId: z.string(), terminalId: z.string() }),
  output: z.object({ terminalId: z.string() }),
});

export const detachTerminal = defineRpc({
  name: "session.detach",
  input: z.object({ sessionId: z.string() }),
  output: z.object({ detached: z.boolean() }),
});

export const sendPrompt = defineRpc({
  name: "prompt.send",
  input: z.object({
    workspaceId: z.string(),
    workspaceDir: z.string(),
    sessionId: z.string(),
    text: z.string(),
    imagePaths: z.array(z.string()).default([]),
  }),
  output: z.object({ delivered: z.boolean(), note: z.string().nullable() }),
});
