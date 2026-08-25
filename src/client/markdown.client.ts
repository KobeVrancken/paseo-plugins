export type Inline =
  | { kind: "text"; text: string; bold?: boolean; italic?: boolean; code?: boolean }
  | { kind: "link"; text: string; href: string };

export type Block =
  | { kind: "heading"; level: number; inline: Inline[] }
  | { kind: "paragraph"; inline: Inline[] }
  | { kind: "code"; text: string; language: string | null }
  | { kind: "list"; ordered: boolean; items: { inline: Inline[]; depth: number; marker: string }[] }
  | { kind: "quote"; blocks: Block[] }
  | { kind: "table"; rows: string[][] }
  | { kind: "rule" };

const HEADING = /^(#{1,6})\s+(.*)$/;
const FENCE = /^\s*```\s*([\w+-]*)\s*$/;
const BULLET = /^(\s*)([-*+])\s+(.*)$/;
const ORDERED = /^(\s*)(\d+)[.)]\s+(.*)$/;
const QUOTE = /^\s{0,3}>\s?(.*)$/;
const RULE = /^\s{0,3}(?:[-*_]\s*){3,}$/;
const TABLE_ROW = /^\s*\|.*\|\s*$/;
const TABLE_DIVIDER = /^\s*\|[\s:|-]+\|\s*$/;

/**
 * Inline markdown: code spans win over emphasis, and emphasis does not nest.
 * Deliberately short of CommonMark — it only has to make assistant messages readable.
 */
export function parseInline(text: string): Inline[] {
  const parts: Inline[] = [];
  let buffer = "";
  let index = 0;

  const flush = () => {
    if (buffer !== "") parts.push({ kind: "text", text: buffer });
    buffer = "";
  };

  while (index < text.length) {
    const rest = text.slice(index);

    const code = /^`([^`]+)`/.exec(rest);
    if (code) {
      flush();
      parts.push({ kind: "text", text: code[1]!, code: true });
      index += code[0].length;
      continue;
    }

    const link = /^\[([^\]]*)\]\(([^)\s]+)[^)]*\)/.exec(rest);
    if (link) {
      flush();
      parts.push({ kind: "link", text: link[1] || link[2]!, href: link[2]! });
      index += link[0].length;
      continue;
    }

    const bold = /^(\*\*|__)(.+?)\1/.exec(rest);
    if (bold) {
      flush();
      parts.push({ kind: "text", text: bold[2]!, bold: true });
      index += bold[0].length;
      continue;
    }

    const italic = /^(\*|_)([^*_]+?)\1/.exec(rest);
    if (italic) {
      flush();
      parts.push({ kind: "text", text: italic[2]!, italic: true });
      index += italic[0].length;
      continue;
    }

    buffer += text[index];
    index += 1;
  }
  flush();
  return parts;
}

function listDepth(indent: string): number {
  return Math.floor(indent.replace(/\t/g, "  ").length / 2);
}

export function parseMarkdown(source: string): Block[] {
  const lines = source.split("\n");
  const blocks: Block[] = [];
  let paragraph: string[] = [];

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    blocks.push({ kind: "paragraph", inline: parseInline(paragraph.join("\n").trim()) });
    paragraph = [];
  };

  let index = 0;
  while (index < lines.length) {
    const line = lines[index]!;

    const fence = FENCE.exec(line);
    if (fence) {
      flushParagraph();
      const body: string[] = [];
      index += 1;
      while (index < lines.length && !FENCE.test(lines[index]!)) {
        body.push(lines[index]!);
        index += 1;
      }
      index += 1;
      blocks.push({ kind: "code", text: body.join("\n"), language: fence[1] || null });
      continue;
    }

    if (line.trim() === "") {
      flushParagraph();
      index += 1;
      continue;
    }

    if (RULE.test(line)) {
      flushParagraph();
      blocks.push({ kind: "rule" });
      index += 1;
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      flushParagraph();
      blocks.push({ kind: "heading", level: heading[1]!.length, inline: parseInline(heading[2]!) });
      index += 1;
      continue;
    }

    if (QUOTE.test(line)) {
      flushParagraph();
      const quoted: string[] = [];
      while (index < lines.length && QUOTE.test(lines[index]!)) {
        quoted.push(QUOTE.exec(lines[index]!)![1]!);
        index += 1;
      }
      blocks.push({ kind: "quote", blocks: parseMarkdown(quoted.join("\n")) });
      continue;
    }

    if (TABLE_ROW.test(line)) {
      flushParagraph();
      const rows: string[][] = [];
      while (index < lines.length && TABLE_ROW.test(lines[index]!)) {
        const current = lines[index]!;
        index += 1;
        if (TABLE_DIVIDER.test(current)) continue;
        rows.push(
          current
            .trim()
            .replace(/^\|/, "")
            .replace(/\|$/, "")
            .split("|")
            .map((cell) => cell.trim()),
        );
      }
      blocks.push({ kind: "table", rows });
      continue;
    }

    const bullet = BULLET.exec(line);
    const ordered = ORDERED.exec(line);
    if (bullet || ordered) {
      flushParagraph();
      const isOrdered = ordered !== null && bullet === null;
      const items: { inline: Inline[]; depth: number; marker: string }[] = [];
      while (index < lines.length) {
        const currentBullet = BULLET.exec(lines[index]!);
        const currentOrdered = ORDERED.exec(lines[index]!);
        const match = currentBullet ?? currentOrdered;
        if (!match) break;
        items.push({
          depth: listDepth(match[1]!),
          marker: currentOrdered && !currentBullet ? `${currentOrdered[2]}.` : "•",
          inline: parseInline(match[3]!),
        });
        index += 1;
      }
      blocks.push({ kind: "list", ordered: isOrdered, items });
      continue;
    }

    paragraph.push(line);
    index += 1;
  }
  flushParagraph();
  return blocks;
}
