import type { PluginTheme } from "@getpaseo/plugin";
import React from "react";
import { Platform, StyleSheet, Text, View } from "react-native";

/**
 * The theme exposes six flat colors, so every raised or muted surface is drawn as a
 * translucent layer of an existing token instead of a hardcoded shade.
 */
export function Tint({ color, opacity }: { color: string; opacity: number }) {
  return (
    <View
      pointerEvents="none"
      style={[StyleSheet.absoluteFill, { backgroundColor: color, opacity, borderRadius: 8 }]}
    />
  );
}

export function Card({
  theme,
  tone = "raised",
  children,
  style,
}: {
  theme: PluginTheme;
  tone?: "raised" | "accent" | "danger";
  children: React.ReactNode;
  style?: object;
}) {
  const color =
    tone === "accent"
      ? theme.colors.accent
      : tone === "danger"
        ? theme.colors.statusDanger
        : theme.colors.foreground;
  const opacity = tone === "raised" ? 0.06 : 0.12;
  return (
    <View style={[{ borderRadius: 8, padding: 10, overflow: "hidden" }, style]}>
      <Tint color={color} opacity={opacity} />
      {children}
    </View>
  );
}

export function Mono({
  theme,
  children,
  color,
  size = 12,
}: {
  theme: PluginTheme;
  children: React.ReactNode;
  color?: string;
  size?: number;
}) {
  return (
    <Text
      style={{
        fontFamily: MONO_FONT,
        fontSize: size,
        lineHeight: size * 1.45,
        color: color ?? theme.colors.foreground,
      }}
    >
      {children}
    </Text>
  );
}

export const MONO_FONT =
  Platform.select({
    ios: "Menlo",
    android: "monospace",
    default: "Menlo, Monaco, Consolas, monospace",
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
