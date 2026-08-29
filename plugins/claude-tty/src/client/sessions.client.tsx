import { useRpc } from "@getpaseo/plugin";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import React from "react";
import { Text, View } from "react-native";
import * as contracts from "../contracts.shared.ts";
import type { SessionsPayload } from "../contracts.shared.ts";
import { fontSize, leading, spacing, type Palette } from "./theme.client.ts";
import { ConfirmButton } from "./confirm.client.tsx";
import { Monospace, ReadingRow, type Reading } from "./status.client.tsx";
import { Card, Row, Section } from "./ui.client.tsx";

export const SESSIONS_QUERY_KEY = ["claude-tty", "sessions"];
const REFETCH_MS = 10_000;

type Session = SessionsPayload["sessions"][number];

export function SessionsSection({ palette }: { palette: Palette }) {
  const queryClient = useQueryClient();
  const getSessions = useRpc(contracts.getSessions);
  const releaseLock = useRpc(contracts.releaseLock);
  const quarantineSession = useRpc(contracts.quarantineSession);

  const query = useQuery({
    queryKey: SESSIONS_QUERY_KEY,
    queryFn: () => getSessions({}),
    refetchInterval: REFETCH_MS,
  });
  const onSuccess = (next: SessionsPayload) => queryClient.setQueryData(SESSIONS_QUERY_KEY, next);
  const release = useMutation({ mutationFn: (id: string) => releaseLock({ id }), onSuccess });
  const quarantine = useMutation({ mutationFn: (id: string) => quarantineSession({ id }), onSuccess });

  const payload = query.data ?? null;
  const busy = release.isPending || quarantine.isPending;
  const failure = release.error ?? quarantine.error ?? null;

  return (
    <Section palette={palette} title="Sessions">
      {payload === null ? null : payload.sessions.length === 0 ? (
        <Card palette={palette}>
          <Row palette={palette} title="No saved sessions" hint={payload.stateDirectory} dimmed />
        </Card>
      ) : (
        <Card palette={palette}>
          {payload.sessions.map((session, index) => (
            <ReadingRow
              key={session.id}
              palette={palette}
              title={title(session)}
              reading={reading(session)}
              divided={index > 0}
              trailing={
                <SessionAction
                  palette={palette}
                  session={session}
                  busy={busy}
                  onRelease={() => release.mutate(session.id)}
                  onQuarantine={() => quarantine.mutate(session.id)}
                />
              }
            />
          ))}
        </Card>
      )}

      {payload?.problem ? <Monospace palette={palette} text={payload.problem} /> : null}
      {failure ? <Monospace palette={palette} text={String(failure)} /> : null}

      <Text
        style={{
          color: palette.foregroundMuted,
          fontSize: fontSize.sm,
          lineHeight: leading(fontSize.sm),
          marginLeft: spacing[1],
        }}
      >
        A lock names the process holding a session. The adapter clears its own on exit and recovers
        one left by a process that has died, so releasing by hand is only for a lock that outlived
        its process and is still in the way.
      </Text>
    </Section>
  );
}

function SessionAction({
  palette,
  session,
  busy,
  onRelease,
  onQuarantine,
}: {
  palette: Palette;
  session: Session;
  busy: boolean;
  onRelease: () => void;
  onQuarantine: () => void;
}) {
  if (session.corrupt) {
    return (
      <ConfirmButton
        palette={palette}
        label="Move aside"
        confirmLabel="Move it aside"
        disabled={busy}
        onConfirm={onQuarantine}
      />
    );
  }
  if (session.lock !== null && !session.lock.live) {
    return (
      <ConfirmButton
        palette={palette}
        label="Release lock"
        confirmLabel="Release it"
        disabled={busy}
        onConfirm={onRelease}
      />
    );
  }
  return null;
}

function title(session: Session): string {
  return session.cwd ?? session.id;
}

function reading(session: Session): Reading {
  if (session.corrupt) return { hint: `${session.id} — unreadable`, tone: "danger" };
  if (session.orphanLock) return { hint: `${session.id} — a lock with no session beside it`, tone: "danger" };
  const held =
    session.lock === null
      ? "not open"
      : session.lock.live
        ? `open in process ${session.lock.pid}`
        : `stale lock from process ${session.lock.pid}`;
  return {
    hint: [session.model, session.mode, held].filter((part) => part !== null && part !== "").join(" · "),
    tone: session.lock?.live ? "ok" : session.lock === null ? "muted" : "danger",
  };
}
