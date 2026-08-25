import { z } from "zod";

export const DiffLineSchema = z.object({
  kind: z.enum(["add", "del", "ctx"]),
  text: z.string(),
});
export type DiffLine = z.infer<typeof DiffLineSchema>;

export const DetailBlockSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("text"), text: z.string(), mono: z.boolean().optional() }),
  z.object({ kind: z.literal("code"), text: z.string(), language: z.string().optional() }),
  z.object({ kind: z.literal("diff"), lines: z.array(DiffLineSchema) }),
  z.object({
    kind: z.literal("kv"),
    pairs: z.array(z.object({ key: z.string(), value: z.string() })),
  }),
]);
export type DetailBlock = z.infer<typeof DetailBlockSchema>;

export const TodoSchema = z.object({
  content: z.string(),
  status: z.enum(["pending", "in_progress", "completed"]),
  activeForm: z.string().optional(),
});
export type Todo = z.infer<typeof TodoSchema>;

export const QuestionOptionSchema = z.object({
  label: z.string(),
  description: z.string().optional(),
});

export const QuestionSchema = z.object({
  header: z.string().optional(),
  question: z.string(),
  multiSelect: z.boolean().default(false),
  options: z.array(QuestionOptionSchema),
});
export type Question = z.infer<typeof QuestionSchema>;

export const ToolStatusSchema = z.enum(["pending", "ok", "error"]);

/**
 * Tool kinds drive which card the client renders.
 * The backend maps every concrete tool name onto one of these so an unknown tool still lands on "generic".
 */
export const ToolKindSchema = z.enum([
  "bash",
  "edit",
  "write",
  "read",
  "search",
  "web",
  "agent",
  "generic",
]);
export type ToolKind = z.infer<typeof ToolKindSchema>;

export const RenderBodySchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("user_text"), text: z.string() }),
  z.object({
    kind: z.literal("assistant_markdown"),
    text: z.string(),
    model: z.string().optional(),
  }),
  z.object({ kind: z.literal("thinking"), text: z.string() }),
  z.object({
    kind: z.literal("tool_call"),
    toolUseId: z.string(),
    toolName: z.string(),
    tool: ToolKindSchema,
    title: z.string(),
    summary: z.string().optional(),
    detail: z.array(DetailBlockSchema),
    status: ToolStatusSchema,
    result: z
      .object({ text: z.string(), truncated: z.boolean() })
      .nullable()
      .default(null),
  }),
  z.object({ kind: z.literal("todo_list"), todos: z.array(TodoSchema) }),
  z.object({
    kind: z.literal("question"),
    toolUseId: z.string(),
    questions: z.array(QuestionSchema),
    answers: z.array(z.string()).nullable().default(null),
  }),
  z.object({
    kind: z.literal("activity"),
    label: z.string(),
    tone: z.enum(["muted", "danger"]).default("muted"),
  }),
  z.object({
    kind: z.literal("image"),
    dataUri: z.string().nullable().default(null),
    note: z.string().optional(),
  }),
  z.object({ kind: z.literal("unsupported"), entryType: z.string() }),
]);
export type RenderBody = z.infer<typeof RenderBodySchema>;

export const RenderEntrySchema = z.object({
  index: z.number().int(),
  id: z.string(),
  ts: z.string().nullable().default(null),
  isSidechain: z.boolean().default(false),
  body: RenderBodySchema,
});
export type RenderEntry = z.infer<typeof RenderEntrySchema>;

export const SendBehaviorSchema = z.enum(["cli_default", "hold_until_idle", "interrupt_first"]);
export type SendBehavior = z.infer<typeof SendBehaviorSchema>;

export const SessionStatusSchema = z.enum(["idle", "running", "needs_input", "detached"]);
export type SessionStatus = z.infer<typeof SessionStatusSchema>;

export const SessionSummarySchema = z.object({
  sessionId: z.string(),
  mtime: z.number(),
  title: z.string().nullable().default(null),
  preview: z.string(),
  isLive: z.boolean(),
  boundTerminalId: z.string().nullable().default(null),
});
export type SessionSummary = z.infer<typeof SessionSummarySchema>;
