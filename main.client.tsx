import type { PluginWorkspacePanelProps } from "@getpaseo/plugin";
import { useRpc, useWorkspace } from "@getpaseo/plugin";
import { useQuery } from "@tanstack/react-query";
import React, { useCallback, useMemo, useRef, useState } from "react";
import { FlatList, Modal, Pressable, Text, View } from "react-native";
import * as contracts from "./contracts.shared.ts";
import type { RenderEntry, SessionSummary } from "./render-types.shared.ts";
import { groupEntries } from "./timeline-model.client.ts";
import { TimelineItemView } from "./timeline.client.tsx";
import { Tint, relativeTimeFrom } from "./ui.client.tsx";

const SESSION_POLL_MS = 2000;
const TIMELINE_POLL_MS = 750;

type TimelineState = {
  key: string;
  revision: number;
  entries: (RenderEntry | undefined)[];
  unsupportedCount: number;
  total: number;
};

function emptyTimeline(key: string): TimelineState {
  return { key, revision: 0, entries: [], unsupportedCount: 0, total: 0 };
}

function sessionLabel(session: SessionSummary): string {
  return session.title || session.preview || session.sessionId.slice(0, 8);
}

export function ClaudeCodePanel({ workspaceId, theme, layout }: PluginWorkspacePanelProps) {
  const workspaceDir = useWorkspace(workspaceId, (workspace) => workspace.directory);
  const listSessions = useRpc(contracts.listSessions);
  const getTimeline = useRpc(contracts.getTimeline);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  const sessionsQuery = useQuery({
    queryKey: ["claude-code-sessions", workspaceDir],
    enabled: workspaceDir !== null,
    refetchInterval: SESSION_POLL_MS,
    queryFn: () => listSessions({ workspaceDir: workspaceDir! }),
  });

  const sessions = sessionsQuery.data?.sessions ?? [];
  const activeSessionId =
    selectedSessionId ?? sessions.find((session) => session.isLive)?.sessionId ?? sessions[0]?.sessionId ?? null;
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

  const onSelectSession = useCallback((sessionId: string) => {
    setSelectedSessionId(sessionId);
    setPickerOpen(false);
  }, []);

  if (workspaceDir === null) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.colors.surface0, padding: 16 }}>
        <Text style={{ color: theme.colors.foregroundMuted }}>Loading workspace…</Text>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.surface0 }}>
      <SessionHeader
        theme={theme}
        compact={layout.compact}
        session={activeSession}
        sessionCount={sessions.length}
        onOpenPicker={() => setPickerOpen(true)}
      />
      {activeSessionId === null ? (
        <EmptyState
          theme={theme}
          title="No Claude Code sessions yet"
          body={
            sessionsQuery.data?.projectDir === null
              ? "No transcript directory exists for this workspace yet. Run `claude` in a terminal here first."
              : "Run `claude` in a paseo terminal in this workspace and its session will show up here."
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
              {timelineQuery.isPending ? "Loading transcript…" : "This session has no rendered entries."}
            </Text>
          }
        />
      )}
      <Footer
        theme={theme}
        entryCount={entries.length}
        unsupportedCount={timelineQuery.data?.unsupportedCount ?? 0}
      />
      <SessionPicker
        theme={theme}
        visible={pickerOpen}
        sessions={sessions}
        activeSessionId={activeSessionId}
        onSelect={onSelectSession}
        onClose={() => setPickerOpen(false)}
      />
    </View>
  );
}

function SessionHeader({
  theme,
  compact,
  session,
  sessionCount,
  onOpenPicker,
}: {
  theme: PluginWorkspacePanelProps["theme"];
  compact: boolean;
  session: SessionSummary | null;
  sessionCount: number;
  onOpenPicker: () => void;
}) {
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        paddingHorizontal: compact ? 10 : 16,
        paddingVertical: 10,
      }}
    >
      <Pressable
        onPress={onOpenPicker}
        style={{ flex: 1, borderRadius: 8, overflow: "hidden", padding: 8 }}
      >
        <Tint color={theme.colors.foreground} opacity={0.08} />
        <Text numberOfLines={1} style={{ color: theme.colors.foreground, fontWeight: "600" }}>
          {session ? sessionLabel(session) : "No session"}
        </Text>
        <Text numberOfLines={1} style={{ color: theme.colors.foregroundMuted, fontSize: 11 }}>
          {session
            ? `${session.isLive ? "live · " : ""}${relativeTimeFrom(session.mtime)} · ${sessionCount} session${sessionCount === 1 ? "" : "s"}`
            : "tap to pick a session"}
        </Text>
      </Pressable>
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
    <View style={{ paddingHorizontal: 12, paddingVertical: 6, flexDirection: "row", gap: 12 }}>
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

function SessionPicker({
  theme,
  visible,
  sessions,
  activeSessionId,
  onSelect,
  onClose,
}: {
  theme: PluginWorkspacePanelProps["theme"];
  visible: boolean;
  sessions: SessionSummary[];
  activeSessionId: string | null;
  onSelect: (sessionId: string) => void;
  onClose: () => void;
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={{ flex: 1, justifyContent: "center", padding: 16 }} onPress={onClose}>
        <Tint color="#000000" opacity={0.5} />
        <View
          style={{
            maxHeight: "80%",
            borderRadius: 12,
            overflow: "hidden",
            backgroundColor: theme.colors.surface0,
            padding: 8,
          }}
        >
          <FlatList
            data={sessions}
            keyExtractor={(session) => session.sessionId}
            renderItem={({ item }) => (
              <Pressable
                onPress={() => onSelect(item.sessionId)}
                style={{ padding: 10, borderRadius: 8, overflow: "hidden" }}
              >
                {item.sessionId === activeSessionId ? (
                  <Tint color={theme.colors.accent} opacity={0.18} />
                ) : null}
                <Text numberOfLines={1} style={{ color: theme.colors.foreground }}>
                  {sessionLabel(item)}
                </Text>
                <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11 }}>
                  {item.isLive ? "live · " : ""}
                  {relativeTimeFrom(item.mtime)} · {item.sessionId.slice(0, 8)}
                </Text>
              </Pressable>
            )}
            ListEmptyComponent={
              <Text style={{ color: theme.colors.foregroundMuted, padding: 10 }}>No sessions found.</Text>
            }
          />
        </View>
      </Pressable>
    </Modal>
  );
}
