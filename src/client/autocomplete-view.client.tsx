import type { LayoutChangeEvent, NativeScrollEvent, NativeSyntheticEvent } from "react-native";
import React, { useCallback, useEffect, useRef } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { fontSize, radius, spacing, type Palette } from "./theme.client.ts";
import { pressable } from "./ui.client.tsx";

export type AutocompleteOption = {
  id: string;
  label: string;
  description?: string;
  kind: "command" | "file" | "directory";
};

const MAX_HEIGHT = 220;
const ROW_MIN_HEIGHT = 36;

const KIND_GLYPHS: Record<AutocompleteOption["kind"], string> = {
  command: "/",
  directory: "▸",
  file: "·",
};

/**
 * The menu sits above the prompt, so it reads bottom-up: the row nearest the input is the one
 * Enter takes, and the list stays pinned to its end as the options change.
 */
export function AutocompleteList({
  palette,
  options,
  selectedIndex,
  loading,
  emptyText,
  onSelect,
}: {
  palette: Palette;
  options: AutocompleteOption[];
  selectedIndex: number;
  loading: boolean;
  emptyText: string;
  onSelect: (option: AutocompleteOption) => void;
}) {
  const scrollRef = useRef<ScrollView | null>(null);
  const rows = useRef(new Map<number, { top: number; height: number }>());
  const viewport = useRef(0);
  const offset = useRef(0);

  const revealSelected = useCallback(() => {
    const row = rows.current.get(selectedIndex);
    if (!row || viewport.current <= 0) return;
    const bottom = row.top + row.height;
    const next =
      row.top < offset.current
        ? Math.max(0, row.top)
        : bottom > offset.current + viewport.current
          ? Math.max(0, bottom - viewport.current)
          : offset.current;
    if (Math.abs(next - offset.current) < 1) return;
    offset.current = next;
    scrollRef.current?.scrollTo({ y: next, animated: false });
  }, [selectedIndex]);

  useEffect(() => {
    rows.current.clear();
    offset.current = 0;
    scrollRef.current?.scrollToEnd({ animated: false });
  }, [options]);

  useEffect(revealSelected, [revealSelected, options.length]);

  const container = {
    backgroundColor: palette.surface1,
    borderWidth: 1,
    borderColor: palette.borderAccent,
    borderRadius: radius.lg,
    overflow: "hidden" as const,
    maxHeight: MAX_HEIGHT,
  };

  if (options.length === 0) {
    return (
      <View style={container}>
        <View style={{ paddingHorizontal: spacing[3], paddingVertical: spacing[3] }}>
          <Text style={{ color: palette.foregroundMuted, fontSize: fontSize.base }}>
            {loading ? "Searching…" : emptyText}
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View style={container}>
      <ScrollView
        ref={scrollRef}
        style={{ flexGrow: 0, flexShrink: 1 }}
        contentContainerStyle={{ paddingVertical: spacing[1] }}
        keyboardShouldPersistTaps="always"
        scrollEventThrottle={16}
        onLayout={(event: LayoutChangeEvent) => {
          viewport.current = event.nativeEvent.layout.height;
          revealSelected();
        }}
        onScroll={(event: NativeSyntheticEvent<NativeScrollEvent>) => {
          offset.current = event.nativeEvent.contentOffset.y;
        }}
        onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: false })}
      >
        {options.map((option, index) => (
          <Pressable
            key={option.id}
            onPress={() => onSelect(option)}
            onLayout={(event: LayoutChangeEvent) => {
              rows.current.set(index, {
                top: event.nativeEvent.layout.y,
                height: event.nativeEvent.layout.height,
              });
              revealSelected();
            }}
            style={pressable(({ pressed, hovered }) => ({
              flexDirection: "row",
              alignItems: "center",
              gap: spacing[2],
              minHeight: ROW_MIN_HEIGHT,
              paddingHorizontal: spacing[3],
              paddingVertical: spacing[2],
              backgroundColor:
                index === selectedIndex || hovered || pressed ? palette.surface2 : "transparent",
            }))}
          >
            <Text style={{ width: 12, color: palette.foregroundExtraMuted, fontSize: fontSize.sm }}>
              {KIND_GLYPHS[option.kind]}
            </Text>
            <Text numberOfLines={1} style={{ flexShrink: 1, color: palette.foreground, fontSize: fontSize.base }}>
              {option.label}
            </Text>
            {option.description ? (
              <Text
                numberOfLines={1}
                style={{ flex: 1, color: palette.foregroundMuted, fontSize: fontSize.sm }}
              >
                {option.description}
              </Text>
            ) : null}
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}
