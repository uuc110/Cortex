# Queen Decision Boundaries

> What the Queen can decide autonomously, what requires human approval, and how decisions are executed.

**Parent:** [03-INTEGRATION-SWARM-QUEEN-WORKER.md](../03-INTEGRATION-SWARM-QUEEN-WORKER.md)
**Reference:** [cortex/HLD.md — Queen & Worker Architecture](../../../HLD.md#queen--worker-architecture)
**Implementation:** `src/queen/decision-handler.ts`, `src/queen/review-handler.ts`

---

## 1. Core Principle

The Queen decides **WHAT** gets built (scope).
Workers decide **HOW** to implement (approach/tools), within bead scope.

This separation ensures:
- Architectural coherence (Queen has full-epic visibility)
- Worker autonomy (workers don't wait for permission on implementation details)
- Scope control (no unbounded discovery sprawl)

---

## 2. Autonomous Decisions (Queen Decides Alone)

These decisions are handled by `src/queen/decision-handler.ts` and `src/queen/review-handler.ts` without human input.

### 2.1 Approve/Reject Discoveries

**Trigger:** Worker sends `[DISCOVERY]` message with child bead and priority.

**Logic** (from `handleDiscovery()`):

```
IF priority <= P3 → APPROVED
IF priority > P3  → REJECTED
```

**Current implementation detail:** Priority P0-P3 are approved, P4+ rejected. The P3 boundary is a heuristic — low-priority discoveries (P4+) are likely out-of-scope polish work that should be deferred.

**Response:** Queen sends `[APPROVED]` or `[REJECTED]` mail to worker.

**Events emitted:**
- Approved → `task_started` (child bead enters workflow)
- Rejected → `task_completed` with `success: false` (child bead is dead)

### 2.2 Approve Worker Recommendations

**Trigger:** Worker sends `[DECISION]` or `[HELP]` message with a `recommendation` field.

**Logic** (from `handleDecisionRequest()` and `handleHelpRequest()`):

```
IF recommendation present → APPROVED (accept worker's recommendation)
IF recommendation missing → DEFERRED (ask worker to try best option)
```

**Rationale:** Workers are closest to the implementation. If they have a clear recommendation, trust it. If they don't, push back — don't make architectural decisions without context.

**Response:** Queen sends `[APPROVED]` or `[DEFERRED]` mail.

### 2.3 Review Completed Work

**Trigger:** Worker sends `[DONE]` message.

**Logic** (from `handleDone()`):

```
Run verify(projectPath)
IF verification.passed → APPROVED (task complete)
IF verification.failed AND attempts < 3 → NEEDS_CHANGES (send issues)
IF verification.failed AND attempts >= 3 → FAILED (block task)
```

**Review result types:**

| Result | Review Attempts | Action |
|---|---|---|
| `approved` | Any | Clear review counter, send [APPROVED], emit task_completed |
| `needs_changes` | < 3 | Increment counter, send [REVIEW] with issues list |
| `failed` | >= 3 | Send [REVIEW] with "task failed after 3 review attempts", emit task_blocked |

**3-Strike Rule:** After 3 failed review attempts on the same bead, the task is marked **blocked**. This signals an architectural problem — the worker can't fix it by trying harder. The problem needs escalation.

### 2.4 Reassign Blocked Tasks

**Trigger:** Worker sends `[BLOCKED]` message.

**Current behavior:** Queen emits `task_blocked` event and logs. Future enhancement: auto-reassignment to another worker.

### 2.5 Mediate File Conflicts

**Trigger:** `reservation_conflict` event from `src/mail/reservations.ts`.

**Current behavior:** The reservation system prevents conflicts via exclusive locks. Workers call `reserveWorkerFiles()` which checks `checkConflict()` before reserving. If conflict detected, the reservation throws.

**Queen's role:** If a worker needs a file held by another worker, the Queen can:
- Force-release via `reserveFiles({ force: true })` (emits `file_conflict` event)
- Or mediate by asking the holding worker to release

### 2.6 Promote Learnings

**Trigger:** Phase verification passes, Queen calls `promoteLearnings()`.

**Logic** (from `src/queen/learning-promoter.ts`):

```
Find short-term memories WHERE:
  confidence >= 0.7 (DEFAULT_MIN_CONFIDENCE)
  age <= 30 days (DEFAULT_MAX_AGE_DAYS)

For each candidate:
  IF long-term available → promote (storeLongTerm)
  IF long-term unavailable → skip
  IF promotion error → mark as failed
```

**Promotion result:**

```typescript
interface PromotionResult {
  promoted: number;   // Successfully moved to long-term
  skipped: number;    // Below threshold or storage unavailable
  failed: number;     // Error during promotion
  details: Array<{
    memoryId: string;
    action: "promoted" | "skipped" | "failed";
    reason: string;
  }>;
}
```

### 2.7 Create Fix Beads

**Trigger:** Phase verification fails in `verifyPhase()`.

**Logic** (from `src/queen/phase-verifier.ts`):

```
Run verify(projectPath)
IF failed → categorize failures:
  - build failures → create "Fix build verification failures" bead (P0, bug)
  - test failures  → create "Fix tests verification failures" bead (P0, bug)
  - lint failures  → create "Fix lint verification failures" bead (P0, bug)
  - typecheck failures → create "Fix typecheck verification failures" bead (P0, bug)

Each fix bead:
  - Type: bug
  - Priority: P0
  - Parent: epic bead
  - Description: relevant error output
```

### 2.8 Grant Time Extensions

**Trigger:** Worker still working, no idle timeout triggered.

**Current behavior:** The monitor's `maxIdlePolls` config controls timeout. Default is 50 idle polls × 3s interval = 150s of silence before Queen stops.

**Future enhancement:** Queen could extend timeout if worker reports progress.

---

## 3. Decisions Requiring Human Approval

These are NOT currently automated. The Queen should escalate to human when:

### 3.1 Major Scope Changes

**Examples:**
- Worker discovers the task requires a different database technology
- Task scope grew from "add route" to "redesign auth system"
- New dependency that wasn't in the original decomposition

**Escalation:** Queen should pause the worker, emit an event, and (future) prompt the user via CLI or plugin notification.

### 3.2 Architecture Changes

**Examples:**
- Changing the project's module structure
- Introducing a new dependency
- Modifying shared interfaces that affect multiple workers

**Rationale:** Architecture decisions have blast radius beyond a single task. The Queen has epic-level visibility but not project-level judgment.

### 3.3 Skip Verification

**Rule:** Verification is NEVER skippable by Queen or Worker alone. If tests can't pass due to infrastructure issues (e.g., CI is down), the task should be blocked until infrastructure is fixed.

### 3.4 Merge to Main

**Rule:** Workers commit to their branches. Merging to main is a human decision or a CI/CD pipeline step.

### 3.5 Delete/Rollback

**Rule:** Queen can create beads but should not delete them. Rolling back commits requires human judgment.

---

## 4. Decision Protocol

### 4.1 Standard Decision Flow

```
1. Worker sends message to Queen (e.g., [DISCOVERY], [DECISION], [HELP])
2. Queen classifies message via classifyMessage(subject)
3. Queen routes to appropriate handler
4. Handler makes decision based on rules
5. Queen sends response mail ([APPROVED], [REJECTED], [DEFERRED])
6. Queen emits relevant event
```

### 4.2 Decision Timing

All decisions are **synchronous within the poll loop**. The Queen processes messages in order, one at a time. There is no async decision queue — when a message is processed, the decision is made immediately.

```typescript
// From monitor.ts
const processMessage = async (message: MailMessage): Promise<void> => {
  const { tag, rest } = classifyMessage(message.subject);
  switch (tag) {
    case "DISCOVERY": await handlers.onDiscovery(message); break;
    case "DECISION": await handlers.onDecision(message); break;
    case "HELP":     await handlers.onHelp(message); break;
    case "DONE":     await handlers.onDone(message); break;
    // ...
  }
  if (message.ack_required) {
    ackMessage(message.id);
  }
};
```

### 4.3 Decision Announcement (Future Enhancement)

The HLD describes a decision announcement protocol:

```
1. Queen announces decision via mail
2. 30-second window for objection
3. Proceeds if no objection
```

This is NOT yet implemented but is a planned enhancement for when workers need to coordinate on scope changes that affect siblings.

---

## 5. Escalation Triggers

These conditions should trigger escalation from Queen to human:

### 5.1 Three Review Failures

**Condition:** `reviewAttempts.get(beadId) >= 3`

**What happens:** Queen sends final `[REVIEW]` with "task failed after 3 review attempts", emits `task_blocked` event.

**Why escalate:** The worker has tried 3 times to fix the same issues. This indicates either:
- The task specification is wrong (scope problem)
- The task is more complex than estimated (decomposition problem)
- The worker is stuck in a loop (tooling/environment problem)

All of these require human judgment.

### 5.2 Worker Stuck > 10 Minutes

**Condition:** No status update from worker for 10+ minutes.

**Current detection:** The monitor tracks `lastPollAt` and `idlePolls`. After `maxIdlePolls` (default 50) with no messages, the monitor stops. But this doesn't distinguish between "worker is busy" and "worker is stuck."

**Future enhancement:** Track per-worker last-message timestamps. If no message for configurable threshold (e.g., 10 min), send `[CONTEXT] Are you stuck?` and escalate if no response.

### 5.3 Conflicting Requirements

**Condition:** Two workers report contradictory discoveries or decisions.

**Example:** Worker-1 discovers "need Redis for tokens" while Worker-2 discovers "need PostgreSQL for tokens."

**Detection:** Queen can detect this if both workers send `[DISCOVERY]` messages that reference the same files or concepts.

**Current behavior:** Not automated. Queen would approve both discoveries independently.

**Future enhancement:** Semantic conflict detection — compare discovery descriptions, flag overlaps.

### 5.4 Resource Exhaustion

**Condition:** Worker reports repeated build/test failures that suggest environment issues.

**Example:** Out of disk space, network issues, missing dependencies.

**Detection:** Queen sees repeated `needs_changes` reviews with the same errors.

---

## 6. Queen State Machine (Detailed)

```
                    ┌─────────────┐
                    │   STOPPED   │ ← initial state
                    └──────┬──────┘
                           │ start()
                           ▼
                    ┌─────────────┐
         ┌────────►│  MONITORING  │◄────────────────────┐
         │         └──────┬───────┘                     │
         │                │                              │
         │                │ new messages                  │
         │                ▼                              │
         │         ┌─────────────┐                      │
         │         │ CLASSIFYING │                      │
         │         └──────┬──────┘                      │
         │                │                              │
         │    ┌───────────┼───────────┐                 │
         │    │           │           │                 │
         │    ▼           ▼           ▼                 │
         │ ┌──────┐  ┌──────────┐ ┌──────────┐         │
         │ │DECIDE│  │ REVIEW   │ │   LOG    │         │
         │ │      │  │          │ │          │         │
         │ │DISCOV│  │ verify() │ │ STATUS   │         │
         │ │HELP  │  │ 3-strike │ │ BLOCKED  │         │
         │ │DECIDE│  │          │ │          │         │
         │ └──┬───┘  └────┬─────┘ └────┬─────┘         │
         │    │            │            │               │
         │    │  send      │  send      │  emit         │
         │    │  reply     │  review    │  event         │
         │    │            │            │               │
         │    └────────────┼────────────┘               │
         │                 │                             │
         │                 ▼                             │
         │         check: all beads closed?              │
         │                 │                             │
         │         NO──────┘                             │
         │                                               │
         │         YES                                   │
         │                 │                             │
         │                 ▼                             │
         │         ┌───────────────┐                    │
         │         │VERIFY PHASE   │                    │
         │         └───────┬───────┘                    │
         │                 │                             │
         │         ┌───────┼───────┐                    │
         │         │               │                    │
         │     PASS│           FAIL│                    │
         │         ▼               ▼                    │
         │  ┌────────────┐  ┌──────────────┐            │
         │  │PROMOTE     │  │CREATE FIX    │────────────┘
         │  │LEARNINGS   │  │BEADS (P0)    │
         │  └──────┬─────┘  └──────────────┘
         │         │
         │         ▼
         │  ┌────────────┐
         │  │  COMPLETE   │
         │  │  goal_done  │
         │  └─────────────┘
         │
         │  idle timeout (maxIdlePolls reached)
         │         │
         └─────────┘ → STOPPED
```

---

## 7. Decision Audit Trail

All decisions emit events to the append-only event log:

| Decision | Event Type | Data |
|---|---|---|
| Discovery approved | `task_started` | `{ bead_id, worker_id, title }` |
| Discovery rejected | `task_completed` | `{ bead_id, success: false }` |
| Recommendation approved | `task_completed` | `{ bead_id, summary, success: true }` |
| Help deferred | `task_completed` | `{ bead_id, success: false }` |
| Review approved | `task_completed` | `{ bead_id, success: true }` |
| Review needs_changes | (no event — sends mail) | — |
| Review failed (3-strike) | `task_blocked` | `{ bead_id, reason }` |
| Fix bead created | `task_blocked` | `{ bead_id, reason }` |
| Phase verified | `goal_completed` | `{ goal, success: true }` |
| Learning promoted | `learning_stored` | `{ memory_id, tags, summary }` |

This audit trail enables:
- Debugging decision chains
- Understanding why a task was rejected/blocked
- Measuring Queen decision quality over time
- Replaying workflows from event log

---

## 8. Future Enhancements

### 8.1 Configurable Decision Boundaries

```json
{
  "queen": {
    "auto_approve_discoveries": false,
    "discovery_approval_max_priority": 3,
    "max_review_attempts": 3,
    "stuck_timeout_ms": 600000,
    "announcement_window_ms": 30000
  }
}
```

### 8.2 Decision Announcement Protocol

```
Queen decides: "approve Worker-2's discovery"
Queen sends: [ANNOUNCEMENT] "Adding refresh token rotation (P2)"
  → to all workers in the epic
Wait 30 seconds
IF no [OBJECTION] received → execute decision
IF [OBJECTION] received → defer and evaluate
```

### 8.3 Delegation to Sub-Queen

For large epics with many workers, the Queen could delegate monitoring of specific task subtrees to a "Sub-Queen" — a worker with elevated permissions for that subtree only.

### 8.4 Learning from Decisions

Track which Queen decisions led to good/bad outcomes. Over time, adjust discovery approval thresholds, review strictness, and escalation triggers based on historical data.
