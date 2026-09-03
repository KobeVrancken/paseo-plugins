import { useRpc } from "@getpaseo/plugin";
import { useQuery } from "@tanstack/react-query";
import React from "react";
import { Text, View } from "react-native";
import * as contracts from "../contracts.shared.ts";
import type { SubagentsPayload } from "../contracts.shared.ts";
import { lastStepLabel } from "../subagents.shared.ts";
import { fontSize, leading, spacing, type Palette } from "./theme.client.ts";
import { Monospace } from "./status.client.tsx";
import { Card, Disclosure, Row, Section } from "./ui.client.tsx";

export const SUBAGENTS_QUERY_KEY = ["claude-tty", "subagents"];
const REFETCH_MS = 5_000;

type Subagent = SubagentsPayload["sessions"][number]["subagents"][number];

export function SubagentsSection({ palette }: { palette: Palette }) {
  const getSubagents = useRpc(contracts.getSubagents);
  const query = useQuery({
    queryKey: SUBAGENTS_QUERY_KEY,
    queryFn: () => getSubagents({}),
    refetchInterval: REFETCH_MS,
  });
  const payload = query.data ?? null;

  return (
    <Section palette={palette} title="Subagents">
      {payload === null ? null : payload.sessions.length === 0 ? (
        <Card palette={palette}>
          <Row palette={palette} title="No subagents" hint="Nothing has been launched in the open sessions" dimmed />
        </Card>
      ) : (
        payload.sessions.map((session) => (
          <View key={session.sessionId} style={{ gap: spacing[2] }}>
            {payload.sessions.length > 1 ? (
              <Text numberOfLines={1} style={{ color: palette.foregroundMuted, fontSize: fontSize.sm, marginLeft: spacing[1] }}>
                {session.cwd ?? session.sessionId}
              </Text>
            ) : null}
            {session.subagents.map((subagent) => (
              <Disclosure
                key={subagent.agentId}
                palette={palette}
                title={subagent.description ?? subagent.agentId}
                summary={summary(subagent, payload.now)}
              >
                <SubagentSteps palette={palette} sessionId={session.sessionId} subagent={subagent} />
              </Disclosure>
            ))}
          </View>
        ))
      )}

      {payload?.problem ? <Monospace palette={palette} text={payload.problem} /> : null}

      <Text
        style={{
          color: palette.foregroundMuted,
          fontSize: fontSize.sm,
          lineHeight: leading(fontSize.sm),
          marginLeft: spacing[1],
        }}
      >
        Claude keeps a transcript for every subagent it runs, and the session's own transcript says
        only that one was launched. These are read from those files, so a subagent shows its work here
        and in the tool call that launched it. Only open sessions are listed: a subagent runs inside
        its session's Claude process and stops with it.
      </Text>
    </Section>
  );
}

function SubagentSteps({
  palette,
  sessionId,
  subagent,
}: {
  palette: Palette;
  sessionId: string;
  subagent: Subagent;
}) {
  const readSubagent = useRpc(contracts.readSubagent);
  const query = useQuery({
    queryKey: [...SUBAGENTS_QUERY_KEY, sessionId, subagent.agentId],
    queryFn: () => readSubagent({ sessionId, agentId: subagent.agentId }),
    // A finished subagent writes nothing more, so only a running one is worth asking about again.
    refetchInterval: subagent.status === "running" ? REFETCH_MS : false,
  });

  const body = () => {
    if (query.error) return String(query.error);
    if (!query.data) return "Reading…";
    const earlier = query.data.earlier > 0 ? [`… ${query.data.earlier} earlier steps`] : [];
    const steps = [...earlier, ...query.data.steps];
    return steps.length === 0 ? "No steps yet." : steps.join("\n");
  };

  return (
    <View style={{ padding: spacing[4], gap: spacing[3] }}>
      {subagent.summary ? (
        <Text style={{ color: palette.foreground, fontSize: fontSize.sm, lineHeight: leading(fontSize.sm) }}>
          {subagent.summary}
        </Text>
      ) : null}
      <Monospace palette={palette} text={body()} />
    </View>
  );
}

function summary(subagent: Subagent, now: number): string {
  const state =
    subagent.status === "unknown" ? "launch no longer in the transcript" : subagent.status;
  return [state, subagent.nested ? "nested" : null, lastStepLabel(subagent.lastActivity, now)]
    .filter((part) => part !== null)
    .join(" · ");
}
