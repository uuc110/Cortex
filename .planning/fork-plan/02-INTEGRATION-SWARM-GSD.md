# 02 — GSD Integration: Structured Execution for Swarm

## Overview

GSD (Get Shit Done) adds what swarm lacks: **structured plans**, **wave-based parallel execution**, and **goal-backward verification**. Swarm excels at decomposition, coordination, and communication — but has no concept of *how* tasks execute, *what order* they run in, or *whether the collective result meets the original goal*.

This document specifies how GSD's execution model integrates into Cortex's Queen/Worker architecture.

---

## What GSD Adds That Swarm Lacks

| Capability | Swarm Today | With GSD |
|---|---|---|
| **Plan format** | Beads (flat task list with deps) | PLAN.md with YAML frontmatter + XML tasks + context + verification |
| **Execution order** | Workers grab next ready bead | Wave calculator groups independent tasks; execute wave-by-wave |
| **Parallelism strategy** | Ad-hoc (file reservations prevent conflicts) | Computed waves — tasks in same wave proven independent |
| **Verification** | Worker self-check (build/test/lint) | Goal-backward: must_haves with truths/artifacts/key_links |
| **State tracking** | Bead status only | STATE.md persists progress, decisions, context across sessions |
| **Research phase** | Memory recall only | Multi-round librarian research before planning |
| **Project structure** | None | `.planning/` directory with PROJECT.md, ROADMAP.md, STATE.md |
| **Execution modes** | Single mode | Quick Mode (≤5 tasks) vs Project Mode (phased delivery) |
| **Fix generation** | Manual | Verification failures auto-generate fix plans |

---

## Integration Points

### 1. Decompose → PLAN.md Generation

**Current flow:** `swarm_decompose()` produces a cell tree (epic + subtasks with files).

**Integrated flow:**
```
swarm_decompose(task)
  → CellTree { epic, subtasks[] }
  → wave_calculator(subtasks, dependencies)
  → Wave[] { wave_number, tasks[] }
  → for each subtask: generate PLAN.md
  → place in .planning/quick/{bead_id}/01-PLAN.md
```

The existing `plan-generator.ts` (in `src/bridge/`) already produces PLAN.md from `PlanContext`. Integration means:
1. Wave calculator assigns `wave` number to each task
2. PLAN.md frontmatter includes wave assignment
3. Tasks in the same wave can be dispatched to workers simultaneously

### 2. Workers Execute Waves

**Current flow:** Queen polls `bd ready`, assigns next available task to a worker.

**Integrated flow:**
```
Queen: compute waves from epic tasks + dependencies
Queen: for wave_n in waves:
  Queen: dispatch all wave_n tasks to workers simultaneously
  Queen: wait for all wave_n workers to complete
  Queen: run wave-level verification (build, tests)
  Queen: if any failures → create fix tasks, re-run wave
  Queen: proceed to wave_n+1
```

Workers don't change — they still pick up a single task, load context, execute, verify, and report. The Queen's monitor loop becomes wave-aware.

### 3. Review Gate per Wave

After each wave completes:
1. Queen runs integration tests (not just unit tests)
2. Queen checks that wave outputs are consistent with each other
3. If review gate fails → fix tasks are created as new beads
4. Fix tasks run as an additional "fix wave" before proceeding

### 4. GSD Verification After All Waves

After the final wave:
1. Queen runs goal-backward verification
2. Checks `must_haves` from the original decomposition
3. Produces verification report (pass/fail with gaps)
4. If gaps → generates fix plan → executes fix tasks → re-verifies (up to 3 iterations)

---

## Two Execution Modes

### Quick Mode (`cortex goal`)

For small, well-defined goals.

```
User: cortex goal "Add dark mode toggle"

Queen:
  1. Query memory for "dark mode" patterns
  2. Decompose → 3 tasks (toggle component, CSS variables, persistence)
  3. Wave calculator → 2 waves:
     - Wave 1: CSS variables (no deps)
     - Wave 2: toggle component + persistence (depends on CSS vars)
  4. Generate PLAN.md for each task
  5. Execute wave 1 → verify → execute wave 2 → verify
  6. Goal-backward verification: must_haves check
  7. Store learnings, close epic
```

**Characteristics:**
- Single PLAN.md per task (placed in `.planning/quick/{bead_id}/`)
- ≤5 tasks total
- No ROADMAP.md, no phases
- No research phase (memory recall is sufficient)
- Single epic, 1–3 waves

**Directory structure:**
```
.planning/
├── quick/
│   ├── bd-a3f8.1/
│   │   └── 01-PLAN.md
│   ├── bd-a3f8.2/
│   │   └── 01-PLAN.md
│   └── bd-a3f8.3/
│       └── 01-PLAN.md
└── STATE.md          # Optional — only if resumed
```

### Project Mode (`cortex project`)

For large, multi-phase projects.

```
User: cortex project "Build payment system with subscriptions"

Queen:
  1. Research phase (librarian agent: Stripe docs, existing code patterns)
  2. Discussion phase (capture user preferences: which provider? billing cycle?)
  3. Generate ROADMAP.md with phases + milestones
  4. For each phase:
     a. Create epic in bd
     b. Decompose phase into tasks
     c. Wave calculator → group into waves
     d. Generate PLAN.md for each task
     e. Execute waves sequentially
     f. Phase-level verification
     g. Milestone gate (may require human checkpoint)
  5. Project-level verification
  6. Store learnings, close all epics
```

**Characteristics:**
- ROADMAP.md → multiple phase PLAN.md files
- Each phase = separate epic in bd
- Phases execute sequentially (phase 2 after phase 1 verified)
- Within each phase: tasks execute in parallel waves
- Research phase before planning
- STATE.md tracks progress across sessions
- Milestones with definition of done

**Directory structure:**
```
.planning/
├── PROJECT.md                      # Project description, goals, constraints
├── ROADMAP.md                      # Phases, milestones, acceptance criteria
├── STATE.md                        # Current progress, decisions, context
├── research/
│   └── findings.md                 # Research phase output
├── phases/
│   ├── 01-foundation/
│   │   ├── 01-PLAN.md              # Phase 1 plan with wave-assigned tasks
│   │   ├── 02-PLAN.md              # Fix plan (if verification failed)
│   │   └── 001-SUMMARY.md          # Phase completion summary
│   └── 02-integration/
│       ├── 01-PLAN.md
│       └── 001-SUMMARY.md
└── config.json                     # Mode, depth, workflow settings
```

### Mode Selection Heuristic

| Signal | Quick Mode | Project Mode |
|---|---|---|
| Task count estimate | ≤5 | >5 |
| Has external dependencies | No | Yes (APIs, libraries) |
| Requires research | No | Yes |
| Spans multiple modules | ≤2 modules | >2 modules |
| User command | `cortex goal` | `cortex project` |
| Estimated effort | Hours | Days–weeks |

---

## Research Phase (Project Mode Only)

Before planning, the Queen spawns a librarian agent for research:

```
Queen: cortex_research({ project_key })
  → Librarian agent gathers:
     1. Existing code patterns (explore agent scans codebase)
     2. External documentation (librarian queries official docs)
     3. Similar past work (hivemind_find for prior solutions)
     4. Constraints and risks (from codebase analysis)
  → Output: .planning/research/findings.md
  → Findings feed into decomposer context
```

Research is **multi-round** — the librarian may discover follow-up questions and iterate (max 3 rounds).

Research findings are structured:
```markdown
## Findings

### Existing Patterns
- <what the codebase already does relevant to this goal>

### External Dependencies
- <libraries, APIs, services needed>

### Constraints
- <hard constraints from the codebase or infrastructure>

### Risks
- <things that could go wrong, unknowns>

### Recommendations
- <suggested approach based on findings>
```

---

## Wave Calculator

The wave calculator is the key algorithm that transforms a flat dependency graph into ordered parallel groups.

**Input:** Tasks with dependencies (from PLAN.md XML or beads dependency graph).

**Output:** `Wave[]` where each wave contains tasks that can run in parallel.

**Algorithm:** Topological sort → group by dependency depth → each group = wave.

See: [details/wave-calculator-algorithm.md](details/wave-calculator-algorithm.md)

### Wave Execution Protocol

```
for each wave in waves:
  1. DISPATCH: Send all wave tasks to workers simultaneously
     - Each worker gets its own PLAN.md
     - File reservations prevent conflicts
     - Workers can mail each other within a wave

  2. MONITOR: Queen watches for completion/blocking
     - Poll bd status every 3s (configurable)
     - Check swarm mail inbox for [BLOCKED], [HELP], [DISCOVERY]
     - Handle discoveries (approve/reject new child beads)

  3. WAIT: All wave tasks must complete or be explicitly deferred
     - Timeout: configurable (default 30min per wave)
     - If timeout → mark remaining as blocked, notify user

  4. VERIFY: Run wave-level checks
     - Build passes
     - All tests pass (not just per-task, but integration)
     - No type errors
     - If fails → create fix tasks as new wave

  5. ADVANCE: Move to next wave
     - Update STATE.md with completed wave
     - Workers in next wave can see results from this wave
```

---

## Verification Model

Verification is **goal-backward** — start from the desired outcome and verify that preconditions are met.

See: [details/verification-model.md](details/verification-model.md)

### Four Verification Levels

| Level | Who | When | What |
|---|---|---|---|
| **Per-task** | Worker | After each task | Build, tests, lint, type-check |
| **Per-wave** | Queen | After each wave completes | Integration tests, cross-task consistency |
| **Per-plan** | Queen | After all waves complete | Goal-backward must_haves check |
| **Per-phase** | Queen | After phase milestone | Full verification suite + milestone DoD |

### must_haves Format

```yaml
must_haves:
  truths:
    - "Dark mode toggle persists user preference across sessions"
    - "CSS variables switch between light and dark themes"
  artifacts:
    - path: "src/components/ThemeToggle.tsx"
      check: "substantive"  # exists + non-trivial content
    - path: "src/styles/themes.css"
      check: "wired"  # exists + imported + actually used
  key_links:
    - from: "ThemeToggle"
      to: "ThemeProvider"
      type: "renders-within"
    - from: "themes.css"
      to: "index.html"
      type: "imported-by"
```

---

## PLAN.md Template

Each task generates a PLAN.md file that the worker's GSD executor consumes.

See: [details/plan-md-template.md](details/plan-md-template.md)

The existing `src/bridge/plan-generator.ts` already implements `generatePlanMd()` which produces the core template. Integration extends this with:
1. Wave number in frontmatter
2. Must-haves section for verification criteria
3. Research context (when available)
4. Checkpoint gates (for human-in-loop tasks)

---

## STATE.md Tracking

STATE.md persists execution state across sessions for resumability.

```markdown
---
mode: quick | project
status: planning | researching | executing | verifying | completed | failed
current_wave: 2
current_phase: 1
last_updated: 2026-02-01T09:00:00Z
---

## Progress

### Wave 1 (completed)
- [x] bd-a3f8.1: CSS variables — commit a1b2c3d
- [x] bd-a3f8.2: Theme context — commit e4f5g6h

### Wave 2 (in_progress)
- [ ] bd-a3f8.3: Toggle component — worker-2 (60%)
- [x] bd-a3f8.4: Persistence — commit i7j8k9l

### Wave 3 (pending)
- [ ] bd-a3f8.5: Integration tests

## Decisions
- 2026-02-01: Using CSS custom properties (not CSS-in-JS) per user preference
- 2026-02-01: localStorage for persistence (not cookie)

## Context
- Theme system follows existing pattern in src/styles/
- Must support SSR (no window access at import time)
```

**Resume protocol:**
```
cortex resume
  → Read STATE.md
  → Find current_wave, current_phase
  → Check bd status for incomplete tasks
  → Re-dispatch incomplete tasks to workers
  → Continue from where it left off
```

---

## Integration with Existing Cortex Code

### What Exists Today

| Module | File | Status | Integration Need |
|---|---|---|---|
| Plan generator | `src/bridge/plan-generator.ts` | ✅ Working | Add wave number, must_haves, research context |
| Summary reader | `src/executor/summary-reader.ts` | ✅ Working | No changes needed |
| Git commit | `src/executor/git-commit.ts` | ✅ Working | No changes needed |
| Bead client | `src/bridge/bead-client.ts` | ✅ Working | Use for dependency graph input to wave calculator |
| Mail | `src/mail/` | ✅ Working | Use for wave coordination |
| Events | `src/events/` | ✅ Working | Add wave_started, wave_completed, verification_* events |

### What Needs To Be Built (Phase 3)

| Component | File | Description |
|---|---|---|
| Wave calculator | `src/executor/wave-calculator.ts` | Topological sort + depth grouping |
| Wave runner | `src/executor/wave-runner.ts` | Dispatch wave tasks, monitor, wait, verify |
| Checkpoint system | `src/executor/checkpoint.ts` | Human-in-loop gates |
| Deviation handler | `src/executor/deviation-handler.ts` | Auto-fix bugs during execution |
| STATE.md writer | `src/executor/state-writer.ts` | Persist/read STATE.md |
| Worker aggregator | `src/executor/result-aggregator.ts` | Collect parallel worker results |

### What Needs To Be Built (Phase 4)

| Component | File | Description |
|---|---|---|
| Goal-backward verifier | `src/verifier/index.ts` | Must-haves checker |
| Truth checker | `src/verifier/truth-checker.ts` | Observable truth verification |
| Artifact checker | `src/verifier/artifact-checker.ts` | File existence + content + wiring |
| Key link checker | `src/verifier/link-checker.ts` | Cross-component connection validation |
| Fix plan generator | `src/verifier/fix-plan.ts` | Gap → fix task creation |

### What Needs To Be Built (Phase 5)

| Component | File | Description |
|---|---|---|
| Multi-round researcher | `src/research/index.ts` | Iterative question → gather → refine |
| Must-haves deriver | `src/research/must-haves.ts` | Goal → verification criteria |
| Plan checker | `src/research/plan-checker.ts` | Validates plans achieve goals |

---

## Event Types (New)

These events extend the existing event system:

```typescript
// Wave execution events
type WaveEvent =
  | { type: "wave_started"; data: { epic_id: string; wave_number: number; task_ids: string[] } }
  | { type: "wave_completed"; data: { epic_id: string; wave_number: number; results: TaskResult[] } }
  | { type: "wave_failed"; data: { epic_id: string; wave_number: number; failures: string[] } }

// Verification events
type VerificationEvent =
  | { type: "verification_started"; data: { scope: "task" | "wave" | "plan" | "phase"; target_id: string } }
  | { type: "verification_passed"; data: { scope: string; target_id: string; report: VerificationReport } }
  | { type: "verification_failed"; data: { scope: string; target_id: string; gaps: Gap[] } }

// Fix plan events
type FixPlanEvent =
  | { type: "fix_plan_generated"; data: { source_verification: string; fix_tasks: string[] } }
  | { type: "fix_plan_completed"; data: { fix_tasks: string[]; re_verification_passed: boolean } }

// Research events (Project Mode)
type ResearchEvent =
  | { type: "research_started"; data: { project_key: string; round: number } }
  | { type: "research_completed"; data: { project_key: string; findings_path: string } }
```

---

## Configuration Additions

```json
{
  "execution": {
    "gsd_mode": "auto",
    "wave_timeout_ms": 1800000,
    "max_fix_iterations": 3,
    "checkpoint_between_waves": false,
    "verify_after_each_wave": true,
    "parallel_workers_per_wave": 4
  },
  "verification": {
    "run_after_plan": true,
    "run_after_phase": true,
    "truth_check_command": "bun test",
    "artifact_check_level": "wired",
    "max_reverify_attempts": 3
  },
  "research": {
    "max_rounds": 3,
    "max_searches_per_round": 5,
    "cross_validate": true
  }
}
```

---

## Mapping to ROADMAP Phases

This integration plan maps directly to the CortexV2 ROADMAP:

| ROADMAP Phase | GSD Component | This Doc Section |
|---|---|---|
| Phase 3: Execution Engine | Wave calculator, wave runner, checkpoints, STATE.md | Wave Calculator, Wave Execution Protocol |
| Phase 4: Verification Engine | Goal-backward verifier, artifact checker, fix plan generator | Verification Model |
| Phase 5: Research & Planning | Multi-round researcher, must-haves derivation, plan checker | Research Phase |
| Phase 6: Plugin & MCP Tools | cortex_decompose, cortex_verify, cortex_research tools | (deferred to Phase 6 doc) |

---

## Summary

GSD integration transforms Cortex from a task dispatcher into a **structured execution engine**:

1. **Before:** Queen grabs ready beads, sends to workers one at a time
2. **After:** Queen computes waves, dispatches parallel batches, verifies each wave, runs goal-backward verification

The key primitives are:
- **Wave calculator** — Turns dependency graph into parallel execution groups
- **PLAN.md** — Structured task specification that workers consume
- **Goal-backward verification** — Ensures the collective result meets the original intent
- **STATE.md** — Enables session resumability
- **Two modes** — Quick for small goals, Project for large goals with research + phases
