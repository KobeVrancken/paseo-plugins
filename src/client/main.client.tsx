import type { PluginWorkspacePanelProps } from "@getpaseo/plugin";
import { useRpc, useWorkspace } from "@getpaseo/plugin";
import { useMutation, useQuery } from "@tanstack/react-query";
import React, { useCallback, useMemo, useRef, useState } from "react";
import { Clipboard, FlatList, Pressable, Text, View } from "react-native";
import * as contracts from "../contracts.shared.ts";
import {
  ActionButton,
  DialogCard,
  HooksOnboarding,
  ImageAttachSheet,
  PromptBox,
  ResumeBar,
  SEND_BEHAVIOR_HINTS,
  SEND_BEHAVIOR_LABELS,
  Sheet,
  SheetRow,
  StatusPill,
} from "./panel-controls.client.tsx";
import type { RenderEntry, SendBehavior, SessionStatus, SessionSummary } from "../render-types.shared.ts";
import { groupEntries, type TimelineItem } from "./timeline-model.client.ts";
import { TimelineItemView } from "./timeline.client.tsx";
import { Tint, relativeTimeFrom } from "./ui.client.tsx";

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

type TimelineState = {
  key: string;
  revision: number;
  entries: (RenderEntry | undefined)[];
  unsupportedCount: number;
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
    unsupportedCount: 0,
    total: 0,
    windowStart: 0,
    sessionStatus: "detached",
    lastChangeAt: Date.now(),
  };
}

function sessionLabel(session: SessionSummary): string {
  return session.title || session.preview || session.sessionId.slice(0, 8);
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function ClaudeCodePanel({ workspaceId, theme, layout }: PluginWorkspacePanelProps) {
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

  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [attachOpen, setAttachOpen] = useState(false);
  const [imageSheetOpen, setImageSheetOpen] = useState(false);
  const [imagePaths, setImagePaths] = useState<string[]>([]);
  const [note, setNote] = useState<string | null>(null);
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
        unsupportedCount: response.unsupportedCount,
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
        imagePaths,
      }),
    onSuccess: (result) => {
      setImagePaths([]);
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

  const imageMutation = useMutation({
    mutationFn: (path: string) => attachImage({ path }),
    onSuccess: (result) => {
      setImagePaths((current) => [...current, result.path]);
      setImageSheetOpen(false);
    },
  });

  const attachableQuery = useQuery({
    queryKey: ["claude-code-attachable", workspaceDir, attachOpen],
    enabled: attachOpen && workspaceDir !== null,
    queryFn: () => listAttachable({ workspaceDir: workspaceDir! }),
  });

  if (workspaceDir === null) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.colors.surface0, padding: 16 }}>
        <Text style={{ color: theme.colors.foregroundMuted }}>Loading workspace…</Text>
      </View>
    );
  }

  const terminalHint = activeSession?.boundTerminalId
    ? `terminal ${activeSession.boundTerminalId.slice(0, 8)} · open it to type directly`
    : null;

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.surface0 }}>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
          paddingHorizontal: layout.compact ? 10 : 16,
          paddingVertical: 10,
        }}
      >
        <Pressable
          onPress={() => setPickerOpen(true)}
          style={{ flex: 1, borderRadius: 8, overflow: "hidden", padding: 8 }}
        >
          <Tint color={theme.colors.foreground} opacity={0.08} />
          <Text numberOfLines={1} style={{ color: theme.colors.foreground, fontWeight: "600" }}>
            {activeSession ? sessionLabel(activeSession) : "No session"}
          </Text>
          <Text numberOfLines={1} style={{ color: theme.colors.foregroundMuted, fontSize: 11 }}>
            {activeSession
              ? layout.compact
                ? relativeTimeFrom(activeSession.mtime)
                : `${relativeTimeFrom(activeSession.mtime)} · ${sessions.length} session${sessions.length === 1 ? "" : "s"}`
              : "tap to pick a session"}
          </Text>
        </Pressable>
        <StatusPill status={dialog ? "needs_input" : status} theme={theme} />
        <ActionButton
          theme={theme}
          label={layout.compact ? "＋" : "New"}
          disabled={startMutation.isPending}
          onPress={() => startMutation.mutate()}
        />
        <ActionButton theme={theme} label="⋯" onPress={() => setMenuOpen(true)} />
      </View>

      {activeSessionId === null ? (
        <EmptyState
          theme={theme}
          title="No Claude Code sessions yet"
          body={
            sessionsQuery.data?.projectDir === null
              ? "No transcript directory exists for this workspace yet. Start a session to create one."
              : 'Start one with "New", or run `claude` in a paseo terminal in this workspace.'
          }
        />
      ) : (
        <FlatList
          ref={listRef}
          data={items}
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
          contentContainerStyle={{ padding: layout.compact ? 10 : 16, gap: 10 }}
          initialNumToRender={20}
          maxToRenderPerBatch={20}
          windowSize={11}
          removeClippedSubviews
          renderItem={({ item }) => (
            <TimelineItemView
              item={item}
              theme={theme}
              answerPending={answerMutation.isPending}
              onAnswerQuestion={(_entry, labels) => answerMutation.mutate({ labels })}
              loadEntry={loadEntry}
            />
          )}
          ListHeaderComponent={
            (timelineQuery.data?.windowStart ?? 0) > 0 ? (
              <View style={{ alignItems: "center", paddingBottom: 8 }}>
                <ActionButton
                  theme={theme}
                  label={`Load ${Math.min(200, timelineQuery.data?.windowStart ?? 0)} older entries`}
                  onPress={() =>
                    setWindowStart(Math.max(0, (timelineQuery.data?.windowStart ?? 0) - 200))
                  }
                />
              </View>
            ) : null
          }
          ListEmptyComponent={
            <Text style={{ color: theme.colors.foregroundMuted }}>
              {timelineQuery.isPending
                ? "Loading transcript…"
                : "No transcript yet — this session has not received a prompt."}
            </Text>
          }
        />
      )}

      <Footer
        theme={theme}
        entryCount={entries.length}
        total={timelineQuery.data?.total ?? 0}
        unsupportedCount={timelineQuery.data?.unsupportedCount ?? 0}
      />

      {!hooksReady ? (
        <HooksOnboarding
          theme={theme}
          enabling={enableHooksMutation.isPending}
          error={enableHooksMutation.error ? errorText(enableHooksMutation.error) : null}
          onEnable={() => enableHooksMutation.mutate()}
        />
      ) : dialog || status === "needs_input" ? (
        <DialogCard
          theme={theme}
          dialog={dialog}
          terminalHint={terminalHint}
          answering={answerMutation.isPending}
          warning={note}
          onAnswer={(optionIndices) => answerMutation.mutate({ optionIndices })}
        />
      ) : status === "detached" ? (
        <ResumeBar
          theme={theme}
          resuming={resumeMutation.isPending}
          onResume={() => resumeMutation.mutate()}
        />
      ) : (
        <PromptBox
          theme={theme}
          compact={layout.compact}
          disabled={activeSessionId === null}
          sending={sendMutation.isPending}
          note={note}
          terminalHint={terminalHint}
          attachments={imagePaths}
          onAttachImage={() => setImageSheetOpen(true)}
          onRemoveAttachment={(path) => setImagePaths((current) => current.filter((item) => item !== path))}
          onSend={(text) => sendMutation.mutate(text)}
        />
      )}

      <Sheet theme={theme} visible={pickerOpen} title="Sessions" onClose={() => setPickerOpen(false)}>
        {sessions.map((session) => (
          <SheetRow
            key={session.sessionId}
            theme={theme}
            selected={session.sessionId === activeSessionId}
            label={sessionLabel(session)}
            detail={`${session.boundTerminalId ? "bound · " : session.isLive ? "live · " : ""}${relativeTimeFrom(session.mtime)} · ${session.sessionId.slice(0, 8)}`}
            onPress={() => selectSession(session.sessionId)}
          />
        ))}
        {sessions.length === 0 ? (
          <Text style={{ color: theme.colors.foregroundMuted, padding: 10 }}>No sessions found.</Text>
        ) : null}
      </Sheet>

      <Sheet theme={theme} visible={menuOpen} title="Claude Code" onClose={() => setMenuOpen(false)}>
        <SheetRow
          theme={theme}
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
            theme={theme}
            selected={behavior === sendBehavior}
            label={`Send: ${SEND_BEHAVIOR_LABELS[behavior]}`}
            detail={SEND_BEHAVIOR_HINTS[behavior]}
            onPress={() => behaviorMutation.mutate(behavior)}
          />
        ))}
        <SheetRow
          theme={theme}
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

      <Sheet theme={theme} visible={attachOpen} title="Attach to terminal" onClose={() => setAttachOpen(false)}>
        {(attachableQuery.data?.terminals ?? []).map((terminal) => (
          <SheetRow
            key={terminal.id}
            theme={theme}
            selected={terminal.id === activeSession?.boundTerminalId}
            label={terminal.name}
            detail={`${terminal.looksLikeClaude ? "claude detected · " : ""}${terminal.id.slice(0, 8)}`}
            onPress={() => attachMutation.mutate(terminal.id)}
          />
        ))}
        {attachableQuery.isPending ? (
          <Text style={{ color: theme.colors.foregroundMuted, padding: 10 }}>Looking for terminals…</Text>
        ) : null}
        {attachableQuery.data?.terminals.length === 0 ? (
          <Text style={{ color: theme.colors.foregroundMuted, padding: 10 }}>
            No terminals in this workspace.
          </Text>
        ) : null}
      </Sheet>
      <ImageAttachSheet
        theme={theme}
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

function Footer({
  theme,
  entryCount,
  total,
  unsupportedCount,
}: {
  theme: PluginWorkspacePanelProps["theme"];
  entryCount: number;
  total: number;
  unsupportedCount: number;
}) {
  return (
    <View style={{ paddingHorizontal: 12, paddingVertical: 4, flexDirection: "row", gap: 12 }}>
      <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11 }}>
        {entryCount < total ? `${entryCount} of ${total} entries` : `${entryCount} entries`}
      </Text>
      {unsupportedCount > 0 ? (
        <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11 }}>
          {unsupportedCount} unsupported
        </Text>
      ) : null}
    </View>
  );
}

function EmptyState({
  theme,
  title,
  body,
}: {
  theme: PluginWorkspacePanelProps["theme"];
  title: string;
  body: string;
}) {
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 24, gap: 6 }}>
      <Text style={{ color: theme.colors.foreground, fontWeight: "600" }}>{title}</Text>
      <Text style={{ color: theme.colors.foregroundMuted, textAlign: "center" }}>{body}</Text>
    </View>
  );
}
