import React, { useEffect, useState } from "react";
import { Image, Pressable, ScrollView, Text, View } from "react-native";
import { CodeBlock, Markdown } from "./markdown-view.client.tsx";
import type { DetailBlock, RenderBody, RenderEntry } from "../render-types.shared.ts";
import { statusGlyph, todoGlyph, toolGlyph, type TimelineItem } from "./timeline-model.client.ts";
import { alpha, fontSize, leading, radius, spacing, STATUS_DOT_SIZE, type Palette } from "./theme.client.ts";
import { Body, Card, MONO_FONT, Mono, pressable } from "./ui.client.tsx";

export type QuestionAnswerHandler = (entry: RenderEntry, optionLabels: string[]) => void;
export type EntryLoader = (index: number) => Promise<RenderEntry | null>;

/** Tool rows sit slightly wider than the text column so their hover surface reads as a row, not a box. */
const ROW_BLEED = -spacing[2];

/** Fetches the full body of an entry the list payload shortened, once the user asks to see it. */
function useFullBody(
  entry: RenderEntry,
  enabled: boolean,
  loadEntry?: EntryLoader,
): { body: RenderBody; loading: boolean } {
  const [full, setFull] = useState<RenderBody | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setFull(null);
  }, [entry.index, entry.id]);

  useEffect(() => {
    if (!enabled || full !== null || loading || !loadEntry) return;
    let cancelled = false;
    setLoading(true);
    void loadEntry(entry.index)
      .then((loaded) => {
        if (!cancelled && loaded) setFull(loaded.body);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, full, loading, loadEntry, entry.index]);

  return { body: full ?? entry.body, loading };
}

/** The collapsible row paseo uses for every tool call and subagent run. */
function Disclosure({
  palette,
  label,
  secondary,
  expanded,
  onToggle,
  danger,
  children,
}: {
  palette: Palette;
  label: string;
  secondary?: React.ReactNode;
  expanded: boolean;
  onToggle: () => void;
  danger?: boolean;
  children?: React.ReactNode;
}) {
  const hasBody = children !== undefined && children !== null;
  return (
    <View style={{ marginHorizontal: ROW_BLEED, marginBottom: spacing[1] }}>
      <Pressable
        onPress={onToggle}
        style={pressable(({ hovered }) => ({
          flexDirection: "row",
          alignItems: "center",
          paddingHorizontal: spacing[2],
          paddingVertical: spacing[1],
          borderRadius: radius.lg,
          borderWidth: 1,
          borderColor: expanded ? palette.border : "transparent",
          backgroundColor: expanded || hovered ? palette.surface1 : "transparent",
          ...(expanded ? { borderBottomLeftRadius: 0, borderBottomRightRadius: 0 } : null),
        }))}
      >
        <View
          style={{
            width: 22,
            height: 22,
            borderRadius: 11,
            alignItems: "center",
            justifyContent: "center",
            marginRight: spacing[1],
          }}
        >
          <Text style={{ color: danger ? palette.statusDanger : palette.foregroundMuted, fontSize: fontSize.base }}>
            {label}
          </Text>
        </View>
        {secondary}
        {hasBody ? (
          <Text style={{ color: palette.foregroundExtraMuted, fontSize: fontSize.sm, marginLeft: spacing[2] }}>
            {expanded ? "▾" : "▸"}
          </Text>
        ) : null}
      </Pressable>
      {expanded && hasBody ? (
        <View
          style={{
            borderWidth: 1,
            borderTopWidth: 0,
            borderColor: palette.border,
            borderBottomLeftRadius: radius.lg,
            borderBottomRightRadius: radius.lg,
            backgroundColor: palette.surface1,
            padding: spacing[2],
            gap: spacing[2],
            overflow: "hidden",
          }}
        >
          {children}
        </View>
      ) : null}
    </View>
  );
}

function DetailBlockView({ block, palette }: { block: DetailBlock; palette: Palette }) {
  switch (block.kind) {
    case "text":
      return block.mono ? (
        <Mono palette={palette}>{block.text}</Mono>
      ) : (
        <Body palette={palette}>{block.text}</Body>
      );
    case "code":
      return <CodeBlock text={block.text} palette={palette} language={block.language ?? null} />;
    case "kv":
      return (
        <View style={{ gap: 2 }}>
          {block.pairs.map((pair, index) => (
            <View key={index} style={{ flexDirection: "row", gap: spacing[2] }}>
              <Text style={{ color: palette.foregroundMuted, fontSize: fontSize.sm }}>{pair.key}</Text>
              <Text style={{ color: palette.foreground, fontSize: fontSize.sm, flex: 1 }}>{pair.value}</Text>
            </View>
          ))}
        </View>
      );
    case "diff":
      return (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={{
            borderRadius: radius.md,
            borderWidth: 1,
            borderColor: palette.border,
            backgroundColor: palette.surface2,
          }}
        >
          <View style={{ paddingVertical: spacing[1] }}>
            {block.lines.map((line, index) => (
              <View
                key={index}
                style={{
                  paddingHorizontal: spacing[2],
                  backgroundColor:
                    line.kind === "add"
                      ? alpha(palette.accent, 0.18)
                      : line.kind === "del"
                        ? alpha(palette.statusDanger, 0.18)
                        : "transparent",
                }}
              >
                <Text
                  style={{
                    fontFamily: MONO_FONT,
                    fontSize: fontSize.code,
                    lineHeight: 16,
                    color: line.kind === "ctx" ? palette.foregroundMuted : palette.foreground,
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

function ToolCard({
  entry,
  palette,
  loadEntry,
}: {
  entry: RenderEntry;
  palette: Palette;
  loadEntry?: EntryLoader;
}) {
  const [expanded, setExpanded] = useState(false);
  const listBody = entry.body as Extract<RenderBody, { kind: "tool_call" }>;
  const { body: loadedBody, loading } = useFullBody(entry, expanded && listBody.detailTruncated, loadEntry);
  const body = loadedBody.kind === "tool_call" ? loadedBody : listBody;
  const failed = body.status === "error";
  const hasBody = body.detail.length > 0 || body.result !== null;
  return (
    <Disclosure
      palette={palette}
      label={toolGlyph(body.tool)}
      danger={failed}
      expanded={expanded}
      onToggle={() => setExpanded((value) => !value)}
      secondary={
        <>
          <Text
            style={{
              color: expanded ? palette.foreground : palette.foregroundMuted,
              fontSize: fontSize.base,
              flexShrink: 0,
            }}
          >
            {body.title}
          </Text>
          {body.summary ? (
            <Text
              numberOfLines={1}
              style={{
                flexShrink: 1,
                minWidth: 0,
                marginLeft: spacing[2],
                color: palette.foregroundExtraMuted,
                fontFamily: MONO_FONT,
                fontSize: fontSize.code,
              }}
            >
              {body.summary}
            </Text>
          ) : null}
          <View style={{ flex: 1 }} />
          <Text
            style={{
              color: failed ? palette.statusDanger : palette.foregroundExtraMuted,
              fontSize: fontSize.sm,
            }}
          >
            {statusGlyph(body.status)}
          </Text>
        </>
      }
    >
      {hasBody ? (
        <>
          {loading ? <Body palette={palette} muted>Loading…</Body> : null}
          {body.detail.map((block, index) => (
            <DetailBlockView key={index} block={block} palette={palette} />
          ))}
          {body.result ? (
            <View style={{ gap: spacing[1] }}>
              <Text style={{ color: palette.foregroundExtraMuted, fontSize: fontSize.sm }}>
                output{body.result.truncated ? " (truncated)" : ""}
              </Text>
              <CodeBlock text={body.result.text} palette={palette} />
            </View>
          ) : null}
        </>
      ) : null}
    </Disclosure>
  );
}

function ThinkingRow({ text, palette }: { text: string; palette: Palette }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <Pressable onPress={() => setExpanded((value) => !value)} style={{ paddingVertical: spacing[3], gap: spacing[2] }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: spacing[2] }}>
        <Text style={{ color: palette.foregroundMuted, fontSize: fontSize.base }}>✻</Text>
        <Text style={{ color: palette.foregroundMuted, fontSize: fontSize.base }}>Thinking</Text>
        <Text style={{ color: palette.foregroundExtraMuted, fontSize: fontSize.sm }}>{expanded ? "▾" : "▸"}</Text>
      </View>
      {expanded ? (
        <Text
          style={{
            color: palette.foregroundMuted,
            fontSize: fontSize.content,
            lineHeight: leading(fontSize.content),
          }}
        >
          {text}
        </Text>
      ) : null}
    </Pressable>
  );
}

export function EntryView({
  entry,
  palette,
  onAnswerQuestion,
  answerPending,
  loadEntry,
}: {
  entry: RenderEntry;
  palette: Palette;
  onAnswerQuestion?: QuestionAnswerHandler;
  answerPending?: boolean;
  loadEntry?: EntryLoader;
}) {
  const body = entry.body;
  switch (body.kind) {
    case "user_text":
      return (
        <View style={{ flexDirection: "row", justifyContent: "flex-end", marginVertical: spacing[4] }}>
          <View
            style={{
              flexShrink: 1,
              minWidth: 0,
              backgroundColor: palette.surface3,
              borderRadius: radius["2xl"],
              borderTopRightRadius: radius.sm,
              paddingHorizontal: spacing[4],
              paddingVertical: spacing[4],
            }}
          >
            <Text
              style={{
                color: palette.foreground,
                fontSize: fontSize.content,
                lineHeight: leading(fontSize.content),
              }}
            >
              {body.text}
            </Text>
          </View>
        </View>
      );
    case "assistant_markdown":
      return (
        <View style={{ paddingVertical: spacing[3] }}>
          <Markdown text={body.text} palette={palette} />
        </View>
      );
    case "thinking":
      return <ThinkingRow text={body.text} palette={palette} />;
    case "tool_call":
      return <ToolCard entry={entry} palette={palette} loadEntry={loadEntry} />;
    case "todo_list":
      return (
        <Card palette={palette} style={{ marginVertical: spacing[2] }}>
          {body.todos.map((todo, index) => (
            <View key={index} style={{ flexDirection: "row", gap: spacing[2] }}>
              <Text style={{ color: palette.foregroundMuted, fontSize: fontSize.base }}>
                {todoGlyph(todo.status)}
              </Text>
              <Text
                style={{
                  flex: 1,
                  fontSize: fontSize.base,
                  lineHeight: 20,
                  color: todo.status === "completed" ? palette.foregroundExtraMuted : palette.foreground,
                  textDecorationLine: todo.status === "completed" ? "line-through" : "none",
                }}
              >
                {todo.content}
              </Text>
            </View>
          ))}
        </Card>
      );
    case "question":
      return (
        <QuestionCard
          entry={entry}
          body={body}
          palette={palette}
          onAnswer={onAnswerQuestion}
          answerPending={answerPending === true}
        />
      );
    case "activity":
      return (
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: spacing[2],
            marginHorizontal: ROW_BLEED,
            paddingHorizontal: spacing[2],
            paddingVertical: spacing[1],
            marginBottom: spacing[1],
          }}
        >
          <View
            style={{
              width: STATUS_DOT_SIZE,
              height: STATUS_DOT_SIZE,
              borderRadius: radius.full,
              backgroundColor: body.tone === "danger" ? palette.statusDanger : palette.surface4,
            }}
          />
          <Text
            style={{
              flex: 1,
              color: body.tone === "danger" ? palette.statusDanger : palette.foregroundMuted,
              fontSize: fontSize.base,
              lineHeight: 20,
            }}
          >
            {body.label}
          </Text>
        </View>
      );
    case "image":
      return <ImageEntry entry={entry} palette={palette} loadEntry={loadEntry} />;
    case "unsupported":
      return null;
    default:
      return null;
  }
}

/** The option row of paseo's question card, with the selection control its dialog kind calls for. */
export function QuestionOption({
  palette,
  label,
  description,
  selected,
  control,
  disabled,
  onPress,
}: {
  palette: Palette;
  label: string;
  description?: string | null;
  selected: boolean;
  control: "radio" | "checkbox" | "none";
  disabled?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      disabled={disabled}
      onPress={onPress}
      style={pressable(({ pressed, hovered }) => ({
        flexDirection: "row",
        alignItems: "flex-start",
        gap: spacing[2],
        paddingHorizontal: spacing[3],
        paddingVertical: spacing[2],
        borderRadius: radius.md,
        backgroundColor: selected || hovered ? palette.surface2 : "transparent",
        opacity: pressed ? 0.9 : 1,
      }))}
    >
      {control === "none" ? null : (
        <View
          style={{
            width: 18,
            height: 18,
            marginTop: 2,
            alignItems: "center",
            justifyContent: "center",
            borderWidth: 1,
            borderColor: selected ? palette.accent : palette.borderAccent,
            borderRadius: control === "checkbox" ? radius.base : radius.full,
          }}
        >
          {selected ? (
            <View
              style={{
                width: 8,
                height: 8,
                borderRadius: control === "checkbox" ? 1 : radius.full,
                backgroundColor: palette.accent,
              }}
            />
          ) : null}
        </View>
      )}
      <View style={{ flex: 1, gap: spacing[1] }}>
        <Text style={{ color: palette.foreground, fontSize: fontSize.base, fontWeight: "600", lineHeight: 22 }}>
          {label}
        </Text>
        {description ? (
          <Text style={{ color: palette.foregroundMuted, fontSize: fontSize.base, lineHeight: 20 }}>
            {description}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

function QuestionCard({
  entry,
  body,
  palette,
  onAnswer,
  answerPending,
}: {
  entry: RenderEntry;
  body: Extract<RenderBody, { kind: "question" }>;
  palette: Palette;
  onAnswer?: QuestionAnswerHandler;
  answerPending: boolean;
}) {
  const answers = body.answers;
  const resolved = answers !== null;
  return (
    <Card palette={palette} style={{ marginVertical: spacing[3], gap: spacing[3] }}>
      {body.questions.map((question, questionIndex) => (
        <View key={questionIndex} style={{ gap: spacing[2] }}>
          {question.header ? (
            <Text style={{ color: palette.foregroundMuted, fontSize: fontSize.sm }}>{question.header}</Text>
          ) : null}
          <Text style={{ color: palette.foreground, fontSize: fontSize.base, fontWeight: "500", lineHeight: 22 }}>
            {question.question}
          </Text>
          <View style={{ gap: spacing[1] }}>
            {question.options.map((option, optionIndex) => (
              <QuestionOption
                key={optionIndex}
                palette={palette}
                label={option.label}
                description={option.description}
                control="radio"
                selected={resolved && answers.includes(option.label)}
                disabled={resolved || answerPending || !onAnswer}
                onPress={() => onAnswer?.(entry, [option.label])}
              />
            ))}
          </View>
        </View>
      ))}
      {resolved && answers.length > 0 ? (
        <Text style={{ color: palette.foregroundMuted, fontSize: fontSize.sm }}>
          answered: {answers.join(", ")}
        </Text>
      ) : null}
    </Card>
  );
}

function SidechainCard({
  entries,
  palette,
  loadEntry,
}: {
  entries: RenderEntry[];
  palette: Palette;
  loadEntry?: EntryLoader;
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <Disclosure
      palette={palette}
      label="⚙"
      expanded={expanded}
      onToggle={() => setExpanded((value) => !value)}
      secondary={
        <>
          <Text style={{ color: expanded ? palette.foreground : palette.foregroundMuted, fontSize: fontSize.base }}>
            Subagent
          </Text>
          <Text style={{ marginLeft: spacing[2], color: palette.foregroundExtraMuted, fontSize: fontSize.sm }}>
            {entries.length} step{entries.length === 1 ? "" : "s"}
          </Text>
          <View style={{ flex: 1 }} />
        </>
      }
    >
      {entries.map((entry) => (
        <EntryView key={`${entry.index}:${entry.id}`} entry={entry} palette={palette} loadEntry={loadEntry} />
      ))}
    </Disclosure>
  );
}

export function TimelineItemView({
  item,
  palette,
  onAnswerQuestion,
  answerPending,
  loadEntry,
}: {
  item: TimelineItem;
  palette: Palette;
  onAnswerQuestion?: QuestionAnswerHandler;
  answerPending?: boolean;
  loadEntry?: EntryLoader;
}) {
  if (item.kind === "sidechain") {
    return <SidechainCard entries={item.entries} palette={palette} loadEntry={loadEntry} />;
  }
  return (
    <EntryView
      entry={item.entry}
      palette={palette}
      onAnswerQuestion={onAnswerQuestion}
      answerPending={answerPending}
      loadEntry={loadEntry}
    />
  );
}

function ImageEntry({
  entry,
  palette,
  loadEntry,
}: {
  entry: RenderEntry;
  palette: Palette;
  loadEntry?: EntryLoader;
}) {
  const listBody = entry.body as Extract<RenderBody, { kind: "image" }>;
  const [requested, setRequested] = useState(false);
  const { body, loading } = useFullBody(entry, requested, loadEntry);
  const dataUri = body.kind === "image" ? body.dataUri : null;

  if (dataUri) {
    return (
      <View
        style={{
          marginVertical: spacing[3],
          borderRadius: radius.lg,
          borderWidth: 1,
          borderColor: palette.border,
          overflow: "hidden",
        }}
      >
        <Image source={{ uri: dataUri }} style={{ width: "100%", height: 200 }} resizeMode="contain" />
      </View>
    );
  }
  if (listBody.deferred && loadEntry) {
    return (
      <Pressable
        onPress={() => setRequested(true)}
        style={{
          marginVertical: spacing[2],
          paddingHorizontal: spacing[3],
          paddingVertical: spacing[2],
          borderRadius: radius.md,
          borderWidth: 1,
          borderColor: palette.border,
          backgroundColor: palette.surface1,
          alignSelf: "flex-start",
        }}
      >
        <Text style={{ color: palette.foregroundMuted, fontSize: fontSize.base }}>
          {loading ? "Loading image…" : "Image · tap to load"}
        </Text>
      </Pressable>
    );
  }
  return (
    <Text style={{ color: palette.foregroundMuted, fontSize: fontSize.base, paddingVertical: spacing[1] }}>
      {listBody.note ?? "image"}
    </Text>
  );
}
