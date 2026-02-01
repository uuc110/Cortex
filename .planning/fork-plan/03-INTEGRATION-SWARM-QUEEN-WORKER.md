# 03 — Integration: Swarm Queen/Worker Architecture

> How Cortex adds a coordinated two-role architecture to swarm orchestration.

**Status:** Draft
**Depends On:** 01-FORK-SWARM-TOOLS.md (swarm primitives), 02-BRIDGE-BEADS.md (task graph)
**Enables:** 04-EXECUTION-ENGINE.md (plan execution), 05-MEMORY-LAYER.md (learning promotion)
**Reference:** [cortex/HLD.md sections 2-3](../../HLD.md) (authoritative spec)

---

## 1. Why Swarm Needs Queen/Worker

### Current State (swarm-tools)

Swarm-tools has a coordinator + worker model but with **informal communication**:

- Coordinator decomposes tasks and spawns workers
- Workers report via `swarm_progress()` and `swarm_complete()` — unstructured free-text
- No formal decision protocol — coordinator can't approve/reject scope changes
- No structured message types — subject lines are convention, not enforced
- No worker lifecycle — workers just "do work" without orient/plan/verify phases
- No learning promotion — all memories are equal, no short-term to long-term flow
- Review is optional (adversarial review exists but isn't wired into the loop)
- File conflicts are detected but not mediated by a central authority

### What Queen/Worker Adds

| Capability | swarm-tools (before) | Cortex Queen/Worker (after) |
|---|---|---|
| Communication | Free-text mail, informal subjects | Typed messages with discriminated union schema |
| Decision authority | None — coordinator is passive | Queen has explicit decision boundaries |
| Worker lifecycle | Spawn → work → complete | PICKUP → ORIENT → PLAN → EXECUTE → VERIFY → LEARN → REPORT → CLOSE |
| Scope control | Workers can create anything | Workers create child beads, Queen approves |
| Review | Optional adversarial review | Mandatory verify + Queen review with 3-strike rule |
| Learning | Flat — all memories stored equally | Two-tier: short-term (worker) → long-term (Queen promotes) |
| Phase verification | None — only task-level | Queen verifies entire phase after all tasks complete |
| Conflict resolution | Detection only | Queen mediates, reassigns, or escalates |

---

## 2. The Queen Role

The Queen is the **single coordinator** for an epic. She does NOT execute tasks — she monitors, decides, reviews, and promotes.

### Queen Responsibilities

1. **Monitor** all workers via mail inbox polling (`src/queen/monitor.ts`)
   - Poll interval: configurable (default 3000ms)
   - Classify incoming messages by `[TAG]` subject prefix
   - Track processed message IDs to avoid re-processing
   - Auto-stop when all beads closed or idle timeout reached

2. **Make decisions** within her authority boundaries (`src/queen/decision-handler.ts`)
   - Approve/reject worker discoveries based on priority
   - Approve worker recommendations for help requests
   - Defer decisions when recommendation is missing
   - Reply to workers with `[APPROVED]`, `[REJECTED]`, or `[DEFERRED]` messages

3. **Review completed work** (`src/queen/review-handler.ts`)
   - Run verification (build, test, lint, typecheck) on worker output
   - Approve passing work → emit `task_completed` event
   - Request changes on failing work → track review attempt count
   - Block task after 3 failed review attempts (3-strike rule)

4. **Promote learnings** from short-term to long-term memory (`src/queen/learning-promoter.ts`)
   - Find candidates: confidence >= 0.7, age <= 30 days
   - Store in long-term memory (opencode-mem)
   - Skip when long-term storage unavailable
   - Emit `learning_stored` events

5. **Verify phase completion** (`src/queen/phase-verifier.ts`)
   - Check all beads in epic are closed
   - Run full verification suite
   - Create fix beads (type: bug, P0) for each failure category
   - Emit `goal_completed` event on success

### Queen State Machine

```
MONITORING ──────────────────────── (poll inbox, check beads)
     │
     ├─ new message ──→ CLASSIFYING ──→ route to handler
     │                       │
     │                       ├─ [DONE] ──→ REVIEWING ──→ approve/reject
     │                       ├─ [DISCOVERY] ──→ DECIDING ──→ approve/reject/defer
     │                       ├─ [DECISION] ──→ DECIDING ──→ approve recommendation
     │                       ├─ [HELP] ──→ DECIDING ──→ approve/defer
     │                       ├─ [BLOCKED] ──→ emit event, log
     │                       └─ [STATUS] ──→ emit event, log
     │
     ├─ all beads closed ──→ VERIFYING_PHASE
     │                            │
     │                            ├─ pass ──→ PROMOTING_LEARNINGS ──→ COMPLETE
     │                            └─ fail ──→ CREATING_FIX_BEADS ──→ MONITORING
     │
     └─ idle timeout ──→ STOPPED
```

### Queen Does NOT

- Execute tasks (delegates to workers)
- Modify worker files directly
- Skip verification steps
- Auto-approve everything (priority-based logic applies)
- Promote all learnings (confidence threshold applies)

---

## 3. The Worker Role

Workers are **autonomous agents with guardrails**. They plan, implement, verify, and report — but within the scope of their assigned bead.

### Worker Capabilities (CAN do)

From `src/worker/` implementation:

| Capability | Implementation | Notes |
|---|---|---|
| Load full context | `context-loader.ts` | Bead + epic + siblings + deps + memory |
| Send structured mail | `mail-sender.ts` | STATUS, HELP, DISCOVERY, DECISION, DONE, BLOCKED |
| Self-verify | `self-verifier.ts` | Build, test, lint, typecheck via `Bun.spawn` |
| Create child beads | `discovery-handler.ts` | Via `bdCreate` with parent linkage |
| Reserve files | `file-reserver.ts` | Exclusive locks, conflict detection |
| Store short-term memory | `cortexRemember()` | Tagged learnings with auto-decay |
| Read all memory | `cortexRecall()` | Short-term + long-term merged results |

### Worker Guardrails (CANNOT do)

| Guardrail | Enforcement |
|---|---|
| Cannot modify other workers' beads | Only updates own bead via `bd update <own_id>` |
| Cannot create epics | Only creates child tasks under own bead |
| Cannot change scope (WHAT) | Only changes approach (HOW) — scope changes require Queen approval |
| Cannot promote to long-term memory | Only Queen has `learning-promoter.ts` |
| Cannot skip verification | `self-verifier.ts` runs before completion report |
| Cannot close parent epic | Only Queen runs `phase-verifier.ts` |
| Cannot release other workers' files | `file-reserver.ts` checks agent ownership |

---

## 4. Worker Lifecycle

Each worker follows an 8-step lifecycle. This is enforced by `src/worker/index.ts` (`runWorker`):

```
┌─────────┐
│ PICKUP  │  Worker claims ready bead → bd update <id> --status in_progress
└────┬────┘  Event: task_started
     │
┌────▼────┐
│ ORIENT  │  loadWorkerContext(beadId, projectPath)
└────┬────┘  Loads: bead → epic → siblings → deps → memory → project config
     │
┌────▼────┐
│  PLAN   │  Generate local execution plan
└────┬────┘  Mail: [STATUS] beadId: planning (5%)
     │
┌────▼─────────────────────────────────────────────────────────────────┐
│ EXECUTE  │  Implement the task following the plan                    │
│          │                                                           │
│          │  If stuck → query memory → mail Queen [HELP]              │
│          │  If blocked → bd update --status blocked → mail [BLOCKED] │
│          │  If discovers → bdCreate child → mail [DISCOVERY]         │
│          │  If needs decision → mail [DECISION] with options         │
│          │  Report progress → mail [STATUS] at 25/50/75%            │
└────┬─────────────────────────────────────────────────────────────────┘
     │
┌────▼────┐
│ VERIFY  │  verify(projectPath) → build, test, lint, typecheck
└────┬────┘  Returns: { passed, buildOk, testsOk, lintOk, typeCheckOk, errors }
     │
     ├─ passed
     │
┌────▼────┐
│  LEARN  │  cortexRemember(learning, tags) for each insight
└────┬────┘  Event: learning_stored
     │
┌────▼────┐
│ REPORT  │  Mail Queen [DONE] with files, commit, learnings
└────┬────┘  OR mail [BLOCKED] if verification failed
     │
┌────▼────┐
│  CLOSE  │  bd close <id> --reason "Done. Commit: <hash>"
└─────────┘  Event: task_completed
```

### Context Loading Detail

`loadWorkerContext()` gathers (from `src/worker/context-loader.ts`):

```typescript
interface WorkerContext {
  bead: BeadIssue;          // Own task: title, description, priority, status
  epic: BeadIssue | null;   // Parent epic: overall goal, acceptance criteria
  siblings: BeadIssue[];    // Sibling tasks: landscape of related work
  dependencies: BeadIssue[];// Completed deps: what was already done
  memoryContext: RankedMemory[]; // Past patterns relevant to this task
  projectPath: string;
  projectKey: string;
}
```

Falls back gracefully if `bd` is not installed (builds fallback bead).

---

## 5. Integration with Existing Swarm

### What Changes

| swarm-tools Component | Cortex Replacement | Migration Path |
|---|---|---|
| `swarm_init()` | `cortex_session_start()` | Same pattern, different DB |
| `swarm_decompose()` | `cortex decomposer` | Strategy selection + bd task creation |
| `swarm_progress()` | Worker `mail-sender.ts` | Structured [STATUS] messages replace free-text |
| `swarm_complete()` | Worker [DONE] + Queen review | Two-step: worker reports → Queen verifies |
| `swarm_review()` | Queen `review-handler.ts` | Mandatory, not optional |
| `swarm_review_feedback()` | Queen [REVIEW] mail | Integrated with 3-strike rule |
| `swarmmail_send()` | `cortex mail send` | Same primitives, typed message schema |
| `swarmmail_inbox()` | `cortex mail inbox` | Same primitives, Queen poll loop |
| `swarmmail_reserve()` | Worker `file-reserver.ts` | Same pattern, integrated into lifecycle |
| `hive_create/update/close` | `bd create/update/close` | Beads replaces hive table |
| `hivemind_store/find` | `cortex remember/recall` | Short-term in cortex.db, long-term in opencode-mem |

### What Stays The Same

- **Mail primitives**: `sendMessage()`, `getInbox()`, `ackMessage()`, `reserveFiles()` — preserved from swarm-tools, stored in `cortex.db`
- **Event sourcing**: Append-only event log, same pattern
- **File reservations**: Exclusive locks with TTL, conflict detection
- **Thread conventions**: One thread per task context
- **Decomposition strategies**: file-based, feature-based, risk-based, auto

### Queen Replaces Swarm Coordinator

The swarm coordinator was a passive orchestrator — decompose, spawn, wait. The Queen is an **active coordinator**:

| Passive (swarm) | Active (Queen) |
|---|---|
| Spawn workers and wait | Poll mail, process messages, make decisions |
| Accept all completions | Verify completions, request changes |
| No scope control | Approve/reject discoveries |
| No learning curation | Promote verified learnings |
| No phase verification | End-to-end verification after all tasks |

### Workers Are Swarm-Workers With Protocol

Workers gain:
1. **Structured lifecycle** (8 steps instead of "just do it")
2. **Typed messages** (discriminated union instead of free-text)
3. **Self-verification** (mandatory before reporting done)
4. **Discovery protocol** (create child bead + mail Queen)
5. **Context loading** (automatic gathering of all relevant info)
6. **Learning capture** (store insights during execution)

---

## 6. Communication Flow

### Message Flow Diagram

```
                    ┌──────────┐
                    │   QUEEN  │
                    └──┬───┬───┘
            reads ◄────┘   └────► sends
                    │         │
    ┌───────────────┼─────────┼───────────────┐
    │  MAIL SYSTEM  │         │               │
    │  (cortex.db   │         │  messages      │
    │   messages     │         │  table)        │
    │   table)       │         │               │
    └───────────────┼─────────┼───────────────┘
                    │         │
          sends ►───┘   ◄────┘ reads
                    │         │
         ┌──────────┼─────────┼──────────┐
         │          │         │          │
    ┌────▼───┐ ┌────▼───┐ ┌──▼─────┐ ┌──▼─────┐
    │Worker 1│ │Worker 2│ │Worker 3│ │Worker N│
    └────────┘ └────────┘ └────────┘ └────────┘
```

### Thread Conventions

- **Task thread**: `thread-{beadId}` — all messages about a specific task
- **Queen broadcast**: `thread-queen-broadcast` — announcements to all workers
- **Worker-to-worker**: `thread-{beadId}-peer` — sibling coordination

### Message Types Summary

| Direction | Tag | Purpose | Priority |
|---|---|---|---|
| Worker → Queen | `[STATUS]` | Progress update | NORMAL |
| Worker → Queen | `[DONE]` | Task completed | HIGH |
| Worker → Queen | `[BLOCKED]` | Cannot proceed | URGENT |
| Worker → Queen | `[DISCOVERY]` | Found new work | HIGH |
| Worker → Queen | `[DECISION]` | Need scope decision | HIGH |
| Worker → Queen | `[HELP]` | Stuck, need guidance | HIGH |
| Queen → Worker | `[APPROVED]` | Decision approved | NORMAL |
| Queen → Worker | `[REJECTED]` | Decision rejected | NORMAL |
| Queen → Worker | `[DEFERRED]` | Decision deferred | NORMAL |
| Queen → Worker | `[REVIEW]` | Review feedback | HIGH |
| Queen → Worker | `[CONTEXT]` | Info from other workers | NORMAL |
| Queen → Worker | `[UNBLOCKED]` | Blocker resolved | HIGH |
| Worker → Workers | `[FILE]` | File change heads-up | LOW |
| Worker → Workers | `[READY]` | Dependency completed | NORMAL |

See: [details/structured-mail-protocol.md](details/structured-mail-protocol.md) for full TypeScript schemas.

---

## 7. Decision Boundaries

### Queen's Autonomous Decisions

- **Approve discoveries** with priority <= P3 (current implementation: P0-P3 approved, P4+ rejected)
- **Approve worker recommendations** when help request includes a recommendation
- **Defer decisions** when worker provides no recommendation
- **Run verification** on completed work
- **Block tasks** after 3 failed review attempts
- **Create fix beads** when phase verification fails
- **Promote learnings** that meet confidence threshold

### Decisions Requiring Human Escalation

- Architecture changes (not currently automated)
- Skip verification (not allowed by protocol)
- Major scope changes beyond a single task
- Worker stuck for extended period (>10 min)

See: [details/queen-decision-boundaries.md](details/queen-decision-boundaries.md) for full decision protocol.

---

## 8. Implementation Mapping

### Existing Cortex Modules

| Module | Files | Status |
|---|---|---|
| Queen index | `src/queen/index.ts` | Implemented — exports `runQueen()` with config |
| Queen monitor | `src/queen/monitor.ts` | Implemented — poll loop, message classification, bead checking |
| Decision handler | `src/queen/decision-handler.ts` | Implemented — discovery, decision, help handlers |
| Review handler | `src/queen/review-handler.ts` | Implemented — verify + 3-strike rule |
| Learning promoter | `src/queen/learning-promoter.ts` | Implemented — confidence-based promotion |
| Phase verifier | `src/queen/phase-verifier.ts` | Implemented — bead check + verification + fix bead creation |
| Worker index | `src/worker/index.ts` | Implemented — `runWorker()` with full lifecycle |
| Context loader | `src/worker/context-loader.ts` | Implemented — bead + epic + siblings + deps + memory |
| Mail sender | `src/worker/mail-sender.ts` | Implemented — all message types |
| Discovery handler | `src/worker/discovery-handler.ts` | Implemented — `bdCreate` + mapping + mail |
| Self verifier | `src/worker/self-verifier.ts` | Implemented — build, test, lint, typecheck |
| File reserver | `src/worker/file-reserver.ts` | Implemented — reserve, release, conflict check |
| Mail send | `src/mail/send.ts` | Implemented — `sendMessage()` with events |
| Mail inbox | `src/mail/inbox.ts` | Implemented — `getInbox()`, `ackMessage()`, `readMessage()` |
| Mail reservations | `src/mail/reservations.ts` | Implemented — full CRUD with conflict detection |
| Mail threads | `src/mail/threads.ts` | Implemented — `getThreadMessages()`, `getThreads()` |

### Integration Work Needed (Fork Plan)

When forking swarm-tools into Cortex, the integration requires:

1. **Replace swarm's hive table** with `bd` CLI calls (via Task Bridge)
   - `hive_create` → `bdCreate()` + `createMapping()`
   - `hive_update` → `bdUpdate()`
   - `hive_close` → `bdClose()`
   - `hive_query` → `bdList()` / `bdReady()`

2. **Replace swarm's memory** with Cortex memory layer
   - `hivemind_store` → `cortexRemember()` (short-term)
   - `hivemind_find` → `cortexRecall()` (short-term + long-term)
   - Learning promotion → `promoteLearnings()` (Queen-only)

3. **Wire swarm-mail primitives** into Cortex DB
   - Swarm-mail's `messages` table → Cortex's `messages` table (same schema)
   - Swarm-mail's `reservations` table → Cortex's `reservations` table (same schema)
   - Add thread management from `src/mail/threads.ts`

4. **Replace swarm coordinator** with Queen
   - Swarm's decompose → Cortex decomposer + bd task creation
   - Swarm's spawn_subtask → Worker lifecycle with context loading
   - Swarm's review → Queen review-handler with 3-strike rule
   - Swarm's record_outcome → Cortex strategy_outcomes table

5. **Add typed message protocol**
   - Current: free-text subjects with `[TAG]` convention
   - Target: TypeScript discriminated union with validation
   - See: [details/structured-mail-protocol.md](details/structured-mail-protocol.md)

---

## 9. Configuration

From HLD.md project config:

```json
{
  "queen": {
    "monitor_interval_ms": 3000,
    "phase_verify_on_complete": true,
    "auto_approve_discoveries": false
  },
  "worker": {
    "poll_interval_ms": 5000,
    "max_concurrent": 1,
    "auto_start": true
  },
  "mail": {
    "ack_required": false,
    "default_importance": "normal"
  }
}
```

### Queen Config (`MonitorConfig`)

```typescript
interface MonitorConfig {
  projectKey: string;      // Project identifier
  epicBeadId: string;      // Epic being monitored
  pollIntervalMs?: number; // Default: 3000
  maxIdlePolls?: number;   // Default: 50 (stop after N polls with no messages)
}
```

### Worker Config (`WorkerConfig`)

```typescript
interface WorkerConfig {
  beadId: string;       // Task to execute
  projectPath: string;  // Project root
  projectKey: string;   // Project identifier
  workerName: string;   // Agent identity (e.g., "worker-1")
}
```

---

## 10. End-to-End Flow

```
User: cortex goal "Add OAuth authentication"
  │
  ▼
Queen: receives goal
Queen: cortexRecall("OAuth authentication") → past patterns
Queen: decompose → [T1: auth routes, T2: token storage, T3: middleware]
Queen: bdCreate epic + tasks with dependencies
Queen: starts monitor loop (createMonitor)
  │
  ├──────── Worker-1 picks up T1 (ready, no deps) ────────────────┐
  │         ├─ ORIENT: loadWorkerContext(T1)                       │
  │         ├─ PLAN: generate local plan                           │
  │         ├─ EXECUTE: implement auth routes                      │
  │         │   └─ DISCOVERY: found refresh token rotation needed  │
  │         │       ├─ bdCreate child bead under T1                │
  │         │       └─ mail Queen [DISCOVERY]                      │
  │         ├─ Queen reads [DISCOVERY] → approved (P2)             │
  │         ├─ VERIFY: build ✓ test ✓ lint ✓ typecheck ✓          │
  │         ├─ LEARN: cortexRemember("refresh tokens need 5min buffer")
  │         ├─ REPORT: mail Queen [DONE] with files, commit        │
  │         └─ Queen reads [DONE] → verify → [APPROVED]            │
  │                                                                 │
  ├──────── Worker-2 picks up T2 (was blocked by T1, now ready) ──┐
  │         ├─ ORIENT: loads T1's results from context             │
  │         ├─ cortexRecall → finds T1's learning about refresh    │
  │         ├─ EXECUTE: uses that knowledge                        │
  │         ├─ VERIFY: build ✓ test ✓                              │
  │         └─ REPORT: mail Queen [DONE]                           │
  │                                                                 │
  ├──────── Worker-3 picks up T3 ──────────────────────────────────┐
  │         └─ (similar lifecycle)                                  │
  │                                                                 │
Queen: all beads closed → verifyPhase()
Queen: verification passes → promoteLearnings()
Queen: emit goal_completed event
```

---

## References

- [HLD.md — Queen & Worker Architecture](../../HLD.md#queen--worker-architecture)
- [HLD.md — Communication Protocol](../../HLD.md#communication-protocol)
- [HLD.md — Worker Lifecycle](../../HLD.md#worker-lifecycle)
- [HLD.md — Verification Model](../../HLD.md#verification-model)
- [details/queen-decision-boundaries.md](details/queen-decision-boundaries.md)
- [details/structured-mail-protocol.md](details/structured-mail-protocol.md)
