import { useRpc } from "@getpaseo/plugin";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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

/** Paseo's own numbers: the same wait before searching, the same page, the same freshness. */
const QUERY_DEBOUNCE_MS = 180;
const QUERY_STALE_MS = 15_000;
const COMMAND_STALE_MS = 60_000;
const SUGGESTION_LIMIT = 50;

const SEARCHING_WORKSPACE = "Searching workspace...";
const LOADING_COMMANDS = "Loading commands...";
const NO_FILES = "No files or directories found";
const NO_COMMANDS = "No commands found";
const FAILED_TO_LOAD = "Failed to load";

type SlashCommand = { name: string; description: string; source: string; kind: string };

export type ComposerAutocomplete = {
  visible: boolean;
  options: AutocompleteOption[];
  selectedIndex: number;
  loading: boolean;
  errorMessage: string | null;
  loadingText: string;
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

function messageOf(error: unknown): string | null {
  if (error === null || error === undefined) return null;
  return error instanceof Error ? error.message : FAILED_TO_LOAD;
}

/**
 * The composer's `@` and `/` menus, following paseo's own agent autocomplete.
 * Both are derived from where the caret sits rather than from a mode the user has to leave, and a
 * file mention wins when both could match, because it is the one nearer the caret.
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
  const query = active?.query ?? "";

  // Escape hides the menu for as long as the caret stays in the same @ or /, and no longer.
  useEffect(() => {
    if (key === null) setDismissed(null);
  }, [key]);

  const fileQuery = useDebounced(mention?.query ?? "", QUERY_DEBOUNCE_MS);
  const open = active !== null && workspaceDir !== null && dismissed !== key;

  const filesQuery = useQuery({
    queryKey: ["claude-code-files", workspaceDir, fileQuery],
    enabled: open && mode === "file",
    staleTime: QUERY_STALE_MS,
    retry: false,
    placeholderData: keepPreviousData,
    queryFn: () => suggestFiles({ workspaceDir: workspaceDir!, query: fileQuery, limit: SUGGESTION_LIMIT }),
  });

  // Every skill and command on disk is one list, filtered here, so typing costs nothing.
  const commandsQuery = useQuery({
    queryKey: ["claude-code-commands", workspaceDir],
    enabled: open && mode === "command",
    staleTime: COMMAND_STALE_MS,
    retry: false,
    queryFn: () => listCommands({ workspaceDir: workspaceDir! }),
  });

  const commandsLoading = mode === "command" && commandsQuery.isPending;
  // Nothing is shown until the command list has arrived: an empty menu that fills in a moment later
  // reads as "there are none".
  const visible = open && !commandsLoading;

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
      rankCommands(available, query)
        .slice(0, SUGGESTION_LIMIT)
        .map((entry) => ({
          id: entry.name,
          label: `/${entry.name}`,
          description: entry.description,
          kind: "command" as const,
        })),
    );
  }, [visible, mode, filesQuery.data, commandsQuery.data, query, commandPosition]);

  // Narrowing the list moves the selection back to the row Enter would take, which is the one
  // nearest the input; walking the list with the arrows is what keeps it somewhere else.
  const previousQuery = useRef(query);
  useEffect(() => {
    const changed = previousQuery.current !== query;
    previousQuery.current = query;
    if (!visible) {
      setSelectedIndex(-1);
      return;
    }
    setSelectedIndex((current) => {
      if (options.length === 0) return -1;
      if (changed || current < 0 || current >= options.length) return fallbackIndex(options.length);
      return current;
    });
  }, [visible, options.length, query]);

  const select = useCallback(
    (option: AutocompleteOption) => {
      if (option.kind === "command") {
        if (!command) return;
        setText(applySlashCommand({ text, command, name: option.id }));
      } else {
        if (!mention) return;
        setText(applyFileMention({ text, mention, path: option.label }));
      }
      setSelectedIndex(-1);
    },
    [command, mention, setText, text],
  );

  const handleKey = useCallback(
    (pressed: string): boolean => {
      if (!visible || key === null) return false;
      if (pressed === "Escape") {
        // A command typed from the first column is the whole prompt, so clearing it is the way out.
        if (commandPosition === "start") setText("");
        else setDismissed(key);
        return true;
      }
      if (options.length === 0) return false;
      if (pressed === "ArrowUp" || pressed === "ArrowDown") {
        setSelectedIndex((current) =>
          nextIndex({
            currentIndex: current >= 0 && current < options.length ? current : fallbackIndex(options.length),
            count: options.length,
            key: pressed,
          }),
        );
        return true;
      }
      if (pressed === "Enter" || pressed === "Tab") {
        const resolved =
          selectedIndex >= 0 && selectedIndex < options.length ? selectedIndex : fallbackIndex(options.length);
        const option = options[resolved];
        if (option) select(option);
        return true;
      }
      return false;
    },
    [visible, key, commandPosition, options, selectedIndex, select, setText],
  );

  return {
    visible,
    options,
    selectedIndex,
    loading:
      mode === "file"
        ? filesQuery.isPending || (filesQuery.isLoading && options.length === 0)
        : commandsLoading,
    errorMessage: mode === "file" ? messageOf(filesQuery.error) : messageOf(commandsQuery.error),
    loadingText: mode === "file" ? SEARCHING_WORKSPACE : LOADING_COMMANDS,
    emptyText: mode === "file" ? NO_FILES : NO_COMMANDS,
    select,
    handleKey,
  };
}
