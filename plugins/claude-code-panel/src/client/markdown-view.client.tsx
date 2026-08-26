import React from "react";
import { Linking, ScrollView, Text, View } from "react-native";
import type { Block, Inline } from "./markdown.client.ts";
import { parseMarkdown } from "./markdown.client.ts";
import { fontSize, leading, radius, spacing, type Palette } from "./theme.client.ts";
import { MONO_FONT } from "./ui.client.tsx";

const HEADING_SIZES = [20, 18, 16, 15, 15, 15];

function InlineText({ parts, palette, style }: { parts: Inline[]; palette: Palette; style?: object }) {
  return (
    <Text
      style={[
        { color: palette.foreground, fontSize: fontSize.content, lineHeight: leading(fontSize.content) },
        style,
      ]}
    >
      {parts.map((part, index) => {
        if (part.kind === "link") {
          return (
            <Text
              key={index}
              style={{ color: palette.accent, textDecorationLine: "underline" }}
              onPress={() => {
                void Linking.openURL(part.href).catch(() => {});
              }}
            >
              {part.text}
            </Text>
          );
        }
        return (
          <Text
            key={index}
            style={{
              fontWeight: part.bold ? "600" : "normal",
              fontStyle: part.italic ? "italic" : "normal",
              ...(part.code
                ? { fontFamily: MONO_FONT, fontSize: fontSize.base, color: palette.accent }
                : null),
            }}
          >
            {part.text}
          </Text>
        );
      })}
    </Text>
  );
}

export function CodeBlock({
  text,
  palette,
  language,
}: {
  text: string;
  palette: Palette;
  language?: string | null;
}) {
  return (
    <View
      style={{
        borderRadius: radius.md,
        borderWidth: 1,
        borderColor: palette.border,
        backgroundColor: palette.surface2,
        overflow: "hidden",
      }}
    >
      {language ? (
        <Text
          style={{
            color: palette.foregroundMuted,
            fontSize: fontSize.sm,
            paddingHorizontal: spacing[2],
            paddingTop: spacing[1],
          }}
        >
          {language}
        </Text>
      ) : null}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ padding: spacing[2] }}>
        <Text
          style={{
            fontFamily: MONO_FONT,
            fontSize: fontSize.code,
            lineHeight: 16,
            color: palette.foreground,
          }}
        >
          {text}
        </Text>
      </ScrollView>
    </View>
  );
}

function BlockView({ block, palette }: { block: Block; palette: Palette }) {
  switch (block.kind) {
    case "heading":
      return (
        <InlineText
          parts={block.inline}
          palette={palette}
          style={{
            fontSize: HEADING_SIZES[block.level - 1] ?? fontSize.content,
            lineHeight: leading(HEADING_SIZES[block.level - 1] ?? fontSize.content),
            fontWeight: "600",
            marginTop: spacing[1],
          }}
        />
      );
    case "paragraph":
      return <InlineText parts={block.inline} palette={palette} />;
    case "code":
      return <CodeBlock text={block.text} palette={palette} language={block.language} />;
    case "list":
      return (
        <View style={{ gap: 2 }}>
          {block.items.map((item, index) => (
            <View key={index} style={{ flexDirection: "row", paddingLeft: item.depth * spacing[4] }}>
              <Text
                style={{
                  color: palette.foregroundMuted,
                  width: 18,
                  fontSize: fontSize.content,
                  lineHeight: leading(fontSize.content),
                }}
              >
                {item.marker}
              </Text>
              <View style={{ flex: 1 }}>
                <InlineText parts={item.inline} palette={palette} />
              </View>
            </View>
          ))}
        </View>
      );
    case "quote":
      return (
        <View style={{ flexDirection: "row", gap: spacing[2] }}>
          <View style={{ width: 2, borderRadius: 1, backgroundColor: palette.borderAccent }} />
          <View style={{ flex: 1, gap: spacing[2] }}>
            {block.blocks.map((child, index) => (
              <BlockView key={index} block={child} palette={palette} />
            ))}
          </View>
        </View>
      );
    case "table":
      return <CodeBlock palette={palette} text={block.rows.map((row) => row.join("  |  ")).join("\n")} />;
    case "rule":
      return <View style={{ height: 1, backgroundColor: palette.border, marginVertical: spacing[1] }} />;
    default:
      return null;
  }
}

export function Markdown({ text, palette }: { text: string; palette: Palette }) {
  const blocks = React.useMemo(() => parseMarkdown(text), [text]);
  return (
    <View style={{ gap: spacing[2] }}>
      {blocks.map((block, index) => (
        <BlockView key={index} block={block} palette={palette} />
      ))}
    </View>
  );
}
