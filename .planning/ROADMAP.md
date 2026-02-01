# Roadmap

## Overview

Fork swarm-tools and incrementally upgrade it across 5 phases, each building on the previous. The fork already provides ~70% of what Cortex needs (event sourcing, mail, memory, learning, evals, review gate, skills). We add the missing ~30%: enhanced memory ranking, beads task graph, GSD structured execution, and Queen/Worker protocol.

**Codebase baseline:** 275 source files, 204 test files across 7 packages.

## Phases

### Phase 1: Fork & Stabilize <!-- cortex-rxxnfk-ml37mq3pjyn -->

**Goal:** Establish the fork as a buildable, testable, deployable project with the upgrade path ready.

**Dependencies:** None
**Research:** No
**Depth:** standard
**Timeline:** Week 1
**Requirements:** R1, R6, R7

**Scope:**
- Fork repository and rename `opencode-swarm-plugin` to `cortex-plugin`
- Verify all existing tests pass under Bun (`bun turbo test`)
- Add new event types for beads, GSD, and Queen/Worker (per `details/event-type-mapping.md`)
- Add `task_mapping` SQL table schema (per `details/task-mapping-schema.md`)
- Extend agents table with new columns
- Set up CI/CD (GitHub Actions for build + test)
- Set up upstream remote for periodic cherry-picks from joelhooks/swarm-tools

**Exit Criteria:**
- [ ] Fork builds with `bun turbo build` (zero errors)
- [ ] All existing tests pass with `bun turbo test`
- [ ] New event types registered in Zod schema
- [ ] `task_mapping` table created in schema migration
- [ ] CI pipeline runs on push to main
- [ ] Package renamed to `cortex-plugin` in package.json

---

### Phase 2: Memory Enhancement <!-- cortex-rxxnfk-ml37mwrbwz8 -->

**Goal:** Backport Cortex memory improvements into swarm's hivemind, making recall smarter and more private.

**Dependencies:** Phase 1 (fork must build)
**Research:** No (spec already complete in `details/memory-enhancement-spec.md`)
**Depth:** comprehensive
**Timeline:** Week 1-2
**Requirements:** R2, R6, R8

**Scope:**
- Port tag 80/20 boost (80% semantic + 20% tag match) to `hivemind_find()`
- Add 3-tier decay (hot: <=7d, warm: 8-30d, cold: >30d) with frequency bonus
- Add access tracking columns (`last_accessed`, `access_count`) to memories table
- Port privacy XML filter (`<private>` tag stripping + regex for secrets)
- Schema migration for existing hivemind data (additive, no data loss)
- Port relevant memory tests from Cortex (93 tests)

**Exit Criteria:**
- [ ] `hivemind_find()` uses 80/20 weighted ranking when tags present
- [ ] Decay tiers filter memories by recency tier
- [ ] Access tracking increments on every `hivemind_find()` and `hivemind_get()`
- [ ] Privacy filter strips `<private>` tags and regex-matched secrets
- [ ] Schema migration runs without data loss on existing databases
- [ ] Memory recall <50ms for 1K entries (benchmark test)
- [ ] All existing hivemind tests still pass + new tests for enhancements

---

### Phase 3: Beads Bridge <!-- cortex-rxxnfk-ml37n00tywt -->

**Goal:** Bridge `bd` CLI into swarm's orchestration for rich dependency management.

**Dependencies:** Phase 1 (event types, task_mapping table)
**Research:** Yes (verify bd CLI output formats, test on CI)
**Depth:** comprehensive
**Timeline:** Week 2-3
**Requirements:** R3, R7, R10

**Scope:**
- Port bd CLI client from Cortex `src/bridge/` (Bun.spawn wrapper)
- Implement task_mapping store (swarm cell ID <-> bead ID sync)
- Build ready-work poller (`bd ready --json` -> executable task list)
- Bidirectional status sync (swarm cell status <-> bead status)
- Emit `BEADS_*` events on every bd operation
- Graceful degradation: fall back to hive table if `bd` unavailable
- Document all 18 dependency types and their swarm use-cases

**Exit Criteria:**
- [ ] `bd` tasks created from swarm decomposition output
- [ ] Status synced bidirectionally between hive and beads
- [ ] `BEADS_*` events emitted and stored in event log
- [ ] `bd ready` result drives task assignment
- [ ] Fallback to hive table works when bd CLI absent
- [ ] task_mapping queries <5ms for lookups
- [ ] Integration tests cover create -> dep -> ready -> close lifecycle

---

### Phase 4: GSD Integration <!-- cortex-rxxnfk-ml37n3mczeb -->

**Goal:** Add structured execution with plans, waves, and verification to swarm.

**Dependencies:** Phase 1 (event types), Phase 3 (beads for dependency graph)
**Research:** Yes (wave calculator algorithm validation)
**Depth:** comprehensive
**Timeline:** Week 3-4
**Requirements:** R4, R7

**Scope:**
- Port plan generator from Cortex `src/executor/` (decomposition -> PLAN.md)
- Implement wave calculator (topological sort -> parallel wave groups) per `details/wave-calculator-algorithm.md`
- Build `.planning/` directory management (PROJECT.md, STATE.md, ROADMAP.md)
- Implement goal-backward verification engine (must_haves: truths/artifacts/key_links) per `details/verification-model.md`
- Build STATE.md persistence for cross-session tracking
- Support two modes: Quick (<=5 tasks, no phases) and Project (phased roadmap)
- Emit `GSD_*` events on plan/wave/verification operations
- Auto-generate fix plans from verification failures

**Exit Criteria:**
- [ ] Swarm decomposition produces valid PLAN.md with XML tasks and wave assignments
- [ ] Wave calculator groups independent tasks correctly
- [ ] Verification engine checks truths, artifacts, and key_links
- [ ] STATE.md tracks progress across sessions (survives context death)
- [ ] Quick and Project modes both functional
- [ ] `GSD_*` events emitted and stored
- [ ] Verification failure auto-generates fix plan (max 3 iterations)

---

### Phase 5: Queen/Worker Protocol <!-- cortex-rxxnfk-ml37n73640h -->

**Goal:** Port Cortex's formal coordination protocol into swarm for structured multi-agent orchestration.

**Dependencies:** Phase 1 (event types), Phase 2 (memory for learning promotion), Phase 4 (GSD for verification)
**Research:** No (spec complete in `03-INTEGRATION-SWARM-QUEEN-WORKER.md`)
**Depth:** comprehensive
**Timeline:** Week 4-5
**Requirements:** R5, R7

**Scope:**
- Implement Zod schemas for all 17 message types (discriminated union) per `details/structured-mail-protocol.md`
- Build Queen monitor loop (watch status, check mail, make decisions)
- Implement worker lifecycle (PICKUP -> ORIENT -> PLAN -> EXECUTE -> VERIFY -> LEARN -> REPORT -> CLOSE)
- Enforce worker guardrails (no cross-bead mutation, no epic creation, no long-term memory promotion)
- Build learning promoter (Queen promotes short-term -> long-term memory)
- Implement decision boundaries (autonomous vs human-escalation) per `details/queen-decision-boundaries.md`
- Create Queen and Worker agent prompt templates
- Emit `QUEEN_*` and `WORKER_*` events
- 3-strike review rule wired into Queen's review handler

**Exit Criteria:**
- [ ] All 17 message types validated by Zod schemas
- [ ] Queen monitor loop responds to worker messages within one poll cycle
- [ ] Workers follow 8-step lifecycle (verified by integration tests)
- [ ] Guardrails enforce scope boundaries (test: worker attempt to create epic -> rejected)
- [ ] Learning promoter moves memories from short-term to long-term
- [ ] Decision boundaries respected (autonomous decisions proceed, escalation triggers pause)
- [ ] Agent prompts generate well-formed workers that follow protocol
- [ ] All existing swarm coordinator tests still pass

---

## Milestones

| Milestone | Phases | Criteria | Target |
|-----------|--------|----------|--------|
| **Fork Ready** | 1 | Builds, tests pass, renamed, event types added | End of Week 1 |
| **Smart Memory** | 1-2 | Hivemind has 80/20 ranking, decay tiers, privacy filter | End of Week 2 |
| **Task Graph** | 1-3 | Beads bridge operational, ready-work drives assignment | End of Week 3 |
| **Structured Execution** | 1-4 | PLAN.md generation, wave execution, verification works | End of Week 4 |
| **Full Protocol** | 1-5 | Queen/Worker protocol enforced, all systems integrated | End of Week 5 |

## Risk Register

| # | Risk | Impact | Likelihood | Mitigation |
|---|------|--------|------------|------------|
| 1 | **Upstream divergence** — joelhooks/swarm-tools evolves, fork falls behind | Medium | High | Monthly cherry-picks, modular changes (new files over edits), upstream remote |
| 2 | **Memory migration data loss** — schema changes corrupt hivemind data | High | Medium | Additive migrations (DEFAULT NULL), backup before migrate, forward-only |
| 3 | **bd CLI fragility** — Go binary install fails, output format changes | High | Medium | Pin bd version, validate JSON output, graceful fallback to hive table |
| 4 | **GSD complexity** — Wave execution + verification adds orchestration complexity | Medium | Medium | Start Quick Mode only, defer Project Mode, keep GSD optional |
| 5 | **Queen/Worker overhead** — Protocol adds latency vs informal communication | Medium | Low | Zod validation <1ms, optional strict mode, benchmark against current swarm |
| 6 | **Test migration effort** — Porting 93 Cortex tests may be non-trivial | Low | Medium | Port incrementally per module, keep Cortex repo as assertion reference |

## Dependency Graph

```
Phase 1: Fork & Stabilize
    |
    ├──> Phase 2: Memory Enhancement
    |       |
    |       └──────────────────────┐
    |                              |
    ├──> Phase 3: Beads Bridge     |
    |       |                      |
    |       └──> Phase 4: GSD      |
    |               |              |
    |               └──> Phase 5: Queen/Worker
    |                      ^
    |                      |
    └──────────────────────┘
```

Phase 5 depends on Phases 1, 2, and 4. Phases 2 and 3 can run in parallel after Phase 1.
