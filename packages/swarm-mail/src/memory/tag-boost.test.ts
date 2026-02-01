/**
 * Tag 80/20 Boost Tests
 *
 * Tests for the tag-boost module that implements weighted scoring:
 * 80% tag match + 20% semantic similarity when tags match,
 * pure semantic similarity as fallback.
 *
 * Spec: .planning/fork-plan/details/memory-enhancement-spec.md lines 104-150
 */
import { describe, expect, test } from "bun:test";
import {
  computeTagMatchRatio,
  applyTagBoost,
  reRankWithTagBoost,
  type ScoredResult,
} from "./tag-boost.js";

// =============================================================================
// computeTagMatchRatio
// =============================================================================

describe("computeTagMatchRatio", () => {
  test("full match: all query tokens found in tags", () => {
    expect(computeTagMatchRatio("oauth tokens", "oauth,tokens")).toBe(1.0);
  });

  test("partial match: some query tokens match tags", () => {
    // "oauth" matches tag "auth" (substring), "tokens" doesn't match "security"
    const ratio = computeTagMatchRatio("oauth tokens", "auth,security");
    expect(ratio).toBe(0.5);
  });

  test("no match: query tokens not in tags", () => {
    expect(computeTagMatchRatio("oauth tokens", "unrelated,stuff")).toBe(0.0);
  });

  test("empty query returns 0", () => {
    expect(computeTagMatchRatio("", "oauth,tokens")).toBe(0.0);
  });

  test("empty tags returns 0", () => {
    expect(computeTagMatchRatio("oauth tokens", "")).toBe(0.0);
  });

  test("both empty returns 0", () => {
    expect(computeTagMatchRatio("", "")).toBe(0.0);
  });

  test("case insensitive matching", () => {
    expect(computeTagMatchRatio("OAuth TOKENS", "oauth,tokens")).toBe(1.0);
  });

  test("tag substring match: query token is substring of tag", () => {
    // "auth" is substring of tag "authentication"
    const ratio = computeTagMatchRatio("auth", "authentication,security");
    expect(ratio).toBe(1.0);
  });

  test("tag substring match reverse: tag is substring of query token", () => {
    // tag "auth" is substring of query token "authentication"
    const ratio = computeTagMatchRatio("authentication", "auth,tokens");
    expect(ratio).toBe(1.0);
  });

  test("handles whitespace in tags", () => {
    expect(computeTagMatchRatio("oauth", " oauth , tokens ")).toBe(1.0);
  });

  test("handles JSON array tags format", () => {
    // Tags might come as JSON array string
    expect(computeTagMatchRatio("oauth", '["oauth","tokens"]')).toBe(1.0);
  });

  test("single token query with single tag", () => {
    expect(computeTagMatchRatio("auth", "auth")).toBe(1.0);
  });

  test("multi-word query with partial tag overlap", () => {
    // 3 query tokens, 2 match
    const ratio = computeTagMatchRatio("oauth token refresh", "oauth,tokens,security");
    expect(ratio).toBeCloseTo(0.667, 2);
  });
});

// =============================================================================
// applyTagBoost
// =============================================================================

describe("applyTagBoost", () => {
  test("default 80/20 split", () => {
    // tagRatio=1.0, semanticScore=0.5 → 0.8*1.0 + 0.2*0.5 = 0.9
    expect(applyTagBoost(0.5, 1.0)).toBeCloseTo(0.9, 5);
  });

  test("no tag match falls through to pure semantic", () => {
    // tagRatio=0.0, semanticScore=0.8 → 0.8*0.0 + 0.2*0.8 = 0.16
    // But we don't want this! When tagRatio is 0, return original semantic score
    expect(applyTagBoost(0.8, 0.0)).toBeCloseTo(0.8, 5);
  });

  test("custom boost ratio", () => {
    // boostRatio=0.6, tagRatio=1.0, semanticScore=0.5
    // → 0.6*1.0 + 0.4*0.5 = 0.8
    expect(applyTagBoost(0.5, 1.0, 0.6)).toBeCloseTo(0.8, 5);
  });

  test("both zero returns 0", () => {
    expect(applyTagBoost(0.0, 0.0)).toBe(0.0);
  });

  test("perfect semantic with partial tag boost", () => {
    // tagRatio=0.5, semanticScore=1.0 → 0.8*0.5 + 0.2*1.0 = 0.6
    expect(applyTagBoost(1.0, 0.5)).toBeCloseTo(0.6, 5);
  });
});

// =============================================================================
// reRankWithTagBoost
// =============================================================================

describe("reRankWithTagBoost", () => {
  const makeResult = (id: string, score: number, tags: string): ScoredResult => ({
    id,
    score,
    tags,
    content: `content for ${id}`,
  });

  test("re-ranks results: tagged memory beats higher-semantic untagged", () => {
    const results: ScoredResult[] = [
      makeResult("untagged", 0.90, ""),              // High semantic, no tags
      makeResult("tagged", 0.60, "oauth,tokens"),     // Lower semantic, matching tags
    ];

    // tagged: 0.8*1.0 + 0.2*0.6 = 0.92
    // untagged: stays at 0.90 (no tag match)
    const reRanked = reRankWithTagBoost(results, "oauth tokens");
    expect(reRanked[0].id).toBe("tagged");
    expect(reRanked[1].id).toBe("untagged");
  });

  test("no query text: returns original order", () => {
    const results: ScoredResult[] = [
      makeResult("a", 0.95, "oauth,tokens"),
      makeResult("b", 0.60, "auth"),
    ];

    const reRanked = reRankWithTagBoost(results, "");
    expect(reRanked[0].id).toBe("a");
    expect(reRanked[1].id).toBe("b");
  });

  test("no tags on any result: returns original ranking by semantic score", () => {
    const results: ScoredResult[] = [
      makeResult("a", 0.95, ""),
      makeResult("b", 0.60, ""),
    ];

    const reRanked = reRankWithTagBoost(results, "oauth tokens");
    expect(reRanked[0].id).toBe("a");
    expect(reRanked[1].id).toBe("b");
  });

  test("empty results returns empty", () => {
    expect(reRankWithTagBoost([], "query")).toEqual([]);
  });

  test("preserves boosted scores in output", () => {
    const results: ScoredResult[] = [
      makeResult("tagged", 0.60, "oauth,tokens"),
    ];

    const reRanked = reRankWithTagBoost(results, "oauth tokens");
    // tagRatio=1.0, so boosted = 0.8*1.0 + 0.2*0.6 = 0.92
    expect(reRanked[0].score).toBeCloseTo(0.92, 2);
  });

  test("custom boost ratio", () => {
    const results: ScoredResult[] = [
      makeResult("tagged", 0.60, "oauth,tokens"),
    ];

    const reRanked = reRankWithTagBoost(results, "oauth tokens", 0.5);
    // tagRatio=1.0, boostRatio=0.5: 0.5*1.0 + 0.5*0.6 = 0.8
    expect(reRanked[0].score).toBeCloseTo(0.8, 2);
  });
});
