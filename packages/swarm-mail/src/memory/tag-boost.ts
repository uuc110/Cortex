export interface ScoredResult {
  readonly id: string;
  readonly score: number;
  readonly tags: string;
  readonly content: string;
}

const DEFAULT_BOOST_RATIO = 0.8;

function parseTags(tags: string): string[] {
  if (!tags || tags.trim().length === 0) return [];

  const trimmed = tags.trim();
  if (trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return parsed
          .map((t: unknown) => String(t).trim().toLowerCase())
          .filter((t) => t.length > 0);
      }
    } catch {
      // Fall through to comma-separated parsing
    }
  }

  return trimmed
    .split(",")
    .map((t) => t.trim().toLowerCase())
    .filter((t) => t.length > 0);
}

export function computeTagMatchRatio(
  queryText: string,
  tags: string,
): number {
  const queryTokens = queryText
    .toLowerCase()
    .split(/[\s,]+/)
    .filter((t) => t.length > 0);
  if (queryTokens.length === 0) return 0;

  const tagList = parseTags(tags);
  if (tagList.length === 0) return 0;

  let matches = 0;
  for (const qt of queryTokens) {
    if (tagList.some((tag) => tag.includes(qt) || qt.includes(tag))) {
      matches++;
    }
  }

  return matches / queryTokens.length;
}

export function applyTagBoost(
  semanticScore: number,
  tagRatio: number,
  boostRatio: number = DEFAULT_BOOST_RATIO,
): number {
  if (tagRatio === 0) return semanticScore;
  return boostRatio * tagRatio + (1 - boostRatio) * semanticScore;
}

export function reRankWithTagBoost(
  results: ScoredResult[],
  queryText: string,
  boostRatio: number = DEFAULT_BOOST_RATIO,
): ScoredResult[] {
  if (results.length === 0 || !queryText || queryText.trim().length === 0) {
    return results;
  }

  const boosted = results.map((r) => {
    const tagRatio = computeTagMatchRatio(queryText, r.tags);
    const newScore = applyTagBoost(r.score, tagRatio, boostRatio);
    return { ...r, score: newScore };
  });

  return boosted.sort((a, b) => b.score - a.score);
}
