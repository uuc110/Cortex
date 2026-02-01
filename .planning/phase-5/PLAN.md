# Phase 5: Orchestration Upgrade — Queen/Worker Protocol + GSD↔Swarm Wiring

**Phase:** 5 — Orchestration Upgrade
**Epic:** `cortex-rxxnfk-ml37n73640h`
**Status:** Not Started
**Created:** 2026-02-01
**Requirements:** R5, R7
**Pre-read REQUIRED:** `.planning/ORCHESTRATION-ANALYSIS.md` (WHY this phase exists)

---

## Why This Phase Exists

Swarm-tools has excellent infrastructure (events, mail, memory, learning, review gate) but **mediocre orchestration**:
- Coordinator is **passive** — decomposes and waits, no active monitoring or decision-making
- Workers are **dumb** — get a prompt and go, no context loading, no self-verification lifecycle
- **Zero wave awareness** — tasks with dependencies execute ad-hoc, not in computed parallel batches
- Verification is **shallow** — per-task typecheck+tests only, no collective result checking
- Communication is **untyped** — free-text mail with `[TAG]` conventions, not enforced
- **No session resumability** — crash = start over

This phase fixes ALL of these. Read `.planning/ORCHESTRATION-ANALYSIS.md` for the full gap analysis with code references.

---

## Architecture Principle: Extend, Don't Replace

Every upgrade is a **NEW module** alongside existing code. We do NOT rewrite swarm-orchestrate.ts or swarm-verify.ts. We build new queen/ and worker/ directories that USE the existing infrastructure.

### What Gets Created (New)

| Path | Purpose | Sub-Plan |
|------|---------|----------|
| `src/queen/message-types.ts` | 17 Zod discriminated union schemas | [01-STRUCTURED-MESSAGES.md](sub-plans/01-STRUCTURED-MESSAGES.md) |
| `src/queen/monitor.ts` | Inbox polling, message classification, routing | [02-QUEEN-PROTOCOL.md](sub-plans/02-QUEEN-PROTOCOL.md) |
| `src/queen/decision-handler.ts` | Discovery/decision/help handling | [02-QUEEN-PROTOCOL.md](sub-plans/02-QUEEN-PROTOCOL.md) |
| `src/queen/review-handler.ts` | Verification + 3-strike rule | [02-QUEEN-PROTOCOL.md](sub-plans/02-QUEEN-PROTOCOL.md) |
| `src/queen/wave-dispatcher.ts` | Wave-aware task dispatch | [04-WAVE-EXECUTION.md](sub-plans/04-WAVE-EXECUTION.md) |
| `src/queen/learning-promoter.ts` | Short-term → long-term memory | [02-QUEEN-PROTOCOL.md](sub-plans/02-QUEEN-PROTOCOL.md) |
| `src/queen/phase-verifier.ts` | End-of-phase verification | [05-VERIFICATION-MODEL.md](sub-plans/05-VERIFICATION-MODEL.md) |
| `src/queen/index.ts` | Barrel exports | — |
| `src/worker/lifecycle.ts` | 8-step execution engine | [03-WORKER-LIFECYCLE.md](sub-plans/03-WORKER-LIFECYCLE.md) |
| `src/worker/context-loader.ts` | Full context gathering | [03-WORKER-LIFECYCLE.md](sub-plans/03-WORKER-LIFECYCLE.md) |
| `src/worker/self-verifier.ts` | Build/test/lint/typecheck | [03-WORKER-LIFECYCLE.md](sub-plans/03-WORKER-LIFECYCLE.md) |
| `src/worker/mail-sender.ts` | Typed message sending | [03-WORKER-LIFECYCLE.md](sub-plans/03-WORKER-LIFECYCLE.md) |
| `src/worker/discovery-handler.ts` | Child bead creation | [03-WORKER-LIFECYCLE.md](sub-plans/03-WORKER-LIFECYCLE.md) |
| `src/worker/index.ts` | Barrel exports | — |

### What Gets Modified (Minimally)

| Existing File | Change | Why |
|---------------|--------|-----|
| `swarm-orchestrate.ts` | Import wave-dispatcher for wave-aware completion | Trigger next wave after current completes |
| `swarm-prompts.ts` | Extend `SUBTASK_PROMPT_V2` with worker context | Workers need richer context |
| `swarm-decompose.ts` | Pipe output through wave calculator | Assign wave numbers to subtasks |

---

## Sub-Plans

Each sub-plan is a self-contained spec with exact TypeScript interfaces, file locations, test requirements, and implementation instructions. An agent can implement any sub-plan independently.

| # | Sub-Plan | What It Covers | Depends On |
|---|----------|---------------|------------|
| 01 | [Structured Messages](sub-plans/01-STRUCTURED-MESSAGES.md) | 17 Zod message type schemas, parse/format/classify | Nothing (foundation) |
| 02 | [Queen Protocol](sub-plans/02-QUEEN-PROTOCOL.md) | Monitor loop, decision handler, review handler, learning promoter | Sub-plan 01 |
| 03 | [Worker Lifecycle](sub-plans/03-WORKER-LIFECYCLE.md) | 8-step lifecycle, context loader, self-verifier, mail sender, discovery handler | Sub-plan 01 |
| 04 | [Wave Execution](sub-plans/04-WAVE-EXECUTION.md) | GSD↔Swarm wiring, wave dispatcher, dispatch→monitor→verify loop | Sub-plans 02, 03, Phase 4 GSD modules |
| 05 | [Verification Model](sub-plans/05-VERIFICATION-MODEL.md) | 4-level verification, must_haves, phase verifier, fix plan auto-generation | Sub-plans 02, 04, Phase 4 verification engine |
| 06 | [Integration Tests](sub-plans/06-INTEGRATION-TESTS.md) | End-to-end scenarios, regression checks | All above |

---

## Wave Analysis (Execution Order)

| Wave | Sub-Plans | Can Parallel? | Rationale |
|------|-----------|---------------|-----------|
| Wave 1 | 01 (Structured Messages) | No — foundation | Everything depends on typed messages |
| Wave 2 | 02 (Queen) + 03 (Worker) | **YES** — different directories | Both depend on 01, not on each other |
| Wave 3 | 04 (Wave Execution) | No | Needs Queen + Worker to exist |
| Wave 4 | 05 (Verification Model) | No | Needs wave execution to test against |
| Wave 5 | 06 (Integration Tests) | No | Needs everything |

---

## Tasks (GSD Format)

### Task 1: Structured Mail Message Types

<task type="auto" wave="1">
  <name>Structured Mail Message Types (Zod Discriminated Union)</name>
  <files>
    packages/opencode-swarm-plugin/src/queen/message-types.ts (NEW)
    packages/opencode-swarm-plugin/src/queen/__tests__/message-types.test.ts (NEW)
  </files>
  <action>
    Implement per sub-plan: sub-plans/01-STRUCTURED-MESSAGES.md

    Summary: 17 Zod discriminated union schemas on `tag` field.
    - 6 Worker→Queen: STATUS, DONE, BLOCKED, DISCOVERY, DECISION, HELP
    - 6 Queen→Worker: APPROVED, REJECTED, DEFERRED, REVIEW, CONTEXT, UNBLOCKED
    - 2 Worker→Worker: FILE, READY
    - 3 Special: SCOPE_CHANGE, LEARNING, PHASE_GATE

    Plus helper functions:
    - parseCortexMessage(subject, body) → CortexMessage | null
    - classifyMessage(subject) → MessageTag | null
    - formatMessageBody(msg) → string
    - createMailEnvelope(msg, from, to, threadId) → ready-to-send mail params

    MUST NOT modify existing swarm-mail send/inbox functions.
    MUST use Zod for runtime validation (not just TypeScript types).
    MUST handle malformed input gracefully (return null, don't throw).
  </action>
  <verify>bun test packages/opencode-swarm-plugin/src/queen/__tests__/message-types.test.ts</verify>
  <done>
    - 17 Zod message schemas in CortexMessageSchema discriminated union
    - parseCortexMessage + classifyMessage + formatMessageBody + createMailEnvelope
    - 30+ tests: all types validate, invalid rejected, round-trip works, edge cases
    - Zero typecheck errors
  </done>
</task>

### Task 2: Queen Monitor + Decision Handler + Review Handler

<task type="auto" wave="2">
  <name>Queen Protocol (Monitor + Decisions + Review)</name>
  <files>
    packages/opencode-swarm-plugin/src/queen/monitor.ts (NEW)
    packages/opencode-swarm-plugin/src/queen/decision-handler.ts (NEW)
    packages/opencode-swarm-plugin/src/queen/review-handler.ts (NEW)
    packages/opencode-swarm-plugin/src/queen/learning-promoter.ts (NEW)
    packages/opencode-swarm-plugin/src/queen/__tests__/monitor.test.ts (NEW)
    packages/opencode-swarm-plugin/src/queen/__tests__/decision-handler.test.ts (NEW)
    packages/opencode-swarm-plugin/src/queen/__tests__/review-handler.test.ts (NEW)
    packages/opencode-swarm-plugin/src/queen/__tests__/learning-promoter.test.ts (NEW)
  </files>
  <action>
    Implement per sub-plan: sub-plans/02-QUEEN-PROTOCOL.md

    Summary: The Queen's brain.
    - monitor.ts: Poll inbox → classify → route to handler. Auto-stop on all-closed or idle timeout.
    - decision-handler.ts: DISCOVERY (priority gate) / DECISION (approve recommendation) / HELP (query memory + approve)
    - review-handler.ts: Verify worker output → approve or request changes. 3-strike blocking.
    - learning-promoter.ts: Find high-confidence short-term memories → promote to long-term.

    MUST use message-types.ts from Task 1 for all communication.
    MUST emit events via existing event sourcing (createEvent + appendEvent from swarm-mail).
    MUST NOT import from original Cortex src/ — rewrite for fork's APIs.
    MUST mock all external dependencies in tests (bd CLI, Bun.spawn, swarm-mail).
  </action>
  <verify>bun test packages/opencode-swarm-plugin/src/queen/__tests__/</verify>
  <done>
    - Queen monitor polls, classifies, routes messages
    - Decision handler handles discoveries (P0-P3 approved, P4+ rejected)
    - Review handler verifies + 3-strike blocks
    - Learning promoter promotes confidence ≥ 0.7
    - 60+ tests across 4 test files
    - Zero typecheck errors
  </done>
</task>

### Task 3: Worker Lifecycle + Context Loader + Self-Verifier

<task type="auto" wave="2">
  <name>Worker Lifecycle (8-Step Execution Engine)</name>
  <files>
    packages/opencode-swarm-plugin/src/worker/lifecycle.ts (NEW)
    packages/opencode-swarm-plugin/src/worker/context-loader.ts (NEW)
    packages/opencode-swarm-plugin/src/worker/self-verifier.ts (NEW)
    packages/opencode-swarm-plugin/src/worker/mail-sender.ts (NEW)
    packages/opencode-swarm-plugin/src/worker/discovery-handler.ts (NEW)
    packages/opencode-swarm-plugin/src/worker/__tests__/lifecycle.test.ts (NEW)
    packages/opencode-swarm-plugin/src/worker/__tests__/context-loader.test.ts (NEW)
    packages/opencode-swarm-plugin/src/worker/__tests__/self-verifier.test.ts (NEW)
    packages/opencode-swarm-plugin/src/worker/__tests__/mail-sender.test.ts (NEW)
  </files>
  <action>
    Implement per sub-plan: sub-plans/03-WORKER-LIFECYCLE.md

    Summary: The Worker's complete execution engine.
    - lifecycle.ts: PICKUP → ORIENT → PLAN → EXECUTE → VERIFY → LEARN → REPORT → CLOSE
    - context-loader.ts: Gather bead + epic + siblings + deps + memory into WorkerContext
    - self-verifier.ts: Run build/test/typecheck via Bun.spawn with timeout
    - mail-sender.ts: Typed message sending (6 Worker→Queen + 2 Worker→Worker types)
    - discovery-handler.ts: Create child bead + mapping + send DISCOVERY mail

    MUST enforce guardrails: no cross-bead mutation, no epic creation, no LT memory promotion.
    MUST use message-types.ts from Task 1 for all communication.
    MUST gracefully handle bd CLI absence (fallback context from mapping store).
    MUST mock all external dependencies in tests.
  </action>
  <verify>bun test packages/opencode-swarm-plugin/src/worker/__tests__/</verify>
  <done>
    - 8-step lifecycle fully implemented
    - Context loader gathers full WorkerContext with fallback
    - Self-verifier runs build/test/typecheck
    - Mail sender sends all 8 typed message types
    - Discovery handler creates child beads
    - Guardrails enforced (tested)
    - 50+ tests across 4 test files
    - Zero typecheck errors
  </done>
</task>

### Task 4: Wave Execution — GSD↔Swarm Wiring

<task type="auto" wave="3">
  <name>Wave Dispatcher (GSD↔Swarm Wiring)</name>
  <files>
    packages/opencode-swarm-plugin/src/queen/wave-dispatcher.ts (NEW)
    packages/opencode-swarm-plugin/src/queen/__tests__/wave-dispatcher.test.ts (NEW)
  </files>
  <action>
    Implement per sub-plan: sub-plans/04-WAVE-EXECUTION.md

    Summary: The missing link between Phase 4 GSD modules and Phase 5 Queen protocol.
    - Import wave calculator from src/gsd/wave-calculator.ts
    - Import state manager from src/gsd/state-manager.ts
    - wave-dispatcher.ts: createWaveDispatcher(deps) → { executeEpic, executeWave, resume }
      - executeEpic(epicId): Compute waves → execute wave 1 → verify → wave 2 → ... → phase verify
      - executeWave(wave): Dispatch all tasks to workers → monitor via Queen → collect results
      - resume(stateFilePath): Read STATE.md → find current wave → continue from there

    This is the CORE ORCHESTRATION LOOP:
    ```
    for wave in waves:
      dispatch all wave tasks to workers (parallel)
      Queen monitors inbox until all wave tasks complete
      run wave-level verification (integration tests)
      if failures → create fix tasks → re-run as fix wave
      update STATE.md
      advance to next wave
    ```

    MUST use Phase 4 wave calculator (already built, 238 lines, 616 tests)
    MUST use Phase 4 state manager (already built, 573 lines, 714 tests)
    MUST use Queen monitor from Task 2 for inbox monitoring
    MUST use Worker lifecycle from Task 3 for task execution
    MUST emit GSD events (gsdWaveStarted, gsdWaveCompleted, gsdWaveFailed) via Phase 4 event factories
  </action>
  <verify>bun test packages/opencode-swarm-plugin/src/queen/__tests__/wave-dispatcher.test.ts</verify>
  <done>
    - Wave dispatcher computes waves and executes sequentially
    - Workers dispatched in parallel within each wave
    - Queen monitors inbox during execution
    - Wave-level verification after each wave
    - Fix wave created on verification failure
    - STATE.md updated after each wave
    - Resume from STATE.md works
    - 30+ tests
    - Zero typecheck errors
  </done>
</task>

### Task 5: 4-Level Verification + Phase Verifier

<task type="auto" wave="4">
  <name>4-Level Verification + Phase Verifier</name>
  <files>
    packages/opencode-swarm-plugin/src/queen/phase-verifier.ts (NEW)
    packages/opencode-swarm-plugin/src/queen/__tests__/phase-verifier.test.ts (NEW)
  </files>
  <action>
    Implement per sub-plan: sub-plans/05-VERIFICATION-MODEL.md

    Summary: Goal-backward verification at 4 levels.
    - Phase verifier uses Phase 4 verification engine (already built) for must_haves checking
    - Per-task: Worker self-verifier (Task 3)
    - Per-wave: Wave dispatcher runs integration tests (Task 4)
    - Per-plan: must_haves check after all waves (truths + artifacts + key_links)
    - Per-phase: Full verification suite + milestone DoD + fix bead creation

    phase-verifier.ts: createPhaseVerifier(deps) → { verifyPhase }
    - Check all beads in epic are closed
    - Run full GSD verification suite via Phase 4 verificationEngine
    - If fails → create fix beads (type: bug, P0)
    - Max 3 verification iterations
    - If passes → promote learnings → emit goal_completed

    MUST use Phase 4 verification engine (createVerificationEngine from src/gsd/)
    MUST create fix beads via bead-client (Phase 3 bridge)
    MUST emit verification events (gsdVerificationRun, gsdVerificationPassed, gsdVerificationFailed)
  </action>
  <verify>bun test packages/opencode-swarm-plugin/src/queen/__tests__/phase-verifier.test.ts</verify>
  <done>
    - Phase verifier checks all beads closed → runs verification → creates fix beads → re-verifies
    - 4-level verification wired together (task→wave→plan→phase)
    - Fix plan auto-generation works (max 3 iterations)
    - Learning promotion on success
    - 20+ tests
    - Zero typecheck errors
  </done>
</task>

### Task 6: Barrel Exports + Minimal Swarm Wiring

<task type="auto" wave="4">
  <name>Barrel Exports + Swarm Integration Points</name>
  <files>
    packages/opencode-swarm-plugin/src/queen/index.ts (NEW)
    packages/opencode-swarm-plugin/src/worker/index.ts (NEW)
  </files>
  <action>
    1. Create queen/index.ts — export all Queen modules:
       - createQueenMonitor, createDecisionHandler, createReviewHandler
       - createLearningPromoter, createPhaseVerifier, createWaveDispatcher
       - CortexMessageSchema, parseCortexMessage, classifyMessage, formatMessageBody
       - All TypeScript types

    2. Create worker/index.ts — export all Worker modules:
       - createWorkerLifecycle, loadWorkerContext, selfVerify
       - sendStatusUpdate, sendCompleted, sendBlocked, sendDiscovery, etc.
       - handleDiscovery
       - All TypeScript types

    3. Verify no circular dependencies between queen/ and worker/
  </action>
  <verify>bun run typecheck (or bunx tsc --noEmit)</verify>
  <done>
    - queen/index.ts exports everything
    - worker/index.ts exports everything
    - No circular dependencies
    - Build passes
  </done>
</task>

### Task 7: Integration Tests

<task type="checkpoint:human-verify" wave="5">
  <name>End-to-End Integration Tests + Human Verification</name>
  <files>
    packages/opencode-swarm-plugin/src/queen/__tests__/integration.test.ts (NEW)
    packages/opencode-swarm-plugin/src/worker/__tests__/integration.test.ts (NEW)
    packages/opencode-swarm-plugin/src/__tests__/orchestration-e2e.test.ts (NEW)
  </files>
  <action>
    Implement per sub-plan: sub-plans/06-INTEGRATION-TESTS.md

    Key scenarios to test:
    1. Queen processes [DONE] → verifies → [APPROVED] → bead closed
    2. Queen processes [DISCOVERY] → priority gate → [APPROVED/REJECTED]
    3. Queen processes [HELP] → queries memory → [APPROVED with recommendation]
    4. Worker lifecycle: PICKUP→ORIENT→PLAN→EXECUTE→VERIFY→LEARN→REPORT→CLOSE
    5. Worker guardrails: attempt to create epic → rejected
    6. 3-strike rule: 3 failed reviews → bead blocked
    7. Wave execution: 2 waves, 3 tasks, correct ordering
    8. Phase verification: all beads closed → verify → promote learnings → goal_completed
    9. Fix plan: verification fails → fix beads created → re-verify
    10. Resume: crash mid-wave → resume from STATE.md

    How-To-Verify:
    1. Run all Queen tests: `bun test packages/opencode-swarm-plugin/src/queen/` — all pass
    2. Run all Worker tests: `bun test packages/opencode-swarm-plugin/src/worker/` — all pass
    3. Run integration: `bun test packages/opencode-swarm-plugin/src/__tests__/orchestration-e2e.test.ts`
    4. Run typecheck: `bunx tsc --noEmit` — passes
    5. Run existing tests: `bun test packages/opencode-swarm-plugin/` — no regressions
    6. Count: total new tests ≥ 200

    Resume-Signal: "tests pass" or specific feedback on failures
  </action>
</task>

---

## Exit Criteria

- [ ] All 17 message types validated by Zod schemas
- [ ] Queen monitor loop processes messages within one poll cycle
- [ ] Queen makes autonomous decisions within defined boundaries
- [ ] Workers follow 8-step lifecycle (integration test verified)
- [ ] Workers load full context (bead + epic + siblings + deps + memory)
- [ ] Worker guardrails enforced (no cross-bead, no epic creation, no LT memory)
- [ ] Wave dispatcher executes tasks in computed parallel batches
- [ ] 4-level verification wired (task → wave → plan → phase)
- [ ] must_haves verification with truths/artifacts/key_links
- [ ] Fix plan auto-generated from verification failures (max 3 iterations)
- [ ] Learning promotion (confidence ≥ 0.7 → long-term)
- [ ] 3-strike review rule blocks bead after 3 failures
- [ ] STATE.md tracks progress, resume works
- [ ] All existing swarm-tools tests still pass (zero regression)
- [ ] 200+ new tests total
- [ ] Zero typecheck errors
- [ ] Build passes

---

## Test Budget

| Task | Sub-Plan | Tests | Covers |
|------|----------|-------|--------|
| Task 1 | 01-STRUCTURED-MESSAGES | 30+ | 17 types validate, parsing, formatting, edge cases |
| Task 2 | 02-QUEEN-PROTOCOL | 60+ | Monitor polling, routing, decisions, review 3-strike, learning |
| Task 3 | 03-WORKER-LIFECYCLE | 50+ | 8-step lifecycle, context loading, self-verify, guardrails |
| Task 4 | 04-WAVE-EXECUTION | 30+ | Wave dispatch, monitor loop, fix waves, STATE.md |
| Task 5 | 05-VERIFICATION-MODEL | 20+ | 4-level verification, must_haves, fix plan generation |
| Task 6 | — | 5+ | Barrel exports, no circular deps |
| Task 7 | 06-INTEGRATION-TESTS | 15+ | E2E scenarios |
| **Total** | | **210+** | |

---

## Dependencies on Earlier Phases

| Phase | What We Use From It | Status |
|-------|-------------------|--------|
| Phase 1 | 9 Queen/Worker event types in Zod (queen_decision_made, worker_status_update, etc.) | ✅ Committed |
| Phase 2 | Enhanced hivemind (tag boost + privacy filter) for memory recall | ✅ Committed |
| Phase 3 | Beads bridge (bead-client, mapping-store) for bd CLI operations | ✅ Committed |
| Phase 4 | GSD modules (wave-calculator, verification-engine, state-manager, gsd-events) | ⚠️ UNCOMMITTED |

**CRITICAL:** Phase 4 code MUST be committed before starting Phase 5. Run:
```bash
git add packages/opencode-swarm-plugin/src/gsd/
git commit -m "feat(gsd): add GSD integration with wave execution, verification, and state management"
```
