import type { PluginSurfaceProps, PluginTheme } from "@getpaseo/plugin";
import { useRpc } from "@getpaseo/plugin";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import React, { useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import * as contracts from "../contracts.shared.ts";
import type { PresenceStatusPayload } from "../contracts.shared.ts";
import { DETAIL_LEVELS, DETAIL_LEVEL_LABELS, type DetailLevel } from "../presence.shared.ts";

const STATUS_QUERY_KEY = ["discord-presence", "status"];
const REFETCH_MS = 5_000;

type Colors = PluginTheme["colors"];

function connectionLine(status: PresenceStatusPayload): { text: string; tone: keyof Colors } {
  if (!status.settings.applicationId) {
    return { text: "Not configured — add an application ID", tone: "foregroundMuted" };
  }
  if (!status.settings.enabled) return { text: "Switched off", tone: "foregroundMuted" };
  if (status.daemon.status === "failed") {
    return { text: `Cannot read Paseo: ${status.daemon.error ?? "unknown error"}`, tone: "statusDanger" };
  }
  switch (status.discord.status) {
    case "connected":
      return { text: "Connected to Discord", tone: "accent" };
    case "connecting":
      return { text: "Connecting to Discord…", tone: "foregroundMuted" };
    case "unavailable":
      return { text: "Discord not running — retrying…", tone: "foregroundMuted" };
    default:
      return { text: "Idle", tone: "foregroundMuted" };
  }
}

function useElapsed(startTimestamp: number | null): string | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (startTimestamp === null) return;
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [startTimestamp]);
  if (startTimestamp === null) return null;
  const total = Math.max(0, Math.floor((now - startTimestamp) / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  const hours = Math.floor(minutes / 60);
  const body = `${String(minutes % 60).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  return hours > 0 ? `${hours}:${body} elapsed` : `${body} elapsed`;
}

function Button({
  colors,
  label,
  onPress,
  tone = "outline",
}: {
  colors: Colors;
  label: string;
  onPress: () => void;
  tone?: "outline" | "accent";
}) {
  return (
    <Pressable
      onPress={onPress}
      style={{
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: 6,
        borderWidth: 1,
        borderColor: tone === "accent" ? colors.accent : colors.foregroundMuted,
        backgroundColor: tone === "accent" ? colors.accent : "transparent",
      }}
    >
      <Text style={{ color: tone === "accent" ? colors.accentForeground : colors.foreground, fontSize: 13 }}>
        {label}
      </Text>
    </Pressable>
  );
}

function Section({
  colors,
  title,
  children,
}: {
  colors: Colors;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <View style={{ gap: 8 }}>
      <Text style={{ color: colors.foregroundMuted, fontSize: 12, textTransform: "uppercase" }}>
        {title}
      </Text>
      {children}
    </View>
  );
}

function Preview({ colors, status }: { colors: Colors; status: PresenceStatusPayload }) {
  const elapsed = useElapsed(status.activity?.startTimestamp ?? null);
  if (!status.activity) {
    return (
      <Text style={{ color: colors.foregroundMuted, fontSize: 13 }}>
        Nothing is sent to Discord right now.
      </Text>
    );
  }
  return (
    <View
      style={{
        borderWidth: 1,
        borderColor: colors.foregroundMuted,
        borderRadius: 8,
        padding: 12,
        gap: 2,
      }}
    >
      <Text style={{ color: colors.foreground, fontSize: 14, fontWeight: "600" }}>
        {status.activity.largeImageText}
      </Text>
      <Text style={{ color: colors.foreground, fontSize: 13 }}>{status.activity.details}</Text>
      {status.activity.state ? (
        <Text style={{ color: colors.foreground, fontSize: 13 }}>{status.activity.state}</Text>
      ) : null}
      {elapsed ? <Text style={{ color: colors.foregroundMuted, fontSize: 12 }}>{elapsed}</Text> : null}
      {status.activity.smallImageText ? (
        <Text style={{ color: colors.foregroundMuted, fontSize: 12 }}>
          Badge: {status.activity.smallImageText}
        </Text>
      ) : null}
    </View>
  );
}

export function DiscordPresenceSurface({ theme, layout }: PluginSurfaceProps) {
  const colors = theme.colors;
  const queryClient = useQueryClient();
  const getStatus = useRpc(contracts.getStatus);
  const setSettings = useRpc(contracts.setSettings);
  const muteProject = useRpc(contracts.muteProject);

  const query = useQuery({
    queryKey: STATUS_QUERY_KEY,
    queryFn: () => getStatus({}),
    refetchInterval: REFETCH_MS,
  });
  const apply = useMutation({
    mutationFn: (next: PresenceStatusPayload["settings"]) => setSettings(next),
    onSuccess: (next) => queryClient.setQueryData(STATUS_QUERY_KEY, next),
  });
  const toggleMute = useMutation({
    mutationFn: (input: { rootPath: string; displayName: string; muted: boolean }) =>
      muteProject(input),
    onSuccess: (next) => queryClient.setQueryData(STATUS_QUERY_KEY, next),
  });

  const status = query.data ?? null;
  const [draftId, setDraftId] = useState<string | null>(null);
  const applicationId = draftId ?? status?.settings.applicationId ?? "";
  const line = useMemo(() => (status ? connectionLine(status) : null), [status]);

  if (!status || !line) {
    return (
      <View style={{ flex: 1, padding: layout.compact ? 16 : 24, backgroundColor: colors.surface0 }}>
        <Text style={{ color: colors.foregroundMuted }}>Loading…</Text>
      </View>
    );
  }

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.surface0 }}
      contentContainerStyle={{ padding: layout.compact ? 16 : 24, gap: 24 }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <Text style={{ color: colors[line.tone], fontSize: 14, flexShrink: 1 }}>{line.text}</Text>
        <Button
          colors={colors}
          label={status.settings.enabled ? "Turn off" : "Turn on"}
          tone={status.settings.enabled ? "outline" : "accent"}
          onPress={() => apply.mutate({ ...status.settings, enabled: !status.settings.enabled })}
        />
      </View>

      <Section colors={colors} title="Application ID">
        <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
          <TextInput
            value={applicationId}
            onChangeText={setDraftId}
            placeholder="1234567890123456789"
            placeholderTextColor={colors.foregroundMuted}
            style={{
              flex: 1,
              color: colors.foreground,
              borderWidth: 1,
              borderColor: colors.foregroundMuted,
              borderRadius: 6,
              paddingHorizontal: 10,
              paddingVertical: 6,
              fontSize: 13,
            }}
          />
          <Button
            colors={colors}
            label="Save"
            tone="accent"
            onPress={() => {
              apply.mutate({ ...status.settings, applicationId: applicationId.trim() || null });
              setDraftId(null);
            }}
          />
        </View>
        <Text style={{ color: colors.foregroundMuted, fontSize: 12 }}>
          Create an application named Paseo at discord.com/developers, then paste its ID here. The
          plugin README walks through the portal steps and the art assets.
        </Text>
      </Section>

      <Section colors={colors} title="Detail level">
        <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
          {DETAIL_LEVELS.map((level: DetailLevel) => (
            <Button
              key={level}
              colors={colors}
              label={DETAIL_LEVEL_LABELS[level]}
              tone={status.settings.detailLevel === level ? "accent" : "outline"}
              onPress={() => apply.mutate({ ...status.settings, detailLevel: level })}
            />
          ))}
        </View>
      </Section>

      <Section colors={colors} title="Preview">
        <Preview colors={colors} status={status} />
      </Section>

      <Section colors={colors} title="Projects">
        {status.projects.length === 0 ? (
          <Text style={{ color: colors.foregroundMuted, fontSize: 13 }}>No projects open.</Text>
        ) : (
          status.projects.map((project) => (
            <View
              key={project.rootPath}
              style={{
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
                paddingVertical: 6,
              }}
            >
              <View style={{ flexShrink: 1 }}>
                <Text style={{ color: colors.foreground, fontSize: 13 }}>{project.displayName}</Text>
                <Text style={{ color: colors.foregroundMuted, fontSize: 11 }}>{project.rootPath}</Text>
              </View>
              <Button
                colors={colors}
                label={project.muted ? "Muted" : "Mute"}
                tone={project.muted ? "accent" : "outline"}
                onPress={() =>
                  toggleMute.mutate({
                    rootPath: project.rootPath,
                    displayName: project.displayName,
                    muted: !project.muted,
                  })
                }
              />
            </View>
          ))
        )}
      </Section>
    </ScrollView>
  );
}
