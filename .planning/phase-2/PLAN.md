# Phase 2: Memory Enhancement

## Summary

Backport 2 remaining Cortex memory improvements into swarm-tools' hivemind.

**Discovery finding:** Upstream already implements decay tiers (hot/warm/cold), access tracking (`last_accessed`, `access_count`), and `trackAccess()`. Only **tag 80/20 boost** and **privacy XML filter** remain.

**Spec:** `.planning/fork-plan/details/memory-enhancement-spec.md`

**Requirements:** R2 (memory recall), R6 (zero regression), R8 (performance <50ms/1K)

---

## Tasks

### Task 1 (auto): Tag 80/20 Boost

**Goal:** When a query contains keywords that match memory tags, boost those results with an 80% tag-match / 20% semantic-similarity weighted score. Fall back to pure semantic similarity when no tags match.

**TDD approach:**

1. **RED** — Write tests in `packages/swarm-mail/src/memory/tag-boost.test.ts`:
   - `computeTagMatchRatio("oauth tokens", "oauth,tokens")` returns 1.0
   - `computeTagMatchRatio("oauth tokens", "auth,security")` returns 0.5 (partial: "auth" matches "oauth")
   - `computeTagMatchRatio("oauth tokens", "unrelated,stuff")` returns 0.0
   - `computeTagMatchRatio("", "oauth,tokens")` returns 0.0
   - `computeTagMatchRatio("oauth tokens", "")` returns 0.0
   - Integration: `find("oauth tokens")` ranks tag-matched memory higher than untagged semantically-similar memory
   - Integration: `find("random query")` with no tag matches uses pure semantic similarity

2. **GREEN** — Implement in `packages/swarm-mail/src/memory/tag-boost.ts`:
   - `computeTagMatchRatio(queryText: string, tags: string): number`
   - `applyTagBoost(semanticScore: number, tagRatio: number, boostRatio?: number): number`
   - Default `boostRatio = 0.8` (configurable)

3. **WIRE** — Integrate into `packages/swarm-mail/src/memory/store.ts`:
   - In `search()` method (line ~206): after getting vector results, apply tag boost re-ranking
   - In `ftsSearch()` method (line ~286): same re-ranking
   - Only apply when query text is available and results have tags

4. **REFACTOR** — Export from `packages/swarm-mail/src/memory/index.ts`

**Files:**
- `packages/swarm-mail/src/memory/tag-boost.ts` (new)
- `packages/swarm-mail/src/memory/tag-boost.test.ts` (new)
- `packages/swarm-mail/src/memory/store.ts` (modify search + ftsSearch)
- `packages/swarm-mail/src/memory/index.ts` (re-export)

**Verify:** `bun test packages/swarm-mail/src/memory/tag-boost.test.ts`

**Spec reference:** `memory-enhancement-spec.md` lines 104-150

---

### Task 2 (auto): Privacy XML Filter

**Goal:** Strip sensitive data (passwords, API keys, tokens, secrets, emails) and `<private>...</private>` XML tags from memories before returning them to agents or injecting into context.

**TDD approach:**

1. **RED** — Write tests in `packages/swarm-mail/src/memory/privacy.test.ts`:
   - `isPrivate("private,auth", undefined)` returns true
   - `isPrivate("auth", "<private>secret</private>")` returns true
   - `isPrivate("auth", "normal content")` returns false
   - `stripSensitive("password=abc123 normal text")` returns `"[REDACTED] normal text"`
   - `stripSensitive("api_key=sk-123abc normal")` returns `"[REDACTED] normal"`
   - `stripSensitive("token=eyJhbGci... normal")` returns `"[REDACTED] normal"`
   - `stripSensitive("secret=mysecret normal")` returns `"[REDACTED] normal"`
   - `stripSensitive("user@example.com normal")` returns `"[REDACTED] normal"`
   - `stripSensitive("<private>hidden</private> visible")` returns `"[REDACTED] visible"`
   - `stripSensitive("no sensitive data here")` returns `"no sensitive data here"` (passthrough)
   - `containsPrivateTag("<private>x</private>")` returns true
   - `containsPrivateTag("normal text")` returns false
   - `filterMemoriesForContext(memories)` excludes private-tagged, strips sensitive, excludes fully-redacted
   - Edge: empty string, null tags, memories with no tags

2. **GREEN** — Implement in `packages/swarm-mail/src/memory/privacy.ts`:
   - `isPrivate(tags: string, content?: string): boolean`
   - `stripSensitive(text: string): string`
   - `containsPrivateTag(content: string): boolean`
   - `isFullyRedacted(text: string): boolean`
   - `filterMemoriesForContext<T>(memories: T[]): T[]`

3. **WIRE** — Integrate into adapter/tools layer:
   - In `packages/swarm-mail/src/memory/adapter.ts` `find()`: apply `filterMemoriesForContext()` before returning
   - Add `privacyFilter?: boolean` option (default: true, can be disabled for admin queries)

4. **REFACTOR** — Export from `packages/swarm-mail/src/memory/index.ts`

**Files:**
- `packages/swarm-mail/src/memory/privacy.ts` (new)
- `packages/swarm-mail/src/memory/privacy.test.ts` (new)
- `packages/swarm-mail/src/memory/adapter.ts` (modify find)
- `packages/swarm-mail/src/memory/index.ts` (re-export)

**Verify:** `bun test packages/swarm-mail/src/memory/privacy.test.ts`

**Spec reference:** `memory-enhancement-spec.md` lines 302-391

---

### Task 3 (checkpoint:human-verify): Verify Memory Enhancements

**Goal:** Run full memory test suite, verify 0 new regressions, confirm both new features work end-to-end.

**Steps:**

1. Run `bun test packages/swarm-mail/src/memory/` — full memory suite
2. Run `bun test packages/swarm-mail/src/memory/tag-boost.test.ts` — tag boost tests
3. Run `bun test packages/swarm-mail/src/memory/privacy.test.ts` — privacy filter tests
4. Verify existing adapter tests still pass (no regression in find/get/store)
5. Verify build: `bunx turbo build --filter='!@swarmtools/web' --filter='!swarm-dashboard'`

**Success criteria:**
- All new tag-boost tests pass
- All new privacy-filter tests pass
- Zero new test failures in existing memory suite
- Build succeeds

---

## Dependencies

- Phase 1 complete (verified: commit `3d5adf5`)
- Upstream decay tiers + access tracking already implemented (no work needed)

## Exit Criteria

- [x] Decay tiers (hot/warm/cold) — already in upstream `store.ts` lines 64-95
- [x] Access tracking (`last_accessed`, `access_count`) — already in upstream Drizzle schema + `store.ts` lines 390-404
- [x] `trackAccess()` function — already in upstream `store.ts` lines 394-407
- [x] Tag 80/20 boost — `computeTagMatchRatio()` + wired into `search()` and `ftsSearch()` in store.ts (24 tests)
- [x] Privacy XML filter — `privacy.ts` module + wired into `find()` in adapter.ts (36 tests)
- [x] All existing memory tests still pass (zero new regression — 67 failures all pre-existing from adapter.test.ts missing migration)
- [x] Build succeeds
