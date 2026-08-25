import { useRpc } from "@getpaseo/plugin";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useCallback, useMemo, useState } from "react";
import * as contracts from "../contracts.shared.ts";
import { compareMatchScores, scoreFields } from "../text-match.shared.ts";
import {
  applyFileMention,
  applySlashCommand,
  fallbackIndex,
  findActiveFileMention,
  findActiveSlashCommand,
  nextIndex,
  orderOptions,
  type Range,
} from "./autocomplete.client.ts";
import type { AutocompleteOption } from "./autocomplete-view.client.tsx";
import { useDebounced } from "./ui.client.tsx";

const QUERY_DEBOUNCE_MS = 120;
const QUERY_STALE_MS = 15_000;
const COMMAND_STALE_MS = 60_000;
const SUGGESTION_LIMIT = 30;

type SlashCommand = { name: string; description: string; source: string; kind: string };

export type ComposerAutocomplete = {
  visible: boolean;
  options: AutocompleteOption[];
  selectedIndex: number;
  loading: boolean;
  emptyText: string;
  select: (option: AutocompleteOption) => void;
  /** True when the key belonged to the menu, so the composer leaves it alone. */
  handleKey: (key: string) => boolean;
};

function rankCommands(commands: SlashCommand[], query: string): SlashCommand[] {
  const scored = commands.flatMap((command) => {
    const score = scoreFields(query, [command.name, command.description]);
    return score ? [{ command, score }] : [];
  });
  scored.sort((left, right) => {
    const order = compareMatchScores(left.score, right.score);
    return order !== 0 ? order : left.command.name.localeCompare(right.command.name);
  });
  return scored.map((entry) => entry.command);
}

/**
 * The composer's `@` and `/` menus.
 * Both are derived from where the caret sits rather than from a mode the user has to leave, and a
 * file mention wins when somehow both are open, because it is the one nearer the caret.
 */
export function useComposerAutocomplete(input: {
  workspaceDir: string | null;
  text: string;
  cursorIndex: number;
  setText: (next: string) => void;
}): ComposerAutocomplete {
  const { workspaceDir, text, cursorIndex, setText } = input;
  const suggestFiles = useRpc(contracts.suggestFiles);
  const listCommands = useRpc(contracts.listCommands);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(-1);

  const mention = useMemo(() => findActiveFileMention({ text, cursorIndex }), [text, cursorIndex]);
  const command = useMemo(
    () => (mention ? null : findActiveSlashCommand({ text, cursorIndex })),
    [mention, text, cursorIndex],
  );
  const commandPosition = command?.position ?? null;
  const active: Range | null = mention ?? command;
  const mode = mention ? "file" : command ? "command" : null;
  const key = active === null ? null : `${mode}:${active.start}`;
  const visible = active !== null && workspaceDir !== null && dismissed !== key;

  const fileQuery = useDebounced(mention?.query ?? "", QUERY_DEBOUNCE_MS);
  const filesQuery = useQuery({
    queryKey: ["claude-code-files", workspaceDir, fileQuery],
    enabled: visible && mode === "file",
    staleTime: QUERY_STALE_MS,
    placeholderData: keepPreviousData,
    queryFn: () => suggestFiles({ workspaceDir: workspaceDir!, query: fileQuery, limit: SUGGESTION_LIMIT }),
  });

  // Every skill and command on disk is one list, filtered here, so typing costs nothing.
  const commandsQuery = useQuery({
    queryKey: ["claude-code-commands", workspaceDir],
    enabled: visible && mode === "command",
    staleTime: COMMAND_STALE_MS,
    queryFn: () => listCommands({ workspaceDir: workspaceDir! }),
  });

  const options = useMemo<AutocompleteOption[]>(() => {
    if (!visible) return [];
    if (mode === "file") {
      return orderOptions(
        (filesQuery.data?.entries ?? []).map((entry) => ({
          id: `${entry.kind}:${entry.path}`,
          label: entry.path,
          kind: entry.kind,
        })),
      );
    }
    // A slash mid-prompt can only mean a skill: the CLI runs a command only from the first column.
    const available = (commandsQuery.data?.commands ?? []).filter(
      (entry) => commandPosition === "start" || entry.kind === "skill",
    );
    return orderOptions(
      rankCommands(available, command?.query ?? "")
        .slice(0, SUGGESTION_LIMIT)
        .map((entry) => ({
          id: entry.name,
          label: `/${entry.name}`,
          description: entry.description,
          kind: "command" as const,
        })),
    );
  }, [visible, mode, filesQuery.data, commandsQuery.data, command?.query, commandPosition]);

  // The list is rebuilt on every keystroke, so the row Enter would take is pinned to its end
  // rather than to whatever happened to sit at the old index.
  const resolvedIndex =
    selectedIndex >= 0 && selectedIndex < options.length ? selectedIndex : fallbackIndex(options.length);

  const select = useCallback(
    (option: AutocompleteOption) => {
      if (option.kind === "command") {
        if (!command) return;
        setText(applySlashCommand({ text, command, name: option.id }));
      } else {
        if (!mention) return;
        setText(applyFileMention({ text, mention, path: option.label, kind: option.kind }));
      }
      setSelectedIndex(-1);
    },
    [command, mention, setText, text],
  );

  const handleKey = useCallback(
    (pressed: string): boolean => {
      if (!visible || key === null) return false;
      if (pressed === "Escape") {
        setDismissed(key);
        return true;
      }
      if (options.length === 0) return false;
      if (pressed === "ArrowUp" || pressed === "ArrowDown") {
        setSelectedIndex(nextIndex({ currentIndex: resolvedIndex, count: options.length, key: pressed }));
        return true;
      }
      if (pressed === "Enter" || pressed === "Tab") {
        const option = options[resolvedIndex];
        if (option) select(option);
        return true;
      }
      return false;
    },
    [visible, key, options, resolvedIndex, select],
  );

  return {
    visible,
    options,
    selectedIndex: resolvedIndex,
    loading: mode === "file" ? filesQuery.isFetching : commandsQuery.isFetching,
    emptyText: mode === "file" ? "No files match." : "No skills or commands match.",
    select,
    handleKey,
  };
}
