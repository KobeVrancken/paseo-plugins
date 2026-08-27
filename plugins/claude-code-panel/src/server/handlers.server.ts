import { z } from "zod";
import * as contracts from "../contracts.shared.ts";
import { listTerminals } from "./paseo-cli.server.ts";
import type { SessionStatus } from "../render-types.shared.ts";
import * as control from "./session-control.server.ts";
import {
  enableHooks as patchHooks,
  hooksEnabled,
  workspaceSessionStatus,
  type PaseoLike,
} from "./session-status.server.ts";
import { readCliSettings, modelLabel } from "./cli-settings.server.ts";
import {
  cleanupOldUploads,
  fullImageDataUrl,
  imagePreviewDataUrl,
  resolveAttachmentPath,
  saveBase64File,
  saveBase64Image,
} from "./uploads.server.ts";
import { listSlashCommands } from "./commands.server.ts";
import { snapshotFile, waitForFileChange } from "./file-events.server.ts";
import { sendWatchingFrame } from "./presence.server.ts";
import { searchWorkspaceEntries } from "./file-search.server.ts";
import { searchForgeItems } from "./github.server.ts";
import {
  deliveryFor,
  forgetDelivery,
  noteDelivery,
  shouldLookForSuccessor,
  transcriptTookThePrompt,
} from "./session-rotation.server.ts";
import { StateStore } from "./state.server.ts";
import { TranscriptStore, isRecentlyActive } from "./transcript.server.ts";

const store = new TranscriptStore();
const state = new StateStore();

type Input<Contract extends { input: z.ZodType }> = z.output<Contract["input"]>;
type Output<Contract extends { output: z.ZodType }> = z.input<Contract["output"]>;
type Context = { paseo: PaseoLike };

let prunedBindings = false;

void cleanupOldUploads().then((removed) => {
  if (removed > 0) console.log(`removed ${removed} cached upload(s) older than a week`);
});

/** Bindings survive daemon restarts, so validate them against the live terminals once per process. */
async function pruneStaleBindingsOnce(): Promise<void> {
  if (prunedBindings) return;
  prunedBindings = true;
  try {
    const terminals = await listTerminals();
    const dropped = await state.pruneBindings(new Set(terminals.map((terminal) => terminal.id)));
    if (dropped.length > 0) console.log(`dropped ${dropped.length} binding(s) for terminals that are gone`);
  } catch (error) {
    prunedBindings = false;
    console.log(`could not validate terminal bindings: ${String(error)}`);
  }
}

async function boundTerminalId(sessionId: string): Promise<string | null> {
  await pruneStaleBindingsOnce();
  return (await state.binding(sessionId))?.terminalId ?? null;
}

async function statusFor(
  paseo: PaseoLike,
  sessionId: string,
  workspaceId: string | undefined,
): Promise<SessionStatus> {
  const terminalId = await boundTerminalId(sessionId);
  if (!terminalId) return "detached";
  if (!workspaceId) return "idle";
  return workspaceSessionStatus(paseo, workspaceId);
}

export async function listSessionsHandler(
  input: Input<typeof contracts.listSessions>,
): Promise<Output<typeof contracts.listSessions>> {
  await pruneStaleBindingsOnce();
  const projectDir = await store.projectDir(input.workspaceDir);
  const files = await store.listSessionFiles(input.workspaceDir);
  const bindings = await state.bindings();
  const sessions = files.map((file) => ({
    sessionId: file.sessionId,
    mtime: file.mtime,
    title: file.title,
    preview: file.preview,
    isLive: bindings[file.sessionId] !== undefined || isRecentlyActive(file.mtime),
    boundTerminalId: bindings[file.sessionId]?.terminalId ?? null,
  }));

  // A session started from the panel has no transcript until its first prompt lands.
  for (const [sessionId, binding] of Object.entries(bindings)) {
    if (binding.workspaceDir !== input.workspaceDir) continue;
    if (sessions.some((session) => session.sessionId === sessionId)) continue;
    sessions.unshift({
      sessionId,
      mtime: binding.boundAt,
      title: null,
      preview: "",
      isLive: true,
      boundTerminalId: binding.terminalId,
    });
  }

  return { projectDir, sessions };
}

/** Armed as the keys go in, because how far the transcript had got by then is what says whether the prompt ever landed in it. */
async function armRotationWatch(workspaceDir: string, sessionId: string): Promise<void> {
  const at = Date.now();
  const entryTotal = await store.entryTotal(workspaceDir, sessionId).catch(() => null);
  noteDelivery(sessionId, { at, entryTotal: entryTotal ?? 0 });
}

/**
 * `/clear` leaves the bound transcript behind for a new one, and neither file records the other, so the successor is found by elimination and the binding follows it.
 * Null whenever the session is merely quiet, which is every other reason a poll comes back empty.
 */
async function followRotation(
  workspaceDir: string,
  sessionId: string,
  entryTotal: number | null,
): Promise<string | null> {
  const delivery = deliveryFor(sessionId);
  if (delivery === null) return null;
  if (transcriptTookThePrompt(delivery, entryTotal)) {
    forgetDelivery(sessionId);
    return null;
  }
  if (!shouldLookForSuccessor({ delivery, entryTotal })) return null;
  const successor = await store.findSuccessor(workspaceDir, sessionId, delivery.at);
  if (successor === null) return null;
  const binding = await state.binding(sessionId);
  if (!binding) return null;
  forgetDelivery(sessionId);
  await state.unbind(sessionId);
  await state.bind(successor, { ...binding, boundAt: Date.now() });
  console.log(`session ${sessionId} was cleared and continues as ${successor}`);
  return successor;
}

export async function getTimelineHandler(
  input: Input<typeof contracts.getTimeline>,
  context: Context,
): Promise<Output<typeof contracts.getTimeline>> {
  const readSlice = () =>
    store.timelineSince(input.workspaceDir, input.sessionId, input.sinceRevision, input.fromIndex);

  // The snapshot is taken before the read, so an append that lands during the read is a change too.
  const filePath = input.waitMs > 0 ? await store.sessionFilePath(input.workspaceDir, input.sessionId) : null;
  const before = filePath === null ? null : await snapshotFile(filePath);

  let sessionStatus = await statusFor(context.paseo, input.sessionId, input.workspaceId);
  let slice = await readSlice();

  // Nothing to say yet: hold the request open until the transcript moves rather than answer "no" and
  // be asked again. The kernel reports the append, so the panel sees it as soon as the CLI writes it.
  if (filePath !== null && (slice?.entries.length ?? 0) === 0) {
    if (await waitForFileChange(filePath, before, input.waitMs)) {
      slice = await readSlice();
      sessionStatus = await statusFor(context.paseo, input.sessionId, input.workspaceId);
    }
  }
  const rotatedTo = await followRotation(input.workspaceDir, input.sessionId, slice?.total ?? null);

  if (!slice) {
    return {
      entries: [],
      total: 0,
      windowStart: 0,
      revision: 0,
      reset: true,
      rotatedTo,
      sessionStatus,
    };
  }
  return {
    entries: slice.entries,
    total: slice.total,
    windowStart: slice.windowStart,
    revision: slice.revision,
    reset: slice.reset,
    rotatedTo,
    sessionStatus,
  };
}

export async function getTimelineEntryHandler(
  input: Input<typeof contracts.getTimelineEntry>,
): Promise<Output<typeof contracts.getTimelineEntry>> {
  return { entry: await store.entryAt(input.workspaceDir, input.sessionId, input.index) };
}

export async function getHooksStatusHandler(
  _input: Input<typeof contracts.getHooksStatus>,
  context: Context,
): Promise<Output<typeof contracts.getHooksStatus>> {
  return { enabled: await hooksEnabled(context.paseo) };
}

export async function enableHooksHandler(
  _input: Input<typeof contracts.enableHooks>,
  context: Context,
): Promise<Output<typeof contracts.enableHooks>> {
  return { enabled: await patchHooks(context.paseo) };
}

export async function getSettingsHandler(): Promise<Output<typeof contracts.getSettings>> {
  return await state.settings();
}

export async function setSettingsHandler(
  input: Input<typeof contracts.setSettings>,
): Promise<Output<typeof contracts.setSettings>> {
  await state.setSendBehavior(input.sendBehavior);
  return { sendBehavior: input.sendBehavior };
}

export async function startSessionHandler(
  input: Input<typeof contracts.startSession>,
): Promise<Output<typeof contracts.startSession>> {
  const started = await control.startSession(input.workspaceDir);
  await state.bind(started.sessionId, {
    terminalId: started.terminalId,
    workspaceDir: input.workspaceDir,
    boundAt: Date.now(),
  });
  console.log(`started session ${started.sessionId} in terminal ${started.terminalId}`);
  return started;
}

export async function resumeSessionHandler(
  input: Input<typeof contracts.resumeSession>,
): Promise<Output<typeof contracts.resumeSession>> {
  const resumed = await control.resumeSession(input.workspaceDir, input.sessionId);
  await state.bind(resumed.sessionId, {
    terminalId: resumed.terminalId,
    workspaceDir: input.workspaceDir,
    boundAt: Date.now(),
  });
  console.log(`resumed session ${resumed.sessionId} in terminal ${resumed.terminalId}`);
  return resumed;
}

export async function listAttachableTerminalsHandler(
  input: Input<typeof contracts.listAttachableTerminals>,
): Promise<Output<typeof contracts.listAttachableTerminals>> {
  return { terminals: await control.listAttachableTerminals(input.workspaceDir) };
}

export async function attachTerminalHandler(
  input: Input<typeof contracts.attachTerminal>,
): Promise<Output<typeof contracts.attachTerminal>> {
  await state.bind(input.sessionId, {
    terminalId: input.terminalId,
    workspaceDir: input.workspaceDir,
    boundAt: Date.now(),
  });
  return { terminalId: input.terminalId };
}

export async function detachTerminalHandler(
  input: Input<typeof contracts.detachTerminal>,
): Promise<Output<typeof contracts.detachTerminal>> {
  await state.unbind(input.sessionId);
  return { detached: true };
}

export async function sendPromptHandler(
  input: Input<typeof contracts.sendPrompt>,
  context: Context,
): Promise<Output<typeof contracts.sendPrompt>> {
  const terminalId = await boundTerminalId(input.sessionId);
  if (!terminalId) return { delivered: false, note: "no terminal is bound to this session" };
  const { sendBehavior } = await state.settings();
  return control.sendPrompt({
    terminalId,
    text: input.text,
    references: input.references,
    behavior: sendBehavior,
    readStatus: () => statusFor(context.paseo, input.sessionId, input.workspaceId),
    onDeliver: () => void armRotationWatch(input.workspaceDir, input.sessionId),
  });
}

export async function getDialogHandler(
  input: Input<typeof contracts.getDialog>,
): Promise<Output<typeof contracts.getDialog>> {
  const terminalId = await boundTerminalId(input.sessionId);
  if (!terminalId) return { dialog: null, terminalId: null };
  try {
    return { dialog: await control.readDialog(terminalId), terminalId };
  } catch (error) {
    console.log(`could not read the terminal screen: ${String(error)}`);
    return { dialog: null, terminalId };
  }
}

export async function answerDialogHandler(
  input: Input<typeof contracts.answerDialog>,
): Promise<Output<typeof contracts.answerDialog>> {
  const terminalId = await boundTerminalId(input.sessionId);
  if (!terminalId) {
    return {
      answered: false,
      verified: false,
      warning: "no terminal is bound to this session",
      note: null,
    };
  }
  const dialog = await control.readDialog(terminalId);
  if (!dialog) {
    return {
      answered: false,
      verified: false,
      warning: "no dialog is on screen — answer it in the terminal",
      note: null,
    };
  }
  const optionIndices =
    input.labels.length > 0 ? control.optionIndicesForLabels(dialog, input.labels) : input.optionIndices;
  if (optionIndices.length === 0) {
    return {
      answered: false,
      verified: false,
      warning: "the terminal is showing different options — answer it in the terminal",
      note: null,
    };
  }
  return control.answerDialog({ terminalId, dialog, optionIndices });
}

export async function attachPathHandler(
  input: Input<typeof contracts.attachPath>,
): Promise<Output<typeof contracts.attachPath>> {
  const attached = await resolveAttachmentPath(input.path);
  return { ...attached, previewDataUrl: await imagePreviewDataUrl(attached.path) };
}

export async function uploadImageHandler(
  input: Input<typeof contracts.uploadImage>,
): Promise<Output<typeof contracts.uploadImage>> {
  return { path: await saveBase64Image(input.fileName, input.base64) };
}

export async function readImageHandler(
  input: Input<typeof contracts.readImage>,
): Promise<Output<typeof contracts.readImage>> {
  return { dataUrl: await fullImageDataUrl(input.path) };
}

export async function uploadFileHandler(
  input: Input<typeof contracts.uploadFile>,
): Promise<Output<typeof contracts.uploadFile>> {
  return { path: await saveBase64File(input.fileName, input.base64) };
}

export async function searchForgeItemsHandler(
  input: Input<typeof contracts.searchForgeItems>,
): Promise<Output<typeof contracts.searchForgeItems>> {
  return searchForgeItems(input.workspaceDir, input.query, input.limit);
}

export async function suggestFilesHandler(
  input: Input<typeof contracts.suggestFiles>,
): Promise<Output<typeof contracts.suggestFiles>> {
  return {
    entries: await searchWorkspaceEntries({
      root: input.workspaceDir,
      query: input.query,
      limit: input.limit,
    }),
  };
}

export async function watchTerminalHandler(
  input: Input<typeof contracts.watchTerminal>,
): Promise<Output<typeof contracts.watchTerminal>> {
  return { claimed: await sendWatchingFrame(input.terminalId) };
}

export async function listCommandsHandler(
  input: Input<typeof contracts.listCommands>,
): Promise<Output<typeof contracts.listCommands>> {
  return { commands: await listSlashCommands(input.workspaceDir) };
}

export async function getComposerStateHandler(
  input: Input<typeof contracts.getComposerState>,
): Promise<Output<typeof contracts.getComposerState>> {
  const [settings, model, terminalId] = await Promise.all([
    readCliSettings(input.workspaceDir),
    store.lastModel(input.workspaceDir, input.sessionId),
    boundTerminalId(input.sessionId),
  ]);
  return {
    model: modelLabel(model),
    effortLevel: settings.effortLevel,
    thinking: settings.thinking,
    bound: terminalId !== null,
  };
}

export async function openCliMenuHandler(
  input: Input<typeof contracts.openCliMenu>,
): Promise<Output<typeof contracts.openCliMenu>> {
  const terminalId = await boundTerminalId(input.sessionId);
  if (!terminalId) return { opened: false, warning: "no terminal is bound to this session" };
  await control.openCliMenu(terminalId, input.menu);
  return { opened: true, warning: null };
}

export async function permissionModeHandler(
  input: Input<typeof contracts.permissionMode>,
): Promise<Output<typeof contracts.permissionMode>> {
  const terminalId = await boundTerminalId(input.sessionId);
  if (!terminalId) return { mode: null, warning: "no terminal is bound to this session" };
  try {
    if (input.mode === null) return { mode: await control.readPermissionMode(terminalId), warning: null };
    return await control.setPermissionMode(terminalId, input.mode);
  } catch (error) {
    console.log(`could not read the terminal screen: ${String(error)}`);
    return { mode: null, warning: "could not read the terminal screen" };
  }
}
