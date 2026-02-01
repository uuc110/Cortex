# Orchestration Analysis: Swarm-Tools vs Cortex Plan

**Purpose:** This document is the canonical reference for WHY Cortex's orchestration model is superior to vanilla swarm-tools. Any agent implementing Phase 5 MUST read this first to understand the motivation behind every design decision.

**Created:** 2026-02-01
**Based On:** Direct code analysis of `packages/opencode-swarm-plugin/src/` + specs in `.planning/fork-plan/`

---

## Executive Summary

Swarm-tools has **excellent infrastructure** (event sourcing, mail, memory, learning, evals, review gate, skills) but **mediocre orchestration**. The coordinator is passive, workers are dumb, there's no concept of parallel waves, verification is shallow, and nothing persists between sessions.

Cortex's plan upgrades the orchestration layer while keeping swarm's infrastructure intact. This is the correct approach — rebuild the ~30% that's weak, keep the ~70% that's strong.

---

## 1. Swarm's Current Architecture (What EXISTS)

### 1.1 Coordinator (Passive)

**File:** `swarm-orchestrate.ts` (1,500+ lines)

The coordinator does:
- `swarm_init()` — checks tool availability, discovers skills
- `swarm_status()` — queries epic subtasks, counts statuses
- `swarm_progress()` — workers report status, auto-checkpoint at 25/50/75%
- `swarm_complete()` — verification gate → close cell → emit events → record outcome
- `swarm_broadcast()` — context sharing across workers

**What it does NOT do:**
- ❌ Does NOT decide what order tasks run in
- ❌ Does NOT compute which tasks can be parallel
- ❌ Does NOT make decisions (approve/reject scope changes)
- ❌ Does NOT verify that the COLLECTIVE result is correct
- ❌ Does NOT promote learnings from workers
- ❌ Does NOT actively monitor workers or intervene
- ❌ Does NOT persist execution state across sessions

### 1.2 Decomposition (Good)

**Files:** `swarm-strategies.ts`, `swarm-prompts.ts`, `swarm-decompose.ts`

4 strategies (file-based, feature-based, risk-based, research-based) with keyword matching. Produces a `CellTree` with epic + subtasks + files + dependencies. Memory-augmented prompts include hivemind history and CASS context. This is well-built.

### 1.3 Worker Handoff (Basic)

**File:** `swarm-orchestrate.ts` → `generateWorkerHandoff()`

Workers receive a `WorkerHandoff` Zod schema with:
- `contract.files_owned` — what they can modify
- `contract.success_criteria` — what success looks like
- `context.epic_summary` — what the overall goal is
- `escalation.scope_change_protocol` — how to request scope changes

Contract validation checks `files_touched ⊆ files_owned` with glob support.

**What it DOESN'T include:**
- ❌ No sibling context (what other workers are doing)
- ❌ No dependency context (what was already completed)
- ❌ No memory context (relevant past learnings)
- ❌ No wave assignment (which batch this task belongs to)

### 1.4 Verification (Shallow)

**File:** `swarm-verify.ts` (331 lines)

Two checks:
1. `runTypecheckVerification()` — `tsc --noEmit`
2. `runTestVerification(filesTouched)` — finds `*.test.ts` / `*.spec.ts` → `bun test`

**What it DOESN'T check:**
- ❌ No integration tests (cross-task consistency)
- ❌ No goal-backward verification (did the feature actually work?)
- ❌ No artifact verification (do the right files exist with the right content?)
- ❌ No key-link verification (are components properly wired together?)

### 1.5 Review Gate (Good)

**File:** `swarm-review.ts`

- 3-strike rule (task blocked after 3 rejections)
- Structured feedback with file/line/issue/suggestion
- Epic-aware review context (understands overall goal)
- Review attempt tracking per task

### 1.6 Coordinator Guard (Good)

**File:** `coordinator-guard.ts`

Hard blocks coordinator from:
- Editing files (must spawn workers)
- Running tests (workers verify their own work)
- Reserving files (workers handle reservations)

### 1.7 Learning System (Good)

**Files:** `learning/` directory, `swarm-orchestrate.ts` → `swarm_record_outcome`

- Pattern maturity (candidate → established → proven)
- Anti-pattern detection with confidence scoring
- Strategy insights (success rates by decomposition strategy)
- File insights (per-file gotchas from past outcomes)

---

## 2. What Cortex's Plan Adds (What's MISSING from Swarm)

### 2.1 Wave-Based Parallel Execution (CRITICAL GAP)

**Spec:** `02-INTEGRATION-SWARM-GSD.md` lines 48-63, `details/wave-calculator-algorithm.md`

**The Problem:** Swarm has dependencies in its decomposition output but NEVER USES THEM for execution ordering. Workers just grab the next "ready" bead. There is no concept of "these 3 tasks are independent and should run simultaneously, and tasks 4-5 must wait for them."

**The Solution:**
```
wave_calculator(subtasks, dependencies) → Wave[]
  Wave 1: [T1, T2, T3]  ← independent, run in parallel
  Wave 2: [T4, T5]      ← depend on wave 1, run after
  Wave 3: [T6]           ← depends on wave 2
```

**Implementation:** Phase 4 already built `wave-calculator.ts` with topological sort, cycle detection, and file conflict detection. What's MISSING is wiring it into the coordinator's dispatch loop.

### 2.2 Active Queen vs Passive Coordinator (CRITICAL GAP)

**Spec:** `03-INTEGRATION-SWARM-QUEEN-WORKER.md` section 2

**Swarm Today:**
```
Coordinator: decompose → spawn workers → wait → check status when asked
```

**Cortex Queen:**
```
Queen: decompose → compute waves → dispatch wave 1 → poll inbox →
  classify messages → make decisions → review completions →
  verify wave → dispatch wave 2 → ... → verify phase →
  promote learnings → emit goal_completed
```

**State Machine:**
- MONITORING → CLASSIFYING → REVIEWING / DECIDING → MONITORING
- VERIFYING_PHASE → PROMOTING_LEARNINGS → COMPLETE
- Idle timeout → STOPPED

**Decision Boundaries (what Queen handles autonomously):**
- Approve discoveries with priority ≤ P3
- Approve worker recommendations for help requests
- Defer decisions when no recommendation provided
- Block tasks after 3 failed reviews
- Create fix beads for phase verification failures
- Promote learnings with confidence ≥ 0.7

### 2.3 Intelligent Worker Lifecycle (CRITICAL GAP)

**Spec:** `03-INTEGRATION-SWARM-QUEEN-WORKER.md` section 4

**Swarm Worker Today:** Get prompt → implement → call `swarm_complete()`. That's it.

**Cortex Worker (8 steps):**
1. **PICKUP** — Claim bead, update status to in_progress
2. **ORIENT** — Load full context: bead + epic + siblings + deps + memory
3. **PLAN** — Generate local execution plan from context
4. **EXECUTE** — Implement with sub-event handling (stuck → HELP, blocked → BLOCKED, discovers → DISCOVERY)
5. **VERIFY** — Self-verify: build, test, lint, typecheck
6. **LEARN** — Store insights as short-term memory
7. **REPORT** — Send structured [DONE] message with files, commit, learnings
8. **CLOSE** — Close bead with summary

**Key Upgrade — Context Loading:**
```typescript
interface WorkerContext {
  bead: BeadIssue;          // Own task details
  epic: BeadIssue | null;   // Parent epic (overall goal)
  siblings: BeadIssue[];    // What other workers are doing
  dependencies: BeadIssue[]; // What was already completed
  memoryContext: RankedMemory[]; // Relevant past learnings
  projectPath: string;
  projectKey: string;
}
```

Swarm workers don't know what their siblings are doing. Cortex workers know EVERYTHING about the epic context.

### 2.4 Typed Communication Protocol (IMPORTANT GAP)

**Spec:** `details/structured-mail-protocol.md`

**Swarm Today:** Free-text mail with `[TAG]` convention in subject lines. Not enforced. Workers can send malformed messages.

**Cortex:** 17 Zod discriminated union schemas:
- 6 Worker→Queen: STATUS, DONE, BLOCKED, DISCOVERY, DECISION, HELP
- 6 Queen→Worker: APPROVED, REJECTED, DEFERRED, REVIEW, CONTEXT, UNBLOCKED
- 2 Worker→Worker: FILE, READY
- 3 Special: SCOPE_CHANGE, LEARNING, PHASE_GATE

Every message is parsed and validated at runtime. Malformed messages are rejected.

### 2.5 4-Level Verification (IMPORTANT GAP)

**Spec:** `02-INTEGRATION-SWARM-GSD.md` lines 276-303, `details/verification-model.md`

**Swarm:** Per-task only (typecheck + tests).

**Cortex:**
| Level | Who | When | What |
|-------|-----|------|------|
| Per-task | Worker | After each task | Build, tests, lint, typecheck |
| Per-wave | Queen | After wave completes | Integration tests, cross-task consistency |
| Per-plan | Queen | After all waves | Goal-backward must_haves check |
| Per-phase | Queen | After phase milestone | Full verification suite + milestone DoD |

**must_haves Format:**
```yaml
must_haves:
  truths:
    - "Dark mode toggle persists user preference across sessions"
  artifacts:
    - path: "src/components/ThemeToggle.tsx"
      check: "wired"  # exists + imported + actually used
  key_links:
    - from: "ThemeToggle"
      to: "ThemeProvider"
      type: "renders-within"
```

### 2.6 Session Resumability (NICE-TO-HAVE GAP)

**Swarm:** Event log only. No structured state file. If session crashes, you manually reconstruct.

**Cortex:** STATE.md tracks:
- Current wave number
- Current phase
- Completed tasks with commits
- In-progress tasks with worker assignments
- Decisions made
- Context (user preferences, constraints)

Resume protocol: Read STATE.md → find current_wave → check bead status → re-dispatch incomplete tasks.

### 2.7 Research Phase (NICE-TO-HAVE GAP)

**Swarm:** `hivemind_find()` for memory recall. No active research.

**Cortex (Project Mode):** Multi-round librarian research → findings.md:
1. Explore agent scans codebase for existing patterns
2. Librarian queries official docs
3. Hivemind searches past solutions
4. Up to 3 rounds of follow-up questions
5. Output: structured findings.md that feeds into decomposer

### 2.8 Two Execution Modes (NICE-TO-HAVE GAP)

**Swarm:** Single mode — every task treated the same.

**Cortex:**
- **Quick Mode** (`cortex goal`): ≤5 tasks, single epic, no research, no phases, 1-3 waves
- **Project Mode** (`cortex project`): Multi-phase, research phase, ROADMAP.md, phase-level verification, milestones

---

## 3. What Swarm Already Does WELL (Don't Rebuild)

| Component | Quality | Keep As-Is? |
|-----------|---------|-------------|
| Event sourcing (56+ types, Zod-validated) | ⭐⭐⭐⭐⭐ | YES |
| Swarm Mail (messages, threads, reservations) | ⭐⭐⭐⭐ | YES |
| Hivemind memory (smart upsert, entity extraction, CASS) | ⭐⭐⭐⭐ | YES (already enhanced in Phase 2) |
| Learning system (maturity, anti-patterns, insights) | ⭐⭐⭐⭐ | YES |
| Review gate (3-strike, adversarial, epic-aware) | ⭐⭐⭐⭐ | YES — extend with Queen review handler |
| Coordinator guard (hard blocks on file edits) | ⭐⭐⭐⭐ | YES — complementary to Queen guardrails |
| Decomposition (4 strategies, memory-augmented) | ⭐⭐⭐⭐ | YES — extend output with wave assignments |
| Worker handoff (contract, escalation) | ⭐⭐⭐ | YES — extend with context loading |
| Eval pipeline (Evalite, 3 test suites) | ⭐⭐⭐⭐ | YES |
| Skills system | ⭐⭐⭐⭐ | YES |
| Checkpoint/recovery (25/50/75%) | ⭐⭐⭐ | YES — extend with wave-level checkpoints |

---

## 4. Implementation Strategy

### Principle: Extend, Don't Replace

Every upgrade should be a NEW module that works alongside existing code:
- `src/queen/` — NEW directory, extends existing coordinator
- `src/worker/` — NEW directory, extends existing worker handoff
- `src/gsd/` — ALREADY BUILT (Phase 4), needs wiring to coordinator

### What Gets Modified (Minimally)

| Existing File | Change | Why |
|---------------|--------|-----|
| `swarm-orchestrate.ts` | Add wave-aware dispatch in `swarm_complete` | Need to trigger next wave after current completes |
| `swarm-prompts.ts` | Extend `SUBTASK_PROMPT_V2` with context loader output | Workers need richer context |
| `swarm-decompose.ts` | Add wave assignment to decomposition output | Wave calculator runs after decomposition |
| `swarm-verify.ts` | Add integration test support for wave-level verification | Per-wave verification needs broader test scope |

### What Gets Created (New)

| New Path | Purpose |
|----------|---------|
| `src/queen/message-types.ts` | 17 Zod discriminated union schemas |
| `src/queen/monitor.ts` | Inbox polling, message classification, routing |
| `src/queen/decision-handler.ts` | Discovery/decision/help request handling |
| `src/queen/review-handler.ts` | Verification + 3-strike (extends existing review gate) |
| `src/queen/learning-promoter.ts` | Short-term → long-term memory promotion |
| `src/queen/phase-verifier.ts` | End-of-phase verification + fix bead creation |
| `src/queen/wave-dispatcher.ts` | Wave-aware task dispatch using GSD wave calculator |
| `src/queen/index.ts` | Barrel exports |
| `src/worker/lifecycle.ts` | 8-step execution engine |
| `src/worker/context-loader.ts` | Bead + epic + siblings + deps + memory |
| `src/worker/self-verifier.ts` | Build/test/lint/typecheck |
| `src/worker/mail-sender.ts` | Typed message sending helpers |
| `src/worker/discovery-handler.ts` | Child bead creation + mapping + mail |
| `src/worker/index.ts` | Barrel exports |

---

## 5. Priority Order

| Priority | Upgrade | Effort | Impact |
|----------|---------|--------|--------|
| P0 | Typed messages (foundation for everything) | Medium | High |
| P0 | Queen monitor + decision handler | Large | High |
| P0 | Worker lifecycle + context loader | Large | High |
| P1 | Wave dispatcher (GSD → swarm wiring) | Medium | High |
| P1 | 4-level verification | Medium | High |
| P2 | Learning promoter | Small | Medium |
| P2 | Phase verifier | Medium | Medium |
| P3 | STATE.md persistence | Small | Medium |
| P3 | Research phase | Medium | Low (nice-to-have) |
| P4 | Two execution modes | Medium | Low (Quick Mode first) |

---

## References

| Document | Path | Lines |
|----------|------|-------|
| Fork Master Plan | `.planning/fork-plan/00-FORK-MASTER-PLAN.md` | 526 |
| GSD Integration Spec | `.planning/fork-plan/02-INTEGRATION-SWARM-GSD.md` | 498 |
| Queen/Worker Spec | `.planning/fork-plan/03-INTEGRATION-SWARM-QUEEN-WORKER.md` | 489 |
| Structured Mail Protocol | `.planning/fork-plan/details/structured-mail-protocol.md` | ~200 |
| Queen Decision Boundaries | `.planning/fork-plan/details/queen-decision-boundaries.md` | ~150 |
| Wave Calculator Algorithm | `.planning/fork-plan/details/wave-calculator-algorithm.md` | ~100 |
| Verification Model | `.planning/fork-plan/details/verification-model.md` | ~150 |
| Coordinator guard (code) | `packages/opencode-swarm-plugin/src/coordinator-guard.ts` | 239 |
| Swarm orchestrate (code) | `packages/opencode-swarm-plugin/src/swarm-orchestrate.ts` | 1500+ |
| Swarm verify (code) | `packages/opencode-swarm-plugin/src/swarm-verify.ts` | 331 |
| Swarm review (code) | `packages/opencode-swarm-plugin/src/swarm-review.ts` | 500+ |
| Swarm prompts (code) | `packages/opencode-swarm-plugin/src/swarm-prompts.ts` | 500+ |
| GSD modules (Phase 4) | `packages/opencode-swarm-plugin/src/gsd/` | 3,800 |
