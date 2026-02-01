# Fork Master Plan: swarm-tools → Cortex

**Status:** Draft
**Created:** 2026-02-01
**Owner:** Cortex Core Team

---

## Executive Summary

**Decision:** Fork [joelhooks/swarm-tools](https://github.com/joelhooks/swarm-tools) and incrementally upgrade its weaker modules — instead of continuing the Cortex ground-up rewrite.

**Why:** CortexV2 has been rebuilding from scratch what swarm-tools already provides. After completing Phase 1 (Memory) and Phase 2 (Mail) to ≥90% fidelity, the pattern is clear: we are porting swarm-tools' logic piecemeal into Cortex's architecture. This is slower and more error-prone than forking the working system and upgrading it.

### What the fork saves

| Aspect | Rewrite (current) | Fork (proposed) |
|--------|-------------------|-----------------|
| Event sourcing (56 event types, Zod-validated) | Rebuilt — 30 types so far | Already exists |
| Swarm Mail (messaging, reservations, threads) | Rebuilt to ~90% fidelity | Already exists at 100% |
| Hivemind memory (smart upsert, entity extraction, auto-linking, temporal queries, CASS sessions) | Not started (deferred per HLD) | Already exists |
| Learning system (pattern maturity, anti-patterns, confidence decay) | Not built | Already exists |
| Strategy insights (3 query types) | Not built | Already exists |
| Eval pipeline (Evalite, 3 test suites) | Not built | Already exists |
| Review gate (3-strike rule, adversarial review) | Not built | Already exists |
| Checkpoint/recovery (25/50/75%) | Not built | Already exists |
| Skills system | Not built | Already exists |
| Dashboard + CLI tools | Not built | Already exists |
| Compaction hook | Not built | Already exists |

**~70% of what Cortex needs already exists in swarm-tools.** Forking saves months of rebuild work while letting us focus engineering effort on the 4 things swarm lacks.

---

## What to KEEP from swarm-tools

### 1. Event Sourcing Architecture

swarm-tools uses an append-only event log with 56 Zod-validated event types, materialized views via projections, and batch event support. Cortex currently has 30 event types in `src/events/types.ts` — swarm's coverage is nearly 2x broader.

**swarm-tools event categories (from `packages/swarm-mail/src/streams/events.ts`):**

| Category | Event Types | Count |
|----------|-------------|-------|
| Agent lifecycle | `AGENT_REGISTERED`, `AGENT_HEARTBEAT`, `AGENT_DEREGISTERED` | 3 |
| Message flow | `MESSAGE_SENT`, `MESSAGE_READ`, `MESSAGE_ACKNOWLEDGED` | 3 |
| File reservations | `FILES_RESERVED`, `FILES_RELEASED`, `FILE_CONFLICT` | 3 |
| Thread management | `THREAD_CREATED`, `THREAD_ACTIVITY` | 2 |
| Cell/task lifecycle | `CELL_CREATED`, `CELL_UPDATED`, `CELL_STATUS_CHANGED`, `CELL_CLOSED` | 4 |
| Epic management | `EPIC_CREATED`, `EPIC_UPDATED`, `EPIC_COMPLETED` | 3 |
| Swarm orchestration | `SWARM_STARTED`, `SWARM_COMPLETED`, `SWARM_FAILED` | 3 |
| Decomposition | `DECOMPOSITION_STARTED`, `DECOMPOSITION_COMPLETED`, `DECOMPOSITION_FAILED` | 3 |
| Task execution | `TASK_STARTED`, `TASK_PROGRESS`, `TASK_COMPLETED`, `TASK_FAILED`, `TASK_BLOCKED` | 5 |
| Review | `REVIEW_REQUESTED`, `REVIEW_COMPLETED`, `REVIEW_FAILED` | 3 |
| Memory | `MEMORY_STORED`, `MEMORY_FOUND`, `MEMORY_VALIDATED`, `MEMORY_REMOVED` | 4 |
| Learning | `LEARNING_RECORDED`, `LEARNING_MATURED`, `LEARNING_DECAYED` | 3 |
| Strategy | `STRATEGY_SELECTED`, `STRATEGY_OUTCOME_RECORDED` | 2 |
| Checkpoint | `CHECKPOINT_CREATED`, `CHECKPOINT_RESTORED` | 2 |
| Session | `SESSION_STARTED`, `SESSION_ENDED`, `SESSION_HANDOFF` | 3 |
| Worktree | `WORKTREE_CREATED`, `WORKTREE_MERGED`, `WORKTREE_CLEANED` | 3 |
| Broadcast | `BROADCAST_SENT` | 1 |
| Health | `HEALTH_CHECK_RUN` | 1 |
| Compaction | `EVENTS_COMPACTED` | 1 |
| Evaluation | `EVAL_RUN_STARTED`, `EVAL_RUN_COMPLETED` | 2 |

**Total: ~56 event types** (vs Cortex's 30)

**Keep:** All event types, Zod schemas, append-only store, materialized projections, batch append, replay.

### 2. Swarm Mail (Messaging + Reservations + Threads)

Fully built messaging system with:
- Agent registration with program/task_description
- Message send/receive with threading, importance, ack_required
- Inbox with body exclusion (context preservation), MAX_INBOX_LIMIT
- File reservations with exclusive locks, TTL, force override, conflict detection
- Read receipts and acknowledgment tracking
- Thread management (create, activity tracking)
- Health check (WAL mode, integrity, queue depth, reservation leaks, stale agents)

**Keep:** All mail functionality. This is already ~90% replicated in Cortex Phase 2 — the fork gives us the remaining 10% for free.

### 3. Hivemind Memory System

swarm-tools' hivemind (in `packages/swarm-mail/src/`) provides:
- **Smart upsert** — Semantic dedup before store (>0.95 similarity → update instead of insert)
- **Entity extraction** — Auto-extract entities from stored information
- **Auto-linking** — Automatically link related memories
- **Temporal queries** — Time-range based memory retrieval
- **Session indexing** — Index AI sessions from 10+ agents (Claude, Cursor, Codex, Gemini, Aider, ChatGPT, Cline, OpenCode, Amp, Pi-Agent)
- **CASS integration** — Cross-Agent Session Search across all agent histories
- **Confidence decay** — 90-day half-life with manual validation reset
- **Git-backed sync** — `.hive/memories.jsonl` for team sharing

**Keep:** All hivemind capabilities. Per the HLD decision, swarm's memory is BETTER than opencode-mem for our use case. We'll backport Cortex's improvements (see `details/memory-enhancement-spec.md`).

### 4. Learning System

- **Pattern maturity:** `candidate → established → proven` (based on success count)
- **Anti-pattern detection:** Track failure patterns with confidence scoring
- **Confidence decay:** Time-based decay for stale learnings
- **File insights:** Per-file gotchas from past swarm outcomes
- **Pattern insights:** Top failure patterns across swarms

**Keep:** Entire learning system.

### 5. Strategy Insights

Three query types for decomposition intelligence:
- `get_strategy_insights(task)` — Success rates by strategy (file-based, feature-based, risk-based)
- `get_file_insights(files)` — Historical failure patterns for specific files
- `get_pattern_insights()` — Top 5 recurring failure patterns

**Keep:** All strategy insight tools.

### 6. Eval Pipeline

- **Evalite integration** — AI evaluation framework
- **3 test suites** — Decomposition quality, review accuracy, strategy selection
- **Automated scoring** — Structured evaluation with pass/fail criteria

**Keep:** Full eval pipeline.

### 7. Review Gate

- **3-strike rule** — Task blocked after 3 review rejections (architectural problem signal)
- **Adversarial review** — VDD-style hostile reviewer with fresh context per review
- **Review feedback loop** — Structured approve/needs_changes with file-line-level issues

**Keep:** Full review gate system.

### 8. Checkpoint & Recovery

- **Progress checkpoints** at 25%, 50%, 75%
- **State preservation** — Resume from last checkpoint after crash
- **Compaction hook** — Context injection with compacted state

**Keep:** Full checkpoint system.

### 9. Skills System

- **Skill discovery** — `skills_list()`, `skills_read()`, `skills_use()`
- **Skill creation** — `skills_create()`, `skills_update()`, `skills_add_script()`
- **Skill execution** — `skills_execute()` for running skill scripts
- **Multi-source** — Global, project, and bundled skill sources

**Keep:** Full skills system.

### 10. Dashboard + CLI

- **Dashboard** — Visual swarm status monitoring
- **CLI tools** — `hive_*`, `hivemind_*`, `swarmmail_*`, `swarm_*` tool families

**Keep:** All CLI tools and dashboard.

---

## What to PORT from Cortex

Cortex has 4 innovations that swarm-tools lacks. These will be backported into the fork.

### 1. Tag 80/20 Boost for Memory Ranking

**File:** `src/memory/vector-search.ts` lines 139-143

Cortex's vector search uses a weighted formula: **80% tag match + 20% semantic similarity**. This dramatically improves recall quality for structured knowledge.

```typescript
// Cortex implementation
if (queryText) {
  const tagMatchRatio = computeTagMatchRatio(queryText, row.tags);
  similarity = tagMatchRatio * 0.8 + contentSim * 0.2;
}
```

**Port to:** Hivemind's `hivemind_find()` function.

### 2. Decay Tiers (Hot/Warm/Cold)

**File:** `src/memory/vector-search.ts` lines 4-36

Three-tier access-based decay for long-term memory:
- **Hot** (≤7 days since last access) — Full relevance
- **Warm** (8-30 days) — Moderate decay
- **Cold** (>30 days, with frequency bonus for high-access items extending to 37 days)

```typescript
export type DecayTier = "hot" | "warm" | "cold";
const DECAY_HOT_DAYS = 7;
const DECAY_WARM_DAYS = 30;
const DECAY_FREQUENCY_BONUS_THRESHOLD = 10;
const DECAY_FREQUENCY_BONUS_DAYS = 7;
```

**Port to:** Hivemind's `hivemind_find()` with optional tier filtering.

### 3. Access Tracking

**File:** `src/memory/long-term.ts` lines 55-68

Cortex tracks `last_accessed` and `access_count` per memory, enabling:
- Frequency-based relevance boosting
- Usage analytics for memory quality assessment
- Informed cleanup (never delete frequently-used memories)

```typescript
export function trackAccess(ids: string[]): void {
  const stmt = db.prepare(
    `UPDATE long_memory SET last_accessed = ?, access_count = access_count + 1 WHERE id = ?`
  );
  // ...batched transaction
}
```

**Port to:** Hivemind's store/find/get operations.

### 4. Privacy XML Filter

**File:** `src/memory/privacy.ts`

Strip sensitive data from memories before context injection:
- `<private>...</private>` XML tags → `[REDACTED]`
- Regex patterns for passwords, API keys, tokens, secrets, emails
- `isPrivate()` / `isFullyPrivate()` checks
- `filterMemoriesForContext()` pipeline

**Port to:** Hivemind's context injection path.

### 5. Queen/Worker Protocol

**File:** `HLD.md` — Queen & Worker Architecture section

Structured coordinator/executor protocol with:
- **Message types:** STATUS_UPDATE, HELP_REQUEST, DISCOVERY, DECISION_NEEDED, COMPLETED, BLOCKED (Worker→Queen) and APPROVED, REJECTED, UNBLOCKED, CONTEXT_UPDATE, REVIEW_FEEDBACK (Queen→Worker)
- **Subject patterns:** `[STATUS] {bead_id}: {status}`, `[HELP] {bead_id}: {question}`, etc.
- **Body schema:** Structured fields (status, percent_complete, blockers, files, commit, summary)
- **Worker guardrails:** Cannot modify other workers' beads, cannot create epics, cannot promote to long-term memory
- **Worker lifecycle:** PICKUP → ORIENT → PLAN → EXECUTE → VERIFY → LEARN → REPORT → CLOSE

**Port to:** New agent prompt templates and mail message type validation.

### 6. Structured Mail Message Types

**File:** `HLD.md` — Communication Protocol section

Worker↔Queen and Worker↔Worker message types with formal schemas:
- 6 Worker→Queen types
- 5 Queen→Worker types
- 2 Worker→Worker types

**Port to:** Swarm Mail with Zod schema validation per message type.

---

## What to BRIDGE from External Systems

### 1. Beads (`bd` CLI) — Task Graph

**Source:** [steveyegge/beads](https://github.com/steveyegge/beads)

swarm-tools has a built-in `hive` table — a simplified task tracker. It works but has significant limitations compared to `bd`:

| Feature | swarm hive table | bd CLI |
|---------|-----------------|--------|
| Dependency types | 3-4 (blocks, parent) | 18 types |
| Ready algorithm | Simple query | Recursive CTE, transitive blocking |
| Hierarchical IDs | No | Yes (`bd-a3f8.1`, `bd-a3f8.2`) |
| Storage | SQLite | Git-backed JSONL |
| Background sync | No | Daemon + git hooks |
| Labels/Comments | No | Yes |
| Search | No | Full-text search |
| Molecules/Gates | No | Yes (advanced coordination) |

**Bridge approach:**
- Keep swarm's hive table for internal swarm coordination (lightweight cells)
- Bridge to `bd` CLI for serious dependency management (epics, dep graphs, ready algorithm)
- `task_mapping` table maps swarm cell IDs ↔ bead IDs
- New event types: `BEADS_TASK_CREATED`, `BEADS_DEP_ADDED`, `BEADS_STATUS_CHANGED`, `BEADS_READY_CHANGED`
- Queen uses `bd ready --json` to find executable tasks

### 2. GSD (Get Shit Done) — Structured Execution

**Source:** [get-shit-done](https://github.com/steipete/get-shit-done)

swarm-tools has decomposition + worker spawning but lacks structured execution discipline:

| Feature | swarm-tools | GSD |
|---------|------------|-----|
| Plan format | Ad-hoc prompts | YAML frontmatter + XML tasks |
| Execution structure | Flat subtask list | Waves (parallel groups) |
| Verification | Review gate only | Goal-backward (must_haves, artifacts, key_links) |
| State persistence | Event log | STATE.md + ROADMAP.md |
| Research phase | No | Multi-round discovery |
| Checkpoint types | Generic 25/50/75 | human-verify, decision, human-action |

**Bridge approach:**
- Add `.planning/` directory structure to forked swarm
- Generate GSD `PLAN.md` files from swarm decomposition
- New event types: `GSD_PLAN_CREATED`, `GSD_WAVE_STARTED`, `GSD_WAVE_COMPLETED`, `GSD_TASK_EXECUTED`, `GSD_VERIFICATION_RUN`, `GSD_VERIFICATION_PASSED`, `GSD_VERIFICATION_FAILED`
- Wave calculator groups independent tasks for parallel execution
- STATE.md tracks execution position across sessions

---

## 5-Phase Implementation Timeline

### Phase 1: Fork & Stabilize (Week 1)

**Goal:** Create the fork, verify it builds and tests pass, establish the upgrade path.

| Task | Description | Effort |
|------|-------------|--------|
| Fork repository | Fork joelhooks/swarm-tools into cortex | S |
| Rename package | `opencode-swarm-plugin` → `cortex-plugin` | S |
| Verify build | Ensure all existing tests pass under Bun | M |
| Add event types | New event types for beads bridge, GSD, Queen/Worker (see `details/event-type-mapping.md`) | M |
| Schema migration | Add `task_mapping` table, extend agents table | S |
| CI/CD setup | GitHub Actions for build + test | S |

**Exit criteria:** Fork builds, all existing tests pass, new event types registered.

### Phase 2: Memory Enhancement (Week 1-2)

**Goal:** Backport Cortex memory improvements into hivemind.

| Task | Description | Effort |
|------|-------------|--------|
| Tag 80/20 boost | Port weighted ranking to hivemind_find | M |
| Decay tiers | Add hot/warm/cold filtering to hivemind | M |
| Access tracking | Add last_accessed, access_count columns | S |
| Privacy filter | Port XML filter + regex sanitization | M |
| Migration | Migrate existing hivemind data with new columns | S |
| Tests | Port Cortex's 93 memory tests | L |

**Exit criteria:** `hivemind_find` uses 80/20 ranking, decay tiers work, privacy filter strips sensitive data. See `details/memory-enhancement-spec.md` for full spec.

### Phase 3: Beads Bridge (Week 2-3)

**Goal:** Bridge `bd` CLI into swarm's orchestration loop.

| Task | Description | Effort |
|------|-------------|--------|
| bd CLI client | Shell wrapper for `bd create`, `bd ready`, `bd dep add`, etc. | M |
| Task mapping store | `task_mapping` table (swarm cell → bead ID) | S |
| Ready poller | Poll `bd ready --json` for executable tasks | S |
| Status sync | Sync swarm cell status ↔ bead status | M |
| Event bridge | Emit `BEADS_*` events on bd operations | M |
| Tests | bd client, mapping, sync tests | M |

**Exit criteria:** `bd` tasks created from swarm decomposition, status synced bidirectionally, events emitted.

### Phase 4: GSD Integration (Week 3-4)

**Goal:** Add GSD's structured execution framework.

| Task | Description | Effort |
|------|-------------|--------|
| Plan generator | Convert swarm decomposition → GSD `PLAN.md` | M |
| Wave calculator | Group tasks by dependency wave | M |
| .planning/ structure | PROJECT.md, STATE.md, ROADMAP.md management | M |
| Verification engine | Goal-backward verification with must_haves | L |
| STATE.md persistence | Track execution position across sessions | M |
| Event bridge | Emit `GSD_*` events on execution operations | S |
| Tests | Plan generation, wave calculation, verification | L |

**Exit criteria:** `cortex goal "X"` generates PLAN.md, executes in waves, verifies with must_haves.

### Phase 5: Queen/Worker Protocol (Week 4-5)

**Goal:** Port Cortex's Queen/Worker architecture into the forked swarm.

| Task | Description | Effort |
|------|-------------|--------|
| Message type validation | Zod schemas for all Worker↔Queen message types | M |
| Queen monitor loop | Watch bead status, check mail, make decisions | L |
| Worker lifecycle | PICKUP → ORIENT → PLAN → EXECUTE → VERIFY → LEARN → REPORT → CLOSE | L |
| Worker guardrails | Enforce scope boundaries (no cross-bead mutation, no epic creation) | M |
| Learning promoter | Short-term → long-term memory promotion by Queen | S |
| Agent prompts | Queen and Worker agent prompt templates | M |
| Event bridge | Emit `QUEEN_*` and `WORKER_*` events | S |
| Tests | Protocol compliance, guardrail enforcement | L |

**Exit criteria:** Queen coordinates workers via mail, workers follow lifecycle, guardrails enforced.

---

## Risk Analysis and Mitigation

### Risk 1: swarm-tools Divergence

**Risk:** joelhooks/swarm-tools continues to evolve, and our fork falls behind.

**Likelihood:** High (active project)
**Impact:** Medium (we lose upstream improvements)

**Mitigation:**
- Set up upstream remote for periodic cherry-picks
- Keep our changes modular (new files, not massive edits to existing ones)
- Track upstream changelog in `.planning/fork-plan/UPSTREAM-CHANGELOG.md`
- Monthly sync cadence

### Risk 2: Hivemind Memory Enhancement Breaks Existing Data

**Risk:** Schema changes to hivemind tables corrupt or lose existing memory data.

**Likelihood:** Medium
**Impact:** High (data loss)

**Mitigation:**
- Schema migration with versioning (see `details/memory-enhancement-spec.md`)
- Backup before migration
- New columns use `DEFAULT NULL` — old data remains valid
- Forward-only migrations (never drop columns)

### Risk 3: bd CLI Dependency Fragility

**Risk:** `bd` CLI is a Go binary — build/install may fail on some systems, or bd output format changes.

**Likelihood:** Medium
**Impact:** High (core dependency breaks)

**Mitigation:**
- Pin bd version in `.cortex/config.json`
- bd client includes output format validation (JSON parse + schema check)
- Graceful degradation: if bd unavailable, fall back to swarm's built-in hive table
- Integration tests mock bd CLI output

### Risk 4: GSD Integration Complexity

**Risk:** GSD's plan format and wave execution add significant complexity to the orchestration loop.

**Likelihood:** Medium
**Impact:** Medium (delayed delivery)

**Mitigation:**
- Start with Quick Mode only (flat PLAN.md, no roadmap)
- Defer Project Mode (phased roadmap) to a later phase
- Keep GSD as a module — can be bypassed for simple goals
- Use Cortex's existing PLAN.md template as starting point

### Risk 5: Queen/Worker Protocol Overhead

**Risk:** Structured mail protocol adds latency and complexity vs. ad-hoc communication.

**Likelihood:** Low
**Impact:** Medium (slower execution)

**Mitigation:**
- Message validation is Zod-based (fast, <1ms)
- Optional strict mode: enforce protocol in production, relax in development
- Worker guardrails are checks at function entry, not middleware
- Benchmark: measure overhead vs. current swarm on same task

### Risk 6: Test Migration

**Risk:** Cortex has 394 tests — migrating them to the forked codebase may be non-trivial.

**Likelihood:** Medium
**Impact:** Low (tests can be ported incrementally)

**Mitigation:**
- Port tests module by module as each module is enhanced
- Memory tests (93) port during Phase 2
- Mail tests (80) can likely be retired (swarm's existing tests cover)
- Keep Cortex repo as reference for test assertions

---

## What We Retire from Cortex

After the fork is complete, these Cortex modules become obsolete:

| Cortex Module | Replaced By | Notes |
|---------------|-------------|-------|
| `src/events/` (30 event types) | swarm's 56 event types | Swarm's coverage is broader |
| `src/mail/` (inbox, send, reservations) | swarm-mail package | Swarm's implementation is more complete |
| `src/memory/short-term.ts` | hivemind short-term | Merged capability |
| `src/memory/long-term.ts` | hivemind + Cortex enhancements | Enhanced hivemind |
| `src/memory/vector-search.ts` | hivemind vector search + 80/20 boost | Enhanced |
| `src/memory/ranker.ts` | hivemind ranker + tag boost | Enhanced |
| `src/memory/privacy.ts` | Ported to hivemind | Privacy filter moved |
| `src/memory/dedup.ts` | hivemind smart upsert | Already exists in hivemind |
| `src/memory/cleanup.ts` | hivemind cleanup | Already exists |
| `src/memory/sync.ts` | hivemind git sync | Already exists |
| `src/memory/embedding.ts` | hivemind embeddings | Already exists |
| `src/plugin/` (4 MCP tools) | swarm's full tool suite | Swarm has 29+ tools |

**Kept from Cortex:**
- `src/bridge/` — Beads bridge (new to swarm)
- `src/queen/` — Queen protocol (new to swarm)
- `src/worker/` — Worker lifecycle (enhanced over swarm's current worker)
- `HLD.md` — Architecture spec (canonical reference)
- `.planning/` — GSD execution framework (new to swarm)
- Test patterns and assertions

---

## Success Criteria

The fork is considered successful when:

1. **All existing swarm-tools tests pass** (no regression)
2. **Cortex's 93 memory tests pass** on enhanced hivemind (ported)
3. **`bd` CLI integration works** end-to-end (create epic → ready tasks → execute → close)
4. **GSD PLAN.md generation works** from swarm decomposition
5. **Queen/Worker protocol enforced** via mail message validation
6. **No data loss** during hivemind schema migration
7. **Performance:** Memory recall <50ms for 1K entries, mail send <10ms

---

## Appendix: Module Mapping (Cortex → Fork)

| Cortex Module | Fork Location | Action |
|---------------|---------------|--------|
| `src/events/types.ts` | `packages/opencode-swarm-plugin/src/events/` | EXTEND (add new types) |
| `src/mail/*` | `packages/swarm-mail/src/` | RETIRE (swarm's is better) |
| `src/memory/*` | `packages/swarm-mail/src/` (hivemind) | ENHANCE (backport improvements) |
| `src/bridge/*` | `packages/cortex-bridge/src/` (NEW) | CREATE (new package) |
| `src/queen/*` | `packages/opencode-swarm-plugin/src/queen/` | CREATE (new module) |
| `src/worker/*` | `packages/opencode-swarm-plugin/src/worker/` | ENHANCE (upgrade existing) |
| `src/executor/*` | `packages/opencode-swarm-plugin/src/executor/` | CREATE (GSD integration) |
| `vendor/agents/*` | `packages/opencode-swarm-plugin/vendor/agents/` | CREATE (new prompts) |
| `.planning/*` | Root `.planning/` | CREATE (GSD structure) |
| `HLD.md` | Root `HLD.md` | PORT (canonical architecture) |
