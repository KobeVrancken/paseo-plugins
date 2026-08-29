import type { PluginSurfaceProps } from "@getpaseo/plugin";
import { useRpc } from "@getpaseo/plugin";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import React, { useCallback } from "react";
import { ScrollView, Text, View } from "react-native";
import * as contracts from "../contracts.shared.ts";
import { DoctorSection } from "./doctor.client.tsx";
import { InstallSection } from "./install.client.tsx";
import { SessionsSection } from "./sessions.client.tsx";
import { UninstallSection } from "./uninstall.client.tsx";
import { MAX_CONTENT_WIDTH, fontSize, leading, spacing } from "./theme.client.ts";
import {
  Monospace,
  ReadingRow,
  adapterReading,
  claudeReading,
  pnpmReading,
  providerReading,
} from "./status.client.tsx";
import { Card, Row, Section, usePalette } from "./ui.client.tsx";

export const STATUS_QUERY_KEY = ["claude-tty", "status"];
const REFETCH_MS = 5_000;

export function ClaudeTtySurface({ theme, layout }: PluginSurfaceProps) {
  const palette = usePalette(theme);
  const queryClient = useQueryClient();
  const getStatus = useRpc(contracts.getStatus);
  const query = useQuery({
    queryKey: STATUS_QUERY_KEY,
    queryFn: () => getStatus({}),
    refetchInterval: REFETCH_MS,
  });
  const status = query.data ?? null;
  const refreshStatus = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: STATUS_QUERY_KEY });
  }, [queryClient]);

  if (!status) {
    return (
      <View style={{ flex: 1, backgroundColor: palette.surface0, padding: spacing[4] }}>
        <Text style={{ color: palette.foregroundMuted, fontSize: fontSize.base }}>Loading…</Text>
      </View>
    );
  }

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: palette.surface0 }}
      contentContainerStyle={{
        width: "100%",
        maxWidth: MAX_CONTENT_WIDTH,
        alignSelf: "center",
        padding: layout.compact ? spacing[3] : spacing[4],
        paddingTop: spacing[6],
        paddingBottom: spacing[8],
        gap: spacing[6],
      }}
    >
      {status.problem === null ? null : (
        <Section palette={palette} title="Checkout">
          <Monospace palette={palette} text={status.problem} />
          <Text
            style={{
              color: palette.foregroundMuted,
              fontSize: fontSize.sm,
              lineHeight: leading(fontSize.sm),
              marginLeft: spacing[1],
            }}
          >
            This plugin manages the adapter in the checkout it was installed from, so it needs its own
            entry in the daemon configuration before it can do anything.
          </Text>
        </Section>
      )}

      <Section palette={palette} title="Adapter">
        <Card palette={palette}>
          <ReadingRow palette={palette} title="Provider" reading={providerReading(status)} />
          <ReadingRow palette={palette} title="Executable" reading={adapterReading(status)} divided />
          <Row
            palette={palette}
            title="Checkout"
            hint={status.repoRoot ?? "Unknown"}
            dimmed={status.repoRoot === null}
            divided
          />
        </Card>
      </Section>

      <InstallSection palette={palette} status={status} onSettled={refreshStatus} />

      <DoctorSection palette={palette} />

      <SessionsSection palette={palette} />

      <Section palette={palette} title="This host">
        <Card palette={palette}>
          <Row palette={palette} title="Node.js" hint={status.host.node} />
          <ReadingRow palette={palette} title="Claude Code" reading={claudeReading(status)} divided />
          <ReadingRow palette={palette} title="pnpm" reading={pnpmReading(status)} divided />
          <Row palette={palette} title="State directory" hint={status.stateDirectory} divided />
        </Card>
        <Text
          style={{
            color: palette.foregroundMuted,
            fontSize: fontSize.sm,
            lineHeight: leading(fontSize.sm),
            marginLeft: spacing[1],
          }}
        >
          Everything here is local to the host running this daemon. Selecting another host in Paseo
          shows that host's own answer.
        </Text>
      </Section>

      <UninstallSection palette={palette} onSettled={refreshStatus} />
    </ScrollView>
  );
}
