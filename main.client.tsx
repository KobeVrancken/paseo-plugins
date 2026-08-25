import type { PluginWorkspacePanelProps } from "@getpaseo/plugin";
import { useRpc, useWorkspace } from "@getpaseo/plugin";
import { useMutation, useQuery } from "@tanstack/react-query";
import React, { useCallback, useMemo, useRef, useState } from "react";
import { FlatList, Pressable, Text, View } from "react-native";
import * as contracts from "./contracts.shared.ts";
import {
  ActionButton,
  HooksOnboarding,
  PromptBox,
  ResumeBar,
  SEND_BEHAVIOR_HINTS,
  SEND_BEHAVIOR_LABELS,
  Sheet,
  SheetRow,
  StatusPill,
} from "./panel-controls.client.tsx";
import type { RenderEntry, SendBehavior, SessionStatus, SessionSummary } from "./render-types.shared.ts";
import { groupEntries } from "./timeline-model.client.ts";
import { TimelineItemView } from "./timeline.client.tsx";
import { Tint, relativeTimeFrom } from "./ui.client.tsx";

const SESSION_POLL_MS = 2000;
const TIMELINE_POLL_MS = 750;
const HOOKS_POLL_MS = 15_000;
const SEND_BEHAVIORS: SendBehavior[] = ["cli_default", "hold_until_idle", "interrupt_first"];

type TimelineState = {
  key: string;
  revision: number;
  entries: (RenderEntry | undefined)[];
  unsupportedCount: number;
  total: number;
  sessionStatus: SessionStatus;
};

function emptyTimeline(key: string): TimelineState {
  return { key, revision: 0, entries: [], unsupportedCount: 0, total: 0, sessionStatus: "detached" };
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

  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [attachOpen, setAttachOpen] = useState(false);
  const [note, setNote] = useState<string | null>(null);

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

  const timelineRef = useRef<TimelineState>(emptyTimeline(""));
  const timelineKey = `${workspaceDir ?? ""}:${activeSessionId ?? ""}`;

  const timelineQuery = useQuery({
    queryKey: ["claude-code-timeline", timelineKey],
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
        sessionStatus: response.sessionStatus,
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
    setPickerOpen(false);
  }, []);

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
      setNote(`Started a session in a new "Claude Code" terminal.`);
      void sessionsQuery.refetch();
    },
    onError: (error) => setNote(errorText(error)),
  });

  const resumeMutation = useMutation({
    mutationFn: () => resumeSession({ workspaceDir: workspaceDir!, sessionId: activeSessionId! }),
    onSuccess: () => {
      setNote("Resumed in a new terminal.");
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
        imagePaths: [],
      }),
    onSuccess: (result) => setNote(result.note ?? (result.delivered ? null : "not delivered")),
    onError: (error) => setNote(errorText(error)),
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
              ? `${relativeTimeFrom(activeSession.mtime)} · ${sessions.length} session${sessions.length === 1 ? "" : "s"}`
              : "tap to pick a session"}
          </Text>
        </Pressable>
        <StatusPill status={status} theme={theme} />
        <ActionButton
          theme={theme}
          label="New"
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
          data={items}
          keyExtractor={(item) => item.key}
          contentContainerStyle={{ padding: layout.compact ? 10 : 16, gap: 10 }}
          initialNumToRender={20}
          maxToRenderPerBatch={20}
          windowSize={11}
          removeClippedSubviews
          renderItem={({ item }) => <TimelineItemView item={item} theme={theme} />}
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
        unsupportedCount={timelineQuery.data?.unsupportedCount ?? 0}
      />

      {!hooksReady ? (
        <HooksOnboarding
          theme={theme}
          enabling={enableHooksMutation.isPending}
          error={enableHooksMutation.error ? errorText(enableHooksMutation.error) : null}
          onEnable={() => enableHooksMutation.mutate()}
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
        <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11, padding: 10 }}>
          {hooksReady ? "Terminal agent hooks are on." : "Terminal agent hooks are off."}
          {terminalHint ? ` This session runs in ${terminalHint}.` : ""}
        </Text>
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
    </View>
  );
}

function Footer({
  theme,
  entryCount,
  unsupportedCount,
}: {
  theme: PluginWorkspacePanelProps["theme"];
  entryCount: number;
  unsupportedCount: number;
}) {
  return (
    <View style={{ paddingHorizontal: 12, paddingVertical: 4, flexDirection: "row", gap: 12 }}>
      <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11 }}>{entryCount} entries</Text>
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
