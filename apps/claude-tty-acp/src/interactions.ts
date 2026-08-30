import { randomUUID } from "node:crypto";
import path from "node:path";
import type { AgentSideConnection, PermissionOption, RequestPermissionResponse, ToolCallUpdate, ToolKind } from "@agentclientprotocol/sdk";
import { createDeferred, type Deferred } from "./deferred.ts";
import type { HookPayload, HookResponse } from "./hook-server.ts";

type PermissionSuggestion = Record<string, unknown>;

type PendingTool = {
  id: string;
  name: string;
  input: Record<string, unknown>;
};

type PermissionChoice = {
  response: RequestPermissionResponse;
  suggestion?: PermissionSuggestion;
};

const TOOL_KINDS: Record<string, ToolKind> = {
  Bash: "execute",
  Edit: "edit",
  Glob: "search",
  Grep: "search",
  MultiEdit: "edit",
  NotebookEdit: "edit",
  Read: "read",
  WebFetch: "fetch",
  WebSearch: "search",
  Write: "edit",
};

export class InteractionBridge {
  private readonly sessionId: string;
  private readonly cwd: string;
  private readonly connection: AgentSideConnection;
  private readonly pendingTools: PendingTool[] = [];
  private readonly pendingRequests = new Set<Deferred<RequestPermissionResponse>>();

  constructor(sessionId: string, cwd: string, connection: AgentSideConnection) {
    this.sessionId = sessionId;
    this.cwd = cwd;
    this.connection = connection;
  }

  beginTurn(): void {
    this.pendingTools.length = 0;
    this.cancelPending();
  }

  cancelPending(): void {
    for (const pending of this.pendingRequests) pending.resolve({ outcome: { outcome: "cancelled" } });
    this.pendingRequests.clear();
  }

  async handlePreToolUse(payload: HookPayload): Promise<HookResponse> {
    const name = stringValue(payload.tool_name) || "Tool";
    const input = objectValue(payload.tool_input) || {};
    const toolUseId = stringValue(payload.tool_use_id) || `tool-${randomUUID()}`;
    this.pendingTools.push({ id: toolUseId, name, input });
    if (name === "AskUserQuestion") return this.handleQuestions(toolUseId, input);
    if (name === "ExitPlanMode") return this.handlePlanApproval(toolUseId, input);
    return {};
  }

  async handlePermissionRequest(payload: HookPayload): Promise<HookResponse> {
    const name = stringValue(payload.tool_name) || "Tool";
    const input = objectValue(payload.tool_input) || {};
    const pending = this.takePendingTool(name, input);
    const toolCallId = pending?.id || `permission-${randomUUID()}`;
    const suggestions = Array.isArray(payload.permission_suggestions)
      ? payload.permission_suggestions.filter((value): value is PermissionSuggestion => objectValue(value) !== null)
      : [];
    const suggestionByOption = new Map<string, PermissionSuggestion>();
    const options: PermissionOption[] = [{ optionId: "allow-once", name: "Allow once", kind: "allow_once" }];
    for (let index = 0; index < suggestions.length; index += 1) {
      const optionId = `allow-suggestion-${index}`;
      suggestionByOption.set(optionId, suggestions[index]!);
      options.push({ optionId, name: suggestionLabel(suggestions[index]!), kind: "allow_always" });
    }
    options.push({ optionId: "deny", name: "Deny", kind: "reject_once" });
    const response = await this.request({
      toolCall: toolCall(toolCallId, name, input, this.cwd),
      options,
    });
    const choice: PermissionChoice = {
      response,
      ...(response.outcome.outcome === "selected" ? { suggestion: suggestionByOption.get(response.outcome.optionId) } : {}),
    };
    return permissionHookResponse(choice);
  }

  private async handleQuestions(toolUseId: string, input: Record<string, unknown>): Promise<HookResponse> {
    const questions = Array.isArray(input.questions) ? input.questions : [];
    const answers: Record<string, string> = {};
    for (let index = 0; index < questions.length; index += 1) {
      const question = objectValue(questions[index]);
      const text = stringValue(question?.question);
      if (!question || !text) continue;
      const selected = new Set<string>();
      let round = 0;
      while (true) {
        const choices = Array.isArray(question.options) ? question.options : [];
        const options: PermissionOption[] = choices.flatMap((value, optionIndex) => {
          const option = objectValue(value);
          const label = stringValue(option?.label);
          if (!label) return [];
          return [answerOption(`answer-${optionIndex}`, `${selected.has(label) ? "✓ " : ""}${label}`)];
        });
        if (question.multiSelect === true) options.push(answerOption("done", "Done"));
        options.push(questionOption("reply-next", "Reply in next message"));
        const response = await this.request({
          toolCall: {
            toolCallId: `${toolUseId}-question-${index}-${round}`,
            title: stringValue(question.header) || text,
            kind: "other",
            status: "pending",
            rawInput: question,
          },
          options,
        });
        if (response.outcome.outcome === "cancelled" || response.outcome.optionId === "reply-next") return conversationalQuestionFallback();
        if (response.outcome.optionId === "done") {
          answers[text] = [...selected].join(", ");
          break;
        }
        const optionIndex = Number.parseInt(response.outcome.optionId.replace("answer-", ""), 10);
        const chosen = objectValue(choices[optionIndex]);
        const label = stringValue(chosen?.label);
        if (!label) return conversationalQuestionFallback();
        if (question.multiSelect !== true) {
          answers[text] = label;
          break;
        }
        if (selected.has(label)) selected.delete(label);
        else selected.add(label);
        round += 1;
      }
    }
    return preToolAllow({ ...input, answers });
  }

  private async handlePlanApproval(toolUseId: string, input: Record<string, unknown>): Promise<HookResponse> {
    const plan = stringValue(input.plan) || stringValue(input.planContent) || stringValue(input.plan_file_path);
    const response = await this.request({
      toolCall: {
        toolCallId: `${toolUseId}-approval`,
        title: "Approve Claude's plan",
        kind: "switch_mode",
        status: "pending",
        rawInput: input,
        ...(plan ? { content: [{ type: "content", content: { type: "text", text: plan } }] } : {}),
      },
      options: [
        { optionId: "approve-plan", name: "Approve plan", kind: "allow_once" },
        { optionId: "deny-plan", name: "Keep planning", kind: "reject_once" },
      ],
    });
    if (response.outcome.outcome === "selected" && response.outcome.optionId === "approve-plan") return preToolAllow(input);
    return preToolDeny("The user did not approve leaving plan mode.");
  }

  private request(params: { toolCall: ToolCallUpdate; options: PermissionOption[] }): Promise<RequestPermissionResponse> {
    const cancellation = createDeferred<RequestPermissionResponse>();
    this.pendingRequests.add(cancellation);
    return Promise.race([
      this.connection.requestPermission({ sessionId: this.sessionId, ...params }),
      cancellation.promise,
    ]).finally(() => this.pendingRequests.delete(cancellation));
  }

  private takePendingTool(name: string, input: Record<string, unknown>): PendingTool | null {
    const signature = JSON.stringify(input);
    const index = this.pendingTools.findLastIndex((tool) => tool.name === name && JSON.stringify(tool.input) === signature);
    if (index < 0) return null;
    return this.pendingTools.splice(index, 1)[0] || null;
  }
}

function permissionHookResponse(choice: PermissionChoice): HookResponse {
  const outcome = choice.response.outcome;
  if (outcome.outcome === "cancelled" || outcome.optionId === "deny") {
    return {
      hookSpecificOutput: {
        hookEventName: "PermissionRequest",
        decision: { behavior: "deny", message: outcome.outcome === "cancelled" ? "The permission request was cancelled." : "The user denied this action.", interrupt: false },
      },
    };
  }
  return {
    hookSpecificOutput: {
      hookEventName: "PermissionRequest",
      decision: { behavior: "allow", ...(choice.suggestion ? { updatedPermissions: [choice.suggestion] } : {}) },
    },
  };
}

function preToolAllow(updatedInput: Record<string, unknown>): HookResponse {
  return { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "allow", updatedInput } };
}

function preToolDeny(reason: string): HookResponse {
  return { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: reason } };
}

function conversationalQuestionFallback(): HookResponse {
  return preToolDeny("Restate the question conversationally, end this turn, and wait for the user to answer in their next message.");
}

function questionOption(optionId: string, name: string): PermissionOption {
  return { optionId, name, kind: "reject_once" };
}

function answerOption(optionId: string, name: string): PermissionOption {
  return { optionId, name, kind: "allow_once" };
}

function toolCall(id: string, name: string, input: Record<string, unknown>, cwd: string): ToolCallUpdate {
  const candidatePath = stringValue(input.file_path) || stringValue(input.path);
  const resolvedPath = candidatePath ? (path.isAbsolute(candidatePath) ? candidatePath : path.resolve(cwd, candidatePath)) : null;
  return {
    toolCallId: id,
    title: toolTitle(name, input),
    kind: TOOL_KINDS[name] || "other",
    status: "pending",
    rawInput: input,
    ...(resolvedPath ? { locations: [{ path: resolvedPath }] } : {}),
  };
}

function toolTitle(name: string, input: Record<string, unknown>): string {
  const detail = stringValue(input.description) || stringValue(input.command)?.split("\n")[0] || stringValue(input.file_path) || stringValue(input.query);
  return detail ? `${name}: ${detail}` : name;
}

function suggestionLabel(suggestion: PermissionSuggestion): string {
  const destination = stringValue(suggestion.destination);
  const rules = Array.isArray(suggestion.rules) ? suggestion.rules : [];
  const firstRule = objectValue(rules[0]);
  const toolName = stringValue(firstRule?.toolName);
  const content = stringValue(firstRule?.ruleContent);
  const scope = destination === "userSettings" ? "globally" : destination === "projectSettings" ? "for this project" : "locally";
  return toolName ? `Always allow ${toolName}${content ? ` (${content})` : ""} ${scope}` : `Apply Claude's permission suggestion ${scope}`;
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}
