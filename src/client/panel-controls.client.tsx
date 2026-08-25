import type { TextInputKeyPressEvent } from "react-native";
import React, { useState } from "react";
import { Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import type { SendBehavior, SessionStatus } from "../render-types.shared.ts";
import {
  controlHeight,
  fontSize,
  leading,
  MAX_CONTENT_WIDTH,
  radius,
  spacing,
  STATUS_DOT_SIZE,
  type Palette,
} from "./theme.client.ts";
import { QuestionOption } from "./timeline.client.tsx";
import { Button, Card, IconButton, NO_OUTLINE, pressable } from "./ui.client.tsx";

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

export function StatusPill({ status, palette }: { status: SessionStatus; palette: Palette }) {
  const color =
    status === "running"
      ? palette.accent
      : status === "needs_input"
        ? palette.statusDanger
        : palette.foregroundMuted;
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        paddingHorizontal: spacing[2],
        paddingVertical: 3,
        borderRadius: radius.full,
        borderWidth: 1,
        borderColor: palette.border,
        backgroundColor: palette.surface3,
      }}
    >
      <View
        style={{
          width: STATUS_DOT_SIZE,
          height: STATUS_DOT_SIZE,
          borderRadius: radius.full,
          backgroundColor: color,
        }}
      />
      <Text
        style={{
          color: status === "needs_input" ? palette.statusDanger : palette.foregroundMuted,
          fontSize: fontSize.sm,
        }}
      >
        {STATUS_LABELS[status]}
      </Text>
    </View>
  );
}

/**
 * Terminal status, and therefore prompt forwarding and question answering, depend on paseo's
 * agent hooks. Without them the panel stays a read-only viewer.
 */
export function HooksOnboarding({
  palette,
  onEnable,
  enabling,
  error,
}: {
  palette: Palette;
  onEnable: () => void;
  enabling: boolean;
  error: string | null;
}) {
  return (
    <ComposerFrame palette={palette} compact={false}>
      <Card palette={palette} style={{ gap: spacing[3] }}>
        <Text style={{ color: palette.foreground, fontSize: fontSize.base, fontWeight: "500", lineHeight: 22 }}>
          Enable terminal agent hooks to talk to this session
        </Text>
        <Text style={{ color: palette.foregroundMuted, fontSize: fontSize.base, lineHeight: 20 }}>
          Paseo installs Claude Code hooks into your global ~/.claude/settings.json. They only report
          running / idle / needs-input for terminals paseo owns, and no-op everywhere else. Until they
          are on, this panel stays read-only.
        </Text>
        {error ? (
          <Text style={{ color: palette.statusDanger, fontSize: fontSize.base }}>{error}</Text>
        ) : null}
        <View style={{ flexDirection: "row" }}>
          <Button
            palette={palette}
            variant="default"
            label={enabling ? "Enabling…" : "Enable hooks"}
            disabled={enabling}
            onPress={onEnable}
          />
        </View>
      </Card>
    </ComposerFrame>
  );
}

/** The footer rail every composer state shares: centered, capped to the reading column. */
function ComposerFrame({
  palette,
  compact,
  children,
}: {
  palette: Palette;
  compact: boolean;
  children: React.ReactNode;
}) {
  return (
    <View
      style={{
        alignItems: "center",
        paddingHorizontal: compact ? spacing[3] : spacing[4],
        paddingBottom: compact ? spacing[2] : spacing[4],
        paddingTop: spacing[2],
      }}
    >
      <View style={{ width: "100%", maxWidth: MAX_CONTENT_WIDTH, gap: spacing[3] }}>{children}</View>
    </View>
  );
}

export function PromptBox({
  palette,
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
  palette: Palette;
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

  const submit = () => {
    if (!canSend) return;
    onSend(text);
    setText("");
  };

  // Enter sends and shift+Enter breaks the line, as everywhere else you type at an agent.
  // Only on web: a soft keyboard has no shift+Enter, so on a phone Enter keeps inserting a newline
  // and the send button is the way to send.
  const handleKeyPress = (event: TextInputKeyPressEvent) => {
    if (Platform.OS !== "web") return;
    const native = event.nativeEvent as { key: string; shiftKey?: boolean };
    if (native.key !== "Enter" || native.shiftKey === true) return;
    event.preventDefault();
    submit();
  };

  return (
    <ComposerFrame palette={palette} compact={compact}>
      {note ? (
        <Text style={{ color: palette.foregroundMuted, fontSize: fontSize.sm }}>{note}</Text>
      ) : null}
      <View
        style={{
          gap: spacing[3],
          backgroundColor: palette.surface1,
          borderWidth: 1,
          borderColor: palette.borderAccent,
          borderRadius: radius["2xl"],
          paddingVertical: compact ? spacing[2] : spacing[4],
          paddingHorizontal: compact ? spacing[3] : spacing[4],
        }}
      >
        {files.length > 0 ? (
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing[2] }}>
            {files.map((file) => (
              <Pressable
                key={file}
                onPress={() => onRemoveAttachment?.(file)}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: spacing[1],
                  paddingHorizontal: spacing[2],
                  paddingVertical: spacing[1],
                  borderRadius: radius.md,
                  borderWidth: 1,
                  borderColor: palette.border,
                  backgroundColor: palette.surface2,
                }}
              >
                <Text style={{ color: palette.foregroundMuted, fontSize: fontSize.sm }}>
                  {file.split("/").pop()}
                </Text>
                <Text style={{ color: palette.foregroundExtraMuted, fontSize: fontSize.sm }}>✕</Text>
              </Pressable>
            ))}
          </View>
        ) : null}
        <View style={{ position: "relative" }}>
          {Platform.OS === "web" && text === "" ? (
            <Text
              style={{
                position: "absolute",
                top: 0,
                right: 0,
                color: palette.foregroundMuted,
                fontSize: fontSize.sm,
                opacity: 0.5,
              }}
            >
              ↵ to send
            </Text>
          ) : null}
          <TextInput
            value={text}
            onChangeText={setText}
            editable={!disabled}
            multiline
            placeholder={disabled ? "Bind a terminal to send prompts" : "Message Claude Code…"}
            placeholderTextColor={palette.foregroundMuted}
            onKeyPress={handleKeyPress}
            style={{
              width: "100%",
              color: palette.foreground,
              fontSize: fontSize.content,
              lineHeight: leading(fontSize.content),
              maxHeight: 140,
              minHeight: 24,
              ...NO_OUTLINE,
            }}
          />
        </View>
        <View
          style={{
            flexDirection: "row",
            alignItems: "flex-end",
            justifyContent: "space-between",
            marginHorizontal: -6,
          }}
        >
          <View style={{ flexDirection: "row", alignItems: "center", minWidth: 0, flexShrink: 1 }}>
            {onAttachImage ? (
              <IconButton
                palette={palette}
                glyph="＋"
                accessibilityLabel="Attach an image"
                onPress={onAttachImage}
                disabled={disabled}
              />
            ) : null}
            {terminalHint ? (
              <Text
                numberOfLines={1}
                style={{
                  flexShrink: 1,
                  minWidth: 0,
                  marginLeft: spacing[1],
                  color: palette.foregroundExtraMuted,
                  fontSize: fontSize.sm,
                }}
              >
                {terminalHint}
              </Text>
            ) : null}
          </View>
          <IconButton
            palette={palette}
            glyph={sending ? "…" : "↑"}
            tone="accent"
            accessibilityLabel="Send"
            disabled={!canSend}
            onPress={submit}
          />
        </View>
      </View>
    </ComposerFrame>
  );
}

export type PanelDialog = {
  kind: "permission" | "question";
  prompt: string;
  context: string[];
  options: { index: number; label: string; checked: boolean; meta: boolean }[];
  multiSelect: boolean;
};

/**
 * Answering from the panel is a convenience over the terminal, never a replacement:
 * the terminal hint stays visible because capture parsing can go stale with a CLI update.
 */
export function DialogCard({
  palette,
  compact,
  dialog,
  terminalHint,
  answering,
  warning,
  onAnswer,
}: {
  palette: Palette;
  compact: boolean;
  dialog: PanelDialog | null;
  terminalHint: string | null;
  answering: boolean;
  warning: string | null;
  onAnswer: (optionIndices: number[]) => void;
}) {
  const [checked, setChecked] = useState<number[]>([]);

  if (!dialog) {
    return (
      <ComposerFrame palette={palette} compact={compact}>
        <Card palette={palette} tone="danger">
          <Text style={{ color: palette.foreground, fontSize: fontSize.base, fontWeight: "500", lineHeight: 22 }}>
            Claude is waiting for input
          </Text>
          <Text style={{ color: palette.foregroundMuted, fontSize: fontSize.base, lineHeight: 20 }}>
            The prompt could not be read from the screen — answer it in {terminalHint ?? "the terminal"}.
          </Text>
        </Card>
      </ComposerFrame>
    );
  }

  return (
    <ComposerFrame palette={palette} compact={compact}>
      <Card palette={palette} style={{ gap: spacing[3] }}>
        {dialog.context.length > 0 ? (
          <View style={{ gap: spacing[1] }}>
            {dialog.context.map((line, index) => (
              <Text key={index} style={{ color: palette.foregroundMuted, fontSize: fontSize.base, lineHeight: 20 }}>
                {line}
              </Text>
            ))}
          </View>
        ) : null}
        <Text style={{ color: palette.foreground, fontSize: fontSize.base, fontWeight: "500", lineHeight: 22 }}>
          {dialog.prompt}
        </Text>
        <View style={{ gap: spacing[1] }}>
          {dialog.options.map((option) => {
            // "Type something" and "Chat about this" open a field in the CLI rather than answering,
            // so they are always a single press, even in a multi-select.
            const toggles = dialog.multiSelect && !option.meta;
            return (
              <QuestionOption
                key={option.index}
                palette={palette}
                label={`${option.index}. ${option.label}`}
                control={toggles ? "checkbox" : "none"}
                selected={toggles && checked.includes(option.index)}
                disabled={answering}
                onPress={() => {
                  if (!toggles) {
                    onAnswer([option.index]);
                    return;
                  }
                  setChecked((current) =>
                    current.includes(option.index)
                      ? current.filter((value) => value !== option.index)
                      : [...current, option.index],
                  );
                }}
              />
            );
          })}
        </View>
        {dialog.multiSelect ? (
          <View style={{ flexDirection: "row" }}>
            <Button
              palette={palette}
              variant="default"
              label={answering ? "Sending…" : "Submit answers"}
              disabled={answering || checked.length === 0}
              onPress={() => onAnswer(checked)}
            />
          </View>
        ) : null}
        {warning ? (
          <Text style={{ color: palette.statusDanger, fontSize: fontSize.base }}>{warning}</Text>
        ) : null}
        <Text style={{ color: palette.foregroundExtraMuted, fontSize: fontSize.sm }}>
          Or answer in {terminalHint ?? "the terminal"}.
        </Text>
      </Card>
    </ComposerFrame>
  );
}

export function ImageAttachSheet({
  palette,
  visible,
  busy,
  error,
  onClose,
  onAttach,
  onPasteFromClipboard,
}: {
  palette: Palette;
  visible: boolean;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onAttach: (path: string) => void;
  onPasteFromClipboard: (setPath: (path: string) => void) => void;
}) {
  const [path, setPath] = useState("");
  return (
    <Sheet palette={palette} visible={visible} title="Attach an image" onClose={onClose}>
      <View style={{ padding: spacing[4], gap: spacing[3] }}>
        <Text style={{ color: palette.foregroundMuted, fontSize: fontSize.base, lineHeight: 20 }}>
          Point at an image file on the machine running paseo. It is copied into the plugin cache and
          its path is appended to the prompt, which is how the CLI picks images up.
        </Text>
        <TextInput
          value={path}
          onChangeText={setPath}
          placeholder="/home/you/screenshot.png"
          placeholderTextColor={palette.foregroundMuted}
          autoCapitalize="none"
          autoCorrect={false}
          style={{
            minHeight: controlHeight.compact,
            paddingHorizontal: spacing[3],
            borderRadius: radius.md,
            borderWidth: 1,
            borderColor: palette.border,
            backgroundColor: palette.surface2,
            color: palette.foreground,
            fontSize: fontSize.base,
            ...NO_OUTLINE,
          }}
        />
        {error ? <Text style={{ color: palette.statusDanger, fontSize: fontSize.base }}>{error}</Text> : null}
        <View style={{ flexDirection: "row", gap: spacing[2] }}>
          <Button palette={palette} label="Paste path" onPress={() => onPasteFromClipboard(setPath)} />
          <Button
            palette={palette}
            variant="default"
            label={busy ? "Attaching…" : "Attach"}
            disabled={busy || path.trim() === ""}
            onPress={() => {
              onAttach(path.trim());
              setPath("");
            }}
          />
        </View>
      </View>
    </Sheet>
  );
}

export function ResumeBar({
  palette,
  compact,
  onResume,
  resuming,
}: {
  palette: Palette;
  compact: boolean;
  onResume: () => void;
  resuming: boolean;
}) {
  return (
    <ComposerFrame palette={palette} compact={compact}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: spacing[3] }}>
        <Text style={{ flex: 1, color: palette.foregroundMuted, fontSize: fontSize.base }}>
          This session is not running in a paseo terminal.
        </Text>
        <Button
          palette={palette}
          variant="default"
          label={resuming ? "Resuming…" : "Resume session"}
          disabled={resuming}
          onPress={onResume}
        />
      </View>
    </ComposerFrame>
  );
}

/**
 * An overlay inside the panel rather than a React Native `Modal`: the panel is embedded in the host
 * app, and the backdrop is a sibling of the content so a press inside the sheet cannot close it.
 */
export function Sheet({
  palette,
  visible,
  title,
  onClose,
  children,
}: {
  palette: Palette;
  visible: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  if (!visible) return null;
  return (
    <View
      style={[
        StyleSheet.absoluteFill,
        { justifyContent: "center", alignItems: "center", padding: spacing[6] },
      ]}
    >
      <Pressable
        style={[StyleSheet.absoluteFill, { backgroundColor: "rgba(0, 0, 0, 0.55)" }]}
        onPress={onClose}
      />
      <View
        style={{
          width: "100%",
          maxWidth: 520,
          maxHeight: "85%",
          flexShrink: 1,
          minHeight: 0,
          backgroundColor: palette.surface1,
          borderRadius: radius.xl,
          borderWidth: 1,
          borderColor: palette.surface2,
          overflow: "hidden",
        }}
      >
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: spacing[2],
            paddingHorizontal: spacing[4],
            paddingVertical: spacing[3],
            borderBottomWidth: 1,
            borderBottomColor: palette.surface2,
          }}
        >
          <Text style={{ flex: 1, color: palette.foreground, fontSize: fontSize.base, fontWeight: "500" }}>
            {title}
          </Text>
          <IconButton palette={palette} glyph="✕" accessibilityLabel="Close" onPress={onClose} />
        </View>
        <ScrollView contentContainerStyle={{ paddingVertical: spacing[1] }}>{children}</ScrollView>
      </View>
    </View>
  );
}

export function SheetRow({
  palette,
  label,
  detail,
  onPress,
  selected,
}: {
  palette: Palette;
  label: string;
  detail?: string;
  onPress: () => void;
  selected?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={pressable(({ pressed, hovered }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: spacing[2],
        minHeight: controlHeight.compact,
        marginHorizontal: spacing[1],
        paddingHorizontal: spacing[2],
        paddingVertical: spacing[1],
        borderRadius: radius.md,
        borderWidth: 1,
        borderColor: "transparent",
        backgroundColor: selected || hovered || pressed ? palette.surface2 : "transparent",
      }))}
    >
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={{ color: palette.foreground, fontSize: fontSize.base, lineHeight: 18 }}>{label}</Text>
        {detail ? (
          <Text style={{ marginTop: 2, color: palette.foregroundMuted, fontSize: fontSize.sm }}>{detail}</Text>
        ) : null}
      </View>
      {selected ? <Text style={{ color: palette.accent, fontSize: fontSize.base }}>✓</Text> : null}
    </Pressable>
  );
}

export function SheetNote({ palette, children }: { palette: Palette; children: React.ReactNode }) {
  return (
    <Text
      style={{
        color: palette.foregroundMuted,
        fontSize: fontSize.base,
        paddingHorizontal: spacing[3],
        paddingVertical: spacing[2],
      }}
    >
      {children}
    </Text>
  );
}
