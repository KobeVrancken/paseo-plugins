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
    /**
     * How long the handler may hold the request open waiting for the transcript to change.
     * The daemon gives a plugin RPC 30 seconds and does not cancel a handler that overruns it, so
     * this stays well inside that.
     */
    waitMs: z.number().int().min(0).max(20_000).default(0),
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
    /** Attachment lines appended to the prompt: a path the CLI reads, or a URL it fetches. */
    references: z.array(z.string()).default([]),
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

/**
 * A file named by its path on the machine paseo runs on, which the file dialog cannot reach.
 * It is attached in place, so the answer is the path itself.
 * The preview only comes back for an image, and an upload carries none: the panel already holds
 * the bytes it just sent.
 */
export const attachPath = defineRpc({
  name: "file.attach",
  input: z.object({ path: z.string() }),
  output: z.object({
    path: z.string(),
    kind: z.enum(["image", "file"]),
    previewDataUrl: z.string().nullable(),
  }),
});

export const uploadImage = defineRpc({
  name: "image.upload",
  input: z.object({ fileName: z.string(), base64: z.string() }),
  output: z.object({ path: z.string() }),
});

/** The whole image, for the one attachment the user opened. Null once it is larger than the cap. */
export const readImage = defineRpc({
  name: "image.data",
  input: z.object({ path: z.string() }),
  output: z.object({ dataUrl: z.string().nullable() }),
});

/** Anything that is not an image: saved next to the images and named in the prompt the same way. */
export const uploadFile = defineRpc({
  name: "file.upload",
  input: z.object({ fileName: z.string(), base64: z.string() }),
  output: z.object({ path: z.string() }),
});

/**
 * Issues and pull requests, read through the user's own `gh`.
 * A miss is a warning rather than an error: not every workspace is a GitHub checkout.
 */
export const searchForgeItems = defineRpc({
  name: "github.search",
  input: z.object({
    workspaceDir: z.string(),
    query: z.string().default(""),
    limit: z.number().int().min(1).max(50).default(20),
  }),
  output: z.object({
    items: z.array(
      z.object({
        kind: z.enum(["issue", "pr"]),
        number: z.number().int(),
        title: z.string(),
        state: z.string(),
        url: z.string(),
      }),
    ),
    warning: z.string().nullable(),
  }),
});

/** Files and directories for the composer's `@` menu, ranked the way paseo's own picker ranks them. */
export const suggestFiles = defineRpc({
  name: "files.suggest",
  input: z.object({
    workspaceDir: z.string(),
    query: z.string().default(""),
    limit: z.number().int().min(1).max(100).default(30),
  }),
  output: z.object({
    entries: z.array(z.object({ path: z.string(), kind: z.enum(["file", "directory"]) })),
  }),
});

/**
 * The skills and commands the CLI would offer for `/`, read off disk.
 * The list only changes when a file does, so the panel holds it for the life of the panel.
 */
export const listCommands = defineRpc({
  name: "commands.list",
  input: z.object({ workspaceDir: z.string() }),
  output: z.object({
    commands: z.array(
      z.object({
        name: z.string(),
        description: z.string(),
        source: z.enum(["user", "project", "plugin"]),
        kind: z.enum(["skill", "command"]),
      }),
    ),
  }),
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
