import type { PluginTheme } from "@getpaseo/plugin";
import React, { useState } from "react";
import { Modal, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import type { SendBehavior, SessionStatus } from "./render-types.shared.ts";
import { Card, Tint } from "./ui.client.tsx";

export const SEND_BEHAVIOR_LABELS: Record<SendBehavior, string> = {
  cli_default: "CLI default",
  hold_until_idle: "Hold until idle",
  interrupt_first: "Interrupt first",
};

export const SEND_BEHAVIOR_HINTS: Record<SendBehavior, string> = {
  cli_default: "Forward immediately; the CLI queues or steers input typed mid-turn.",
  hold_until_idle: "Wait for the session to go idle before forwarding.",
  interrupt_first: "Press Esc to stop the current turn, then forward.",
};

const STATUS_LABELS: Record<SessionStatus, string> = {
  idle: "idle",
  running: "running",
  needs_input: "needs input",
  detached: "no terminal",
};

export function StatusPill({ status, theme }: { status: SessionStatus; theme: PluginTheme }) {
  const color =
    status === "running"
      ? theme.colors.accent
      : status === "needs_input"
        ? theme.colors.statusDanger
        : theme.colors.foregroundMuted;
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 6, paddingVertical: 3, borderRadius: 999, overflow: "hidden" }}>
      <Tint color={color} opacity={0.15} />
      <Text style={{ color, fontSize: 10 }}>●</Text>
      <Text style={{ color, fontSize: 11 }}>{STATUS_LABELS[status]}</Text>
    </View>
  );
}

export function ActionButton({
  theme,
  label,
  onPress,
  disabled,
  tone = "muted",
}: {
  theme: PluginTheme;
  label: string;
  onPress: () => void;
  disabled?: boolean;
  tone?: "muted" | "accent";
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={{ borderRadius: 6, overflow: "hidden", paddingHorizontal: 10, paddingVertical: 7, opacity: disabled ? 0.5 : 1 }}
    >
      <Tint color={tone === "accent" ? theme.colors.accent : theme.colors.foreground} opacity={tone === "accent" ? 0.9 : 0.1} />
      <Text
        style={{
          color: tone === "accent" ? theme.colors.accentForeground : theme.colors.foreground,
          fontSize: 12,
          fontWeight: "600",
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

/**
 * Terminal status, and therefore prompt forwarding and question answering, depend on paseo's
 * agent hooks. Without them the panel stays a read-only viewer.
 */
export function HooksOnboarding({
  theme,
  onEnable,
  enabling,
  error,
}: {
  theme: PluginTheme;
  onEnable: () => void;
  enabling: boolean;
  error: string | null;
}) {
  return (
    <Card theme={theme} style={{ margin: 10 }}>
      <View style={{ gap: 6 }}>
        <Text style={{ color: theme.colors.foreground, fontWeight: "600" }}>
          Enable terminal agent hooks to talk to this session
        </Text>
        <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12, lineHeight: 17 }}>
          Paseo installs Claude Code hooks into your global ~/.claude/settings.json. They only report
          running / idle / needs-input for terminals paseo owns, and no-op everywhere else. Until they
          are on, this panel stays read-only.
        </Text>
        {error ? <Text style={{ color: theme.colors.statusDanger, fontSize: 12 }}>{error}</Text> : null}
        <View style={{ flexDirection: "row" }}>
          <ActionButton
            theme={theme}
            tone="accent"
            label={enabling ? "Enabling…" : "Enable hooks"}
            disabled={enabling}
            onPress={onEnable}
          />
        </View>
      </View>
    </Card>
  );
}

export function PromptBox({
  theme,
  compact,
  disabled,
  sending,
  note,
  terminalHint,
  attachments,
  onSend,
  onAttachImage,
  onRemoveAttachment,
}: {
  theme: PluginTheme;
  compact: boolean;
  disabled: boolean;
  sending: boolean;
  note: string | null;
  terminalHint: string | null;
  attachments?: string[];
  onSend: (text: string) => void;
  onAttachImage?: () => void;
  onRemoveAttachment?: (path: string) => void;
}) {
  const [text, setText] = useState("");
  const files = attachments ?? [];
  const canSend = !disabled && !sending && (text.trim() !== "" || files.length > 0);

  return (
    <View style={{ padding: compact ? 8 : 12, gap: 6 }}>
      {note ? <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11 }}>{note}</Text> : null}
      {files.length > 0 ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
          {files.map((file) => (
            <Pressable
              key={file}
              onPress={() => onRemoveAttachment?.(file)}
              style={{ borderRadius: 6, overflow: "hidden", paddingHorizontal: 8, paddingVertical: 4 }}
            >
              <Tint color={theme.colors.foreground} opacity={0.1} />
              <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11 }}>
                {file.split("/").pop()} ✕
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      <View style={{ borderRadius: 8, overflow: "hidden", padding: 8, gap: 6 }}>
        <Tint color={theme.colors.foreground} opacity={0.08} />
        <TextInput
          value={text}
          onChangeText={setText}
          editable={!disabled}
          multiline
          placeholder={disabled ? "Bind a terminal to send prompts" : "Message Claude Code…"}
          placeholderTextColor={theme.colors.foregroundMuted}
          style={{ color: theme.colors.foreground, fontSize: 14, maxHeight: 140, minHeight: 36 }}
        />
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          {onAttachImage ? (
            <ActionButton theme={theme} label="Image" onPress={onAttachImage} disabled={disabled} />
          ) : null}
          {terminalHint ? (
            <Text numberOfLines={1} style={{ color: theme.colors.foregroundMuted, fontSize: 11, flex: 1 }}>
              {terminalHint}
            </Text>
          ) : (
            <View style={{ flex: 1 }} />
          )}
          <ActionButton
            theme={theme}
            tone="accent"
            label={sending ? "Sending…" : "Send"}
            disabled={!canSend}
            onPress={() => {
              onSend(text);
              setText("");
            }}
          />
        </View>
      </View>
    </View>
  );
}

export function ResumeBar({
  theme,
  onResume,
  resuming,
}: {
  theme: PluginTheme;
  onResume: () => void;
  resuming: boolean;
}) {
  return (
    <View style={{ padding: 12, flexDirection: "row", alignItems: "center", gap: 10 }}>
      <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12, flex: 1 }}>
        This session is not running in a paseo terminal.
      </Text>
      <ActionButton
        theme={theme}
        tone="accent"
        label={resuming ? "Resuming…" : "Resume session"}
        disabled={resuming}
        onPress={onResume}
      />
    </View>
  );
}

export function Sheet({
  theme,
  visible,
  title,
  onClose,
  children,
}: {
  theme: PluginTheme;
  visible: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={{ flex: 1, justifyContent: "center", padding: 16 }} onPress={onClose}>
        <Tint color="#000000" opacity={0.5} />
        <View style={{ maxHeight: "80%", borderRadius: 12, backgroundColor: theme.colors.surface0, padding: 12, gap: 8 }}>
          <Text style={{ color: theme.colors.foreground, fontWeight: "600" }}>{title}</Text>
          <ScrollView contentContainerStyle={{ gap: 6 }}>{children}</ScrollView>
        </View>
      </Pressable>
    </Modal>
  );
}

export function SheetRow({
  theme,
  label,
  detail,
  onPress,
  selected,
}: {
  theme: PluginTheme;
  label: string;
  detail?: string;
  onPress: () => void;
  selected?: boolean;
}) {
  return (
    <Pressable onPress={onPress} style={{ padding: 10, borderRadius: 8, overflow: "hidden" }}>
      <Tint color={selected ? theme.colors.accent : theme.colors.foreground} opacity={selected ? 0.18 : 0.06} />
      <Text style={{ color: theme.colors.foreground, fontSize: 13 }}>{label}</Text>
      {detail ? <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11 }}>{detail}</Text> : null}
    </Pressable>
  );
}
