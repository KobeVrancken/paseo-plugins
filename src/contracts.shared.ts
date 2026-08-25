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
    /** Lowest entry index to include; omitted means "the most recent window". */
    fromIndex: z.number().int().min(0).nullable().default(null),
  }),
  output: z.object({
    /** Entries created or changed since `sinceRevision`, addressed by their stable `index`. */
    entries: z.array(RenderEntrySchema),
    total: z.number().int(),
    windowStart: z.number().int(),
    revision: z.number().int(),
    /** The client must discard everything it has cached for this session before merging. */
    reset: z.boolean(),
    sessionStatus: SessionStatusSchema,
  }),
});

export const getTimelineEntry = defineRpc({
  name: "timeline.entry",
  input: z.object({ workspaceDir: z.string(), sessionId: z.string(), index: z.number().int().min(0) }),
  output: z.object({ entry: RenderEntrySchema.nullable() }),
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

const StartedSessionSchema = z.object({
  sessionId: z.string(),
  terminalId: z.string(),
  warning: z.string().nullable(),
});

export const startSession = defineRpc({
  name: "session.start",
  input: z.object({ workspaceDir: z.string() }),
  output: StartedSessionSchema,
});

export const resumeSession = defineRpc({
  name: "session.resume",
  input: z.object({ workspaceDir: z.string(), sessionId: z.string() }),
  output: StartedSessionSchema,
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

export const DialogOptionSchema = z.object({
  index: z.number().int(),
  label: z.string(),
  description: z.string().nullable(),
  checked: z.boolean(),
  meta: z.boolean(),
});

export const getDialog = defineRpc({
  name: "dialog.get",
  input: z.object({ sessionId: z.string() }),
  output: z.object({
    dialog: z
      .object({
        kind: z.enum(["permission", "question"]),
        prompt: z.string(),
        context: z.array(z.string()),
        options: z.array(DialogOptionSchema),
        multiSelect: z.boolean(),
      })
      .nullable(),
    terminalId: z.string().nullable(),
  }),
});

export const answerDialog = defineRpc({
  name: "dialog.answer",
  input: z.object({
    sessionId: z.string(),
    optionIndices: z.array(z.number().int()).default([]),
    labels: z.array(z.string()).default([]),
  }),
  output: z.object({
    answered: z.boolean(),
    verified: z.boolean(),
    warning: z.string().nullable(),
    note: z.string().nullable(),
  }),
});

export const attachImage = defineRpc({
  name: "image.attach",
  input: z.object({ path: z.string() }),
  output: z.object({ path: z.string() }),
});

export const uploadImage = defineRpc({
  name: "image.upload",
  input: z.object({ fileName: z.string(), base64: z.string() }),
  output: z.object({ path: z.string() }),
});

export const PermissionModeSchema = z.enum([
  "default",
  "acceptEdits",
  "plan",
  "bypassPermissions",
  "auto",
]);

/**
 * What the composer's controls display. Everything here is read for free — the model from the
 * transcript, the rest from Claude Code's own settings files — so it can be polled with the timeline.
 */
export const getComposerState = defineRpc({
  name: "composer.state",
  input: z.object({ workspaceDir: z.string(), sessionId: z.string() }),
  output: z.object({
    model: z.string().nullable(),
    effortLevel: z.string().nullable(),
    thinking: z.boolean(),
    bound: z.boolean(),
  }),
});

/**
 * Opens one of the CLI's own menus, which the panel then reads back like any other dialog rather
 * than reimplementing. The model menu carries the effort level too.
 */
export const openCliMenu = defineRpc({
  name: "composer.menu",
  input: z.object({ sessionId: z.string(), menu: z.enum(["model", "thinking"]) }),
  output: z.object({ opened: z.boolean(), warning: z.string().nullable() }),
});

/** Reads the permission mode off the terminal, and with a `mode` set, Shift+Tabs until it matches. */
export const permissionMode = defineRpc({
  name: "composer.mode",
  input: z.object({ sessionId: z.string(), mode: PermissionModeSchema.nullable().default(null) }),
  output: z.object({ mode: PermissionModeSchema.nullable(), warning: z.string().nullable() }),
});
