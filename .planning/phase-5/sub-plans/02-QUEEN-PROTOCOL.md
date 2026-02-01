# Sub-Plan 02: Queen Protocol

**Parent:** Phase 5 Task 2
**Wave:** 2 (Parallel with Sub-Plan 03)
**Depends On:** Sub-Plan 01 (message types)
**Output:** `packages/opencode-swarm-plugin/src/queen/{monitor,decision-handler,review-handler,learning-promoter}.ts`
**Tests:** `packages/opencode-swarm-plugin/src/queen/__tests__/{monitor,decision-handler,review-handler,learning-promoter}.test.ts`

---

## Problem

Swarm's coordinator is **passive** — it decomposes tasks, spawns workers, and waits. It does NOT:
- Actively monitor worker progress
- Make decisions (approve/reject scope changes)
- Review completed work before accepting it
- Promote learnings to long-term memory
- React to blocked workers

See `ORCHESTRATION-ANALYSIS.md` section 2.2 for full gap analysis.

## Solution

An **active Queen** with 4 modules: monitor (poll + classify + route), decision handler (approve/reject/defer), review handler (verify + 3-strike), and learning promoter (short-term → long-term).

---

## Module 1: monitor.ts

### Factory

```typescript
export interface MonitorConfig {
  projectKey: string;         // Project path
  epicBeadId: string;         // Epic being monitored
  pollIntervalMs?: number;    // Default: 3000
  maxIdlePolls?: number;      // Default: 50 (stop after N polls with no messages)
}

export interface QueenDeps {
  getInbox: (params: { projectPath: string; agentName: string; limit: number }) => Promise<InboxResult>;
  sendMail: (params: SendMailParams) => Promise<void>;
  beadClient: BeadClientInterface;       // From Phase 3 bridge
  eventStore: EventStoreInterface;       // createEvent + appendEvent from swarm-mail
  verificationRunner: VerificationRunner; // From swarm-verify.ts
  memoryRecall: (query: string, opts?: { limit?: number }) => Promise<RankedMemory[]>;
  decisionHandler: DecisionHandler;      // From decision-handler.ts
  reviewHandler: ReviewHandler;          // From review-handler.ts
}

export function createQueenMonitor(config: MonitorConfig, deps: QueenDeps): QueenMonitor;

export interface QueenMonitor {
  start(): Promise<void>;           // Start polling loop
  stop(): void;                     // Stop polling
  isRunning(): boolean;
  getStats(): MonitorStats;         // Messages processed, decisions made, etc.
  processOnce(): Promise<void>;     // Process one poll cycle (for testing)
}
```

### Behavior

```
POLL LOOP:
  1. getInbox(projectPath, "queen", limit=5)
  2. For each unprocessed message:
     a. classifyMessage(msg.subject) → tag
     b. parseCortexMessage(msg.subject, msg.body) → typed message
     c. Route by tag:
        [DONE]      → reviewHandler.handleCompleted(msg)
        [DISCOVERY] → decisionHandler.handleDiscovery(msg)
        [DECISION]  → decisionHandler.handleDecisionRequest(msg)
        [HELP]      → decisionHandler.handleHelpRequest(msg)
        [BLOCKED]   → emit worker_blocked event, log
        [STATUS]    → emit worker_status_update event, update progress tracking
        [FILE]      → log (informational)
        [READY]     → log (informational)
        unknown     → log warning, skip
     d. Add msg.id to processedMessageIds Set
  3. Check bead statuses:
     - All beads in epic closed? → verifyPhase() → COMPLETE
     - Any blocked > 5min? → log warning
  4. If no new messages this cycle → increment idleCounter
     - idleCounter >= maxIdlePolls → stop()
     - else → sleep(pollIntervalMs) → repeat
```

### Key Implementation Details

- `processedMessageIds: Set<number>` — avoid reprocessing (in-memory, not persisted)
- Inbox query uses `agentName: "queen"` — Queen registers as an agent in swarm-mail
- Messages from inbox may include body (read full message when needed)
- Events emitted: `queen_decision_made`, `worker_status_update`, `worker_blocked`

---

## Module 2: decision-handler.ts

### Factory

```typescript
export interface DecisionHandler {
  handleDiscovery(msg: DiscoveryMessage): Promise<DecisionResult>;
  handleDecisionRequest(msg: DecisionNeededMessage): Promise<DecisionResult>;
  handleHelpRequest(msg: HelpRequestMessage): Promise<DecisionResult>;
}

export interface DecisionResult {
  action: "approved" | "rejected" | "deferred";
  reason: string;
  replyMessage: CortexMessage;  // Typed reply to send back
}

export function createDecisionHandler(deps: DecisionDeps): DecisionHandler;
```

### Decision Logic

#### handleDiscovery(msg: Discovery)

```
IF msg.priority <= 3:
  → APPROVED
  → Reply: { tag: "APPROVED", beadId: msg.beadId, decision: `Discovery approved: ${msg.title}` }
  → Emit queen_decision_made event
IF msg.priority > 3:
  → REJECTED
  → Reply: { tag: "REJECTED", beadId: msg.beadId, decision: `Discovery rejected: ${msg.title}`, reason: "Priority too low (P${msg.priority})" }
  → Emit queen_decision_made event
```

**Why P3 threshold:** P0-P3 are meaningful work items. P4+ is polish/cleanup that shouldn't block the main task.

#### handleDecisionRequest(msg: DecisionNeeded)

```
IF msg.recommendation exists:
  → APPROVED
  → Reply: { tag: "APPROVED", beadId: msg.beadId, decision: msg.recommendation }
IF no recommendation:
  → DEFERRED
  → Reply: { tag: "DEFERRED", beadId: msg.beadId, reason: "No recommendation provided, deferring to human" }
```

**Why:** The Queen trusts worker expertise for technical decisions. If the worker can't recommend, it's likely an architectural decision that needs human input.

#### handleHelpRequest(msg: HelpRequest)

```
IF msg.recommendation exists:
  → APPROVED
  → Reply: { tag: "APPROVED", beadId: msg.beadId, decision: msg.recommendation }
IF no recommendation:
  → Query memory: memoryRecall(msg.question, { limit: 5 })
  → IF relevant memories found:
    → APPROVED
    → Reply: { tag: "CONTEXT", beadId: msg.beadId, update: formatMemoryContext(memories) }
  → IF no relevant memories:
    → DEFERRED
    → Reply: { tag: "DEFERRED", beadId: msg.beadId, reason: "No relevant context found, deferring to human" }
```

---

## Module 3: review-handler.ts

### Factory

```typescript
export interface ReviewHandler {
  handleCompleted(msg: CompletedMessage): Promise<ReviewResult>;
  getAttemptCount(beadId: string): number;
  getRemainingAttempts(beadId: string): number;
}

export interface ReviewResult {
  status: "approved" | "needs_changes" | "blocked";
  issues?: ReviewIssue[];
  remainingAttempts?: number;
}

export function createReviewHandler(deps: ReviewDeps): ReviewHandler;
```

### Behavior

```
handleCompleted(msg):
  1. Run verification on worker's files:
     verificationRunner.runVerificationGate(msg.files, false)
  2. IF verification passes:
     → Reply: { tag: "REVIEW", beadId: msg.beadId, status: "approved" }
     → Clear attempt counter
     → Emit task_completed event
     → Return { status: "approved" }
  3. IF verification fails:
     → Increment attempt counter for this beadId
     → IF attempts >= 3:
       → Reply: { tag: "REVIEW", beadId: msg.beadId, status: "needs_changes", remainingAttempts: 0 }
       → Mark bead as blocked via beadClient
       → Emit task_blocked event
       → Return { status: "blocked" }
     → ELSE:
       → Reply: { tag: "REVIEW", beadId: msg.beadId, status: "needs_changes", issues: [...], remainingAttempts: 3 - attempts }
       → Return { status: "needs_changes", issues: [...] }
```

### 3-Strike Rule

- `reviewAttempts: Map<string, number>` — tracks per-bead attempt count
- After 3 failures → bead marked `blocked` (not `closed`)
- This signals an architectural problem, not "try harder"
- Clearing: `clearAttempts(beadId)` on approval or bead reset

---

## Module 4: learning-promoter.ts

### Factory

```typescript
export interface LearningPromoter {
  promoteLearnings(projectKey: string): Promise<PromotionResult>;
}

export interface PromotionResult {
  promoted: number;
  skipped: number;
  errors: string[];
}

export function createLearningPromoter(deps: LearningDeps): LearningPromoter;
```

### Behavior

```
promoteLearnings(projectKey):
  1. Query short-term memories: find candidates with confidence >= 0.7, age <= 30 days
  2. For each candidate:
     a. Check for duplicates in long-term: similarity > 0.95 → skip
     b. Store in long-term memory via hivemind_store
     c. Emit learning_stored event
  3. Return { promoted, skipped, errors }
```

### When Called

- After phase verification passes (all beads closed, verification passed)
- Only by Queen (workers CANNOT promote to long-term memory)
- Graceful: if long-term storage unavailable, skip silently (return skipped count)

---

## Test Requirements (60+ tests)

### monitor.test.ts (20+ tests)
1. processOnce() with no messages → idle counter incremented
2. processOnce() with STATUS message → event emitted, counter NOT incremented
3. processOnce() with DONE message → routed to reviewHandler
4. processOnce() with DISCOVERY message → routed to decisionHandler
5. processOnce() with HELP message → routed to decisionHandler
6. processOnce() with BLOCKED message → event emitted
7. processOnce() with unknown tag → logged, skipped
8. processOnce() with malformed body → logged, skipped
9. Same message not processed twice (processedMessageIds)
10. Auto-stop after maxIdlePolls idle cycles
11. Auto-stop when all beads closed
12. start() and stop() work
13. isRunning() returns correct state
14. getStats() returns message counts
15. Poll interval respected

### decision-handler.test.ts (15+ tests)
16. handleDiscovery P0 → approved
17. handleDiscovery P3 → approved
18. handleDiscovery P4 → rejected
19. handleDecisionRequest with recommendation → approved
20. handleDecisionRequest without recommendation → deferred
21. handleHelpRequest with recommendation → approved
22. handleHelpRequest without recommendation, relevant memories found → context update
23. handleHelpRequest without recommendation, no memories → deferred
24. All handlers emit queen_decision_made event
25. All handlers return typed reply messages
26. Reply messages validate against CortexMessageSchema

### review-handler.test.ts (15+ tests)
27. handleCompleted, verification passes → approved
28. handleCompleted, verification fails (1st attempt) → needs_changes with 2 remaining
29. handleCompleted, verification fails (2nd attempt) → needs_changes with 1 remaining
30. handleCompleted, verification fails (3rd attempt) → blocked
31. After block, bead status updated to blocked
32. task_completed event emitted on approval
33. task_blocked event emitted on 3-strike
34. Attempt counter cleared on approval
35. Issues array populated from verification errors
36. Reply messages validate against CortexMessageSchema

### learning-promoter.test.ts (10+ tests)
37. No candidates → { promoted: 0, skipped: 0 }
38. Candidate with confidence 0.8 → promoted
39. Candidate with confidence 0.5 → skipped
40. Candidate older than 30 days → skipped
41. Duplicate in long-term (similarity > 0.95) → skipped
42. Long-term storage unavailable → graceful skip
43. learning_stored event emitted for each promotion
44. Multiple candidates → correct promoted/skipped counts
45. Error during promotion → recorded in errors array, continues

---

## What To AVOID

- Do NOT use real `bd` CLI in tests → mock `beadClient`
- Do NOT use real `Bun.spawn` in tests → mock `verificationRunner`
- Do NOT use real swarm-mail database → mock `getInbox` and `sendMail`
- Do NOT import from original Cortex `src/queen/` → clean rewrite using fork's APIs
- Do NOT store `processedMessageIds` in database → in-memory Set is fine for CLI tool
- Do NOT make Queen editable — Queen is read-only + message-sending (coordinator guard still applies)
