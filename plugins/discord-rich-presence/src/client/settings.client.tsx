import type { PluginSurfaceProps } from "@getpaseo/plugin";
import { useRpc } from "@getpaseo/plugin";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import React, { useMemo, useState } from "react";
import { ScrollView, Text, TextInput, View } from "react-native";
import * as contracts from "../contracts.shared.ts";
import type { PresenceStatusPayload } from "../contracts.shared.ts";
import {
  BADGE_COLORS,
  DETAIL_LEVELS,
  DETAIL_LEVEL_LABELS,
  type DetailLevel,
  MANAGED_APPLICATION_ID,
} from "../presence.shared.ts";
import { coerceApplicationId } from "../settings.shared.ts";
import { DiscordPreview } from "./preview.client.tsx";
import {
  MAX_CONTENT_WIDTH,
  controlHeight,
  fontSize,
  leading,
  radius,
  spacing,
  type Palette,
} from "./theme.client.ts";
import {
  Button,
  Card,
  NO_OUTLINE,
  Row,
  Section,
  SegmentedControl,
  StatusDot,
  Switch,
  usePalette,
} from "./ui.client.tsx";

const STATUS_QUERY_KEY = ["discord-rich-presence", "status"];
const REFETCH_MS = 5_000;

type Connection = { text: string; tone: "accent" | "muted" | "danger" };

function connectionOf(status: PresenceStatusPayload): Connection {
  if (!status.settings.applicationId) {
    return { text: "No application ID — add one below", tone: "muted" };
  }
  if (!status.settings.enabled) return { text: "Off — your profile shows nothing", tone: "muted" };
  if (status.daemon.status === "failed") {
    return { text: `Cannot read Paseo: ${status.daemon.error ?? "unknown error"}`, tone: "danger" };
  }
  switch (status.discord.status) {
    case "connected":
      return { text: "Connected to Discord", tone: "accent" };
    case "connecting":
      return { text: "Connecting to Discord…", tone: "muted" };
    case "unavailable":
      return { text: `${status.discord.error ?? "Discord not running"} — retrying…`, tone: "muted" };
    case "rejected":
      return { text: status.discord.error ?? "Discord refused this application ID", tone: "danger" };
    default:
      return { text: "Idle", tone: "muted" };
  }
}

function toneColor(palette: Palette, tone: Connection["tone"]): string {
  if (tone === "accent") return palette.accent;
  if (tone === "danger") return palette.statusDanger;
  return palette.foregroundMuted;
}

const DETAIL_LEVEL_HINTS: Record<DetailLevel, string> = {
  detailed: "Your project, the workspace you are in, and what your agents are doing.",
  projects: "Your project name and how many workspaces are open. Workspace titles stay private.",
  anonymous: "Only that Paseo is running.",
};

function ApplicationIdField({
  palette,
  value,
  onChangeText,
  onSubmit,
}: {
  palette: Palette;
  value: string;
  onChangeText: (value: string) => void;
  onSubmit: () => void;
}) {
  return (
    <TextInput
      value={value}
      onChangeText={onChangeText}
      onSubmitEditing={onSubmit}
      placeholder={MANAGED_APPLICATION_ID}
      placeholderTextColor={palette.foregroundExtraMuted}
      accessibilityLabel="Discord application ID"
      style={[
        {
          flex: 1,
          minWidth: 160,
          minHeight: controlHeight.compact,
          color: palette.foreground,
          backgroundColor: palette.surface0,
          borderWidth: 1,
          borderColor: palette.borderAccent,
          borderRadius: radius.md,
          paddingHorizontal: spacing[3],
          fontSize: fontSize.base,
        },
        NO_OUTLINE,
      ]}
    />
  );
}

export function DiscordPresenceSurface({ theme, layout }: PluginSurfaceProps) {
  const palette = usePalette(theme);
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
  const connection = useMemo(() => (status ? connectionOf(status) : null), [status]);

  if (!status || !connection) {
    return (
      <View style={{ flex: 1, backgroundColor: palette.surface0, padding: spacing[4] }}>
        <Text style={{ color: palette.foregroundMuted, fontSize: fontSize.base }}>Loading…</Text>
      </View>
    );
  }

  const settings = status.settings;
  const savedId = settings.applicationId ?? "";
  const applicationId = draftId ?? savedId;
  const parsedId = coerceApplicationId(applicationId);
  const idChanged = applicationId.trim() !== savedId;
  const idInvalid = applicationId.trim().length > 0 && parsedId === null;
  const badgeColor = status.activity?.smallImageKey
    ? (BADGE_COLORS[status.activity.smallImageKey] ?? null)
    : null;

  const saveApplicationId = () => {
    if (idInvalid || !idChanged) return;
    apply.mutate({ ...settings, applicationId: parsedId });
    setDraftId(null);
  };

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
      <Card palette={palette}>
        <Row
          palette={palette}
          title="Show my activity on Discord"
          hint={connection.text}
          hintColor={toneColor(palette, connection.tone)}
          leading={
            <View style={{ paddingRight: spacing[1] }}>
              <StatusDot color={toneColor(palette, connection.tone)} />
            </View>
          }
          trailing={
            <Switch
              palette={palette}
              value={settings.enabled}
              onValueChange={(enabled) => apply.mutate({ ...settings, enabled })}
              accessibilityLabel="Show my activity on Discord"
            />
          }
        />
      </Card>

      <Section
        palette={palette}
        title="Preview"
        trailing={
          badgeColor && status.activity?.smallImageText ? (
            <View style={{ flexDirection: "row", alignItems: "center", gap: spacing[2] }}>
              <StatusDot color={badgeColor} size={6} />
              <Text style={{ color: palette.foregroundMuted, fontSize: fontSize.sm }}>
                {status.activity.smallImageText}
              </Text>
            </View>
          ) : null
        }
      >
        <DiscordPreview status={status} />
      </Section>

      <Section palette={palette} title="Detail level">
        <Card palette={palette}>
          <View style={{ padding: spacing[4], gap: spacing[3] }}>
            <SegmentedControl
              palette={palette}
              value={settings.detailLevel}
              options={DETAIL_LEVELS.map((level: DetailLevel) => ({
                value: level,
                label: DETAIL_LEVEL_LABELS[level],
              }))}
              onValueChange={(detailLevel) => apply.mutate({ ...settings, detailLevel })}
            />
            <Text
              style={{
                color: palette.foregroundMuted,
                fontSize: fontSize.sm,
                lineHeight: leading(fontSize.sm),
              }}
            >
              {DETAIL_LEVEL_HINTS[settings.detailLevel]}
            </Text>
          </View>
        </Card>
      </Section>

      <Section palette={palette} title="Projects">
        <Card palette={palette}>
          {status.projects.length === 0 ? (
            <Row palette={palette} title="No projects open." dimmed />
          ) : (
            status.projects.map((project, index) => (
              <Row
                key={project.rootPath}
                palette={palette}
                title={project.displayName}
                hint={project.rootPath}
                dimmed={project.muted}
                divided={index > 0}
                trailing={
                  <Switch
                    palette={palette}
                    value={!project.muted}
                    onValueChange={(shown) =>
                      toggleMute.mutate({
                        rootPath: project.rootPath,
                        displayName: project.displayName,
                        muted: !shown,
                      })
                    }
                    accessibilityLabel={`Show ${project.displayName} on Discord`}
                  />
                }
              />
            ))
          )}
        </Card>
        <Text
          style={{
            color: palette.foregroundMuted,
            fontSize: fontSize.sm,
            lineHeight: leading(fontSize.sm),
            marginLeft: spacing[1],
          }}
        >
          Switch a project off to keep it off your profile. Paseo shows another project with active
          work instead, or falls back to the anonymous presence.
        </Text>
      </Section>

      <Section palette={palette} title="Application">
        <Card palette={palette}>
          <View style={{ padding: spacing[4], gap: spacing[3] }}>
            <View style={{ flexDirection: "row", gap: spacing[2], alignItems: "center", flexWrap: "wrap" }}>
              <ApplicationIdField
                palette={palette}
                value={applicationId}
                onChangeText={setDraftId}
                onSubmit={saveApplicationId}
              />
              <Button
                palette={palette}
                label="Save"
                variant="default"
                disabled={!idChanged || idInvalid}
                onPress={saveApplicationId}
              />
              {savedId !== MANAGED_APPLICATION_ID ? (
                <Button
                  palette={palette}
                  label="Use the shared one"
                  variant="ghost"
                  onPress={() => {
                    apply.mutate({ ...settings, applicationId: MANAGED_APPLICATION_ID });
                    setDraftId(null);
                  }}
                />
              ) : null}
            </View>
            <Text
              style={{
                color: idInvalid ? palette.statusDanger : palette.foregroundMuted,
                fontSize: fontSize.sm,
                lineHeight: leading(fontSize.sm),
              }}
            >
              {idInvalid
                ? "An application ID is 17 to 20 digits."
                : "The shared Paseo application, already filled in. Replace it with your own to host the presence yourself — the plugin README walks through the portal steps and the art assets."}
            </Text>
          </View>
        </Card>
      </Section>
    </ScrollView>
  );
}
