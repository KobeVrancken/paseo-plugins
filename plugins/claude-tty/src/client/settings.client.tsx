import { useRpc } from "@getpaseo/plugin";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import React from "react";
import { Text } from "react-native";
import * as contracts from "../contracts.shared.ts";
import type { StatusPayload } from "../contracts.shared.ts";
import { IDLE_TIMEOUT_OPTIONS } from "../settings.shared.ts";
import { fontSize, leading, spacing, type Palette } from "./theme.client.ts";
import { Card, Row, Section, Select } from "./ui.client.tsx";

const STATUS_QUERY_KEY = ["claude-tty", "status"];

const OPTIONS = IDLE_TIMEOUT_OPTIONS.map((option) => ({
  value: String(option.value),
  label: option.label,
  description:
    option.value === 0
      ? "Keep native Claude processes alive until their tabs close"
      : `Stop the native process after ${option.label} without a foreground prompt`,
}));

export function SettingsSection({ palette, status }: { palette: Palette; status: StatusPayload }) {
  const queryClient = useQueryClient();
  const setSettings = useRpc(contracts.setSettings);
  const apply = useMutation({
    mutationFn: (idleTimeoutMs: number) => setSettings({ idleTimeoutMs }),
    onSuccess: (next) => queryClient.setQueryData(STATUS_QUERY_KEY, next),
  });
  const disabled = status.provider.state !== "matching" || apply.isPending;
  const selected = String(status.settings.idleTimeoutMs);
  const options = OPTIONS.some((option) => option.value === selected)
    ? OPTIONS
    : [{ value: selected, label: formatTimeout(status.settings.idleTimeoutMs), description: "Custom provider value" }, ...OPTIONS];

  return (
    <Section palette={palette} title="Settings">
      <Card palette={palette}>
        <Row
          palette={palette}
          title="Suspend idle Claude"
          hint={disabled ? "Install or repair this provider to change the timeout" : "Measured from the end of the last foreground turn"}
          trailing={
            <Select
              palette={palette}
              value={selected}
              options={options}
              disabled={disabled}
              accessibilityLabel={`Suspend idle Claude after ${formatTimeout(status.settings.idleTimeoutMs)}`}
              onValueChange={(value) => apply.mutate(Number(value))}
            />
          }
        />
      </Card>
      <Text
        style={{
          color: apply.error ? palette.statusDanger : palette.foregroundMuted,
          fontSize: fontSize.sm,
          lineHeight: leading(fontSize.sm),
          marginLeft: spacing[1],
        }}
      >
        {apply.error
          ? apply.error instanceof Error
            ? apply.error.message
            : String(apply.error)
          : "Suspension stops the PTY and its background tasks but keeps the logical session. Your next prompt resumes the same Claude conversation automatically. Open adapters keep the setting they started with."}
      </Text>
    </Section>
  );
}

function formatTimeout(milliseconds: number): string {
  if (milliseconds === 0) return "never";
  if (milliseconds % 3_600_000 === 0) {
    const hours = milliseconds / 3_600_000;
    return `${hours} hour${hours === 1 ? "" : "s"}`;
  }
  const minutes = Math.round(milliseconds / 60_000);
  return `${minutes} minute${minutes === 1 ? "" : "s"}`;
}
