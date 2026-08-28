import type { TextInputKeyPressEvent } from "react-native";
import React, { useEffect, useRef, useState } from "react";
import { Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import type { SendBehavior, SessionStatus } from "../render-types.shared.ts";
import {
  forgeLabel,
  forgeOptionLabel,
  type Attachment,
  type ForgeItem,
} from "./attachments.client.ts";
import { AutocompleteList, type AutocompleteOption } from "./autocomplete-view.client.tsx";
import { pastedImageName, pastedImages } from "./clipboard-image.client.ts";
import { useComposerAutocomplete } from "./composer-autocomplete.client.ts";
import { readFileDataUrl } from "./file-picker.client.ts";
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
import { AttachmentPill, Button, Card, IconButton, NO_OUTLINE, pressable } from "./ui.client.tsx";

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

/** How the CLI names its effort levels and permission modes, in the CLI's own cycle order. */
export const EFFORT_LABELS: Record<string, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Extra high",
  max: "Max",
};

export const PERMISSION_MODES = ["default", "acceptEdits", "plan", "bypassPermissions", "auto"] as const;

export const PERMISSION_MODE_LABELS: Record<string, string> = {
  default: "Always ask",
  acceptEdits: "Accept file edits",
  plan: "Plan mode",
  bypassPermissions: "Bypass",
  auto: "Auto mode",
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

/** The flat 28px badge paseo uses for every composer control. */
export function Pill({
  palette,
  glyph,
  glyphSize = fontSize.base,
  label,
  onPress,
  disabled,
  active,
}: {
  palette: Palette;
  glyph?: string;
  /** ASCII marks draw lighter than the dingbats, so they ask for a size of their own. */
  glyphSize?: number;
  label?: string;
  onPress: () => void;
  disabled?: boolean;
  active?: boolean;
}) {
  const color = active ? palette.accent : palette.foregroundMuted;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label ?? glyph}
      style={pressable(({ pressed, hovered }) => ({
        height: controlHeight.tight,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: spacing[1],
        paddingHorizontal: label === undefined ? 0 : spacing[2],
        borderRadius: radius["2xl"],
        backgroundColor: pressed ? palette.surface0 : hovered ? palette.surface2 : "transparent",
        opacity: disabled ? 0.5 : 1,
        flexShrink: 1,
        minWidth: label === undefined ? controlHeight.tight : 0,
      }))}
    >
      {glyph ? <Text style={{ color, fontSize: glyphSize }}>{glyph}</Text> : null}
      {label === undefined ? null : (
        <Text numberOfLines={1} style={{ flexShrink: 1, minWidth: 0, color, fontSize: fontSize.base }}>
          {label}
        </Text>
      )}
      {label === undefined ? null : (
        <Text style={{ color: palette.foregroundExtraMuted, fontSize: fontSize.sm }}>⌄</Text>
      )}
    </Pressable>
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

export type ComposerControls = {
  model: string | null;
  effort: string | null;
  mode: string | null;
  onOpenModelMenu: () => void;
  onOpenThinking: () => void;
  onOpenMode: () => void;
};

export function PromptBox({
  palette,
  compact,
  disabled,
  sending,
  note,
  workspaceDir,
  attachments,
  controls,
  onSend,
  onAddAttachment,
  onOpenAttachment,
  onPasteImages,
  onRemoveAttachment,
}: {
  palette: Palette;
  compact: boolean;
  disabled: boolean;
  sending: boolean;
  note: string | null;
  workspaceDir: string | null;
  attachments?: Attachment[];
  controls: ComposerControls | null;
  onSend: (text: string) => void;
  onAddAttachment?: () => void;
  onOpenAttachment?: (attachment: Attachment) => void;
  onPasteImages?: (images: { fileName: string; dataUrl: string }[]) => void;
  onRemoveAttachment?: (reference: string) => void;
}) {
  const [text, setText] = useState("");
  const [cursorIndex, setCursorIndex] = useState(0);
  const inputRef = useRef<TextInput | null>(null);
  const files = attachments ?? [];
  const canSend = !disabled && !sending && (text.trim() !== "" || files.length > 0);

  // Which `@` or `/` the menu belongs to depends on the caret, and a web textarea only reports a
  // selection when there is one to report, so the caret is read off the element while typing.
  const caretAfter = (fallback: number): number => {
    const node = inputRef.current as unknown as { selectionStart?: number | null } | null;
    return typeof node?.selectionStart === "number" ? node.selectionStart : fallback;
  };

  const typeText = (next: string) => {
    setText(next);
    setCursorIndex(caretAfter(next.length));
  };

  const changeText = (next: string) => {
    setText(next);
    // Replacing the value leaves the caret at the end of it, which is where the browser puts it too.
    setCursorIndex(next.length);
  };
  const autocomplete = useComposerAutocomplete({ workspaceDir, text, cursorIndex, setText: changeText });
  // Paseo holds the menu back until a row is selected, so it never flashes an unselected list.
  const menuOpen = autocomplete.visible && (autocomplete.options.length === 0 || autocomplete.selectedIndex >= 0);

  const applySuggestion = (option: AutocompleteOption) => {
    autocomplete.select(option);
    inputRef.current?.focus();
  };

  // A pasted screenshot never reaches React Native's TextInput, so the DOM node is asked directly.
  useEffect(() => {
    if (Platform.OS !== "web" || !onPasteImages) return;
    const node = inputRef.current as unknown as HTMLElement | null;
    if (!node?.addEventListener) return;
    const onPaste = (event: Event) => {
      const clipboard = (event as ClipboardEvent).clipboardData;
      if (!clipboard) return;
      const images = pastedImages(clipboard);
      if (images.length === 0) return;
      event.preventDefault();
      void Promise.all(
        images.map(async (image) => ({
          fileName: pastedImageName(image),
          dataUrl: await readFileDataUrl(image),
        })),
      ).then(onPasteImages, () => {});
    };
    node.addEventListener("paste", onPaste);
    return () => node.removeEventListener("paste", onPaste);
  }, [onPasteImages]);

  const submit = () => {
    if (!canSend) return;
    onSend(text);
    setText("");
    setCursorIndex(0);
  };

  // Enter sends and shift+Enter breaks the line, as everywhere else you type at an agent.
  // Only on web: a soft keyboard has no shift+Enter, so on a phone Enter keeps inserting a newline
  // and the send button is the way to send.
  // The open menu gets first refusal on every key, so Enter takes the highlighted row instead.
  const handleKeyPress = (event: TextInputKeyPressEvent) => {
    if (Platform.OS !== "web") return;
    const native = event.nativeEvent as { key: string; shiftKey?: boolean };
    if (native.shiftKey !== true && autocomplete.handleKey(native.key)) {
      event.preventDefault();
      return;
    }
    if (native.key !== "Enter" || native.shiftKey === true) return;
    event.preventDefault();
    submit();
  };

  return (
    <ComposerFrame palette={palette} compact={compact}>
      {note ? (
        <Text style={{ color: palette.foregroundMuted, fontSize: fontSize.sm }}>{note}</Text>
      ) : null}
      <View style={{ position: "relative" }}>
        {/* Over the transcript, anchored to the top of the prompt: opening it never moves the prompt. */}
        {menuOpen ? (
          <View
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              bottom: "100%",
              marginBottom: spacing[3],
              zIndex: 10,
            }}
          >
            <AutocompleteList
              palette={palette}
              options={autocomplete.options}
              selectedIndex={autocomplete.selectedIndex}
              loading={autocomplete.loading}
              errorMessage={autocomplete.errorMessage}
              loadingText={autocomplete.loadingText}
              emptyText={autocomplete.emptyText}
              onSelect={applySuggestion}
            />
          </View>
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
                <AttachmentPill
                  key={file.reference}
                  palette={palette}
                  previewDataUrl={file.previewDataUrl}
                  title={file.title}
                  subtitle={file.subtitle}
                  disabled={disabled}
                  onOpen={onOpenAttachment ? () => onOpenAttachment(file) : undefined}
                  onRemove={() => onRemoveAttachment?.(file.reference)}
                />
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
              ref={inputRef}
              value={text}
              onChangeText={typeText}
              onSelectionChange={(event) => setCursorIndex(event.nativeEvent.selection.start)}
              editable={!disabled}
              multiline
              placeholder={
                disabled
                  ? "Bind a terminal to send prompts"
                  : "Message Claude Code, tag @files, or use /commands and /skills"
              }
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
              {onAddAttachment ? (
                <Pill
                  palette={palette}
                  glyph="+"
                  glyphSize={fontSize.lg}
                  onPress={onAddAttachment}
                  disabled={disabled}
                />
              ) : null}
              {controls ? (
                <>
                  <Pill
                    palette={palette}
                    glyph="✻"
                    label={controls.model ?? "Model"}
                    onPress={controls.onOpenModelMenu}
                    disabled={disabled}
                  />
                  <Pill
                    palette={palette}
                    label={controls.effort ?? "Thinking"}
                    onPress={controls.onOpenThinking}
                    disabled={disabled}
                  />
                  <Pill
                    palette={palette}
                    label={controls.mode ?? "Mode"}
                    onPress={controls.onOpenMode}
                    disabled={disabled}
                  />
                </>
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
      </View>
    </ComposerFrame>
  );
}

export type PanelDialog = {
  kind: "permission" | "question";
  prompt: string;
  context: string[];
  options: { index: number; label: string; description: string | null; checked: boolean; meta: boolean }[];
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
                description={option.description}
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

export function AttachPathSheet({
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
    <Sheet palette={palette} visible={visible} title="Attach a file by path" onClose={onClose}>
      <View style={{ padding: spacing[4], gap: spacing[3] }}>
        <Text style={{ color: palette.foregroundMuted, fontSize: fontSize.base, lineHeight: 20 }}>
          Point at any file on the machine running paseo. It stays where it is, and its path is
          appended to the prompt, which is how the CLI picks an attachment up: an image is read as an
          image, anything else as a file to open.
        </Text>
        <TextInput
          value={path}
          onChangeText={setPath}
          placeholder="/home/you/notes.md"
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

/** Issues and pull requests come from the user's own `gh`, so an unauthenticated one says so here. */
export function ForgePickerSheet({
  palette,
  visible,
  query,
  items,
  loading,
  warning,
  onQueryChange,
  onClose,
  onPick,
}: {
  palette: Palette;
  visible: boolean;
  query: string;
  items: ForgeItem[];
  loading: boolean;
  warning: string | null;
  onQueryChange: (query: string) => void;
  onClose: () => void;
  onPick: (item: ForgeItem) => void;
}) {
  return (
    <Sheet palette={palette} visible={visible} title="Add issue or PR" onClose={onClose}>
      <View style={{ paddingHorizontal: spacing[4], paddingTop: spacing[3] }}>
        <TextInput
          value={query}
          onChangeText={onQueryChange}
          placeholder="Search issues and pull requests"
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
      </View>
      {warning ? <SheetNote palette={palette}>{warning}</SheetNote> : null}
      {items.map((item) => (
        <SheetRow
          key={`${item.kind}:${item.number}`}
          palette={palette}
          label={forgeOptionLabel(item)}
          detail={`${forgeLabel(item.kind)} · ${item.state}`}
          onPress={() => onPick(item)}
        />
      ))}
      {loading && items.length === 0 ? <SheetNote palette={palette}>Asking gh…</SheetNote> : null}
      {!loading && !warning && items.length === 0 ? (
        <SheetNote palette={palette}>Nothing matched.</SheetNote>
      ) : null}
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
