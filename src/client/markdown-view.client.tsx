import type { PluginTheme } from "@getpaseo/plugin";
import React from "react";
import { Linking, ScrollView, Text, View } from "react-native";
import type { Block, Inline } from "./markdown.client.ts";
import { parseMarkdown } from "./markdown.client.ts";
import { MONO_FONT, Tint } from "./ui.client.tsx";

const HEADING_SIZES = [20, 18, 16, 15, 14, 14];

function InlineText({ parts, theme, style }: { parts: Inline[]; theme: PluginTheme; style?: object }) {
  return (
    <Text style={[{ color: theme.colors.foreground, fontSize: 14, lineHeight: 20 }, style]}>
      {parts.map((part, index) => {
        if (part.kind === "link") {
          return (
            <Text
              key={index}
              style={{ color: theme.colors.accent, textDecorationLine: "underline" }}
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
              fontWeight: part.bold ? "700" : "400",
              fontStyle: part.italic ? "italic" : "normal",
              ...(part.code
                ? { fontFamily: MONO_FONT, fontSize: 13, color: theme.colors.accent }
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
  theme,
  language,
}: {
  text: string;
  theme: PluginTheme;
  language?: string | null;
}) {
  return (
    <View style={{ borderRadius: 6, overflow: "hidden", paddingVertical: 6 }}>
      <Tint color={theme.colors.foreground} opacity={0.07} />
      {language ? (
        <Text style={{ color: theme.colors.foregroundMuted, fontSize: 10, paddingHorizontal: 8 }}>
          {language}
        </Text>
      ) : null}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ padding: 8 }}>
        <Text style={{ fontFamily: MONO_FONT, fontSize: 12, lineHeight: 17, color: theme.colors.foreground }}>
          {text}
        </Text>
      </ScrollView>
    </View>
  );
}

function BlockView({ block, theme }: { block: Block; theme: PluginTheme }) {
  switch (block.kind) {
    case "heading":
      return (
        <InlineText
          parts={block.inline}
          theme={theme}
          style={{
            fontSize: HEADING_SIZES[block.level - 1] ?? 14,
            fontWeight: "700",
            marginTop: 4,
          }}
        />
      );
    case "paragraph":
      return <InlineText parts={block.inline} theme={theme} />;
    case "code":
      return <CodeBlock text={block.text} theme={theme} language={block.language} />;
    case "list":
      return (
        <View style={{ gap: 2 }}>
          {block.items.map((item, index) => (
            <View key={index} style={{ flexDirection: "row", paddingLeft: item.depth * 14 }}>
              <Text style={{ color: theme.colors.foregroundMuted, width: 18, fontSize: 14, lineHeight: 20 }}>
                {item.marker}
              </Text>
              <View style={{ flex: 1 }}>
                <InlineText parts={item.inline} theme={theme} />
              </View>
            </View>
          ))}
        </View>
      );
    case "quote":
      return (
        <View style={{ flexDirection: "row", gap: 8 }}>
          <View style={{ width: 2, borderRadius: 1, overflow: "hidden" }}>
            <Tint color={theme.colors.accent} opacity={0.6} />
          </View>
          <View style={{ flex: 1, gap: 6 }}>
            {block.blocks.map((child, index) => (
              <BlockView key={index} block={child} theme={theme} />
            ))}
          </View>
        </View>
      );
    case "table":
      return (
        <CodeBlock
          theme={theme}
          text={block.rows.map((row) => row.join("  |  ")).join("\n")}
        />
      );
    case "rule":
      return (
        <View style={{ height: 1, borderRadius: 1, overflow: "hidden", marginVertical: 4 }}>
          <Tint color={theme.colors.foreground} opacity={0.2} />
        </View>
      );
    default:
      return null;
  }
}

export function Markdown({ text, theme }: { text: string; theme: PluginTheme }) {
  const blocks = React.useMemo(() => parseMarkdown(text), [text]);
  return (
    <View style={{ gap: 6 }}>
      {blocks.map((block, index) => (
        <BlockView key={index} block={block} theme={theme} />
      ))}
    </View>
  );
}
