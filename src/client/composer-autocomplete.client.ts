import { useRpc } from "@getpaseo/plugin";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useCallback, useMemo, useState } from "react";
import * as contracts from "../contracts.shared.ts";
import { applyFileMention, fallbackIndex, findActiveFileMention, nextIndex, orderOptions } from "./autocomplete.client.ts";
import type { AutocompleteOption } from "./autocomplete-view.client.tsx";
import { useDebounced } from "./ui.client.tsx";

const QUERY_DEBOUNCE_MS = 120;
const QUERY_STALE_MS = 15_000;
const SUGGESTION_LIMIT = 30;

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

/**
 * The composer's `@` menu.
 * It reads the same text the prompt box holds, so the menu is derived from the caret rather than
 * from a mode the user has to leave.
 */
export function useComposerAutocomplete(input: {
  workspaceDir: string | null;
  text: string;
  cursorIndex: number;
  setText: (next: string) => void;
}): ComposerAutocomplete {
  const { workspaceDir, text, cursorIndex, setText } = input;
  const suggestFiles = useRpc(contracts.suggestFiles);
  const [dismissedAt, setDismissedAt] = useState<number | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(-1);

  const mention = useMemo(
    () => findActiveFileMention({ text, cursorIndex }),
    [text, cursorIndex],
  );
  const visible = mention !== null && workspaceDir !== null && dismissedAt !== mention.start;
  const query = useDebounced(mention?.query ?? "", QUERY_DEBOUNCE_MS);

  const filesQuery = useQuery({
    queryKey: ["claude-code-files", workspaceDir, query],
    enabled: visible,
    staleTime: QUERY_STALE_MS,
    placeholderData: keepPreviousData,
    queryFn: () => suggestFiles({ workspaceDir: workspaceDir!, query, limit: SUGGESTION_LIMIT }),
  });

  const options = useMemo<AutocompleteOption[]>(
    () =>
      visible
        ? orderOptions(
            (filesQuery.data?.entries ?? []).map((entry) => ({
              id: `${entry.kind}:${entry.path}`,
              label: entry.path,
              kind: entry.kind,
            })),
          )
        : [],
    [visible, filesQuery.data],
  );

  // The list is rebuilt on every keystroke, so the row Enter would take is pinned to its end
  // rather than to whatever happened to sit at the old index.
  const resolvedIndex =
    selectedIndex >= 0 && selectedIndex < options.length ? selectedIndex : fallbackIndex(options.length);

  const select = useCallback(
    (option: AutocompleteOption) => {
      if (!mention || option.kind === "command") return;
      setText(applyFileMention({ text, mention, path: option.label, kind: option.kind }));
      setSelectedIndex(-1);
    },
    [mention, setText, text],
  );

  const handleKey = useCallback(
    (key: string): boolean => {
      if (!visible || mention === null) return false;
      if (key === "Escape") {
        setDismissedAt(mention.start);
        return true;
      }
      if (options.length === 0) return false;
      if (key === "ArrowUp" || key === "ArrowDown") {
        setSelectedIndex(nextIndex({ currentIndex: resolvedIndex, count: options.length, key }));
        return true;
      }
      if (key === "Enter" || key === "Tab") {
        const option = options[resolvedIndex];
        if (option) select(option);
        return true;
      }
      return false;
    },
    [visible, mention, options, resolvedIndex, select],
  );

  return {
    visible,
    options,
    selectedIndex: resolvedIndex,
    loading: filesQuery.isFetching,
    emptyText: "No files match.",
    select,
    handleKey,
  };
}
