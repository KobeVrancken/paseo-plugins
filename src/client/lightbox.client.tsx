import React, { useEffect } from "react";
import { Image, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { controlHeight, fontSize, radius, spacing, type Palette } from "./theme.client.ts";
import { pressable } from "./ui.client.tsx";

const MAX_IMAGE_WIDTH = 960;
const MAX_IMAGE_HEIGHT = 640;

/**
 * The opened image, over the whole panel.
 * Not a React Native `Modal`: the panel is embedded in the host app, so the backdrop is a sibling
 * of the image and a press on the image itself cannot reach it.
 */
export function AttachmentLightbox({
  palette,
  uri,
  loading,
  onClose,
}: {
  palette: Palette;
  uri: string | null;
  loading: boolean;
  onClose: () => void;
}) {
  useEffect(() => {
    if (Platform.OS !== "web") return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <View style={StyleSheet.absoluteFill}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Dismiss image"
        onPress={onClose}
        style={[StyleSheet.absoluteFill, { backgroundColor: "rgba(0, 0, 0, 0.9)" }]}
      />
      <View
        style={[StyleSheet.absoluteFill, { alignItems: "center", justifyContent: "center", padding: spacing[4] }]}
        pointerEvents="box-none"
      >
        {uri ? (
          <Image
            source={{ uri }}
            resizeMode="contain"
            style={{ width: "100%", height: "100%", maxWidth: MAX_IMAGE_WIDTH, maxHeight: MAX_IMAGE_HEIGHT }}
          />
        ) : (
          <Text style={{ color: palette.foregroundMuted, fontSize: fontSize.base }}>
            {loading ? "Loading image…" : "The image could not be loaded."}
          </Text>
        )}
      </View>
      <View
        style={{ position: "absolute", top: spacing[3], right: spacing[3] }}
        pointerEvents="box-none"
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close image"
          hitSlop={8}
          onPress={onClose}
          style={pressable(({ hovered }) => ({
            width: controlHeight.compact,
            height: controlHeight.compact,
            borderRadius: radius.full,
            alignItems: "center",
            justifyContent: "center",
            borderWidth: 1,
            borderColor: palette.border,
            backgroundColor: hovered ? palette.surface3 : palette.surface2,
          }))}
        >
          <Text style={{ color: palette.foregroundMuted, fontSize: fontSize.lg }}>✕</Text>
        </Pressable>
      </View>
    </View>
  );
}
