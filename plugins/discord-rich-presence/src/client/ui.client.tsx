import type { PluginTheme } from "@getpaseo/plugin";
import type { StyleProp, TextStyle, ViewStyle } from "react-native";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Animated, Platform, Pressable, Text, View } from "react-native";
import {
  controlHeight,
  derivePalette,
  fontSize,
  leading,
  radius,
  spacing,
  switchGeometry,
  type Palette,
} from "./theme.client.ts";

export function usePalette(theme: PluginTheme): Palette {
  const colors = theme.colors;
  return useMemo(
    () => derivePalette(theme),
    [colors.surface0, colors.foreground, colors.foregroundMuted, colors.accent, colors.accentForeground, colors.statusDanger],
  );
}

/**
 * React Native types a pressable's style callback without `hovered`, which the web renderer does pass
 * and which every paseo control styles itself with.
 */
export type PressState = { pressed: boolean; hovered?: boolean };

export function pressable(
  style: (state: PressState) => StyleProp<ViewStyle>,
): (state: { pressed: boolean }) => StyleProp<ViewStyle> {
  return style as (state: { pressed: boolean }) => StyleProp<ViewStyle>;
}

/** Web focus rings do not belong on a control that already draws its own border. */
export const NO_OUTLINE = (Platform.OS === "web"
  ? ({ outlineStyle: "none", outlineWidth: 0 } as unknown as TextStyle)
  : null) as TextStyle | null;

const SWITCH_DURATION_MS = 180;

export function Switch({
  palette,
  value,
  onValueChange,
  disabled,
  accessibilityLabel,
}: {
  palette: Palette;
  value: boolean;
  onValueChange: (value: boolean) => void;
  disabled?: boolean;
  accessibilityLabel: string;
}) {
  const progress = useRef(new Animated.Value(value ? 1 : 0)).current;
  useEffect(() => {
    Animated.timing(progress, {
      toValue: value ? 1 : 0,
      duration: SWITCH_DURATION_MS,
      useNativeDriver: false,
    }).start();
  }, [progress, value]);

  const interpolate = (from: string, to: string) =>
    progress.interpolate({ inputRange: [0, 1], outputRange: [from, to] });

  return (
    <Pressable
      onPress={() => onValueChange(!value)}
      disabled={disabled}
      hitSlop={8}
      accessibilityRole="switch"
      accessibilityState={{ checked: value, disabled: Boolean(disabled) }}
      accessibilityLabel={accessibilityLabel}
      style={{ minHeight: controlHeight.compact, justifyContent: "center", opacity: disabled ? 0.5 : 1 }}
    >
      <Animated.View
        style={{
          width: switchGeometry.trackWidth,
          height: switchGeometry.trackHeight,
          borderRadius: switchGeometry.trackHeight / 2,
          padding: (switchGeometry.trackHeight - switchGeometry.thumbSize) / 2,
          justifyContent: "center",
          backgroundColor: interpolate(palette.surface3, palette.accent),
        }}
      >
        <Animated.View
          style={{
            width: switchGeometry.thumbSize,
            height: switchGeometry.thumbSize,
            borderRadius: switchGeometry.thumbSize / 2,
            backgroundColor: interpolate("#ffffff", palette.accentForeground),
            transform: [{ translateX: progress.interpolate({ inputRange: [0, 1], outputRange: [0, switchGeometry.thumbTravel] }) }],
            shadowColor: "rgba(0, 0, 0, 0.25)",
            shadowOffset: { width: 0, height: 1 },
            shadowRadius: 2,
            shadowOpacity: 1,
            elevation: 2,
          }}
        />
      </Animated.View>
    </Pressable>
  );
}

export function SegmentedControl<Value extends string>({
  palette,
  options,
  value,
  onValueChange,
}: {
  palette: Palette;
  options: readonly { value: Value; label: string }[];
  value: Value;
  onValueChange: (value: Value) => void;
}) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: spacing[1], minHeight: controlHeight.compact }}>
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            onPress={() => onValueChange(option.value)}
            style={pressable(({ hovered, pressed }) => ({
              minHeight: controlHeight.compact - 4,
              paddingHorizontal: spacing[3],
              borderRadius: radius.md,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: selected || pressed ? palette.surface3 : hovered ? palette.surface2 : "transparent",
            }))}
          >
            <Text style={{ color: selected ? palette.foreground : palette.foregroundMuted, fontSize: fontSize.base }}>
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export type ButtonVariant = "default" | "outline" | "ghost";

export function Button({
  palette,
  label,
  onPress,
  disabled,
  variant = "outline",
}: {
  palette: Palette;
  label: string;
  onPress: () => void;
  disabled?: boolean;
  variant?: ButtonVariant;
}) {
  const surface = {
    default: { backgroundColor: palette.accent, borderColor: palette.accent },
    outline: { backgroundColor: "transparent", borderColor: palette.borderAccent },
    ghost: { backgroundColor: "transparent", borderColor: "transparent" },
  }[variant];
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      style={pressable(({ hovered, pressed }) => [
        {
          minHeight: controlHeight.compact,
          paddingHorizontal: spacing[3],
          borderRadius: radius.md,
          borderWidth: 1,
          alignItems: "center",
          justifyContent: "center",
          opacity: disabled ? 0.5 : pressed ? 0.85 : 1,
        },
        surface,
        variant !== "default" && (hovered || pressed) ? { backgroundColor: palette.surface2 } : null,
      ])}
    >
      <Text style={{ color: variant === "default" ? palette.accentForeground : palette.foreground, fontSize: fontSize.base }}>
        {label}
      </Text>
    </Pressable>
  );
}

/** The muted label paseo puts above every settings block. */
export function Section({
  palette,
  title,
  trailing,
  children,
}: {
  palette: Palette;
  title: string;
  trailing?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <View style={{ gap: spacing[3] }}>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          gap: spacing[2],
          marginLeft: spacing[1],
        }}
      >
        <Text style={{ color: palette.foregroundMuted, fontSize: fontSize.sm }}>{title}</Text>
        {trailing}
      </View>
      {children}
    </View>
  );
}

/** The bordered surface1 block every settings row lives in. */
export function Card({
  palette,
  children,
  style,
}: {
  palette: Palette;
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View
      style={[
        {
          backgroundColor: palette.surface1,
          borderRadius: radius.lg,
          borderWidth: 1,
          borderColor: palette.border,
          overflow: "hidden",
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

export function Row({
  palette,
  title,
  hint,
  hintColor,
  leading: leadingSlot,
  trailing,
  divided,
  dimmed,
}: {
  palette: Palette;
  title: string;
  hint?: string;
  hintColor?: string;
  leading?: React.ReactNode;
  trailing?: React.ReactNode;
  divided?: boolean;
  dimmed?: boolean;
}) {
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        paddingVertical: spacing[4],
        paddingHorizontal: spacing[4],
        gap: spacing[3],
        borderTopWidth: divided ? 1 : 0,
        borderTopColor: palette.border,
      }}
    >
      {leadingSlot}
      <View style={{ flex: 1, opacity: dimmed ? 0.6 : 1 }}>
        <Text numberOfLines={1} style={{ color: palette.foreground, fontSize: fontSize.base }}>
          {title}
        </Text>
        {hint ? (
          <Text
            numberOfLines={1}
            style={{
              color: hintColor ?? palette.foregroundMuted,
              fontSize: fontSize.sm,
              lineHeight: leading(fontSize.sm),
              marginTop: spacing[1],
            }}
          >
            {hint}
          </Text>
        ) : null}
      </View>
      {trailing}
    </View>
  );
}

/** Paseo marks a disclosure with a chevron; a plugin has no icon set, so the caret is drawn. */
function Caret({ color, open }: { color: string; open: boolean }) {
  return (
    <View style={{ width: 10, height: 10, alignItems: "center", justifyContent: "center" }}>
      <View
        style={{
          width: 0,
          height: 0,
          borderTopWidth: 4,
          borderBottomWidth: 4,
          borderLeftWidth: 6,
          borderTopColor: "transparent",
          borderBottomColor: "transparent",
          borderLeftColor: color,
          transform: [{ rotate: open ? "90deg" : "0deg" }],
        }}
      />
    </View>
  );
}

/** A card that opens on its header row, for settings that most installs never touch. */
export function Disclosure({
  palette,
  title,
  summary,
  initialOpen = false,
  children,
}: {
  palette: Palette;
  title: string;
  summary?: string;
  initialOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(initialOpen);
  return (
    <Card palette={palette}>
      <Pressable
        onPress={() => setOpen(!open)}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        style={pressable(({ hovered, pressed }) => ({
          flexDirection: "row",
          alignItems: "center",
          gap: spacing[2],
          paddingVertical: spacing[4],
          paddingHorizontal: spacing[4],
          backgroundColor: hovered || pressed ? palette.surface2 : "transparent",
        }))}
      >
        <Caret color={palette.foregroundMuted} open={open} />
        <Text style={{ flex: 1, color: palette.foreground, fontSize: fontSize.base }}>{title}</Text>
        {summary ? (
          <Text numberOfLines={1} style={{ color: palette.foregroundMuted, fontSize: fontSize.sm }}>
            {summary}
          </Text>
        ) : null}
      </Pressable>
      {open ? (
        <View style={{ borderTopWidth: 1, borderTopColor: palette.border }}>{children}</View>
      ) : null}
    </Card>
  );
}

export function StatusDot({ color, size = 8 }: { color: string; size?: number }) {
  return <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color }} />;
}

export const MONO_FONT =
  Platform.select({
    ios: "Menlo",
    android: "monospace",
    default: "SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
  }) ?? "monospace";
