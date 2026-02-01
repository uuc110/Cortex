/**
 * Tests for bead-cache.ts — In-memory cache with tiered TTLs and LRU eviction.
 *
 * TDD RED phase: These tests define the full contract BEFORE implementation.
 * Cross-references:
 *   - Caching Strategy: .planning/fork-plan/details/bd-cli-bridge-api.md §5
 *   - Task spec: Cache layer with tiered TTLs and LRU eviction
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import {
  BdCache,
  type BdCacheOptions,
  type CacheStats,
  type CacheTier,
  type WriteOperation,
} from "../bead-cache.js";

// ============================================================================
// Helper: sleep for async TTL tests
// ============================================================================
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// ============================================================================
// Construction & Basic API
// ============================================================================
describe("BdCache — construction", () => {
  test("creates instance with default options", () => {
    const cache = new BdCache();
    expect(cache).toBeInstanceOf(BdCache);
    expect(cache.size()).toBe(0);
  });

  test("creates instance with custom options", () => {
    const cache = new BdCache({
      maxSize: 500,
      hotTtlMs: 10_000,
      warmTtlMs: 30_000,
      coldTtlMs: 120_000,
    });
    expect(cache).toBeInstanceOf(BdCache);
  });

  test("creates instance with enabled=false (disabled mode)", () => {
    const cache = new BdCache({ enabled: false });
    expect(cache).toBeInstanceOf(BdCache);
  });
});

// ============================================================================
// get / set / has / delete — Core CRUD
// ============================================================================
describe("BdCache — core CRUD", () => {
  let cache: BdCache;

  beforeEach(() => {
    cache = new BdCache({ maxSize: 100 });
  });

  test("set and get a value", () => {
    cache.set("list:all", [{ id: "1" }], "hot");
    const result = cache.get<Array<{ id: string }>>("list:all");
    expect(result).toEqual([{ id: "1" }]);
  });

  test("get returns undefined for missing key", () => {
    const result = cache.get("nonexistent");
    expect(result).toBeUndefined();
  });

  test("has returns true for existing key", () => {
    cache.set("show:abc", { title: "test" }, "warm");
    expect(cache.has("show:abc")).toBe(true);
  });

  test("has returns false for missing key", () => {
    expect(cache.has("missing")).toBe(false);
  });

  test("delete removes a key and returns true", () => {
    cache.set("show:abc", { title: "test" }, "warm");
    const result = cache.delete("show:abc");
    expect(result).toBe(true);
    expect(cache.has("show:abc")).toBe(false);
  });

  test("delete returns false for missing key", () => {
    const result = cache.delete("nonexistent");
    expect(result).toBe(false);
  });

  test("set overwrites existing value", () => {
    cache.set("show:abc", { title: "old" }, "warm");
    cache.set("show:abc", { title: "new" }, "warm");
    expect(cache.get<{ title: string }>("show:abc")?.title).toBe("new");
  });

  test("size reflects number of entries", () => {
    cache.set("a", 1, "hot");
    cache.set("b", 2, "warm");
    cache.set("c", 3, "cold");
    expect(cache.size()).toBe(3);
  });

  test("clear removes all entries", () => {
    cache.set("a", 1, "hot");
    cache.set("b", 2, "warm");
    cache.clear();
    expect(cache.size()).toBe(0);
    expect(cache.get("a")).toBeUndefined();
  });
});

// ============================================================================
// TTL Expiration — Tiered
// ============================================================================
describe("BdCache — TTL expiration", () => {
  test("hot tier expires after hotTtlMs", async () => {
    const cache = new BdCache({ hotTtlMs: 50 });
    cache.set("list:all", [1, 2, 3], "hot");
    expect(cache.get("list:all")).toEqual([1, 2, 3]);

    await sleep(70);
    expect(cache.get("list:all")).toBeUndefined();
  });

  test("warm tier expires after warmTtlMs", async () => {
    const cache = new BdCache({ warmTtlMs: 50 });
    cache.set("show:abc", { id: "abc" }, "warm");
    expect(cache.get("show:abc")).toBeDefined();

    await sleep(70);
    expect(cache.get("show:abc")).toBeUndefined();
  });

  test("cold tier expires after coldTtlMs", async () => {
    const cache = new BdCache({ coldTtlMs: 50 });
    cache.set("version:all", "1.0.0", "cold");
    expect(cache.get("version:all")).toBe("1.0.0");

    await sleep(70);
    expect(cache.get("version:all")).toBeUndefined();
  });

  test("expired entries are not counted in size", async () => {
    const cache = new BdCache({ hotTtlMs: 50 });
    cache.set("a", 1, "hot");
    cache.set("b", 2, "hot");
    expect(cache.size()).toBe(2);

    await sleep(70);
    // After TTL, attempting to get triggers cleanup
    cache.get("a");
    cache.get("b");
    expect(cache.size()).toBe(0);
  });

  test("has returns false for expired entries", async () => {
    const cache = new BdCache({ hotTtlMs: 50 });
    cache.set("list:all", [1], "hot");
    expect(cache.has("list:all")).toBe(true);

    await sleep(70);
    expect(cache.has("list:all")).toBe(false);
  });

  test("default TTLs: hot=30s, warm=60s, cold=300s", () => {
    // Verify defaults are applied (we can't wait 30s in tests,
    // but we can verify the tiers resolve correctly by testing
    // that entries set with default TTLs don't expire immediately)
    const cache = new BdCache();
    cache.set("list:all", "data", "hot");
    cache.set("show:abc", "data", "warm");
    cache.set("version:v", "data", "cold");

    expect(cache.get("list:all")).toBe("data");
    expect(cache.get("show:abc")).toBe("data");
    expect(cache.get("version:v")).toBe("data");
  });
});

// ============================================================================
// LRU Eviction
// ============================================================================
describe("BdCache — LRU eviction", () => {
  test("evicts oldest entry when maxSize is reached", () => {
    const cache = new BdCache({ maxSize: 3 });
    cache.set("a", 1, "hot");
    cache.set("b", 2, "hot");
    cache.set("c", 3, "hot");

    // Cache is full. Adding d should evict "a" (least recently used)
    cache.set("d", 4, "hot");
    expect(cache.get("a")).toBeUndefined();
    expect(cache.get("b")).toBe(2);
    expect(cache.get("c")).toBe(3);
    expect(cache.get("d")).toBe(4);
    expect(cache.size()).toBe(3);
  });

  test("accessing a key refreshes its LRU position", () => {
    const cache = new BdCache({ maxSize: 3 });
    cache.set("a", 1, "hot");
    cache.set("b", 2, "hot");
    cache.set("c", 3, "hot");

    // Access "a" to make it recently used
    cache.get("a");

    // Adding "d" should evict "b" (now least recently used)
    cache.set("d", 4, "hot");
    expect(cache.get("a")).toBe(1);
    expect(cache.get("b")).toBeUndefined();
    expect(cache.get("c")).toBe(3);
    expect(cache.get("d")).toBe(4);
  });

  test("setting existing key refreshes LRU position", () => {
    const cache = new BdCache({ maxSize: 3 });
    cache.set("a", 1, "hot");
    cache.set("b", 2, "hot");
    cache.set("c", 3, "hot");

    // Overwrite "a" to refresh its position
    cache.set("a", 10, "hot");

    // Adding "d" should evict "b" (now least recently used)
    cache.set("d", 4, "hot");
    expect(cache.get("a")).toBe(10);
    expect(cache.get("b")).toBeUndefined();
  });

  test("eviction tracks stats", () => {
    const cache = new BdCache({ maxSize: 2 });
    cache.set("a", 1, "hot");
    cache.set("b", 2, "hot");
    cache.set("c", 3, "hot"); // evicts "a"
    cache.set("d", 4, "hot"); // evicts "b"

    const stats = cache.stats();
    expect(stats.evictions).toBe(2);
  });

  test("maxSize defaults to 1000", () => {
    const cache = new BdCache();
    const stats = cache.stats();
    expect(stats.maxSize).toBe(1000);
  });
});

// ============================================================================
// invalidate / invalidatePattern — Cache Invalidation
// ============================================================================
describe("BdCache — invalidation", () => {
  let cache: BdCache;

  beforeEach(() => {
    cache = new BdCache({ maxSize: 100 });
    cache.set("list:all", [1, 2], "hot");
    cache.set("list:parent:abc", [3], "hot");
    cache.set("show:abc", { id: "abc" }, "warm");
    cache.set("show:def", { id: "def" }, "warm");
    cache.set("ready:all", [1], "hot");
    cache.set("stats:proj", { total: 5 }, "cold");
    cache.set("deps:abc", [{ from: "a", to: "b" }], "warm");
    cache.set("deps:def", [{ from: "c", to: "d" }], "warm");
    cache.set("tree:abc", { nodes: [] }, "warm");
    cache.set("labels:abc", ["urgent"], "warm");
    cache.set("comments:abc", [{ text: "hello" }], "warm");
    cache.set("molecules", [{ name: "auth" }], "cold");
    cache.set("molecule:auth", { name: "auth" }, "cold");
  });

  test("invalidate removes a specific key", () => {
    cache.invalidate("show:abc");
    expect(cache.get("show:abc")).toBeUndefined();
    expect(cache.get("show:def")).toBeDefined(); // others untouched
  });

  test("invalidatePattern with 'list:*' removes all list entries", () => {
    cache.invalidatePattern("list:*");
    expect(cache.get("list:all")).toBeUndefined();
    expect(cache.get("list:parent:abc")).toBeUndefined();
    expect(cache.get("show:abc")).toBeDefined(); // other keys untouched
  });

  test("invalidatePattern with 'show:bead-*' removes matching keys", () => {
    cache.set("show:bead-123", { id: "bead-123" }, "warm");
    cache.set("show:bead-456", { id: "bead-456" }, "warm");
    cache.invalidatePattern("show:bead-*");
    expect(cache.get("show:bead-123")).toBeUndefined();
    expect(cache.get("show:bead-456")).toBeUndefined();
    expect(cache.get("show:abc")).toBeDefined(); // doesn't match pattern
  });

  test("invalidatePattern with 'ready:*' removes all ready entries", () => {
    cache.invalidatePattern("ready:*");
    expect(cache.get("ready:all")).toBeUndefined();
  });

  test("invalidatePattern with 'deps:*' removes all dep entries", () => {
    cache.invalidatePattern("deps:*");
    expect(cache.get("deps:abc")).toBeUndefined();
    expect(cache.get("deps:def")).toBeUndefined();
  });

  test("invalidatePattern with no matches is a no-op", () => {
    const sizeBefore = cache.size();
    cache.invalidatePattern("nonexistent:*");
    expect(cache.size()).toBe(sizeBefore);
  });

  test("invalidatePattern with exact match (no wildcard) works like invalidate", () => {
    cache.invalidatePattern("show:abc");
    expect(cache.get("show:abc")).toBeUndefined();
  });
});

// ============================================================================
// invalidateByOperation — Smart Invalidation
// ============================================================================
describe("BdCache — smart invalidation by operation", () => {
  let cache: BdCache;

  beforeEach(() => {
    cache = new BdCache({ maxSize: 100 });
    // Pre-populate with representative cache entries
    cache.set("list:all", [1, 2], "hot");
    cache.set("list:parent:abc", [3], "hot");
    cache.set("show:target-id", { id: "target-id" }, "warm");
    cache.set("ready:all", [1], "hot");
    cache.set("stats:proj", { total: 5 }, "cold");
    cache.set("deps:src-id", [{ from: "a", to: "b" }], "warm");
    cache.set("deps:tgt-id", [{ from: "c", to: "d" }], "warm");
    cache.set("tree:src-id", { nodes: [] }, "warm");
    cache.set("labels:target-id", ["urgent"], "warm");
    cache.set("comments:target-id", [{ text: "hello" }], "warm");
    cache.set("molecules", [{ name: "auth" }], "cold");
    cache.set("molecule:auth", { name: "auth", members: [] }, "cold");
  });

  test("create → invalidates list:*, stats, ready:*", () => {
    cache.invalidateByOperation("create");
    expect(cache.get("list:all")).toBeUndefined();
    expect(cache.get("list:parent:abc")).toBeUndefined();
    expect(cache.get("stats:proj")).toBeUndefined();
    expect(cache.get("ready:all")).toBeUndefined();
    // These should remain
    expect(cache.get("show:target-id")).toBeDefined();
    expect(cache.get("deps:src-id")).toBeDefined();
  });

  test("update → invalidates show:{id}, list:*, ready:*", () => {
    cache.invalidateByOperation("update", { id: "target-id" });
    expect(cache.get("show:target-id")).toBeUndefined();
    expect(cache.get("list:all")).toBeUndefined();
    expect(cache.get("ready:all")).toBeUndefined();
    // These should remain
    expect(cache.get("stats:proj")).toBeDefined();
  });

  test("close → invalidates show:{id}, list:*, stats, ready:*", () => {
    cache.invalidateByOperation("close", { id: "target-id" });
    expect(cache.get("show:target-id")).toBeUndefined();
    expect(cache.get("list:all")).toBeUndefined();
    expect(cache.get("stats:proj")).toBeUndefined();
    expect(cache.get("ready:all")).toBeUndefined();
  });

  test("depAdd → invalidates deps:{src}, deps:{tgt}, tree:*, ready:*", () => {
    cache.invalidateByOperation("depAdd", {
      sourceId: "src-id",
      targetId: "tgt-id",
    });
    expect(cache.get("deps:src-id")).toBeUndefined();
    expect(cache.get("deps:tgt-id")).toBeUndefined();
    expect(cache.get("tree:src-id")).toBeUndefined();
    expect(cache.get("ready:all")).toBeUndefined();
    // These should remain
    expect(cache.get("show:target-id")).toBeDefined();
  });

  test("depRemove → invalidates deps:{src}, deps:{tgt}, tree:*, ready:*", () => {
    cache.invalidateByOperation("depRemove", {
      sourceId: "src-id",
      targetId: "tgt-id",
    });
    expect(cache.get("deps:src-id")).toBeUndefined();
    expect(cache.get("deps:tgt-id")).toBeUndefined();
    expect(cache.get("tree:src-id")).toBeUndefined();
    expect(cache.get("ready:all")).toBeUndefined();
  });

  test("labelAdd → invalidates labels:{id}, list:*", () => {
    cache.invalidateByOperation("labelAdd", { id: "target-id" });
    expect(cache.get("labels:target-id")).toBeUndefined();
    expect(cache.get("list:all")).toBeUndefined();
    // These should remain
    expect(cache.get("show:target-id")).toBeDefined();
    expect(cache.get("stats:proj")).toBeDefined();
  });

  test("labelRemove → invalidates labels:{id}, list:*", () => {
    cache.invalidateByOperation("labelRemove", { id: "target-id" });
    expect(cache.get("labels:target-id")).toBeUndefined();
    expect(cache.get("list:all")).toBeUndefined();
  });

  test("commentAdd → invalidates comments:{id}", () => {
    cache.invalidateByOperation("commentAdd", { id: "target-id" });
    expect(cache.get("comments:target-id")).toBeUndefined();
    // Everything else should remain
    expect(cache.get("list:all")).toBeDefined();
    expect(cache.get("show:target-id")).toBeDefined();
  });

  test("moleculeCreate → invalidates molecules, molecule:{id}", () => {
    cache.invalidateByOperation("moleculeCreate", { id: "auth" });
    expect(cache.get("molecules")).toBeUndefined();
    expect(cache.get("molecule:auth")).toBeUndefined();
    // Others should remain
    expect(cache.get("list:all")).toBeDefined();
  });

  test("moleculeAddMember → invalidates molecules, molecule:{id}", () => {
    cache.invalidateByOperation("moleculeAddMember", { id: "auth" });
    expect(cache.get("molecules")).toBeUndefined();
    expect(cache.get("molecule:auth")).toBeUndefined();
  });
});

// ============================================================================
// Stats Tracking
// ============================================================================
describe("BdCache — stats", () => {
  test("initial stats are all zero (except maxSize)", () => {
    const cache = new BdCache({ maxSize: 500 });
    const stats = cache.stats();
    expect(stats.hits).toBe(0);
    expect(stats.misses).toBe(0);
    expect(stats.evictions).toBe(0);
    expect(stats.size).toBe(0);
    expect(stats.maxSize).toBe(500);
    expect(stats.hitRate).toBe(0);
  });

  test("hit increments on successful get", () => {
    const cache = new BdCache();
    cache.set("a", 1, "hot");
    cache.get("a");
    cache.get("a");
    expect(cache.stats().hits).toBe(2);
  });

  test("miss increments on failed get", () => {
    const cache = new BdCache();
    cache.get("nonexistent");
    cache.get("also-missing");
    expect(cache.stats().misses).toBe(2);
  });

  test("hitRate is calculated correctly", () => {
    const cache = new BdCache();
    cache.set("a", 1, "hot");
    cache.get("a"); // hit
    cache.get("b"); // miss
    cache.get("a"); // hit
    cache.get("c"); // miss

    const stats = cache.stats();
    expect(stats.hits).toBe(2);
    expect(stats.misses).toBe(2);
    expect(stats.hitRate).toBe(0.5);
  });

  test("hitRate is 0 when no gets have been performed", () => {
    const cache = new BdCache();
    expect(cache.stats().hitRate).toBe(0);
  });

  test("size reflects current entries count", () => {
    const cache = new BdCache();
    cache.set("a", 1, "hot");
    cache.set("b", 2, "warm");
    expect(cache.stats().size).toBe(2);
    cache.delete("a");
    expect(cache.stats().size).toBe(1);
  });

  test("expired entry get counts as miss", async () => {
    const cache = new BdCache({ hotTtlMs: 50 });
    cache.set("a", 1, "hot");
    cache.get("a"); // hit

    await sleep(70);
    cache.get("a"); // miss (expired)

    const stats = cache.stats();
    expect(stats.hits).toBe(1);
    expect(stats.misses).toBe(1);
  });
});

// ============================================================================
// Disabled Mode
// ============================================================================
describe("BdCache — disabled mode", () => {
  let cache: BdCache;

  beforeEach(() => {
    cache = new BdCache({ enabled: false });
  });

  test("set is a no-op when disabled", () => {
    cache.set("a", 1, "hot");
    expect(cache.size()).toBe(0);
  });

  test("get always returns undefined when disabled", () => {
    cache.set("a", 1, "hot");
    expect(cache.get("a")).toBeUndefined();
  });

  test("has always returns false when disabled", () => {
    cache.set("a", 1, "hot");
    expect(cache.has("a")).toBe(false);
  });

  test("delete returns false when disabled", () => {
    expect(cache.delete("a")).toBe(false);
  });

  test("invalidate is a no-op when disabled", () => {
    // Should not throw
    cache.invalidate("a");
    cache.invalidatePattern("a:*");
    cache.invalidateByOperation("create");
  });

  test("stats shows zeroes when disabled", () => {
    const stats = cache.stats();
    expect(stats.hits).toBe(0);
    expect(stats.misses).toBe(0);
    expect(stats.size).toBe(0);
  });

  test("clear is a no-op when disabled", () => {
    cache.clear(); // should not throw
    expect(cache.size()).toBe(0);
  });
});

// ============================================================================
// Type Exports — Compile-time verification
// ============================================================================
describe("BdCache — type exports", () => {
  test("CacheTier accepts all three tiers", () => {
    const tiers: CacheTier[] = ["hot", "warm", "cold"];
    expect(tiers).toHaveLength(3);
  });

  test("WriteOperation accepts all valid operations", () => {
    const ops: WriteOperation[] = [
      "create",
      "update",
      "close",
      "depAdd",
      "depRemove",
      "labelAdd",
      "labelRemove",
      "commentAdd",
      "moleculeCreate",
      "moleculeAddMember",
    ];
    expect(ops).toHaveLength(10);
  });

  test("CacheStats has all required fields", () => {
    const stats: CacheStats = {
      hits: 0,
      misses: 0,
      evictions: 0,
      size: 0,
      maxSize: 1000,
      hitRate: 0,
    };
    expect(stats.hits).toBe(0);
    expect(stats.misses).toBe(0);
    expect(stats.evictions).toBe(0);
    expect(stats.size).toBe(0);
    expect(stats.maxSize).toBe(1000);
    expect(stats.hitRate).toBe(0);
  });

  test("BdCacheOptions has all optional fields", () => {
    const opts: BdCacheOptions = {
      maxSize: 500,
      hotTtlMs: 10_000,
      warmTtlMs: 30_000,
      coldTtlMs: 120_000,
      enabled: true,
    };
    expect(opts.maxSize).toBe(500);
    expect(opts.hotTtlMs).toBe(10_000);
    expect(opts.warmTtlMs).toBe(30_000);
    expect(opts.coldTtlMs).toBe(120_000);
    expect(opts.enabled).toBe(true);
  });

  test("BdCacheOptions works with no fields (all optional)", () => {
    const opts: BdCacheOptions = {};
    expect(opts.maxSize).toBeUndefined();
  });
});

// ============================================================================
// Edge cases
// ============================================================================
describe("BdCache — edge cases", () => {
  test("handles complex objects as values", () => {
    const cache = new BdCache();
    const complex = {
      id: "abc",
      nested: { deep: { value: 42 } },
      array: [1, 2, 3],
    };
    cache.set("complex", complex, "warm");
    expect(cache.get("complex")).toEqual(complex);
  });

  test("handles null and undefined values", () => {
    const cache = new BdCache();
    cache.set("null-val", null, "hot");
    cache.set("undef-val", undefined, "hot");
    // null is a valid cached value (distinguishable from cache miss)
    expect(cache.has("null-val")).toBe(true);
    expect(cache.get("null-val")).toBeNull();
    expect(cache.has("undef-val")).toBe(true);
  });

  test("handles empty string keys", () => {
    const cache = new BdCache();
    cache.set("", "empty-key", "hot");
    expect(cache.get("")).toBe("empty-key");
  });

  test("maxSize of 1 works correctly", () => {
    const cache = new BdCache({ maxSize: 1 });
    cache.set("a", 1, "hot");
    cache.set("b", 2, "hot"); // evicts "a"
    expect(cache.get("a")).toBeUndefined();
    expect(cache.get("b")).toBe(2);
    expect(cache.size()).toBe(1);
  });

  test("invalidateByOperation without context still invalidates global patterns", () => {
    const cache = new BdCache();
    cache.set("list:all", [1], "hot");
    cache.set("ready:all", [2], "hot");
    cache.set("stats:proj", 5, "cold");

    // create doesn't need id
    cache.invalidateByOperation("create");
    expect(cache.get("list:all")).toBeUndefined();
    expect(cache.get("stats:proj")).toBeUndefined();
    expect(cache.get("ready:all")).toBeUndefined();
  });
});
