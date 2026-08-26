/**
 * Ranked text matching, mirroring how paseo's own pickers narrow a list.
 * A match is a tier plus the offset it was found at, and lower is better on both, so callers sort
 * ascending and never have to invent a scale.
 */
export type MatchScore = { tier: number; offset: number; spread: number };

const TIER_EXACT = 0;
const TIER_WHOLE_WORD = 1;
const TIER_PREFIX = 2;
const TIER_WORD_START = 3;
const TIER_SUBSTRING = 4;
const TIER_SUBSEQUENCE = 5;

function isWordBoundary(character: string | undefined): boolean {
  return character === undefined || !/[a-z0-9]/.test(character);
}

function scoreSubstring(query: string, text: string): MatchScore | null {
  let best: MatchScore | null = null;
  for (let from = 0; from <= text.length - query.length; from += 1) {
    const found = text.indexOf(query, from);
    if (found === -1) break;
    const startsAtBoundary = found === 0 || isWordBoundary(text[found - 1]);
    const endsAtBoundary = isWordBoundary(text[found + query.length]);
    const tier =
      startsAtBoundary && endsAtBoundary
        ? TIER_WHOLE_WORD
        : found === 0
          ? TIER_PREFIX
          : startsAtBoundary
            ? TIER_WORD_START
            : TIER_SUBSTRING;
    if (!best || tier < best.tier || (tier === best.tier && found < best.offset)) {
      best = { tier, offset: found, spread: query.length };
    }
    from = found;
  }
  return best;
}

/** Characters in order but not adjacent, so "pasbab" still finds "paseo-babysit". */
function scoreSubsequence(query: string, text: string): MatchScore | null {
  let queryIndex = 0;
  let first = -1;
  let last = -1;
  for (let index = 0; index < text.length && queryIndex < query.length; index += 1) {
    if (text[index] !== query[queryIndex]) continue;
    if (first === -1) first = index;
    last = index;
    queryIndex += 1;
  }
  if (queryIndex !== query.length || first === -1) return null;
  return { tier: TIER_SUBSEQUENCE, offset: first, spread: last - first + 1 };
}

export function scoreMatch(query: string, text: string): MatchScore | null {
  if (query === "") return { tier: TIER_EXACT, offset: 0, spread: 0 };
  const needle = query.toLowerCase();
  const haystack = text.toLowerCase();
  if (needle === haystack) return { tier: TIER_EXACT, offset: 0, spread: 0 };
  return scoreSubstring(needle, haystack) ?? scoreSubsequence(needle, haystack);
}

/** Every word of the query has to land somewhere, but not all in the same field. */
export function scoreFields(query: string, fields: string[]): MatchScore | null {
  const tokens = query.trim().toLowerCase().split(/\s+/).filter((token) => token !== "");
  if (tokens.length === 0) return { tier: TIER_EXACT, offset: 0, spread: 0 };

  const total: MatchScore = { tier: TIER_EXACT, offset: 0, spread: 0 };
  for (const token of tokens) {
    let best: MatchScore | null = null;
    for (const field of fields) {
      const score = scoreMatch(token, field);
      if (score && (!best || compareMatchScores(score, best) < 0)) best = score;
    }
    if (!best) return null;
    total.tier += best.tier;
    total.offset += best.offset;
    total.spread += best.spread;
  }
  return total;
}

export function compareMatchScores(left: MatchScore, right: MatchScore): number {
  if (left.tier !== right.tier) return left.tier - right.tier;
  if (left.offset !== right.offset) return left.offset - right.offset;
  return left.spread - right.spread;
}
