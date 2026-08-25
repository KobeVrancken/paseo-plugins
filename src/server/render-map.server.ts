import { diffLines, trimDiffContext } from "./diff.server.ts";
import type {
  DetailBlock,
  Question,
  RenderBody,
  RenderEntry,
  Todo,
  ToolKind,
} from "../render-types.shared.ts";

export type RawEntry = Record<string, unknown>;

const MAX_DETAIL_CHARS = 8_000;
const MAX_RESULT_CHARS = 4_000;
const MAX_IMAGE_BASE64_CHARS = 2_000_000;

/** Transcript line types that carry no conversation content and are deliberately not rendered. */
const IGNORED_ENTRY_TYPES = new Set([
  "mode",
  "permission-mode",
  "last-prompt",
  "file-history-snapshot",
  "file-history-delta",
  "queue-operation",
  "atis-latch",
  "agent-name",
  "agent-setting",
  "bridge-session",
  "pr-link",
  "worktree-state",
  "relocated",
]);

/**
 * Attachments the CLI injects into the model's context without ever putting them on screen.
 * Anything the terminal does show has a renderer in ATTACHMENT_ROWS instead.
 */
const IGNORED_ATTACHMENT_TYPES = new Set([
  "total_tokens_reminder",
  "task_reminder",
  "todo_reminder",
  "deferred_tools_delta",
  "mcp_instructions_delta",
  "agent_listing_delta",
  "skill_listing",
  "invoked_skills",
  "command_permissions",
  "hook_additional_context",
  "compact_file_reference",
  "plan_file_reference",
  "nested_memory",
  "read_truncation_notice",
  "edited_text_file",
  "queued_command",
  "date_change",
  // The machine-readable payload behind a tool result that is already rendered on its own card.
  "structured_output",
]);

const MODE_LABELS: Record<string, string> = {
  plan_mode: "plan mode on",
  plan_mode_reentry: "plan mode on",
  plan_mode_exit: "plan mode off",
  auto_mode: "auto mode on",
  auto_mode_exit: "auto mode off",
};

function baseName(filePath: string): string {
  return filePath.split("/").filter((part) => part !== "").pop() ?? filePath;
}

function countDiagnostics(files: unknown): { issues: number; files: number } {
  if (!Array.isArray(files)) return { issues: 0, files: 0 };
  let issues = 0;
  for (const file of files) {
    const list = asRecord(file)?.diagnostics;
    if (Array.isArray(list)) issues += list.length;
  }
  return { issues, files: files.length };
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  if (minutes < 60) return rest === 0 ? `${minutes}m` : `${minutes}m ${rest}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

/** One row per attachment the Claude Code terminal puts on screen; `null` means "nothing to show". */
const ATTACHMENT_ROWS: Record<string, (attachment: RawEntry) => RenderBody | null> = {
  file: (attachment) => {
    const name = asString(attachment.displayPath) ?? asString(attachment.filename);
    return name ? { kind: "activity", label: `attached ${name}`, tone: "muted" } : null;
  },
  directory: (attachment) => {
    const name = asString(attachment.displayPath) ?? asString(attachment.path);
    return name ? { kind: "activity", label: `attached ${name}/`, tone: "muted" } : null;
  },
  opened_file_in_ide: (attachment) => {
    const name = asString(attachment.filename);
    return name ? { kind: "activity", label: `opened ${baseName(name)} in the IDE`, tone: "muted" } : null;
  },
  selected_lines_in_ide: (attachment) => {
    const name = asString(attachment.filename);
    if (!name) return null;
    const start = attachment.lineStart;
    const end = attachment.lineEnd;
    const ide = asString(attachment.ideName);
    const range = typeof start === "number" && typeof end === "number" ? ` ${start}-${end}` : "";
    return {
      kind: "activity",
      label: `selected lines${range} in ${baseName(name)}${ide ? ` (${ide})` : ""}`,
      tone: "muted",
    };
  },
  diagnostics: (attachment) => {
    const counted = countDiagnostics(attachment.files);
    if (counted.issues === 0) return null;
    return {
      kind: "activity",
      label: `${counted.issues} diagnostic issue${counted.issues === 1 ? "" : "s"} in ${counted.files} file${counted.files === 1 ? "" : "s"}`,
      tone: "muted",
    };
  },
  hook_system_message: (attachment) => {
    const content = asString(attachment.content);
    return content ? { kind: "activity", label: firstLine(content), tone: "muted" } : null;
  },
  hook_success: (attachment) => {
    // `command` is the human-facing label the CLI prints; without it the hook ran silently.
    const command = asString(attachment.command);
    return command ? { kind: "activity", label: firstLine(command), tone: "muted" } : null;
  },
  hook_cancelled: (attachment) => ({
    kind: "activity",
    label: `${asString(attachment.hookName) ?? "hook"} cancelled`,
    tone: "danger",
  }),
  hook_non_blocking_error: (attachment) => ({
    kind: "activity",
    label: `${asString(attachment.hookName) ?? "hook"} failed: ${firstLine(asString(attachment.stderr) ?? "")}`,
    tone: "danger",
  }),
};

for (const [type, label] of Object.entries(MODE_LABELS)) {
  ATTACHMENT_ROWS[type] = () => ({ kind: "activity", label, tone: "muted" });
}

const TOOL_KINDS: Record<string, ToolKind> = {
  Bash: "bash",
  BashOutput: "bash",
  KillShell: "bash",
  Edit: "edit",
  MultiEdit: "edit",
  NotebookEdit: "edit",
  Write: "write",
  Read: "read",
  Grep: "search",
  Glob: "search",
  WebFetch: "web",
  WebSearch: "web",
  Agent: "agent",
  Task: "agent",
};

function asRecord(value: unknown): RawEntry | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as RawEntry)
    : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function truncate(text: string, limit: number): { text: string; truncated: boolean } {
  if (text.length <= limit) return { text, truncated: false };
  return { text: `${text.slice(0, limit)}\n…`, truncated: true };
}

function stripTag(text: string, tag: string): string {
  return text.replace(new RegExp(`<${tag}>[\\s\\S]*?</${tag}>`, "g"), "");
}

function blocksToText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const block of content) {
    const record = asRecord(block);
    if (!record) continue;
    const text = asString(record.text);
    if (record.type === "text" && text !== null) parts.push(text);
  }
  return parts.join("\n");
}

function shortenPath(filePath: string, cwd: string | null): string {
  if (cwd && filePath.startsWith(`${cwd}/`)) return filePath.slice(cwd.length + 1);
  return filePath;
}

function firstLine(text: string): string {
  const line = text.split("\n").find((candidate) => candidate.trim().length > 0) ?? "";
  return line.length > 160 ? `${line.slice(0, 160)}…` : line;
}

function prettyJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    return String(value);
  }
}

function parseTodos(value: unknown): Todo[] | null {
  if (!Array.isArray(value)) return null;
  const todos: Todo[] = [];
  for (const item of value) {
    const record = asRecord(item);
    const content = asString(record?.content);
    if (!record || content === null) continue;
    const status = asString(record.status);
    todos.push({
      content,
      status:
        status === "in_progress" || status === "completed" || status === "pending"
          ? status
          : "pending",
      ...(asString(record.activeForm) !== null ? { activeForm: asString(record.activeForm)! } : {}),
    });
  }
  return todos;
}

function parseQuestions(value: unknown): Question[] | null {
  if (!Array.isArray(value)) return null;
  const questions: Question[] = [];
  for (const item of value) {
    const record = asRecord(item);
    const question = asString(record?.question);
    if (!record || question === null) continue;
    const options: Question["options"] = [];
    if (Array.isArray(record.options)) {
      for (const option of record.options) {
        const optionRecord = asRecord(option);
        const label = asString(optionRecord?.label);
        if (label === null) continue;
        const description = asString(optionRecord?.description);
        options.push({ label, ...(description !== null ? { description } : {}) });
      }
    }
    const header = asString(record.header);
    questions.push({
      question,
      multiSelect: record.multiSelect === true,
      options,
      ...(header !== null ? { header } : {}),
    });
  }
  return questions;
}

/** The CLI reports answers as `"question"="answer"` pairs; only the answers are worth rendering. */
export function parseQuestionAnswers(text: string): string[] {
  const answers: string[] = [];
  const pattern = /="([^"]*)"/g;
  let match = pattern.exec(text);
  while (match) {
    answers.push(match[1]!);
    match = pattern.exec(text);
  }
  return answers.length > 0 ? answers : text === "" ? [] : [text];
}

function describeTool(
  name: string,
  input: RawEntry,
  cwd: string | null,
): { title: string; summary?: string; detail: DetailBlock[] } {
  const filePath = asString(input.file_path);
  switch (name) {
    case "Bash": {
      const command = asString(input.command) ?? "";
      const description = asString(input.description);
      return {
        title: "Bash",
        summary: description ?? firstLine(command),
        detail: [{ kind: "code", text: truncate(command, MAX_DETAIL_CHARS).text, language: "bash" }],
      };
    }
    case "Edit": {
      const before = asString(input.old_string) ?? "";
      const after = asString(input.new_string) ?? "";
      return {
        title: "Edit",
        summary: filePath ? shortenPath(filePath, cwd) : undefined,
        detail: [{ kind: "diff", lines: trimDiffContext(diffLines(before, after)) }],
      };
    }
    case "MultiEdit": {
      const edits = Array.isArray(input.edits) ? input.edits : [];
      const detail: DetailBlock[] = [];
      for (const edit of edits) {
        const record = asRecord(edit);
        if (!record) continue;
        detail.push({
          kind: "diff",
          lines: trimDiffContext(
            diffLines(asString(record.old_string) ?? "", asString(record.new_string) ?? ""),
          ),
        });
      }
      return {
        title: "Edit",
        summary: filePath ? `${shortenPath(filePath, cwd)} (${edits.length} edits)` : undefined,
        detail,
      };
    }
    case "Write": {
      const content = asString(input.content) ?? "";
      return {
        title: "Write",
        summary: filePath ? shortenPath(filePath, cwd) : undefined,
        detail: [{ kind: "code", text: truncate(content, MAX_DETAIL_CHARS).text }],
      };
    }
    case "Read": {
      const offset = input.offset;
      const limit = input.limit;
      const range =
        typeof offset === "number" || typeof limit === "number"
          ? ` (from line ${String(offset ?? 1)}${typeof limit === "number" ? `, ${limit} lines` : ""})`
          : "";
      return {
        title: "Read",
        summary: filePath ? `${shortenPath(filePath, cwd)}${range}` : undefined,
        detail: [],
      };
    }
    case "Grep":
    case "Glob": {
      const pattern = asString(input.pattern) ?? "";
      const searchPath = asString(input.path);
      return {
        title: name,
        summary: pattern,
        detail: searchPath ? [{ kind: "kv", pairs: [{ key: "path", value: searchPath }] }] : [],
      };
    }
    case "WebFetch": {
      const url = asString(input.url) ?? "";
      const prompt = asString(input.prompt);
      return {
        title: "WebFetch",
        summary: url,
        detail: prompt ? [{ kind: "text", text: prompt }] : [],
      };
    }
    case "WebSearch": {
      return { title: "WebSearch", summary: asString(input.query) ?? "", detail: [] };
    }
    case "Agent":
    case "Task": {
      const description = asString(input.description) ?? asString(input.subagent_type) ?? "";
      const prompt = asString(input.prompt);
      return {
        title: "Subagent",
        summary: description,
        detail: prompt ? [{ kind: "text", text: truncate(prompt, MAX_DETAIL_CHARS).text }] : [],
      };
    }
    default: {
      const pairs = Object.entries(input)
        .filter(([, value]) => typeof value === "string" || typeof value === "number")
        .map(([key, value]) => ({ key, value: String(value) }));
      const summary = pairs.length > 0 ? `${pairs[0]!.key}: ${firstLine(pairs[0]!.value)}` : undefined;
      return {
        title: name,
        summary,
        detail: [{ kind: "code", text: truncate(prettyJson(input), MAX_DETAIL_CHARS).text, language: "json" }],
      };
    }
  }
}

const LIST_TEXT_CHARS = 600;
const LIST_DIFF_LINES = 24;
const LIST_IMAGE_CHARS = 128 * 1024;

function capDetailBlock(block: DetailBlock): { block: DetailBlock; truncated: boolean } {
  switch (block.kind) {
    case "text":
    case "code": {
      if (block.text.length <= LIST_TEXT_CHARS) return { block, truncated: false };
      return { block: { ...block, text: `${block.text.slice(0, LIST_TEXT_CHARS)}\n…` }, truncated: true };
    }
    case "diff": {
      if (block.lines.length <= LIST_DIFF_LINES) return { block, truncated: false };
      return { block: { ...block, lines: block.lines.slice(0, LIST_DIFF_LINES) }, truncated: true };
    }
    default:
      return { block, truncated: false };
  }
}

/**
 * Shortens an entry for the timeline payload.
 * A long transcript is mostly tool output nobody expands, so the full body is fetched per entry instead.
 */
export function capEntryForList(entry: RenderEntry): RenderEntry {
  const body = entry.body;
  if (body.kind === "image") {
    if (body.dataUri === null || body.dataUri.length <= LIST_IMAGE_CHARS) return entry;
    return { ...entry, body: { ...body, dataUri: null, deferred: true } };
  }
  if (body.kind !== "tool_call") return entry;
  let truncated = false;
  const detail = body.detail.map((block) => {
    const capped = capDetailBlock(block);
    truncated = truncated || capped.truncated;
    return capped.block;
  });
  let result = body.result;
  if (result && result.text.length > LIST_TEXT_CHARS) {
    result = { text: `${result.text.slice(0, LIST_TEXT_CHARS)}\n…`, truncated: true };
    truncated = true;
  }
  if (!truncated) return entry;
  return { ...entry, body: { ...body, detail, result, detailTruncated: true } };
}

type Tracked = { entry: RenderEntry; rev: number };

/**
 * Folds the append-only transcript into the client-facing `RenderEntry` list.
 * Entries stay addressable by index because later lines (tool results, answers) mutate earlier ones.
 */
export class TimelineBuilder {
  private tracked: Tracked[] = [];
  private toolEntryByUseId = new Map<string, number>();
  private textEntryByRequestId = new Map<string, number>();
  private rev = 0;

  /** Line kinds this build does not know how to render, reported once per session in the plugin log. */
  readonly unknownKinds = new Set<string>();
  cwd: string | null = null;
  title: string | null = null;
  firstUserPrompt: string | null = null;
  lastEntryTimestamp: string | null = null;

  get revision(): number {
    return this.rev;
  }

  get total(): number {
    return this.tracked.length;
  }

  /** `fromIndex` keeps the first load of a long transcript from shipping every entry at once. */
  changedSince(revision: number, fromIndex = 0): RenderEntry[] {
    return this.tracked
      .filter((tracked) => tracked.rev > revision && tracked.entry.index >= fromIndex)
      .map((tracked) => tracked.entry);
  }

  /** Index of the newest unresolved `AskUserQuestion` call, or null when none is pending. */
  pendingQuestionIndex(): number | null {
    for (let index = this.tracked.length - 1; index >= 0; index -= 1) {
      const body = this.tracked[index]!.entry.body;
      if (body.kind === "question" && body.answers === null) return index;
    }
    return null;
  }

  entryAt(index: number): RenderEntry | null {
    return this.tracked[index]?.entry ?? null;
  }

  push(raw: unknown): void {
    const entry = asRecord(raw);
    if (!entry) return;
    const type = asString(entry.type);
    if (type === null) return;

    const timestamp = asString(entry.timestamp);
    if (timestamp) this.lastEntryTimestamp = timestamp;
    this.cwd = asString(entry.cwd) ?? this.cwd;

    switch (type) {
      case "user":
        this.pushUser(entry);
        return;
      case "assistant":
        this.pushAssistant(entry);
        return;
      case "system":
        this.pushSystem(entry);
        return;
      case "attachment":
        this.pushAttachment(entry);
        return;
      case "ai-title":
      case "custom-title":
      case "summary": {
        this.title =
          asString(entry.aiTitle) ?? asString(entry.customTitle) ?? asString(entry.summary) ?? this.title;
        return;
      }
      default:
        if (IGNORED_ENTRY_TYPES.has(type)) return;
        this.unknownKinds.add(type);
    }
  }

  private append(entry: Omit<RenderEntry, "index">): number {
    const index = this.tracked.length;
    this.rev += 1;
    this.tracked.push({ entry: { ...entry, index }, rev: this.rev });
    return index;
  }

  private replaceBody(index: number, body: RenderBody): void {
    const tracked = this.tracked[index];
    if (!tracked) return;
    this.rev += 1;
    this.tracked[index] = { entry: { ...tracked.entry, body }, rev: this.rev };
  }

  private appendText(index: number, extra: string): void {
    const tracked = this.tracked[index];
    if (!tracked || tracked.entry.body.kind !== "assistant_markdown") return;
    this.replaceBody(index, {
      ...tracked.entry.body,
      text: `${tracked.entry.body.text}\n\n${extra}`,
    });
  }

  private pushUser(entry: RawEntry): void {
    const message = asRecord(entry.message);
    const content = message?.content;
    const uuid = asString(entry.uuid) ?? `user-${this.tracked.length}`;
    const timestamp = asString(entry.timestamp);
    const isSidechain = entry.isSidechain === true;
    const cwd = asString(entry.cwd) ?? this.cwd;

    if (Array.isArray(content)) {
      for (const block of content) {
        const record = asRecord(block);
        if (!record) continue;
        if (record.type === "tool_result") {
          this.applyToolResult(record, uuid, timestamp, isSidechain);
          continue;
        }
        if (record.type === "image") {
          this.pushImage(record, `${uuid}-image`, timestamp, isSidechain);
          continue;
        }
        if (record.type === "text") {
          this.pushUserText(asString(record.text) ?? "", entry, uuid, timestamp, isSidechain, cwd);
        }
      }
      return;
    }
    if (typeof content === "string") {
      this.pushUserText(content, entry, uuid, timestamp, isSidechain, cwd);
    }
  }

  private pushUserText(
    rawText: string,
    entry: RawEntry,
    uuid: string,
    timestamp: string | null,
    isSidechain: boolean,
    _cwd: string | null,
  ): void {
    const commandName = /<command-name>([^<]*)<\/command-name>/.exec(rawText)?.[1]?.trim();
    if (commandName) {
      const args = /<command-args>([^<]*)<\/command-args>/.exec(rawText)?.[1]?.trim();
      this.append({
        id: uuid,
        ts: timestamp,
        isSidechain,
        body: { kind: "activity", label: `ran ${commandName}${args ? ` ${args}` : ""}`, tone: "muted" },
      });
      return;
    }

    let text = stripTag(rawText, "system-reminder");
    text = stripTag(text, "task-notification");
    text = stripTag(text, "user-prompt-submit-hook");
    text = stripTag(text, "local-command-stdout");
    text = stripTag(text, "local-command-stderr");
    text = stripTag(text, "command-message");
    text = text.trim();
    if (text === "") return;

    if (entry.isMeta === true) {
      this.append({
        id: uuid,
        ts: timestamp,
        isSidechain,
        body: { kind: "activity", label: firstLine(text), tone: "muted" },
      });
      return;
    }

    if (this.firstUserPrompt === null && !isSidechain) this.firstUserPrompt = text;
    this.append({ id: uuid, ts: timestamp, isSidechain, body: { kind: "user_text", text } });
  }

  private pushImage(
    block: RawEntry,
    id: string,
    timestamp: string | null,
    isSidechain: boolean,
  ): void {
    const source = asRecord(block.source);
    const data = asString(source?.data);
    const mediaType = asString(source?.media_type) ?? "image/png";
    if (data === null) {
      this.append({
        id,
        ts: timestamp,
        isSidechain,
        body: { kind: "image", dataUri: null, deferred: false, note: "image (unsupported source)" },
      });
      return;
    }
    if (data.length > MAX_IMAGE_BASE64_CHARS) {
      this.append({
        id,
        ts: timestamp,
        isSidechain,
        body: { kind: "image", dataUri: null, deferred: false, note: "image too large to preview" },
      });
      return;
    }
    this.append({
      id,
      ts: timestamp,
      isSidechain,
      body: { kind: "image", dataUri: `data:${mediaType};base64,${data}`, deferred: false },
    });
  }

  private applyToolResult(
    block: RawEntry,
    uuid: string,
    timestamp: string | null,
    isSidechain: boolean,
  ): void {
    const toolUseId = asString(block.tool_use_id);
    const isError = block.is_error === true;
    const text = blocksToText(block.content).trim();
    const index = toolUseId ? this.toolEntryByUseId.get(toolUseId) : undefined;

    if (Array.isArray(block.content)) {
      for (const inner of block.content) {
        const record = asRecord(inner);
        if (record?.type === "image") {
          this.pushImage(record, `${uuid}-result-image`, timestamp, isSidechain);
        }
      }
    }

    if (index === undefined) {
      if (text === "") return;
      this.append({
        id: `${uuid}-result`,
        ts: timestamp,
        isSidechain,
        body: { kind: "activity", label: firstLine(text), tone: isError ? "danger" : "muted" },
      });
      return;
    }

    const body = this.tracked[index]!.entry.body;
    if (body.kind === "tool_call") {
      const result = truncate(text, MAX_RESULT_CHARS);
      this.replaceBody(index, {
        ...body,
        status: isError ? "error" : "ok",
        result: { text: result.text, truncated: result.truncated },
      });
      return;
    }
    if (body.kind === "question") {
      this.replaceBody(index, { ...body, answers: parseQuestionAnswers(text) });
    }
  }

  private pushAssistant(entry: RawEntry): void {
    const message = asRecord(entry.message);
    const content = message?.content;
    if (!Array.isArray(content)) return;
    const uuid = asString(entry.uuid) ?? `assistant-${this.tracked.length}`;
    const timestamp = asString(entry.timestamp);
    const isSidechain = entry.isSidechain === true;
    const requestId = asString(entry.requestId);
    const model = asString(message?.model);
    const cwd = asString(entry.cwd) ?? this.cwd;

    for (const block of content) {
      const record = asRecord(block);
      if (!record) continue;
      switch (record.type) {
        case "text": {
          const text = (asString(record.text) ?? "").trim();
          if (text === "") break;
          const existing = requestId ? this.textEntryByRequestId.get(requestId) : undefined;
          if (existing !== undefined) {
            this.appendText(existing, text);
            break;
          }
          const index = this.append({
            id: uuid,
            ts: timestamp,
            isSidechain,
            body: {
              kind: "assistant_markdown",
              text,
              ...(model !== null ? { model } : {}),
            },
          });
          if (requestId) this.textEntryByRequestId.set(requestId, index);
          break;
        }
        case "thinking": {
          const text = (asString(record.thinking) ?? "").trim();
          if (text === "") break;
          this.append({ id: `${uuid}-thinking`, ts: timestamp, isSidechain, body: { kind: "thinking", text } });
          break;
        }
        case "tool_use": {
          this.pushToolUse(record, uuid, timestamp, isSidechain, cwd);
          break;
        }
        default:
          break;
      }
    }
  }

  private pushToolUse(
    block: RawEntry,
    uuid: string,
    timestamp: string | null,
    isSidechain: boolean,
    cwd: string | null,
  ): void {
    const name = asString(block.name) ?? "tool";
    const toolUseId = asString(block.id) ?? `${uuid}-${name}`;
    const input = asRecord(block.input) ?? {};

    if (name === "TodoWrite") {
      const todos = parseTodos(input.todos);
      if (todos) {
        const index = this.append({
          id: toolUseId,
          ts: timestamp,
          isSidechain,
          body: { kind: "todo_list", todos },
        });
        this.toolEntryByUseId.set(toolUseId, index);
        return;
      }
    }

    if (name === "AskUserQuestion") {
      const questions = parseQuestions(input.questions);
      if (questions) {
        const index = this.append({
          id: toolUseId,
          ts: timestamp,
          isSidechain,
          body: { kind: "question", toolUseId, questions, answers: null },
        });
        this.toolEntryByUseId.set(toolUseId, index);
        return;
      }
    }

    const described = describeTool(name, input, cwd);
    const index = this.append({
      id: toolUseId,
      ts: timestamp,
      isSidechain,
      body: {
        kind: "tool_call",
        toolUseId,
        toolName: name,
        tool: TOOL_KINDS[name] ?? "generic",
        title: described.title,
        ...(described.summary !== undefined ? { summary: described.summary } : {}),
        detail: described.detail,
        detailTruncated: false,
        status: "pending",
        result: null,
      },
    });
    this.toolEntryByUseId.set(toolUseId, index);
  }

  private pushSystem(entry: RawEntry): void {
    const subtype = asString(entry.subtype);
    const level = asString(entry.level);
    const content = stripTag(asString(entry.content) ?? "", "local-command-stdout").trim();

    let label = content === "" ? null : firstLine(content);
    if (label === null && subtype === "turn_duration" && typeof entry.durationMs === "number") {
      label = `worked for ${formatDuration(entry.durationMs)}`;
    }
    if (label === null && subtype === "api_error") label = "API error";
    if (label === null && subtype === "agents_killed") label = "subagents stopped";
    if (label === null) return;

    this.append({
      id: asString(entry.uuid) ?? `system-${this.tracked.length}`,
      ts: asString(entry.timestamp),
      isSidechain: entry.isSidechain === true,
      body: {
        kind: "activity",
        label,
        tone: level === "error" || subtype === "api_error" ? "danger" : "muted",
      },
    });
  }

  private pushAttachment(entry: RawEntry): void {
    const attachment = asRecord(entry.attachment);
    const type = asString(attachment?.type);
    if (!attachment || type === null) return;
    if (IGNORED_ATTACHMENT_TYPES.has(type)) return;

    const render = ATTACHMENT_ROWS[type];
    if (!render) {
      this.unknownKinds.add(`attachment:${type}`);
      return;
    }
    const body = render(attachment);
    if (!body) return;
    this.append({
      id: asString(entry.uuid) ?? `attachment-${this.tracked.length}`,
      ts: asString(entry.timestamp),
      isSidechain: entry.isSidechain === true,
      body,
    });
  }
}
