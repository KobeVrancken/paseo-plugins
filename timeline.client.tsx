import type { PluginTheme } from "@getpaseo/plugin";
import React, { useState } from "react";
import { Image, Pressable, ScrollView, Text, View } from "react-native";
import { CodeBlock, Markdown } from "./markdown-view.client.tsx";
import type { DetailBlock, RenderBody, RenderEntry } from "./render-types.shared.ts";
import { statusGlyph, todoGlyph, toolGlyph, type TimelineItem } from "./timeline-model.client.ts";
import { Card, MONO_FONT, Mono, Tint } from "./ui.client.tsx";

export type QuestionAnswerHandler = (entry: RenderEntry, optionLabels: string[]) => void;

function Disclosure({
  theme,
  label,
  detail,
  expanded,
  onToggle,
  children,
  tone = "raised",
}: {
  theme: PluginTheme;
  label: React.ReactNode;
  detail?: React.ReactNode;
  expanded: boolean;
  onToggle: () => void;
  children?: React.ReactNode;
  tone?: "raised" | "accent" | "danger";
}) {
  return (
    <Card theme={theme} tone={tone} style={{ padding: 0 }}>
      <Pressable onPress={onToggle} style={{ padding: 10, gap: 2 }}>
        {label}
        {detail}
      </Pressable>
      {expanded && children ? <View style={{ paddingHorizontal: 10, paddingBottom: 10, gap: 8 }}>{children}</View> : null}
    </Card>
  );
}

function DetailBlockView({ block, theme }: { block: DetailBlock; theme: PluginTheme }) {
  switch (block.kind) {
    case "text":
      return block.mono ? (
        <Mono theme={theme}>{block.text}</Mono>
      ) : (
        <Text style={{ color: theme.colors.foreground, fontSize: 13 }}>{block.text}</Text>
      );
    case "code":
      return <CodeBlock text={block.text} theme={theme} language={block.language ?? null} />;
    case "kv":
      return (
        <View style={{ gap: 2 }}>
          {block.pairs.map((pair, index) => (
            <View key={index} style={{ flexDirection: "row", gap: 6 }}>
              <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>{pair.key}</Text>
              <Text style={{ color: theme.colors.foreground, fontSize: 12, flex: 1 }}>{pair.value}</Text>
            </View>
          ))}
        </View>
      );
    case "diff":
      return (
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View>
            {block.lines.map((line, index) => (
              <View key={index} style={{ paddingHorizontal: 6, borderRadius: 3, overflow: "hidden" }}>
                {line.kind === "add" ? <Tint color={theme.colors.accent} opacity={0.18} /> : null}
                {line.kind === "del" ? <Tint color={theme.colors.statusDanger} opacity={0.18} /> : null}
                <Text
                  style={{
                    fontFamily: MONO_FONT,
                    fontSize: 12,
                    lineHeight: 17,
                    color: line.kind === "ctx" ? theme.colors.foregroundMuted : theme.colors.foreground,
                  }}
                >
                  {line.kind === "add" ? "+" : line.kind === "del" ? "-" : " "} {line.text}
                </Text>
              </View>
            ))}
          </View>
        </ScrollView>
      );
    default:
      return null;
  }
}

function ToolCard({ body, theme }: { body: Extract<RenderBody, { kind: "tool_call" }>; theme: PluginTheme }) {
  const [expanded, setExpanded] = useState(false);
  const hasBody = body.detail.length > 0 || body.result !== null;
  return (
    <Disclosure
      theme={theme}
      tone={body.status === "error" ? "danger" : "raised"}
      expanded={expanded}
      onToggle={() => setExpanded((value) => !value)}
      label={
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>{toolGlyph(body.tool)}</Text>
          <Text style={{ color: theme.colors.foreground, fontWeight: "600", fontSize: 13 }}>{body.title}</Text>
          <Text
            style={{
              color: body.status === "error" ? theme.colors.statusDanger : theme.colors.foregroundMuted,
              fontSize: 12,
            }}
          >
            {statusGlyph(body.status)}
          </Text>
          {hasBody ? (
            <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11, marginLeft: "auto" }}>
              {expanded ? "▾" : "▸"}
            </Text>
          ) : null}
        </View>
      }
      detail={
        body.summary ? (
          <Text numberOfLines={expanded ? undefined : 1} style={{ fontFamily: MONO_FONT, fontSize: 12, color: theme.colors.foregroundMuted }}>
            {body.summary}
          </Text>
        ) : undefined
      }
    >
      {body.detail.map((block, index) => (
        <DetailBlockView key={index} block={block} theme={theme} />
      ))}
      {body.result ? (
        <View style={{ gap: 2 }}>
          <Text style={{ color: theme.colors.foregroundMuted, fontSize: 10 }}>
            output{body.result.truncated ? " (truncated)" : ""}
          </Text>
          <CodeBlock text={body.result.text} theme={theme} />
        </View>
      ) : null}
    </Disclosure>
  );
}

function ThinkingRow({ text, theme }: { text: string; theme: PluginTheme }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <Pressable onPress={() => setExpanded((value) => !value)}>
      <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12, fontStyle: "italic" }}>
        {expanded ? `✻ ${text}` : "✻ Thinking…"}
      </Text>
    </Pressable>
  );
}

export function EntryView({
  entry,
  theme,
  onAnswerQuestion,
  answerPending,
}: {
  entry: RenderEntry;
  theme: PluginTheme;
  onAnswerQuestion?: QuestionAnswerHandler;
  answerPending?: boolean;
}) {
  const body = entry.body;
  switch (body.kind) {
    case "user_text":
      return (
        <Card theme={theme} tone="accent">
          <Text style={{ color: theme.colors.foreground, fontSize: 14, lineHeight: 20 }}>{body.text}</Text>
        </Card>
      );
    case "assistant_markdown":
      return <Markdown text={body.text} theme={theme} />;
    case "thinking":
      return <ThinkingRow text={body.text} theme={theme} />;
    case "tool_call":
      return <ToolCard body={body} theme={theme} />;
    case "todo_list":
      return (
        <Card theme={theme}>
          <View style={{ gap: 3 }}>
            {body.todos.map((todo, index) => (
              <View key={index} style={{ flexDirection: "row", gap: 6 }}>
                <Text style={{ color: theme.colors.foregroundMuted, fontSize: 13 }}>{todoGlyph(todo.status)}</Text>
                <Text
                  style={{
                    flex: 1,
                    fontSize: 13,
                    color: todo.status === "completed" ? theme.colors.foregroundMuted : theme.colors.foreground,
                    textDecorationLine: todo.status === "completed" ? "line-through" : "none",
                  }}
                >
                  {todo.content}
                </Text>
              </View>
            ))}
          </View>
        </Card>
      );
    case "question":
      return (
        <QuestionCard
          entry={entry}
          body={body}
          theme={theme}
          onAnswer={onAnswerQuestion}
          answerPending={answerPending === true}
        />
      );
    case "activity":
      return (
        <Text
          style={{
            color: body.tone === "danger" ? theme.colors.statusDanger : theme.colors.foregroundMuted,
            fontSize: 12,
          }}
        >
          {body.label}
        </Text>
      );
    case "image":
      return body.dataUri ? (
        <Image
          source={{ uri: body.dataUri }}
          style={{ width: "100%", height: 200, borderRadius: 8 }}
          resizeMode="contain"
        />
      ) : (
        <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>{body.note ?? "image"}</Text>
      );
    case "unsupported":
      return null;
    default:
      return null;
  }
}

function QuestionCard({
  entry,
  body,
  theme,
  onAnswer,
  answerPending,
}: {
  entry: RenderEntry;
  body: Extract<RenderBody, { kind: "question" }>;
  theme: PluginTheme;
  onAnswer?: QuestionAnswerHandler;
  answerPending: boolean;
}) {
  const resolved = body.answers !== null;
  return (
    <Card theme={theme} tone="accent">
      <View style={{ gap: 8 }}>
        {body.questions.map((question, questionIndex) => (
          <View key={questionIndex} style={{ gap: 6 }}>
            {question.header ? (
              <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11, textTransform: "uppercase" }}>
                {question.header}
              </Text>
            ) : null}
            <Text style={{ color: theme.colors.foreground, fontWeight: "600" }}>{question.question}</Text>
            <View style={{ gap: 4 }}>
              {question.options.map((option, optionIndex) => (
                <Pressable
                  key={optionIndex}
                  disabled={resolved || answerPending || !onAnswer}
                  onPress={() => onAnswer?.(entry, [option.label])}
                  style={{ padding: 8, borderRadius: 6, overflow: "hidden" }}
                >
                  <Tint color={theme.colors.foreground} opacity={resolved ? 0.04 : 0.1} />
                  <Text style={{ color: theme.colors.foreground, fontSize: 13 }}>{option.label}</Text>
                  {option.description ? (
                    <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11 }}>{option.description}</Text>
                  ) : null}
                </Pressable>
              ))}
            </View>
          </View>
        ))}
        {resolved ? (
          <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>
            answered: {body.answers!.join(", ")}
          </Text>
        ) : null}
      </View>
    </Card>
  );
}

function SidechainCard({ entries, theme }: { entries: RenderEntry[]; theme: PluginTheme }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <Disclosure
      theme={theme}
      expanded={expanded}
      onToggle={() => setExpanded((value) => !value)}
      label={
        <View style={{ flexDirection: "row", gap: 6, alignItems: "center" }}>
          <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>⚙</Text>
          <Text style={{ color: theme.colors.foreground, fontSize: 13, fontWeight: "600" }}>Subagent</Text>
          <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11 }}>
            {entries.length} step{entries.length === 1 ? "" : "s"}
          </Text>
          <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11, marginLeft: "auto" }}>
            {expanded ? "▾" : "▸"}
          </Text>
        </View>
      }
    >
      {entries.map((entry) => (
        <EntryView key={`${entry.index}:${entry.id}`} entry={entry} theme={theme} />
      ))}
    </Disclosure>
  );
}

export function TimelineItemView({
  item,
  theme,
  onAnswerQuestion,
  answerPending,
}: {
  item: TimelineItem;
  theme: PluginTheme;
  onAnswerQuestion?: QuestionAnswerHandler;
  answerPending?: boolean;
}) {
  if (item.kind === "sidechain") return <SidechainCard entries={item.entries} theme={theme} />;
  return (
    <EntryView
      entry={item.entry}
      theme={theme}
      onAnswerQuestion={onAnswerQuestion}
      answerPending={answerPending}
    />
  );
}
