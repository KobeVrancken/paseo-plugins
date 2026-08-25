import type { PluginWorkspacePanelProps } from "@getpaseo/plugin";
import { useRpc, useWorkspace } from "@getpaseo/plugin";
import { useMutation, useQuery } from "@tanstack/react-query";
import React, { useCallback, useMemo, useRef, useState } from "react";
import { Clipboard, FlatList, Linking, Platform, Pressable, Text, View } from "react-native";
import * as contracts from "../contracts.shared.ts";
import {
  addAttachment,
  fileAttachment,
  forgeAttachment,
  imageAttachment,
  type Attachment,
  type ForgeItem,
} from "./attachments.client.ts";
import { base64FromDataUrl } from "./clipboard-image.client.ts";
import { IMAGE_ACCEPT, pickFiles } from "./file-picker.client.ts";
import { AttachmentLightbox } from "./lightbox.client.tsx";
import {
  DialogCard,
  EFFORT_LABELS,
  ForgePickerSheet,
  HooksOnboarding,
  ImageAttachSheet,
  PERMISSION_MODE_LABELS,
  PERMISSION_MODES,
  PromptBox,
  ResumeBar,
  SEND_BEHAVIOR_HINTS,
  SEND_BEHAVIOR_LABELS,
  Sheet,
  SheetNote,
  SheetRow,
  StatusPill,
} from "./panel-controls.client.tsx";
import type { RenderEntry, SendBehavior, SessionStatus, SessionSummary } from "../render-types.shared.ts";
import { fontSize, HEADER_HEIGHT, MAX_CONTENT_WIDTH, radius, spacing, type Palette } from "./theme.client.ts";
import { groupEntries, type TimelineItem } from "./timeline-model.client.ts";
import { TimelineItemView } from "./timeline.client.tsx";
import {
  Button,
  IconButton,
  pressable,
  useDebounced,
  usePalette,
  relativeTimeFrom,
} from "./ui.client.tsx";

const SESSION_POLL_MS = 2000;
const TIMELINE_POLL_MS = 750;
const HOOKS_POLL_MS = 5000;
const DIALOG_OPEN_POLL_MS = 1500;
const DIALOG_WATCH_POLL_MS = 3000;
const DIALOG_BACKOFF_POLL_MS = 10_000;
const DIALOG_WATCH_AFTER_MS = 2000;
const DIALOG_BACKOFF_AFTER_MS = 45_000;
const DIALOG_GIVE_UP_AFTER_MS = 120_000;
const SEND_BEHAVIORS: SendBehavior[] = ["cli_default", "hold_until_idle", "interrupt_first"];
const COMPOSER_POLL_MS = 5000;
const FORGE_SEARCH_DEBOUNCE_MS = 250;
const FORGE_SEARCH_STALE_MS = 30_000;
/** How long opening a CLI menu keeps the screen watched, so the menu reaches the dialog card. */
const MENU_WATCH_MS = 60_000;

type TimelineState = {
  key: string;
  revision: number;
  entries: (RenderEntry | undefined)[];
  total: number;
  windowStart: number;
  sessionStatus: SessionStatus;
  lastChangeAt: number;
};

function emptyTimeline(key: string): TimelineState {
  return {
    key,
    revision: 0,
    entries: [],
    total: 0,
    windowStart: 0,
    sessionStatus: "detached",
    lastChangeAt: Date.now(),
  };
}

function sessionLabel(session: SessionSummary): string {
  return session.title || session.preview || session.sessionId.slice(0, 8);
}

/** "Off" is a real state of the CLI's thinking toggle, not a missing reading. */
function effortLabel(state: { thinking: boolean; effortLevel: string | null }): string {
  if (!state.thinking) return "Off";
  if (state.effortLevel === null) return "Thinking";
  return EFFORT_LABELS[state.effortLevel] ?? state.effortLevel;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function ClaudeCodePanel({ workspaceId, theme, layout }: PluginWorkspacePanelProps) {
  const palette = usePalette(theme);
  const workspaceDir = useWorkspace(workspaceId, (workspace) => workspace.directory);
  const listSessions = useRpc(contracts.listSessions);
  const getTimeline = useRpc(contracts.getTimeline);
  const getHooksStatus = useRpc(contracts.getHooksStatus);
  const enableHooks = useRpc(contracts.enableHooks);
  const getSettings = useRpc(contracts.getSettings);
  const setSettings = useRpc(contracts.setSettings);
  const startSession = useRpc(contracts.startSession);
  const resumeSession = useRpc(contracts.resumeSession);
  const listAttachable = useRpc(contracts.listAttachableTerminals);
  const attachTerminal = useRpc(contracts.attachTerminal);
  const sendPrompt = useRpc(contracts.sendPrompt);
  const getTimelineEntry = useRpc(contracts.getTimelineEntry);
  const getDialog = useRpc(contracts.getDialog);
  const answerDialog = useRpc(contracts.answerDialog);
  const attachImage = useRpc(contracts.attachImage);
  const uploadImage = useRpc(contracts.uploadImage);
  const uploadFile = useRpc(contracts.uploadFile);
  const readImage = useRpc(contracts.readImage);
  const searchForgeItems = useRpc(contracts.searchForgeItems);
  const getComposerState = useRpc(contracts.getComposerState);
  const openCliMenu = useRpc(contracts.openCliMenu);
  const permissionMode = useRpc(contracts.permissionMode);

  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [attachOpen, setAttachOpen] = useState(false);
  const [imageSheetOpen, setImageSheetOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [forgeOpen, setForgeOpen] = useState(false);
  const [forgeQuery, setForgeQuery] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [openedImage, setOpenedImage] = useState<Attachment | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [modeOpen, setModeOpen] = useState(false);
  const [forceWatchUntil, setForceWatchUntil] = useState(0);
  const [windowStart, setWindowStart] = useState<number | null>(null);

  const sessionsQuery = useQuery({
    queryKey: ["claude-code-sessions", workspaceDir],
    enabled: workspaceDir !== null,
    refetchInterval: SESSION_POLL_MS,
    queryFn: () => listSessions({ workspaceDir: workspaceDir! }),
  });

  const hooksQuery = useQuery({
    queryKey: ["claude-code-hooks"],
    refetchInterval: HOOKS_POLL_MS,
    queryFn: () => getHooksStatus({}),
  });

  const settingsQuery = useQuery({
    queryKey: ["claude-code-settings"],
    queryFn: () => getSettings({}),
  });

  const sessions = sessionsQuery.data?.sessions ?? [];
  const activeSessionId =
    selectedSessionId ??
    sessions.find((session) => session.boundTerminalId !== null)?.sessionId ??
    sessions[0]?.sessionId ??
    null;
  const activeSession = sessions.find((session) => session.sessionId === activeSessionId) ?? null;

  const listRef = useRef<FlatList<TimelineItem> | null>(null);
  const followRef = useRef(true);
  const timelineRef = useRef<TimelineState>(emptyTimeline(""));
  const timelineKey = `${workspaceDir ?? ""}:${activeSessionId ?? ""}`;

  const timelineQuery = useQuery({
    queryKey: ["claude-code-timeline", timelineKey, windowStart],
    enabled: workspaceDir !== null && activeSessionId !== null,
    refetchInterval: TIMELINE_POLL_MS,
    queryFn: async (): Promise<TimelineState> => {
      if (timelineRef.current.key !== timelineKey) timelineRef.current = emptyTimeline(timelineKey);
      const previous = timelineRef.current;
      const response = await getTimeline({
        workspaceDir: workspaceDir!,
        workspaceId,
        sessionId: activeSessionId!,
        sinceRevision: previous.revision,
        fromIndex: windowStart,
      });
      const entries = response.reset ? [] : previous.entries.slice();
      for (const entry of response.entries) entries[entry.index] = entry;
      entries.length = response.total;
      const next: TimelineState = {
        key: timelineKey,
        revision: response.revision,
        entries,
        total: response.total,
        windowStart: response.windowStart,
        sessionStatus: response.sessionStatus,
        lastChangeAt: response.revision === previous.revision ? previous.lastChangeAt : Date.now(),
      };
      timelineRef.current = next;
      return next;
    },
  });

  const entries = useMemo(
    () => (timelineQuery.data?.entries ?? []).filter((entry): entry is RenderEntry => entry !== undefined),
    [timelineQuery.data],
  );
  const items = useMemo(() => groupEntries(entries), [entries]);

  const status: SessionStatus = timelineQuery.data?.sessionStatus ?? "detached";
  const hooksReady = hooksQuery.data?.enabled === true;
  const sendBehavior = settingsQuery.data?.sendBehavior ?? "cli_default";

  const selectSession = useCallback((sessionId: string) => {
    setSelectedSessionId(sessionId);
    setWindowStart(null);
    setPickerOpen(false);
  }, []);

  const loadEntry = useCallback(
    async (index: number) => {
      const response = await getTimelineEntry({
        workspaceDir: workspaceDir!,
        sessionId: activeSessionId!,
        index,
      });
      return response.entry;
    },
    [getTimelineEntry, workspaceDir, activeSessionId],
  );

  const enableHooksMutation = useMutation({
    mutationFn: () => enableHooks({}),
    onSuccess: () => {
      void hooksQuery.refetch();
    },
  });

  const startMutation = useMutation({
    mutationFn: () => startSession({ workspaceDir: workspaceDir! }),
    onSuccess: (result) => {
      setSelectedSessionId(result.sessionId);
      setWindowStart(null);
      setNote(result.warning ?? 'Started a session in a new "Claude Code" terminal.');
      void sessionsQuery.refetch();
    },
    onError: (error) => setNote(errorText(error)),
  });

  const resumeMutation = useMutation({
    mutationFn: () => resumeSession({ workspaceDir: workspaceDir!, sessionId: activeSessionId! }),
    onSuccess: (result) => {
      setNote(result.warning ?? "Resumed in a new terminal.");
      void sessionsQuery.refetch();
    },
    onError: (error) => setNote(errorText(error)),
  });

  const attachMutation = useMutation({
    mutationFn: (terminalId: string) =>
      attachTerminal({ workspaceDir: workspaceDir!, sessionId: activeSessionId!, terminalId }),
    onSuccess: () => {
      setAttachOpen(false);
      setNote("Prompt box is now bound to that terminal.");
      void sessionsQuery.refetch();
    },
    onError: (error) => setNote(errorText(error)),
  });

  const behaviorMutation = useMutation({
    mutationFn: (next: SendBehavior) => setSettings({ sendBehavior: next }),
    onSuccess: () => {
      void settingsQuery.refetch();
    },
  });

  const sendMutation = useMutation({
    mutationFn: (text: string) =>
      sendPrompt({
        workspaceId,
        workspaceDir: workspaceDir!,
        sessionId: activeSessionId!,
        text,
        references: attachments.map((attachment) => attachment.reference),
      }),
    onSuccess: (result) => {
      setAttachments([]);
      setNote(result.note ?? (result.delivered ? null : "not delivered"));
    },
    onError: (error) => setNote(errorText(error)),
  });

  // A pending option dialog never reaches the transcript — Claude Code writes the tool call only once
  // it is answered — and the hooks only report needs-input for an idle prompt, so the terminal screen
  // is the only place a live question can be seen.
  // Reading it shells out to the paseo CLI, which costs about a second of CPU per call, so the screen
  // is only watched while the session has gone quiet after recent activity, which is exactly when a
  // dialog is waiting, and the interval backs off the longer nothing turns up.
  const dialogOpenRef = useRef(false);
  const probedRef = useRef<string | null>(null);
  const dialogKey = `${activeSessionId ?? ""}:${activeSession?.boundTerminalId ?? ""}`;
  const quietFor = Date.now() - (timelineQuery.data?.lastChangeAt ?? Date.now());
  const watchScreen =
    (activeSession?.boundTerminalId ?? null) !== null &&
    // Probe once when the session is opened: a question may have been waiting long before that.
    (probedRef.current !== dialogKey ||
      dialogOpenRef.current ||
      Date.now() < forceWatchUntil ||
      (quietFor > DIALOG_WATCH_AFTER_MS && quietFor < DIALOG_GIVE_UP_AFTER_MS));

  const dialogQuery = useQuery({
    queryKey: ["claude-code-dialog", activeSessionId, activeSession?.boundTerminalId ?? null],
    enabled: activeSessionId !== null && watchScreen,
    refetchInterval: (query) =>
      query.state.data?.dialog
        ? DIALOG_OPEN_POLL_MS
        : quietFor < DIALOG_BACKOFF_AFTER_MS
          ? DIALOG_WATCH_POLL_MS
          : DIALOG_BACKOFF_POLL_MS,
    queryFn: async () => {
      const response = await getDialog({ sessionId: activeSessionId! });
      dialogOpenRef.current = response.dialog !== null;
      probedRef.current = dialogKey;
      return response;
    },
  });
  // Stale data must not outlive the watch: once the transcript moves again the dialog is gone.
  const dialog = watchScreen ? (dialogQuery.data?.dialog ?? null) : null;

  const answerMutation = useMutation({
    mutationFn: (answer: { optionIndices?: number[]; labels?: string[] }) =>
      answerDialog({
        sessionId: activeSessionId!,
        optionIndices: answer.optionIndices ?? [],
        labels: answer.labels ?? [],
      }),
    onSuccess: (result) => {
      setNote(result.warning ?? result.note);
      void dialogQuery.refetch();
    },
    onError: (error) => setNote(errorText(error)),
  });

  const attach = useCallback((next: Attachment[]) => {
    setAttachments((current) => next.reduce(addAttachment, current));
  }, []);

  const imageMutation = useMutation({
    mutationFn: (path: string) => attachImage({ path }),
    onSuccess: (result) => {
      attach([imageAttachment(result.path, result.previewDataUrl)]);
      setImageSheetOpen(false);
    },
  });

  // A picked or pasted image is already in the panel's hands, so it is previewed from there rather
  // than read back off disk.
  const uploadMutation = useMutation({
    mutationFn: async (picked: { files: { fileName: string; dataUrl: string }[]; images: boolean }) => {
      const attached: Attachment[] = [];
      for (const file of picked.files) {
        const base64 = base64FromDataUrl(file.dataUrl);
        if (base64 === null) continue;
        if (picked.images) {
          const { path } = await uploadImage({ fileName: file.fileName, base64 });
          attached.push(imageAttachment(path, file.dataUrl));
        } else {
          const { path } = await uploadFile({ fileName: file.fileName, base64 });
          attached.push(fileAttachment(path));
        }
      }
      return attached;
    },
    onSuccess: attach,
    onError: (error) => setNote(errorText(error)),
  });

  // Opening an attachment means what it means in paseo: an image opens, an issue goes to its forge,
  // and a file has nowhere to go.
  const openAttachment = useCallback((attachment: Attachment) => {
    if (attachment.kind === "image") {
      setOpenedImage(attachment);
      return;
    }
    if (attachment.kind === "issue" || attachment.kind === "pr") {
      void Linking.openURL(attachment.reference).catch(() => {});
    }
  }, []);

  const openedImageQuery = useQuery({
    queryKey: ["claude-code-image", openedImage?.reference ?? null],
    enabled: openedImage !== null && openedImage.previewDataUrl === null,
    staleTime: Infinity,
    queryFn: () => readImage({ path: openedImage!.reference }),
  });

  const openPicker = useCallback(
    (images: boolean) => {
      setAddOpen(false);
      if (Platform.OS !== "web") {
        setImageSheetOpen(true);
        return;
      }
      void pickFiles({ accept: images ? IMAGE_ACCEPT : "", multiple: true }).then((files) => {
        if (files.length > 0) uploadMutation.mutate({ files, images });
      });
    },
    [uploadMutation],
  );

  const forgeDebouncedQuery = useDebounced(forgeQuery, FORGE_SEARCH_DEBOUNCE_MS);
  const forgeQueryResult = useQuery({
    queryKey: ["claude-code-forge", workspaceDir, forgeDebouncedQuery],
    enabled: forgeOpen && workspaceDir !== null,
    staleTime: FORGE_SEARCH_STALE_MS,
    queryFn: () => searchForgeItems({ workspaceDir: workspaceDir!, query: forgeDebouncedQuery, limit: 20 }),
  });

  // Everything the composer shows is read from files, so it can be polled with the transcript.
  const composerQuery = useQuery({
    queryKey: ["claude-code-composer", workspaceDir, activeSessionId],
    enabled: workspaceDir !== null && activeSessionId !== null,
    refetchInterval: COMPOSER_POLL_MS,
    queryFn: () => getComposerState({ workspaceDir: workspaceDir!, sessionId: activeSessionId! }),
  });

  // The mode is only on the terminal screen, so it is read once per bound session and after a change.
  const modeQuery = useQuery({
    queryKey: ["claude-code-mode", activeSessionId, activeSession?.boundTerminalId ?? null],
    enabled: activeSessionId !== null && (activeSession?.boundTerminalId ?? null) !== null,
    staleTime: Infinity,
    queryFn: () => permissionMode({ sessionId: activeSessionId!, mode: null }),
  });

  const menuMutation = useMutation({
    mutationFn: (menu: "model" | "thinking") => openCliMenu({ sessionId: activeSessionId!, menu }),
    onSuccess: (result) => {
      setNote(result.warning ?? "The CLI's menu is open — pick from it below or in the terminal.");
      setForceWatchUntil(Date.now() + MENU_WATCH_MS);
      void dialogQuery.refetch();
    },
    onError: (error) => setNote(errorText(error)),
  });

  const modeMutation = useMutation({
    mutationFn: (mode: (typeof PERMISSION_MODES)[number]) =>
      permissionMode({ sessionId: activeSessionId!, mode }),
    onSuccess: (result) => {
      setModeOpen(false);
      setNote(result.warning);
      void modeQuery.refetch();
    },
    onError: (error) => setNote(errorText(error)),
  });

  const attachableQuery = useQuery({
    queryKey: ["claude-code-attachable", workspaceDir, attachOpen],
    enabled: attachOpen && workspaceDir !== null,
    queryFn: () => listAttachable({ workspaceDir: workspaceDir! }),
  });

  if (workspaceDir === null) {
    return (
      <View style={{ flex: 1, backgroundColor: palette.surface0, padding: spacing[4] }}>
        <Text style={{ color: palette.foregroundMuted, fontSize: fontSize.base }}>Loading workspace…</Text>
      </View>
    );
  }

  const terminalHint = activeSession?.boundTerminalId
    ? `terminal ${activeSession.boundTerminalId.slice(0, 8)} · open it to type directly`
    : null;

  return (
    <View style={{ flex: 1, backgroundColor: palette.surface0 }}>
      <View
        style={{
          height: HEADER_HEIGHT,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          gap: spacing[2],
          paddingHorizontal: layout.compact ? spacing[2] : spacing[3],
          borderBottomWidth: 1,
          borderBottomColor: palette.border,
        }}
      >
        <Pressable
          onPress={() => setPickerOpen(true)}
          style={pressable(({ hovered }) => ({
            flex: 1,
            minWidth: 0,
            flexDirection: "row",
            alignItems: "center",
            gap: spacing[1],
            paddingHorizontal: spacing[2],
            paddingVertical: spacing[1],
            borderRadius: radius.md,
            backgroundColor: hovered ? palette.surface2 : "transparent",
          }))}
        >
          <Text
            numberOfLines={1}
            style={{
              flexShrink: 1,
              minWidth: 0,
              color: palette.foreground,
              fontSize: fontSize.base,
              fontWeight: layout.compact ? "400" : "300",
            }}
          >
            {activeSession ? sessionLabel(activeSession) : "No session"}
          </Text>
          {activeSession && !layout.compact ? (
            <Text numberOfLines={1} style={{ color: palette.foregroundExtraMuted, fontSize: fontSize.sm }}>
              {relativeTimeFrom(activeSession.mtime)}
            </Text>
          ) : null}
          <Text style={{ color: palette.foregroundExtraMuted, fontSize: fontSize.sm }}>⌄</Text>
        </Pressable>
        <View style={{ flexDirection: "row", alignItems: "center", gap: spacing[1], flexShrink: 0 }}>
          <StatusPill status={dialog ? "needs_input" : status} palette={palette} />
          <IconButton
            palette={palette}
            glyph="＋"
            accessibilityLabel="New session"
            disabled={startMutation.isPending}
            onPress={() => startMutation.mutate()}
          />
          <IconButton
            palette={palette}
            glyph="⋯"
            accessibilityLabel="Panel options"
            onPress={() => setMenuOpen(true)}
          />
        </View>
      </View>

      {activeSessionId === null ? (
        <EmptyState
          palette={palette}
          title="No Claude Code sessions yet"
          body={
            sessionsQuery.data?.projectDir === null
              ? "No transcript directory exists for this workspace yet. Start a session to create one."
              : 'Start one with the + button, or run `claude` in a paseo terminal in this workspace.'
          }
        />
      ) : (
        <FlatList
          ref={listRef}
          data={items}
          style={{ flex: 1 }}
          onContentSizeChange={() => {
            if (followRef.current) listRef.current?.scrollToEnd({ animated: false });
          }}
          onScroll={(event) => {
            const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
            const distanceFromBottom = contentSize.height - contentOffset.y - layoutMeasurement.height;
            followRef.current = distanceFromBottom < 80;
          }}
          scrollEventThrottle={200}
          keyExtractor={(item) => item.key}
          contentContainerStyle={{
            flexGrow: 1,
            paddingHorizontal: layout.compact ? spacing[3] : spacing[4],
            paddingVertical: spacing[4],
          }}
          initialNumToRender={20}
          maxToRenderPerBatch={20}
          windowSize={11}
          removeClippedSubviews
          renderItem={({ item }) => (
            <ContentColumn>
              <TimelineItemView
                item={item}
                palette={palette}
                answerPending={answerMutation.isPending}
                onAnswerQuestion={(_entry, labels) => answerMutation.mutate({ labels })}
                loadEntry={loadEntry}
              />
            </ContentColumn>
          )}
          ListHeaderComponent={
            (timelineQuery.data?.windowStart ?? 0) > 0 ? (
              <ContentColumn>
                <View style={{ alignItems: "center", paddingBottom: spacing[2] }}>
                  <Button
                    palette={palette}
                    size="xs"
                    label={`Load ${Math.min(200, timelineQuery.data?.windowStart ?? 0)} older entries`}
                    onPress={() => setWindowStart(Math.max(0, (timelineQuery.data?.windowStart ?? 0) - 200))}
                  />
                </View>
              </ContentColumn>
            ) : null
          }
          ListEmptyComponent={
            <EmptyState
              palette={palette}
              title={timelineQuery.isPending ? "Loading transcript…" : "Nothing here yet"}
              body={
                timelineQuery.isPending
                  ? "Reading this session's transcript."
                  : "This session has not received a prompt."
              }
            />
          }
        />
      )}

      {!hooksReady ? (
        <HooksOnboarding
          palette={palette}
          enabling={enableHooksMutation.isPending}
          error={enableHooksMutation.error ? errorText(enableHooksMutation.error) : null}
          onEnable={() => enableHooksMutation.mutate()}
        />
      ) : dialog || status === "needs_input" ? (
        <DialogCard
          palette={palette}
          compact={layout.compact}
          dialog={dialog}
          terminalHint={terminalHint}
          answering={answerMutation.isPending}
          warning={note}
          onAnswer={(optionIndices) => answerMutation.mutate({ optionIndices })}
        />
      ) : status === "detached" ? (
        <ResumeBar
          palette={palette}
          compact={layout.compact}
          resuming={resumeMutation.isPending}
          onResume={() => resumeMutation.mutate()}
        />
      ) : (
        <PromptBox
          palette={palette}
          compact={layout.compact}
          disabled={activeSessionId === null}
          sending={sendMutation.isPending}
          note={note}
          workspaceDir={workspaceDir}
          attachments={attachments}
          controls={
            composerQuery.data?.bound
              ? {
                  model: composerQuery.data.model,
                  effort: effortLabel(composerQuery.data),
                  mode: modeQuery.data?.mode ? PERMISSION_MODE_LABELS[modeQuery.data.mode]! : null,
                  onOpenModelMenu: () => menuMutation.mutate("model"),
                  onOpenThinking: () => menuMutation.mutate("thinking"),
                  onOpenMode: () => {
                    setModeOpen(true);
                    void modeQuery.refetch();
                  },
                }
              : null
          }
          onAddAttachment={() => setAddOpen(true)}
          onOpenAttachment={openAttachment}
          onPasteImages={(files) => uploadMutation.mutate({ files, images: true })}
          onRemoveAttachment={(reference) =>
            setAttachments((current) => current.filter((item) => item.reference !== reference))
          }
          onSend={(text) => sendMutation.mutate(text)}
        />
      )}

      <Sheet palette={palette} visible={pickerOpen} title="Sessions" onClose={() => setPickerOpen(false)}>
        {sessions.map((session) => (
          <SheetRow
            key={session.sessionId}
            palette={palette}
            selected={session.sessionId === activeSessionId}
            label={sessionLabel(session)}
            detail={`${session.boundTerminalId ? "bound · " : session.isLive ? "live · " : ""}${relativeTimeFrom(session.mtime)} · ${session.sessionId.slice(0, 8)}`}
            onPress={() => selectSession(session.sessionId)}
          />
        ))}
        {sessions.length === 0 ? <SheetNote palette={palette}>No sessions found.</SheetNote> : null}
      </Sheet>

      <Sheet palette={palette} visible={menuOpen} title="Claude Code" onClose={() => setMenuOpen(false)}>
        <SheetRow
          palette={palette}
          label="Attach to a terminal…"
          detail="Bind the prompt box to a terminal already running claude"
          onPress={() => {
            setMenuOpen(false);
            setAttachOpen(true);
          }}
        />
        {SEND_BEHAVIORS.map((behavior) => (
          <SheetRow
            key={behavior}
            palette={palette}
            selected={behavior === sendBehavior}
            label={`Send: ${SEND_BEHAVIOR_LABELS[behavior]}`}
            detail={SEND_BEHAVIOR_HINTS[behavior]}
            onPress={() => behaviorMutation.mutate(behavior)}
          />
        ))}
        <SheetRow
          palette={palette}
          label={hooksReady ? "Terminal agent hooks are on" : "Terminal agent hooks are off"}
          detail={
            hooksReady
              ? terminalHint
                ? `This session runs in ${terminalHint}. Tap to re-check the setting.`
                : "Tap to re-check the setting."
              : "Turn them on in paseo's settings, then tap to re-check."
          }
          onPress={() => {
            void hooksQuery.refetch();
          }}
        />
      </Sheet>

      <Sheet palette={palette} visible={attachOpen} title="Attach to terminal" onClose={() => setAttachOpen(false)}>
        {(attachableQuery.data?.terminals ?? []).map((terminal) => (
          <SheetRow
            key={terminal.id}
            palette={palette}
            selected={terminal.id === activeSession?.boundTerminalId}
            label={terminal.name}
            detail={`${terminal.looksLikeClaude ? "claude detected · " : ""}${terminal.id.slice(0, 8)}`}
            onPress={() => attachMutation.mutate(terminal.id)}
          />
        ))}
        {attachableQuery.isPending ? (
          <SheetNote palette={palette}>Looking for terminals…</SheetNote>
        ) : null}
        {attachableQuery.data?.terminals.length === 0 ? (
          <SheetNote palette={palette}>No terminals in this workspace.</SheetNote>
        ) : null}
      </Sheet>
      <Sheet palette={palette} visible={modeOpen} title="Permission mode" onClose={() => setModeOpen(false)}>
        <SheetNote palette={palette}>
          Shift+Tab is the only way to change mode, so the panel steps the cycle until the terminal
          shows the one you picked. A session that does not offer a mode will stop short of it.
        </SheetNote>
        {PERMISSION_MODES.map((mode) => (
          <SheetRow
            key={mode}
            palette={palette}
            selected={modeQuery.data?.mode === mode}
            label={PERMISSION_MODE_LABELS[mode]!}
            onPress={() => modeMutation.mutate(mode)}
          />
        ))}
      </Sheet>

      {openedImage ? (
        <AttachmentLightbox
          palette={palette}
          uri={openedImage.previewDataUrl ?? openedImageQuery.data?.dataUrl ?? null}
          loading={openedImageQuery.isFetching}
          onClose={() => setOpenedImage(null)}
        />
      ) : null}

      <Sheet palette={palette} visible={addOpen} title="Add attachment" onClose={() => setAddOpen(false)}>
        <SheetRow
          palette={palette}
          label="Add image"
          detail="Pick a png, jpg, gif or webp to send with the prompt"
          onPress={() => openPicker(true)}
        />
        <SheetRow
          palette={palette}
          label="Add issue or PR"
          detail="Name a GitHub issue or pull request in the prompt"
          onPress={() => {
            setAddOpen(false);
            setForgeOpen(true);
          }}
        />
        <SheetRow
          palette={palette}
          label="Upload file"
          detail="Send any other file for the CLI to read"
          onPress={() => openPicker(false)}
        />
        {/* The file picker reaches the machine showing the panel; a typed path reaches the one paseo runs on. */}
        {Platform.OS === "web" ? (
          <SheetRow
            palette={palette}
            label="Attach by path…"
            detail="Name an image on the machine running paseo"
            onPress={() => {
              setAddOpen(false);
              setImageSheetOpen(true);
            }}
          />
        ) : null}
      </Sheet>

      <ForgePickerSheet
        palette={palette}
        visible={forgeOpen}
        query={forgeQuery}
        items={forgeQueryResult.data?.items ?? []}
        loading={forgeQueryResult.isFetching}
        warning={forgeQueryResult.data?.warning ?? null}
        onQueryChange={setForgeQuery}
        onClose={() => setForgeOpen(false)}
        onPick={(item: ForgeItem) => {
          attach([forgeAttachment(item)]);
          setForgeOpen(false);
        }}
      />

      <ImageAttachSheet
        palette={palette}
        visible={imageSheetOpen}
        busy={imageMutation.isPending}
        error={imageMutation.error ? errorText(imageMutation.error) : null}
        onClose={() => setImageSheetOpen(false)}
        onAttach={(path) => imageMutation.mutate(path)}
        onPasteFromClipboard={(setPath) => {
          void Clipboard.getString()
            .then((value) => setPath(value.trim()))
            .catch(() => {});
        }}
      />
    </View>
  );
}

/** Transcript content stays in a centered reading column, as it does in paseo's own agent view. */
function ContentColumn({ children }: { children: React.ReactNode }) {
  return (
    <View
      style={{
        width: "100%",
        maxWidth: MAX_CONTENT_WIDTH,
        alignSelf: "center",
        paddingHorizontal: spacing[2],
      }}
    >
      {children}
    </View>
  );
}

function EmptyState({
  palette,
  title,
  body,
}: {
  palette: Palette;
  title: string;
  body: string;
}) {
  return (
    <View
      style={{
        flex: 1,
        alignItems: "center",
        justifyContent: "center",
        padding: spacing[6],
        gap: spacing[2],
      }}
    >
      <Text style={{ color: palette.foreground, fontSize: fontSize.base, fontWeight: "600", textAlign: "center" }}>
        {title}
      </Text>
      <Text style={{ color: palette.foregroundMuted, fontSize: fontSize.base, textAlign: "center" }}>
        {body}
      </Text>
    </View>
  );
}
