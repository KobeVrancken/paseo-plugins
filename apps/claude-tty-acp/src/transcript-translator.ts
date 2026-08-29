import { createHash } from "node:crypto";
import path from "node:path";
import type {
  AgentSideConnection,
  ContentBlock,
  PlanEntry,
  SessionUpdate,
  ToolCallContent,
  ToolCallLocation,
  ToolKind,
} from "@agentclientprotocol/sdk";
import { writeLog } from "./log.ts";
import type { TranscriptRecord } from "./transcript-reader.ts";

const IGNORED_RECORD_TYPES = new Set([
  "agent-name",
  "agent-setting",
  "ai-title",
  "atis-latch",
  "bridge-session",
  "custom-title",
  "file-history-delta",
  "file-history-snapshot",
  "last-prompt",
  "mode",
  "permission-mode",
  "pr-link",
  "queue-operation",
  "relocated",
  "summary",
  "worktree-state",
]);

const TOOL_KINDS: Record<string, ToolKind> = {
  Agent: "other",
  Bash: "execute",
  BashOutput: "execute",
  Edit: "edit",
  Glob: "search",
  Grep: "search",
  KillShell: "execute",
  MultiEdit: "edit",
  NotebookEdit: "edit",
  Read: "read",
  Task: "other",
  WebFetch: "fetch",
  WebSearch: "search",
  Write: "edit",
};

export class TranscriptTranslator {
  private readonly sessionId: string;
  private readonly cwd: string;
  private readonly connection: AgentSideConnection;
  private readonly emitted = new Set<string>();
  private readonly emittedTools = new Set<string>();
  private readonly unknownKinds = new Set<string>();
  private lastPlan = "";
  private lastUsage = "";
  private assistantChunkCount = 0;
  private suppressedAssistantText: string | null = null;

  constructor(sessionId: string, cwd: string, connection: AgentSideConnection) {
    this.sessionId = sessionId;
    this.cwd = cwd;
    this.connection = connection;
  }

  get assistantChunks(): number {
    return this.assistantChunkCount;
  }

  suppressNextAssistantText(text: string): void {
    this.suppressedAssistantText = text.trim() || null;
  }

  async translate(records: TranscriptRecord[]): Promise<void> {
    for (const record of records) await this.translateRecord(record);
  }

  private async translateRecord(record: TranscriptRecord): Promise<void> {
    const type = stringValue(record.type);
    switch (type) {
      case "user":
        await this.translateUser(record);
        return;
      case "assistant":
        await this.translateAssistant(record);
        return;
      case "system":
        await this.translateSystem(record);
        return;
      case "attachment":
        await this.translateAttachment(record);
        return;
      default:
        if (type && !IGNORED_RECORD_TYPES.has(type)) this.reportUnknown(type);
    }
  }

  private async translateUser(record: TranscriptRecord): Promise<void> {
    const message = objectValue(record.message);
    const content = message?.content;
    const recordId = stringValue(record.uuid) || stableUuid(JSON.stringify(record));
    if (record.isMeta !== true && record.isSidechain !== true) this.suppressedAssistantText = null;
    if (typeof content === "string") {
      await this.emitUserText(`${recordId}:text`, recordId, content, record);
      return;
    }
    if (!Array.isArray(content)) return;
    for (let index = 0; index < content.length; index += 1) {
      const block = objectValue(content[index]);
      if (!block) continue;
      const key = `${recordId}:${index}:${String(block.type)}`;
      if (block.type === "text") await this.emitUserText(key, recordId, stringValue(block.text) || "", record);
      if (block.type === "image") await this.emitContent("user_message_chunk", key, recordId, imageContent(block));
      if (block.type === "tool_result") await this.translateToolResult(block);
    }
  }

  private async emitUserText(key: string, recordId: string, rawText: string, record: TranscriptRecord): Promise<void> {
    if (record.isMeta === true || record.isSidechain === true) return;
    const text = cleanUserText(rawText);
    if (text) await this.emitContent("user_message_chunk", key, recordId, { type: "text", text });
  }

  private async translateAssistant(record: TranscriptRecord): Promise<void> {
    const message = objectValue(record.message);
    const content = message?.content;
    if (!Array.isArray(content)) return;
    const recordId = stringValue(record.uuid) || stableUuid(JSON.stringify(record));
    const messageId = stringValue(record.requestId) || recordId;
    for (let index = 0; index < content.length; index += 1) {
      const block = objectValue(content[index]);
      if (!block) continue;
      const key = `${recordId}:${index}:${String(block.type)}`;
      switch (block.type) {
        case "text": {
          const text = stringValue(block.text)?.trim();
          if (text && text === this.suppressedAssistantText) {
            this.suppressedAssistantText = null;
            this.emitted.add(key);
          } else if (text) {
            await this.emitContent("agent_message_chunk", key, messageId, { type: "text", text });
          }
          break;
        }
        case "thinking": {
          const text = stringValue(block.thinking)?.trim();
          if (text) await this.emitContent("agent_thought_chunk", key, messageId, { type: "text", text });
          break;
        }
        case "tool_use":
          await this.translateToolUse(block);
          break;
        case "image":
          await this.emitContent("agent_message_chunk", key, messageId, imageContent(block));
          break;
        default:
          this.reportUnknown(`assistant:${String(block.type)}`);
      }
    }
    await this.translateUsage(record, message);
  }

  private async translateToolUse(block: TranscriptRecord): Promise<void> {
    const toolCallId = stringValue(block.id);
    const name = stringValue(block.name) || "Tool";
    const input = objectValue(block.input) || {};
    if (!toolCallId) {
      this.reportUnknown(`tool:${name}:missing-id`);
      return;
    }
    if (name === "TodoWrite") {
      await this.translatePlan(input.todos);
      return;
    }
    if (this.emittedTools.has(toolCallId)) return;
    this.emittedTools.add(toolCallId);
    const locations = toolLocations(input, this.cwd);
    const content = toolContents(name, input, this.cwd);
    await this.send({
      sessionUpdate: "tool_call",
      toolCallId,
      title: toolTitle(name, input),
      kind: TOOL_KINDS[name] || "other",
      status: "in_progress",
      rawInput: input,
      ...(locations.length > 0 ? { locations } : {}),
      ...(content.length > 0 ? { content } : {}),
    });
  }

  private async translateToolResult(block: TranscriptRecord): Promise<void> {
    const toolCallId = stringValue(block.tool_use_id);
    if (!toolCallId || !this.emittedTools.has(toolCallId)) return;
    const resultKey = `${toolCallId}:result:${createHash("sha256").update(JSON.stringify(block)).digest("hex")}`;
    if (this.emitted.has(resultKey)) return;
    this.emitted.add(resultKey);
    const content = resultContent(block.content);
    await this.send({
      sessionUpdate: "tool_call_update",
      toolCallId,
      status: block.is_error === true ? "failed" : "completed",
      rawOutput: block.content,
      ...(content.length > 0 ? { content } : {}),
    });
  }

  private async translatePlan(value: unknown): Promise<void> {
    if (!Array.isArray(value)) return;
    const entries: PlanEntry[] = [];
    for (const todo of value) {
      const item = objectValue(todo);
      const content = stringValue(item?.content);
      if (!item || !content) continue;
      const status = item.status === "completed" || item.status === "in_progress" ? item.status : "pending";
      entries.push({ content, priority: "medium", status });
    }
    const signature = JSON.stringify(entries);
    if (signature === this.lastPlan) return;
    this.lastPlan = signature;
    await this.send({ sessionUpdate: "plan", entries });
  }

  private async translateUsage(record: TranscriptRecord, message: TranscriptRecord | null): Promise<void> {
    const usage = objectValue(message?.usage) || objectValue(record.usage);
    if (!usage) return;
    const size = firstNumber(record.contextWindow, record.context_window, usage.contextWindow, usage.context_window);
    const input = firstNumber(usage.input_tokens, usage.inputTokens) || 0;
    const cacheRead = firstNumber(usage.cache_read_input_tokens, usage.cacheReadInputTokens) || 0;
    const cacheWrite = firstNumber(usage.cache_creation_input_tokens, usage.cacheCreationInputTokens) || 0;
    const used = firstNumber(record.contextUsed, record.context_used, usage.contextUsed, usage.context_used) ?? input + cacheRead + cacheWrite;
    if (size === null || size <= 0 || used < 0) return;
    const update = { sessionUpdate: "usage_update" as const, size, used: Math.min(used, size) };
    const signature = JSON.stringify(update);
    if (signature === this.lastUsage) return;
    this.lastUsage = signature;
    await this.send(update);
  }

  private async translateSystem(record: TranscriptRecord): Promise<void> {
    const content = stringValue(record.content)?.trim();
    const subtype = stringValue(record.subtype);
    if (!content || subtype === "turn_duration") return;
    const key = `${stringValue(record.uuid) || stableUuid(JSON.stringify(record))}:system`;
    await this.emitContent("agent_message_chunk", key, key, { type: "text", text: content });
  }

  private async translateAttachment(record: TranscriptRecord): Promise<void> {
    const attachment = objectValue(record.attachment);
    const type = stringValue(attachment?.type);
    if (!attachment || !type) return;
    if (type === "hook_system_message" || type === "hook_non_blocking_error" || type === "hook_cancelled") {
      const text = stringValue(attachment.content) || stringValue(attachment.stderr) || `${stringValue(attachment.hookName) || "Hook"} ${type.replace("hook_", "")}`;
      const key = `${stringValue(record.uuid) || stableUuid(JSON.stringify(record))}:attachment`;
      await this.emitContent("agent_message_chunk", key, key, { type: "text", text });
    }
  }

  private async emitContent(
    sessionUpdate: "user_message_chunk" | "agent_message_chunk" | "agent_thought_chunk",
    key: string,
    sourceMessageId: string,
    content: ContentBlock | null,
  ): Promise<void> {
    if (!content || this.emitted.has(key)) return;
    this.emitted.add(key);
    if (sessionUpdate === "agent_message_chunk") this.assistantChunkCount += 1;
    await this.send({ sessionUpdate, messageId: stableUuid(sourceMessageId), content });
  }

  private async send(update: SessionUpdate): Promise<void> {
    await this.connection.sessionUpdate({ sessionId: this.sessionId, update });
  }

  private reportUnknown(kind: string): void {
    if (this.unknownKinds.has(kind)) return;
    this.unknownKinds.add(kind);
    writeLog({ level: "warn", message: "Unknown Claude transcript kind", sessionId: this.sessionId, kind });
  }
}

function stableUuid(value: string): string {
  const bytes = createHash("sha256").update(value).digest().subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function objectValue(value: unknown): TranscriptRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as TranscriptRecord) : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function firstNumber(...values: unknown[]): number | null {
  for (const value of values) if (typeof value === "number" && Number.isFinite(value)) return value;
  return null;
}

function cleanUserText(text: string): string {
  return text
    .replace(/<(system-reminder|task-notification|user-prompt-submit-hook|local-command-stdout|local-command-stderr|command-message)>[\s\S]*?<\/\1>/g, "")
    .trim();
}

function imageContent(block: TranscriptRecord): ContentBlock | null {
  const source = objectValue(block.source);
  const data = stringValue(source?.data);
  if (!data) return null;
  return { type: "image", data, mimeType: stringValue(source?.media_type) || "image/png" };
}

function toolTitle(name: string, input: TranscriptRecord): string {
  const detail = stringValue(input.description) || stringValue(input.file_path) || stringValue(input.query) || stringValue(input.pattern) || stringValue(input.command)?.split("\n")[0];
  return detail ? `${name}: ${detail}` : name;
}

function toolLocations(input: TranscriptRecord, cwd: string): ToolCallLocation[] {
  const filePath = stringValue(input.file_path) || stringValue(input.path);
  if (!filePath) return [];
  return [{ path: path.isAbsolute(filePath) ? filePath : path.resolve(cwd, filePath), ...(typeof input.offset === "number" ? { line: input.offset } : {}) }];
}

function toolContents(name: string, input: TranscriptRecord, cwd: string): ToolCallContent[] {
  const filePath = stringValue(input.file_path) || stringValue(input.notebook_path);
  const resolvedPath = filePath ? (path.isAbsolute(filePath) ? filePath : path.resolve(cwd, filePath)) : null;
  if ((name === "Edit" || name === "NotebookEdit") && resolvedPath) {
    return [{ type: "diff", path: resolvedPath, oldText: stringValue(input.old_string), newText: stringValue(input.new_string) || "" }];
  }
  if (name === "MultiEdit" && resolvedPath && Array.isArray(input.edits)) {
    return input.edits.flatMap((value) => {
      const edit = objectValue(value);
      return edit ? [{ type: "diff" as const, path: resolvedPath, oldText: stringValue(edit.old_string), newText: stringValue(edit.new_string) || "" }] : [];
    });
  }
  if (name === "Write" && resolvedPath) return [{ type: "diff", path: resolvedPath, newText: stringValue(input.content) || "" }];
  const command = stringValue(input.command);
  return command ? [{ type: "content", content: { type: "text", text: command } }] : [];
}

function resultContent(value: unknown): ToolCallContent[] {
  const blocks = Array.isArray(value) ? value : typeof value === "string" ? [{ type: "text", text: value }] : [];
  const content: ToolCallContent[] = [];
  for (const blockValue of blocks) {
    const block = objectValue(blockValue);
    if (!block) continue;
    if (block.type === "text" && typeof block.text === "string") content.push({ type: "content", content: { type: "text", text: block.text } });
    if (block.type === "image") {
      const image = imageContent(block);
      if (image) content.push({ type: "content", content: image });
    }
  }
  return content;
}
