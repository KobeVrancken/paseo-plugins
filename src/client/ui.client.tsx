import type { PluginTheme } from "@getpaseo/plugin";
import type { StyleProp, TextStyle, ViewStyle } from "react-native";
import React, { useMemo } from "react";
import { Image, Platform, Pressable, Text, View } from "react-native";
import {
  controlHeight,
  derivePalette,
  fontSize,
  leading,
  radius,
  spacing,
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

export function pressable(style: (state: PressState) => ViewStyle): (state: { pressed: boolean }) => StyleProp<ViewStyle> {
  return style as (state: { pressed: boolean }) => StyleProp<ViewStyle>;
}

/** Web focus rings do not belong on a control that already draws its own border. */
export const NO_OUTLINE = (Platform.OS === "web"
  ? ({ outlineStyle: "none", outlineWidth: 0 } as unknown as TextStyle)
  : null) as TextStyle | null;

export type ButtonVariant = "default" | "secondary" | "outline" | "ghost" | "destructive";
export type ButtonSize = "xs" | "sm";

export function Button({
  palette,
  label,
  onPress,
  disabled,
  variant = "outline",
  size = "sm",
  style,
}: {
  palette: Palette;
  label: string;
  onPress: () => void;
  disabled?: boolean;
  variant?: ButtonVariant;
  size?: ButtonSize;
  style?: object;
}) {
  const surface = {
    default: { backgroundColor: palette.accent, borderColor: palette.accent },
    secondary: { backgroundColor: palette.surface3, borderColor: palette.surface3 },
    outline: { backgroundColor: "transparent", borderColor: palette.borderAccent },
    ghost: { backgroundColor: "transparent", borderColor: "transparent" },
    destructive: { backgroundColor: palette.statusDanger, borderColor: palette.statusDanger },
  }[variant];
  const color =
    variant === "default" || variant === "destructive" ? palette.accentForeground : palette.foreground;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        {
          minHeight: size === "xs" ? controlHeight.tight : controlHeight.compact,
          paddingHorizontal: spacing[3],
          borderRadius: radius.md,
          borderWidth: 1,
          alignItems: "center",
          justifyContent: "center",
          flexDirection: "row",
          gap: spacing[2],
          opacity: disabled ? 0.5 : pressed ? 0.85 : 1,
        },
        surface,
        style,
      ]}
    >
      <Text style={{ color, fontSize: size === "xs" ? fontSize.sm : fontSize.base }}>{label}</Text>
    </Pressable>
  );
}

/** The round 28px glyph button paseo uses for every toolbar and composer action. */
export function IconButton({
  palette,
  glyph,
  onPress,
  disabled,
  tone = "muted",
  accessibilityLabel,
}: {
  palette: Palette;
  glyph: string;
  onPress: () => void;
  disabled?: boolean;
  tone?: "muted" | "accent";
  accessibilityLabel?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={pressable(({ pressed, hovered }) => ({
        width: controlHeight.tight,
        height: controlHeight.tight,
        borderRadius: radius.full,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor:
          tone === "accent" ? palette.accent : hovered || pressed ? palette.surface2 : "transparent",
        opacity: disabled ? 0.5 : 1,
      }))}
    >
      <Text
        style={{
          color: tone === "accent" ? palette.accentForeground : palette.foregroundMuted,
          fontSize: fontSize.base,
        }}
      >
        {glyph}
      </Text>
    </Pressable>
  );
}

/** Every attachment body renders at this height, so a tray of mixed kinds lines up. */
const ATTACHMENT_CONTENT_HEIGHT = 48;

export function AttachmentPill({
  palette,
  previewDataUrl,
  title,
  subtitle,
  disabled,
  onRemove,
}: {
  palette: Palette;
  previewDataUrl?: string | null;
  title: string;
  subtitle: string;
  disabled?: boolean;
  onRemove: () => void;
}) {
  return (
    <View style={{ position: "relative" }}>
      <View
        style={{
          borderRadius: radius.md,
          borderWidth: 1,
          borderColor: palette.borderAccent,
          overflow: "hidden",
        }}
      >
        {previewDataUrl ? (
          <Image
            source={{ uri: previewDataUrl }}
            style={{ width: ATTACHMENT_CONTENT_HEIGHT, height: ATTACHMENT_CONTENT_HEIGHT }}
          />
        ) : (
          <View
            style={{
              height: ATTACHMENT_CONTENT_HEIGHT,
              maxWidth: 260,
              justifyContent: "center",
              paddingHorizontal: spacing[3],
              backgroundColor: palette.surface1,
            }}
          >
            <Text numberOfLines={1} style={{ color: palette.foreground, fontSize: fontSize.base }}>
              {title}
            </Text>
            <Text numberOfLines={1} style={{ color: palette.foregroundMuted, fontSize: fontSize.sm }}>
              {subtitle}
            </Text>
          </View>
        )}
      </View>
      <Pressable
        onPress={onRemove}
        disabled={disabled}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={`Remove ${title}`}
        style={{
          position: "absolute",
          top: -8,
          left: -8,
          width: 24,
          height: 24,
          borderRadius: radius.full,
          alignItems: "center",
          justifyContent: "center",
          borderWidth: 1,
          borderColor: palette.border,
          backgroundColor: palette.surface2,
          zIndex: 1,
        }}
      >
        <Text style={{ color: palette.foregroundMuted, fontSize: fontSize.sm }}>✕</Text>
      </Pressable>
    </View>
  );
}

/** The bordered surface1 block paseo uses for cards that sit inside the transcript. */
export function Card({
  palette,
  tone = "raised",
  children,
  style,
}: {
  palette: Palette;
  tone?: "raised" | "danger";
  children: React.ReactNode;
  style?: object;
}) {
  return (
    <View
      style={[
        {
          padding: spacing[3],
          gap: spacing[2],
          borderRadius: radius.lg,
          borderWidth: 1,
          backgroundColor: palette.surface1,
          borderColor: tone === "danger" ? palette.statusDanger : palette.border,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

export function Mono({
  palette,
  children,
  color,
  size = fontSize.code,
}: {
  palette: Palette;
  children: React.ReactNode;
  color?: string;
  size?: number;
}) {
  return (
    <Text
      style={{
        fontFamily: MONO_FONT,
        fontSize: size,
        lineHeight: Math.round(size * 1.35),
        color: color ?? palette.foreground,
      }}
    >
      {children}
    </Text>
  );
}

export function Body({
  palette,
  children,
  muted,
  style,
  numberOfLines,
}: {
  palette: Palette;
  children: React.ReactNode;
  muted?: boolean;
  style?: object;
  numberOfLines?: number;
}) {
  return (
    <Text
      numberOfLines={numberOfLines}
      style={[
        {
          color: muted ? palette.foregroundMuted : palette.foreground,
          fontSize: fontSize.base,
          lineHeight: leading(fontSize.base),
        },
        style,
      ]}
    >
      {children}
    </Text>
  );
}

export const MONO_FONT =
  Platform.select({
    ios: "Menlo",
    android: "monospace",
    default: "SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
  }) ?? "monospace";

export function relativeTime(iso: string | null): string {
  if (!iso) return "";
  const value = Date.parse(iso);
  if (Number.isNaN(value)) return "";
  return relativeTimeFrom(value);
}

export function relativeTimeFrom(value: number, now = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - value) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}
