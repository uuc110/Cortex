# Phase 4: GSD Integration

**Phase:** 4 — GSD Integration
**Epic:** `cortex-rxxnfk-ml37n3mczeb`
**Status:** In Progress (code complete, uncommitted, 584 tests pass)
**Created:** 2026-02-01
**Requirements:** R4, R7

---

## Objective

Add GSD (Get Shit Done) structured execution to swarm: PLAN.md generation from decomposition, wave-based parallel execution via topological sort, goal-backward verification with must_haves (truths/artifacts/key_links), and STATE.md persistence for cross-session tracking.

## Context

### Current State
- **Code exists** in `packages/opencode-swarm-plugin/src/gsd/` — 8 modules, ~3,800 source lines
- **584 tests pass**, 0 failures across 10 test files (~7,500 test lines)
- **NOT committed** — files are untracked in git
- Builds on Phase 1 event types (GSD_* events) and Phase 3 beads bridge (dependency graph)

### Reference
- `.planning/fork-plan/02-INTEGRATION-SWARM-GSD.md` — full spec
- `.planning/fork-plan/details/wave-calculator-algorithm.md` — wave calc algorithm
- `.planning/fork-plan/details/verification-model.md` — verification spec
- `cortex-refs/get-shit-done/` — original GSD framework

## What Was Built

8 modules in `packages/opencode-swarm-plugin/src/gsd/`:

| Module | File | Lines | Tests | Purpose |
|--------|------|-------|-------|---------|
| **gsd-types** | `gsd-types.ts` | 358 | 64+94=158 | Enums, interfaces, type guards for plans, tasks, waves, verification |
| **gsd-events** | `gsd-events.ts` | 259 | 747+641=~200 | 15 GSD_* event factory functions (plan/wave/task/verification/state/fix/research/roadmap) |
| **wave-calculator** | `wave-calculator.ts` | 238 | 616 | `createWaveCalculator()` — topological sort → parallel wave groups, cycle detection, file conflict detection |
| **plan-generator** | `plan-generator.ts` | 579 | 935 | `createPlanGenerator()` — PLAN.md generation, XML task parsing, frontmatter, validation |
| **verification-engine** | `verification-engine.ts` | 531 | 1,136 | `createVerificationEngine()` — truths checker, artifact verifier (existence→substantive→wired), key-link validator, fix plan generator |
| **state-manager** | `state-manager.ts` | 573 | 714 | `createStateManager()` — STATE.md serialize/deserialize, task/wave status updates, progress tracking, save/load |
| **gsd-orchestrator** | `gsd-orchestrator.ts` | 530 | 1,012 | `createGsdOrchestrator()` — wave execution loop, task dispatch, checkpoint gates, deviation handling |
| **gsd-integration** | `gsd-integration.ts` | 91 | 507 | `createGsdIntegration()` — wiring layer connecting all modules with event store |
| **index** | `index.ts` | 158 | — | Barrel export (types + functions) |

### Key APIs

```typescript
// Plan Generation
createPlanGenerator(config) → { generatePlan, parsePlan, validatePlan }

// Wave Calculation
createWaveCalculator() → { calculateWaves, validateDependencies, detectFileConflicts }

// Verification
createVerificationEngine(opts) → { verifyTruths, verifyArtifacts, verifyKeyLinks, runFullVerification, generateFixPlan }

// State Management
createStateManager(dir) → { saveState, loadState, updateTaskStatus, updateWaveStatus, getProgress }

// Orchestration
createGsdOrchestrator(deps) → { execute, executeWave, resume }

// Integration (top-level)
createGsdIntegration(config) → { initGsd, executePlan, verifyPhase, resumeExecution }
```

## Tasks

<task type="auto">
  <name>Types + Events + Wave Calculator</name>
  <files>
    packages/opencode-swarm-plugin/src/gsd/gsd-types.ts
    packages/opencode-swarm-plugin/src/gsd/gsd-events.ts
    packages/opencode-swarm-plugin/src/gsd/wave-calculator.ts
    packages/opencode-swarm-plugin/src/gsd/__tests__/gsd-types.test.ts
    packages/opencode-swarm-plugin/src/gsd/__tests__/gsd-events.test.ts
    packages/opencode-swarm-plugin/src/gsd/__tests__/wave-calculator.test.ts
  </files>
  <action>
    1. gsd-types: All GSD enums (modes, statuses, priorities, task types), interfaces
       (GsdPlan, GsdTask, GsdWave, VerificationResult, GsdState), type guards for runtime validation.
    2. gsd-events: 15 event factory functions matching Phase 1 GSD event schemas:
       gsdPlanCreated, gsdWaveStarted, gsdWaveCompleted, gsdWaveFailed, gsdTaskExecuted,
       gsdVerificationRun, gsdVerificationPassed, gsdVerificationFailed, gsdStateUpdated,
       gsdCheckpointGate, gsdFixPlanGenerated, gsdFixPlanCompleted, gsdResearchStarted,
       gsdResearchCompleted, gsdRoadmapPhaseStarted.
    3. wave-calculator: Topological sort of tasks by dependencies → grouped into waves.
       Cycle detection, missing dependency validation, file conflict detection across wave tasks.
  </action>
  <verify>bun test packages/opencode-swarm-plugin/src/gsd/__tests__/gsd-types.test.ts packages/opencode-swarm-plugin/src/gsd/__tests__/wave-calculator.test.ts</verify>
  <done>✅ Types + events + wave calc implemented with full test coverage</done>
</task>

<task type="auto">
  <name>Plan Generator + Verification Engine + State Manager</name>
  <files>
    packages/opencode-swarm-plugin/src/gsd/plan-generator.ts
    packages/opencode-swarm-plugin/src/gsd/verification-engine.ts
    packages/opencode-swarm-plugin/src/gsd/state-manager.ts
    packages/opencode-swarm-plugin/src/gsd/__tests__/plan-generator.test.ts
    packages/opencode-swarm-plugin/src/gsd/__tests__/verification-engine.test.ts
    packages/opencode-swarm-plugin/src/gsd/__tests__/state-manager.test.ts
  </files>
  <action>
    1. plan-generator: Generate PLAN.md with YAML frontmatter + XML task blocks.
       Parse existing PLAN.md files back into GsdPlan objects. Validate plans for
       completeness (every task has files, action, verify, done).
    2. verification-engine: Three verification levels:
       - Truths: Observable user behaviors work (configurable checks)
       - Artifacts: existence → substantive (>10 lines) → wired (imported/referenced)
       - Key links: Critical connections between components verified
       Fix plan generator creates tasks from verification failures (max 3 iterations).
    3. state-manager: Serialize/deserialize GsdState to/from STATE.md.
       Track task and wave statuses, calculate progress percentages.
       Save/load for cross-session persistence.
  </action>
  <verify>bun test packages/opencode-swarm-plugin/src/gsd/__tests__/</verify>
  <done>✅ All three modules implemented with comprehensive tests</done>
</task>

<task type="auto">
  <name>Orchestrator + Integration + Barrel Export</name>
  <files>
    packages/opencode-swarm-plugin/src/gsd/gsd-orchestrator.ts
    packages/opencode-swarm-plugin/src/gsd/gsd-integration.ts
    packages/opencode-swarm-plugin/src/gsd/index.ts
    packages/opencode-swarm-plugin/src/gsd/gsd-orchestrator.test.ts
    packages/opencode-swarm-plugin/src/gsd/gsd-integration.test.ts
  </files>
  <action>
    1. gsd-orchestrator: Wave execution loop — execute tasks wave-by-wave,
       parallel within wave via TaskDispatcher callback. Checkpoint gates between
       waves (human-verify, decision, human-action). Deviation handling for failed tasks.
       Resume from last completed wave via state.
    2. gsd-integration: Top-level wiring that creates all modules with shared config
       and event store adapter. Provides initGsd(), executePlan(), verifyPhase(), resumeExecution().
    3. index.ts: Clean barrel export of all types, factories, and event functions.
  </action>
  <verify>bun test packages/opencode-swarm-plugin/src/gsd/</verify>
  <done>✅ 584 tests pass, 0 failures across all 10 test files</done>
</task>

<task type="checkpoint:human-verify">
  <name>Commit GSD code and verify end-to-end</name>
  <action>
    What-Built:
    Full GSD integration with 8 modules, 584 tests, covering plan generation,
    wave-based execution, goal-backward verification, and state persistence.

    How-To-Verify:
    1. Run all GSD tests: `bun test packages/opencode-swarm-plugin/src/gsd/` — 584 pass, 0 fail
    2. Run typecheck: `bunx turbo build --filter=opencode-swarm-plugin` — passes
    3. Verify no regressions: `bun test packages/opencode-swarm-plugin/` — existing tests still pass
    4. Commit: `git add packages/opencode-swarm-plugin/src/gsd/ && git commit -m "feat(gsd): add GSD integration with wave execution, verification, and state management"`

    Resume-Signal: "committed" or specific feedback
  </action>
</task>

## Exit Criteria

- [x] Plan generator converts decomposition → PLAN.md with XML tasks and wave assignments
- [x] Wave calculator groups independent tasks correctly (topological sort)
- [x] Verification engine checks truths, artifacts, and key_links
- [x] State manager persists progress in STATE.md (survives context death)
- [x] Orchestrator executes waves with checkpoint gates
- [x] GSD event factories match Phase 1 event schemas (15 events)
- [x] 584 tests, 0 failures
- [ ] **PENDING: Code committed to git**
- [ ] **PENDING: Build verified after commit**

## What Remains

1. **Commit the code** — `packages/opencode-swarm-plugin/src/gsd/` is untracked
2. **Wire into swarm decomposition** — connect GSD plan generator to swarm's existing decompose flow
3. **Wire STATE.md into coordinator** — coordinator saves/loads state on session start/end
