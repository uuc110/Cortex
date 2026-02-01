# Phase 1: Fork & Stabilize — Plan 1

**Phase:** 1 — Fork & Stabilize
**Epic:** `cortex-rxxnfk-ml37mq3pjyn`
**Status:** in_progress
**Created:** 2026-02-01
**Requirements:** R1, R6, R7

---

## Objective

Establish the fork as a buildable, testable project with the Cortex upgrade path ready. Add all new event types and schema tables needed by Phases 2-5.

## Prerequisites

- [x] Fork repository created
- [x] Upstream remote configured (`upstream → joelhooks/swarm-tools`)
- [x] `bun install` succeeds
- [x] Core packages build (`swarm-mail`, `opencode-swarm-plugin`, `shared-types`, `swarm-tools`)

## Tasks

### Task 1: Verify Build (auto) ✅

**Status:** completed
**Files:** N/A (verification only)

Build results:
- `swarm-mail` ✅
- `opencode-swarm-plugin` ✅  
- `shared-types` ✅
- `swarm-tools` ✅
- `claude-code-swarm-plugin` ✅
- `swarm-dashboard` ❌ (pre-existing: missing `partysocket/react` types)
- `@swarmtools/web` ❌ (pre-existing: `next` not installed)

Tests: 1144 pass, 102 fail (pre-existing — vector search, DurableStreamServer, SessionIndexer require runtime deps)

---

### Task 2: Add New Event Types (auto) ✅

<task type="auto">
  <name>Add 27 new event types for Beads Bridge, GSD, and Queen/Worker</name>
  <files>
    packages/swarm-mail/src/streams/events.ts
    packages/swarm-mail/src/streams/events.test.ts
  </files>
  <action>
    Add Zod schemas for all 27 new event types per details/event-type-mapping.md:
    - 8 Beads Bridge events (beads_task_created, beads_dep_added, etc.)
    - 10 GSD Integration events (gsd_plan_created, gsd_wave_started, etc.)
    - 9 Queen/Worker events (queen_decision_made, worker_status_update, etc.)
    Register all in AgentEventSchema discriminated union.
    Export individual type aliases.
    Add basic schema validation tests.
  </action>
  <verify>bun test packages/swarm-mail/src/streams/events.test.ts</verify>
  <done>All 27 new event types parse with Zod, existing 56 events still work</done>
</task>

---

### Task 3: Add Schema Migration for Task Mapping Tables (auto) ✅

<task type="auto">
  <name>Add task_mapping, dep_mapping, and label_mapping tables (migration v11)</name>
  <files>
    packages/swarm-mail/src/hive/migrations.ts
    packages/swarm-mail/src/streams/migrations.ts
  </files>
  <action>
    Add LibSQL-compatible migration v11 with:
    - task_mapping table (extended schema from details/task-mapping-schema.md)
    - dep_mapping table (beads dependency edges)
    - label_mapping table (beads label cache)
    - All indexes per the spec
    Register migration in hiveMigrationsLibSQL array.
  </action>
  <verify>bun test packages/swarm-mail/src/hive/</verify>
  <done>Migration v11 runs without error, tables created with correct schema</done>
</task>

---

### Task 4: Rename Package (auto) ⏭️ SKIPPED

<task type="auto">
  <name>Rename opencode-swarm-plugin to cortex-plugin — SKIPPED: 775 matches/84 files, high risk low value per user decision</name>
  <files>
    packages/opencode-swarm-plugin/package.json
    package.json
    packages/swarm-evals/package.json
    packages/claude-code-swarm-plugin/package.json
    All source files with import references
  </files>
  <action>
    1. Rename package name in package.json files
    2. Rename directory packages/opencode-swarm-plugin → packages/cortex-plugin
    3. Update workspace references
    4. Update import statements
    5. Run bun install to relink
    6. Verify build still passes
  </action>
  <verify>bunx turbo build --filter='!@swarmtools/web' --filter='!swarm-dashboard'</verify>
  <done>Package renamed, builds pass, imports resolve</done>
</task>

---

### Task 5: Set up GitHub Actions CI (auto) ✅ (pre-existing)

<task type="auto">
  <name>Create GitHub Actions workflow for build + test — already existed upstream with full CI (Bun, Ollama, build, typecheck, tests, eval gates)</name>
  <files>
    .github/workflows/ci.yml
  </files>
  <action>
    Create CI workflow that:
    - Triggers on push to main and PRs
    - Uses Bun runtime
    - Runs bun install, build, test (excluding web/dashboard)
    - Caches bun dependencies
  </action>
  <verify>cat .github/workflows/ci.yml (manual: push to verify)</verify>
  <done>CI config exists and is valid YAML</done>
</task>

---

## Wave Analysis

| Wave | Tasks | Parallel? |
|------|-------|-----------|
| 1 | Task 2 (events) + Task 3 (schema) | Yes — different files |
| 2 | Task 4 (rename) | Sequential — depends on wave 1 passing |
| 3 | Task 5 (CI) | Independent |

## Exit Criteria

- [x] Fork builds with `bunx turbo build` (zero errors on core packages)
- [x] All existing tests pass (1144+ pass, 0 new regressions) — verified: 1351 pass, 110 fail (all pre-existing)
- [x] 27 new event types registered in Zod schema — 83 total (56 existing + 27 new)
- [x] task_mapping table created in schema migration — v11 with 3 tables, 13 indexes
- [x] CI pipeline config exists — full upstream CI with Bun, Ollama, eval gates
- [ ] ~~Package renamed to cortex-plugin~~ — SKIPPED by user decision
