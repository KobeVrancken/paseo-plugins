import type { LayoutChangeEvent, NativeScrollEvent, NativeSyntheticEvent } from "react-native";
import React, { useCallback, useEffect, useRef } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { scrollOffsetFor, withoutBoltGlyphs } from "./autocomplete.client.ts";
import { fontSize, radius, shadowMd, spacing, type Palette } from "./theme.client.ts";
import { pressable } from "./ui.client.tsx";

export type AutocompleteOption = {
  id: string;
  label: string;
  /** The argument hint a command publishes, shown beside its name. */
  detail?: string;
  description?: string;
  kind: "command" | "file" | "directory";
};

const MAX_HEIGHT = 220;
const ROW_MIN_HEIGHT = 36;
const LEADING_WIDTH = 18;

/** No icon set reaches a plugin, so the file and directory marks are drawn as glyphs. */
const KIND_GLYPHS: Record<AutocompleteOption["kind"], string> = {
  command: "/",
  directory: "▸",
  file: "·",
};

/**
 * The menu paseo puts above its composer, reproduced.
 * It reads bottom-up, because the row nearest the input is the one Enter takes, and a command's
 * description gets a card of its own above the list rather than being squeezed into the row.
 */
export function AutocompleteList({
  palette,
  options,
  selectedIndex,
  loading,
  errorMessage,
  loadingText,
  emptyText,
  onSelect,
}: {
  palette: Palette;
  options: AutocompleteOption[];
  selectedIndex: number;
  loading: boolean;
  errorMessage: string | null;
  loadingText: string;
  emptyText: string;
  onSelect: (option: AutocompleteOption) => void;
}) {
  const scrollRef = useRef<ScrollView | null>(null);
  const rows = useRef(new Map<number, { top: number; height: number }>());
  const viewportHeight = useRef(0);
  const offset = useRef(0);

  const revealSelected = useCallback(() => {
    if (selectedIndex < 0) return;
    const row = rows.current.get(selectedIndex);
    if (!row) return;
    const next = scrollOffsetFor({
      currentOffset: offset.current,
      viewportHeight: viewportHeight.current,
      itemTop: row.top,
      itemHeight: row.height,
    });
    if (Math.abs(next - offset.current) < 1) return;
    offset.current = next;
    scrollRef.current?.scrollTo({ y: next, animated: false });
  }, [selectedIndex]);

  const pinToBottom = useCallback(() => {
    scrollRef.current?.scrollToEnd({ animated: false });
  }, []);

  useEffect(() => {
    rows.current.clear();
    offset.current = 0;
    if (options.length > 0) pinToBottom();
  }, [options, pinToBottom]);

  useEffect(revealSelected, [revealSelected, options.length]);

  const surface = {
    backgroundColor: palette.surface1,
    borderWidth: 1,
    borderColor: palette.borderAccent,
    borderRadius: radius.lg,
    ...shadowMd(palette.isDark),
  };

  if (loading || errorMessage !== null || options.length === 0) {
    return (
      <View style={[surface, { overflow: "hidden", maxHeight: MAX_HEIGHT }]}>
        <View style={{ paddingHorizontal: spacing[3], paddingVertical: spacing[3] }}>
          <Text style={{ color: palette.foregroundMuted, fontSize: fontSize.base }}>
            {loading ? loadingText : errorMessage !== null ? `Error: ${errorMessage}` : emptyText}
          </Text>
        </View>
      </View>
    );
  }

  const selected = options[selectedIndex];
  return (
    <View style={{ gap: spacing[1] }}>
      {selected?.kind === "command" && selected.description ? (
        <View style={[surface, { paddingHorizontal: spacing[3], paddingVertical: spacing[3] }]}>
          <Text style={{ color: palette.foreground, fontSize: fontSize.base }}>
            {withoutBoltGlyphs(selected.label) ?? selected.label}
          </Text>
          <Text style={{ marginTop: spacing[1], color: palette.foregroundMuted, fontSize: fontSize.sm }}>
            {withoutBoltGlyphs(selected.description)}
          </Text>
          {selected.detail ? (
            <Text style={{ marginTop: spacing[1], color: palette.foregroundMuted, fontSize: fontSize.sm }}>
              {withoutBoltGlyphs(selected.detail)}
            </Text>
          ) : null}
        </View>
      ) : null}
      <View style={[surface, { overflow: "hidden", maxHeight: MAX_HEIGHT }]}>
        <ScrollView
          ref={scrollRef}
          style={{ flexGrow: 0, flexShrink: 1 }}
          contentContainerStyle={{ paddingVertical: spacing[1] }}
          keyboardShouldPersistTaps="always"
          scrollEventThrottle={16}
          onLayout={(event: LayoutChangeEvent) => {
            viewportHeight.current = event.nativeEvent.layout.height;
            revealSelected();
          }}
          onScroll={(event: NativeSyntheticEvent<NativeScrollEvent>) => {
            offset.current = event.nativeEvent.contentOffset.y;
          }}
          onContentSizeChange={pinToBottom}
        >
          {options.map((option, index) => (
            <AutocompleteRow
              key={option.id}
              palette={palette}
              option={option}
              selected={index === selectedIndex}
              onSelect={onSelect}
              onLayout={(event: LayoutChangeEvent) => {
                rows.current.set(index, {
                  top: event.nativeEvent.layout.y,
                  height: event.nativeEvent.layout.height,
                });
                revealSelected();
              }}
            />
          ))}
        </ScrollView>
      </View>
    </View>
  );
}

function AutocompleteRow({
  palette,
  option,
  selected,
  onSelect,
  onLayout,
}: {
  palette: Palette;
  option: AutocompleteOption;
  selected: boolean;
  onSelect: (option: AutocompleteOption) => void;
  onLayout: (event: LayoutChangeEvent) => void;
}) {
  const label = withoutBoltGlyphs(option.label) ?? option.label;
  const description = withoutBoltGlyphs(option.description);
  const detail = withoutBoltGlyphs(option.detail);
  const isPath = option.kind === "file" || option.kind === "directory";
  return (
    <Pressable
      onPress={() => onSelect(option)}
      onLayout={onLayout}
      style={pressable(({ pressed, hovered }) => ({
        flexDirection: "row",
        alignItems: "center",
        minHeight: ROW_MIN_HEIGHT,
        paddingHorizontal: spacing[3],
        paddingVertical: spacing[2],
        backgroundColor: selected || hovered || pressed ? palette.surface2 : "transparent",
      }))}
    >
      {isPath ? (
        <>
          <View style={{ width: LEADING_WIDTH, alignItems: "center", marginRight: spacing[1] }}>
            <Text style={{ color: palette.foregroundMuted, fontSize: fontSize.sm }}>
              {KIND_GLYPHS[option.kind]}
            </Text>
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: spacing[2] }}>
              <Text numberOfLines={1} style={{ flexShrink: 1, color: palette.foreground, fontSize: fontSize.base }}>
                {label}
              </Text>
              {detail ? (
                <Text style={{ color: palette.foregroundMuted, fontSize: fontSize.sm }}>{detail}</Text>
              ) : null}
            </View>
            {description ? (
              <Text
                numberOfLines={1}
                style={{ marginTop: 2, color: palette.foregroundMuted, fontSize: fontSize.sm }}
              >
                {description}
              </Text>
            ) : null}
          </View>
        </>
      ) : (
        <View
          style={{ flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: spacing[2] }}
        >
          <Text style={{ color: palette.foreground, fontSize: fontSize.base }}>{label}</Text>
          {description ? (
            <Text numberOfLines={1} style={{ flex: 1, color: palette.foregroundMuted, fontSize: fontSize.sm }}>
              {description}
            </Text>
          ) : null}
        </View>
      )}
    </Pressable>
  );
}
