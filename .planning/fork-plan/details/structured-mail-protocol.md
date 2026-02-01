# Structured Mail Protocol

> Typed message schemas for Queen/Worker communication in Cortex.

**Parent:** [03-INTEGRATION-SWARM-QUEEN-WORKER.md](../03-INTEGRATION-SWARM-QUEEN-WORKER.md)
**Reference:** [cortex/HLD.md — Communication Protocol](../../../HLD.md#communication-protocol)
**Implementation:** `src/worker/mail-sender.ts` (sending), `src/queen/monitor.ts` (classification), `src/mail/send.ts` (primitives)

---

## 1. Design Principles

1. **Typed messages** — Each message has a discriminated union type, not free-text
2. **Subject-tagged** — `[TAG]` prefix enables O(1) classification without parsing body
3. **Structured bodies** — Key-value pairs with known fields per message type
4. **Machine-parseable** — Bodies can be parsed by `parseMessageBody()` → `Record<string, string>`
5. **Priority-mapped** — Message importance derives from message type

---

## 2. Message Type Discriminated Union

### TypeScript Type Definition

```typescript
// Message classification tag — extracted from subject prefix [TAG]
type MessageTag =
  | "STATUS"     // Worker → Queen: progress update
  | "DONE"       // Worker → Queen: task completed
  | "BLOCKED"    // Worker → Queen: cannot proceed
  | "DISCOVERY"  // Worker → Queen: found new work
  | "DECISION"   // Worker → Queen: need scope decision
  | "HELP"       // Worker → Queen: stuck, need guidance
  | "APPROVED"   // Queen → Worker: decision approved
  | "REJECTED"   // Queen → Worker: decision rejected
  | "DEFERRED"   // Queen → Worker: decision deferred
  | "REVIEW"     // Queen → Worker: review feedback
  | "CONTEXT"    // Queen → Worker: context update
  | "UNBLOCKED"  // Queen → Worker: blocker resolved
  | "FILE"       // Worker → Workers: file change heads-up
  | "READY";     // Worker → Workers: dependency completed

// Full discriminated union of all message types
type CortexMessage =
  | StatusUpdate
  | Completed
  | Blocked
  | Discovery
  | DecisionNeeded
  | HelpRequest
  | Approved
  | Rejected
  | Deferred
  | ReviewFeedback
  | ContextUpdate
  | Unblocked
  | FileHeadsUp
  | DependencyReady
  | ScopeChangeRequest
  | LearningReport
  | PhaseGate;
```

---

## 3. Worker → Queen Messages

### 3.1 STATUS_UPDATE

Reports progress at regular intervals (25%, 50%, 75% or on state changes).

**Subject pattern:** `[STATUS] {beadId}: {status}`

**Implementation:** `mail-sender.ts → sendStatusUpdate()`

```typescript
interface StatusUpdate {
  tag: "STATUS";
  beadId: string;
  // Body fields
  status: string;              // "planning" | "executing" | "verifying" | etc.
  percent_complete: number;    // 0-100
  blockers: string;            // "none" or description
  files: string[];             // Files currently being modified
  notes?: string;              // Free-text context
}
```

**Example mail:**
```
Subject: [STATUS] bd-a3f8.2: executing
Body:
  status: executing
  percent_complete: 40
  blockers: none
  files: src/auth/oauth-client.ts, src/auth/index.ts
  notes: Token refresh flow implemented; pending tests.
```

**Priority:** NORMAL
**Ack required:** No
**Queen action:** Emit `task_started` event, log progress

---

### 3.2 COMPLETED

Worker has finished the task and passed self-verification.

**Subject pattern:** `[DONE] {beadId}: {title}`

**Implementation:** `mail-sender.ts → sendCompleted()`

```typescript
interface Completed {
  tag: "DONE";
  beadId: string;
  title: string;
  // Body fields
  files: string[];          // All files changed
  commit: string;           // Git commit hash
  summary: string;          // Path to SUMMARY.md (or "none")
  learnings: string;        // Semicolon-separated learnings
}
```

**Example mail:**
```
Subject: [DONE] bd-a3f8.2: OAuth client
Body:
  files: src/auth/oauth-client.ts, src/auth/index.ts
  commit: a1b2c3d
  summary: .planning/quick/bd-a3f8.2/001-SUMMARY.md
  learnings: refresh token needs 5min buffer; use Bun.spawn for verification
```

**Priority:** HIGH
**Ack required:** No (Queen will reply with [REVIEW])
**Queen action:** Run `handleDone()` → verify → send [APPROVED] or [REVIEW]

---

### 3.3 BLOCKED

Worker cannot proceed and needs external help.

**Subject pattern:** `[BLOCKED] {beadId}: {reason}`

**Implementation:** `mail-sender.ts → sendBlocked()`

```typescript
interface Blocked {
  tag: "BLOCKED";
  beadId: string;
  reason: string;
  // Body fields
  blocker: string;           // Specific blocking issue
  needed: string;            // What's needed to unblock
}
```

**Example mail:**
```
Subject: [BLOCKED] bd-a3f8.2: Awaiting OAuth client ID
Body:
  blocker: credentials not provided
  needed: client_id, client_secret
```

**Priority:** URGENT
**Ack required:** No
**Queen action:** Emit `task_blocked` event, attempt to resolve or escalate

---

### 3.4 DISCOVERY

Worker found new work during execution that wasn't in the original decomposition.

**Subject pattern:** `[DISCOVERY] {beadId}: Found {title}`

**Implementation:** `mail-sender.ts → sendDiscovery()`

```typescript
interface Discovery {
  tag: "DISCOVERY";
  beadId: string;           // Parent bead where discovery was made
  title: string;            // What was discovered
  // Body fields
  child_bead: string;       // ID of child bead already created
  description: string;      // Description of the discovered work
  priority: string;         // e.g., "P2"
}
```

**Example mail:**
```
Subject: [DISCOVERY] bd-a3f8.2: Found refresh token rotation
Body:
  child_bead: bd-a3f8.2.1
  description: Implement rotation + revoke old tokens
  priority: P2
```

**Priority:** HIGH
**Ack required:** No
**Queen action:** `handleDiscovery()` → approve/reject based on priority

**Worker protocol:** Worker creates the child bead FIRST via `createDiscovery()`, THEN notifies Queen. Queen approves or rejects after the fact — if rejected, the child bead stays in the graph but is marked as rejected.

---

### 3.5 DECISION_NEEDED

Worker needs a scope/architecture decision that exceeds their authority.

**Subject pattern:** `[DECISION] {beadId}: {question}`

**Implementation:** `mail-sender.ts → sendDecisionNeeded()`

```typescript
interface DecisionNeeded {
  tag: "DECISION";
  beadId: string;
  question: string;
  // Body fields
  options: Array<{
    name: string;
    tradeoff: string;
  }>;
  recommendation: string;    // Worker's preferred option
}
```

**Example mail:**
```
Subject: [DECISION] bd-a3f8.2: Store tokens in DB or Redis?
Body:
  options:
  - db: durable, slower reads
  - redis: fast, but not durable
  recommendation: db
```

**Priority:** HIGH
**Ack required:** No
**Queen action:** `handleDecisionRequest()` → approve recommendation

---

### 3.6 HELP_REQUEST

Worker is stuck and needs guidance or suggestions.

**Subject pattern:** `[HELP] {beadId}: {question}`

**Implementation:** `mail-sender.ts → sendHelpRequest()`

```typescript
interface HelpRequest {
  tag: "HELP";
  beadId: string;
  question: string;
  // Body fields
  what_tried: string;        // What the worker already attempted
  failed: string;            // Why it failed
  options: string[];         // Possible approaches
  recommendation: string;    // Worker's best guess
}
```

**Example mail:**
```
Subject: [HELP] bd-a3f8.2: How to store refresh tokens?
Body:
  what_tried: encrypted cookies, db table
  failed: cookie exceeds size limit
  options: [db table, redis cache]
  recommendation: db table
```

**Priority:** HIGH
**Ack required:** No
**Queen action:** `handleHelpRequest()` → approve recommendation or defer

---

## 4. Queen → Worker Messages

### 4.1 APPROVED

Queen approves a discovery, decision, or help recommendation.

**Subject pattern:** `[APPROVED] {beadId}: {decision}`

```typescript
interface Approved {
  tag: "APPROVED";
  beadId: string;
  decision: string;
  // Body fields
  reason?: string;           // Why approved
  notes?: string;            // Additional guidance
  selected?: string;         // Selected option (for decisions)
}
```

**Example mail:**
```
Subject: [APPROVED] bd-a3f8.2: proceed with db storage
Body:
  notes: use tokens table with 30-day expiry
```

**Priority:** NORMAL
**Ack required:** No

---

### 4.2 REJECTED

Queen rejects a discovery as out of scope.

**Subject pattern:** `[REJECTED] {beadId}: {reason}`

```typescript
interface Rejected {
  tag: "REJECTED";
  beadId: string;
  reason: string;
  // Body fields
  alternative?: string;      // What to do instead
}
```

**Example mail:**
```
Subject: [REJECTED] bd-a3f8.2.1: Low priority optimization
Body:
  reason: Rejected discovery with priority P4.
```

**Priority:** NORMAL
**Ack required:** No

---

### 4.3 DEFERRED

Queen defers a decision — asks worker to try their best option.

**Subject pattern:** `[DEFERRED] {beadId}: recommendation needed`

```typescript
interface Deferred {
  tag: "DEFERRED";
  beadId: string;
  // Body fields
  guidance: string;          // "please try your best option and report back"
}
```

**Priority:** NORMAL
**Ack required:** No

---

### 4.4 REVIEW_FEEDBACK

Queen's review of completed work.

**Subject pattern:** `[REVIEW] {beadId}: {verdict}`

```typescript
interface ReviewFeedback {
  tag: "REVIEW";
  beadId: string;
  verdict: "verified" | "needs changes" | "task failed after 3 review attempts";
  // Body fields (for needs_changes/failed)
  issues?: string[];         // List of issues to fix
  // Body fields (for verified)
  summary?: string;          // Summary of verified work
}
```

**Example mail (approved):**
```
Subject: [APPROVED] bd-a3f8.2: verified
Body:
  summary: OAuth client implementation verified
```

**Example mail (needs changes):**
```
Subject: [REVIEW] bd-a3f8.2: needs changes
Body:
  issues:
  - tests missing for refresh flow
  - lint error in src/auth/oauth-client.ts
```

**Example mail (3-strike failure):**
```
Subject: [REVIEW] bd-a3f8.2: task failed after 3 review attempts
Body:
  issues:
  - tests missing for refresh flow
  - lint error in src/auth/oauth-client.ts
```

**Priority:** HIGH
**Ack required:** No

---

### 4.5 CONTEXT_UPDATE

Queen forwards relevant information from other workers.

**Subject pattern:** `[CONTEXT] {info}`

```typescript
interface ContextUpdate {
  tag: "CONTEXT";
  info: string;
  // Body fields
  source?: string;           // Which worker/event triggered this
  affected_files?: string[]; // Files that were changed
  action_needed?: string;    // What this worker should do about it
}
```

**Example mail:**
```
Subject: [CONTEXT] OAuth regression found in phase verification
Body:
  source: phase-verifier
  affected_files: src/auth/oauth-client.ts
  action_needed: Fix task created: bd-a3f8.5
```

**Priority:** NORMAL
**Ack required:** No

---

### 4.6 UNBLOCKED

Queen resolved a blocker and the worker can proceed.

**Subject pattern:** `[UNBLOCKED] {beadId}`

```typescript
interface Unblocked {
  tag: "UNBLOCKED";
  beadId: string;
  // Body fields
  resolution: string;        // What changed
  proceed_with?: string;     // How to continue
}
```

**Priority:** HIGH
**Ack required:** No

---

## 5. Worker → Worker Messages

### 5.1 FILE_HEADS_UP

Worker changed a shared file and warns siblings.

**Subject pattern:** `[FILE] Modified {path}`

**Implementation:** `mail-sender.ts → sendFileHeadsUp()`

```typescript
interface FileHeadsUp {
  tag: "FILE";
  path: string;
  // Body fields
  what_changed: string;       // Description of changes
  why: string;                // Reason for changes
  interface_change: string;   // "none" or description of interface changes
}
```

**Example mail:**
```
Subject: [FILE] Modified src/auth/types.ts
Body:
  what_changed: Added TokenPayload interface
  why: Needed for token refresh implementation
  interface_change: new export TokenPayload { userId, exp, iat }
```

**Priority:** LOW
**Ack required:** No
**Recipient:** `workers` (broadcast to all workers)

---

### 5.2 DEPENDENCY_READY

Worker completed a task that unblocks other workers.

**Subject pattern:** `[READY] {beadId} complete`

**Implementation:** `mail-sender.ts → sendDependencyReady()`

```typescript
interface DependencyReady {
  tag: "READY";
  beadId: string;
  // Body fields
  what_implemented: string;   // What was implemented
  api_details: string;        // API/interface details (or "none")
}
```

**Example mail:**
```
Subject: [READY] bd-a3f8.1 complete
Body:
  what_implemented: Auth routes for login, logout, refresh
  api_details: POST /api/auth/login, POST /api/auth/logout, POST /api/auth/refresh
```

**Priority:** NORMAL
**Ack required:** No
**Recipient:** `workers` (broadcast to all workers)

---

## 6. Extended Message Types (Planned)

These types are specified in the task description but not yet implemented in Cortex. They represent the complete protocol target.

### 6.1 SCOPE_CHANGE_REQUEST

Worker or Queen requests a scope change that exceeds normal discovery.

```typescript
interface ScopeChangeRequest {
  tag: "SCOPE_CHANGE";
  beadId: string;
  requestedBy: string;       // Agent name
  // Body fields
  current_scope: string;     // What the task currently covers
  requested_scope: string;   // What it should cover
  justification: string;     // Why the change is needed
  impact: string;            // What other tasks are affected
  recommendation: string;    // "approve" | "reject" | "split"
}
```

**Priority:** HIGH
**Ack required:** Yes (Queen must respond)
**Queen action:** Evaluate impact, approve/reject/split into new tasks

---

### 6.2 LEARNING_REPORT

Worker reports learnings after task completion for Queen to evaluate for promotion.

```typescript
interface LearningReport {
  tag: "LEARNING";
  beadId: string;
  // Body fields
  learnings: Array<{
    insight: string;         // The learning itself
    tags: string;            // Comma-separated tags
    confidence: number;      // 0.0-1.0, how confident is this learning
    scope: string;           // "task" | "epic" | "project" | "universal"
  }>;
  recommend_promotion: boolean; // Worker's recommendation to promote
}
```

**Priority:** LOW
**Ack required:** No
**Queen action:** Evaluate during `promoteLearnings()` phase

---

### 6.3 PHASE_GATE

Queen announces phase completion or phase transition.

```typescript
interface PhaseGate {
  tag: "PHASE_GATE";
  epicBeadId: string;
  phase: string;             // Phase identifier
  // Body fields
  status: "verified" | "failed" | "pending_verification";
  open_beads: number;        // Count of unclosed beads
  total_beads: number;       // Total beads in phase
  fix_beads_created: string[]; // IDs of fix beads if failed
  next_phase?: string;       // Next phase if verified
}
```

**Priority:** HIGH
**Ack required:** No
**Recipient:** All workers in the epic (broadcast)

---

## 7. Body Schema Format

### Parsing Convention

All message bodies use a simple key-value format parseable by `parseMessageBody()` from `src/queen/decision-handler.ts`:

```typescript
function parseMessageBody(body: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of body.split("\n")) {
    const idx = line.indexOf(":");
    if (idx > 0) {
      const key = line.slice(0, idx).trim();
      const value = line.slice(idx + 1).trim();
      if (key.length > 0) {
        result[key] = value;
      }
    }
  }
  return result;
}
```

### Format Rules

1. One key-value pair per line: `key: value`
2. Keys are lowercase with underscores: `percent_complete`, `child_bead`
3. Values are plain text (no JSON, no nested objects)
4. Lists are comma-separated: `files: src/a.ts, src/b.ts`
5. Multi-line values use continuation lines starting with `- `: 
   ```
   options:
   - db: durable, slower reads
   - redis: fast, but not durable
   ```
6. Optional fields are omitted (not sent as empty)

### Standard Fields Reference

| Field | Type | Used By | Description |
|---|---|---|---|
| `status` | string | STATUS_UPDATE | Current worker state |
| `percent_complete` | number | STATUS_UPDATE | 0-100 progress |
| `blockers` | string | STATUS_UPDATE | "none" or description |
| `files` | csv | STATUS_UPDATE, COMPLETED | Affected file paths |
| `notes` | string | STATUS_UPDATE, APPROVED | Free-text context |
| `commit` | string | COMPLETED | Git commit hash |
| `summary` | string | COMPLETED, REVIEW | Path to SUMMARY.md |
| `learnings` | string | COMPLETED | Semicolon-separated insights |
| `blocker` | string | BLOCKED | Specific blocking issue |
| `needed` | string | BLOCKED | What's needed to unblock |
| `child_bead` | string | DISCOVERY | Child bead ID |
| `description` | string | DISCOVERY | Discovery description |
| `priority` | string | DISCOVERY | e.g., "P2" |
| `options` | multiline | DECISION, HELP | List of options with tradeoffs |
| `recommendation` | string | DECISION, HELP | Worker's preferred option |
| `what_tried` | string | HELP | What was attempted |
| `failed` | string | HELP | Why it failed |
| `reason` | string | APPROVED, REJECTED | Decision reason |
| `selected` | string | APPROVED | Selected option |
| `issues` | multiline | REVIEW | List of review issues |
| `what_changed` | string | FILE | Description of file changes |
| `why` | string | FILE | Reason for changes |
| `interface_change` | string | FILE | "none" or interface description |
| `what_implemented` | string | READY | What was implemented |
| `api_details` | string | READY | API/interface details |

---

## 8. Thread Conventions

### One Thread Per Task

Each bead has its own thread for all related messages:

```
Thread ID: thread-{beadId}  (e.g., "thread-bd-a3f8.2")
```

All messages about `bd-a3f8.2` — status updates, help requests, reviews — use the same `thread_id`. This enables:
- Reading full conversation history for a task
- Understanding decision context
- Auditing the complete lifecycle

### Queen Broadcast Thread

Announcements from Queen to all workers:

```
Thread ID: thread-queen-broadcast
```

Used for:
- Phase gate announcements
- Context updates affecting all workers
- Configuration changes

### Worker Peer Thread

Worker-to-worker coordination within a task context:

```
Thread ID: thread-{beadId}-peer
```

Used for:
- File heads-up notifications
- Dependency ready notifications

### Thread ID Generation

From `src/mail/threads.ts`:

```typescript
function generateThreadId(): string {
  return `thread-${crypto.randomUUID().slice(0, 8)}`;
}
```

**Convention:** Workers should create threads using deterministic IDs based on bead ID (e.g., `thread-bd-a3f8.2`) rather than random UUIDs, to enable thread correlation.

---

## 9. Acknowledgement Protocol

### Which Messages Require Ack

| Message Type | Ack Required | Reason |
|---|---|---|
| STATUS_UPDATE | No | Informational, loss is acceptable |
| COMPLETED | No | Queen will reply with REVIEW (implicit ack) |
| BLOCKED | No | Queen will take action (implicit ack) |
| DISCOVERY | No | Queen will reply with APPROVED/REJECTED (implicit ack) |
| DECISION_NEEDED | No | Queen will reply with APPROVED/DEFERRED (implicit ack) |
| HELP_REQUEST | No | Queen will reply with APPROVED/DEFERRED (implicit ack) |
| APPROVED | No | Worker proceeds (implicit ack via next STATUS) |
| REJECTED | No | Worker adjusts (implicit ack via next STATUS) |
| REVIEW | No | Worker fixes and resends COMPLETED (implicit ack) |
| SCOPE_CHANGE_REQUEST | **Yes** | Critical — scope changes must be explicitly acknowledged |
| PHASE_GATE | No | Informational broadcast |

### Implicit vs Explicit Ack

Most messages use **implicit acknowledgement** — the response message serves as acknowledgement. For example:
- Worker sends `[DISCOVERY]` → Queen sends `[APPROVED]` → implicit ack
- Worker sends `[DONE]` → Queen sends `[REVIEW]` → implicit ack
- Worker sends `[STATUS]` → No response needed → no ack

**Explicit ack** (via `ackMessage()`) is reserved for critical messages where loss could cause incorrect behavior. Currently, only future `SCOPE_CHANGE_REQUEST` messages require explicit ack.

### Timeout for Unacked Messages

From `src/mail/inbox.ts`, ack is tracked via `acked_at` column:

```typescript
function ackMessage(id: string, ackerAgent?: string): AcknowledgeResult {
  // Sets acked_at timestamp
  // Emits mail_acked event
}
```

**Timeout policy (planned):**
- If `ack_required` message is not acked within 60 seconds:
  1. Queen resends with `importance: "urgent"`
  2. If still not acked after 120 seconds: Queen escalates (marks worker as potentially stuck)

---

## 10. Priority Mapping

Message importance maps directly from message type:

| Priority | Importance | Message Types | Behavior |
|---|---|---|---|
| URGENT | `"urgent"` | BLOCKED | Immediate attention. Queen processes first in poll loop. |
| HIGH | `"high"` | DONE, DISCOVERY, DECISION, HELP, REVIEW, UNBLOCKED, PHASE_GATE | Important — affects worker progress. |
| NORMAL | `"normal"` | STATUS, APPROVED, REJECTED, DEFERRED, CONTEXT, READY | Routine — processed in order. |
| LOW | `"low"` | FILE, LEARNING | Informational — can be batched or deferred. |

### Priority in Mail System

From `src/mail/send.ts`:

```typescript
function sendMessage(opts: {
  // ...
  importance?: "low" | "normal" | "high" | "urgent";
  // ...
}): SendMessageResult;
```

The `importance` field is stored in the `messages` table and can be used for filtering:

```typescript
// From inbox.ts
function getInbox(opts: {
  urgentOnly?: boolean;  // Filter to urgent messages only
  // ...
}): InboxResult;
```

### Queen Priority Processing

The monitor processes all messages in order (FIFO), but `urgentOnly` flag allows Queen to check for urgent messages first:

```
1. Check urgentOnly inbox → process BLOCKED messages immediately
2. Check full inbox → process all other messages in order
```

---

## 11. Integration with Swarm-Mail Primitives

### Existing Primitives (Preserved)

Cortex's mail system is built on the same primitives as swarm-mail:

| Primitive | Cortex Implementation | swarm-mail Equivalent |
|---|---|---|
| Send message | `sendMessage()` in `src/mail/send.ts` | `swarmmail_send()` |
| Read inbox | `getInbox()` in `src/mail/inbox.ts` | `swarmmail_inbox()` |
| Read message | `readMessage()` in `src/mail/inbox.ts` | `swarmmail_read_message()` |
| Acknowledge | `ackMessage()` in `src/mail/inbox.ts` | `swarmmail_ack()` |
| Reserve files | `reserveFiles()` in `src/mail/reservations.ts` | `swarmmail_reserve()` |
| Release files | `releaseFiles()` in `src/mail/reservations.ts` | `swarmmail_release()` |
| Thread messages | `getThreadMessages()` in `src/mail/threads.ts` | (not in swarm-mail) |
| Mark as read | `markAsRead()` in `src/mail/inbox.ts` | (not in swarm-mail) |

### What Cortex Adds Over Swarm-Mail

1. **Thread management** (`src/mail/threads.ts`) — list threads, get thread messages, generate thread IDs
2. **Read tracking** — `read_at` column, `markAsRead()`, `getUnreadCount()`
3. **Typed message senders** (`src/worker/mail-sender.ts`) — functions for each message type instead of raw `sendMessage()`
4. **Message classification** (`src/queen/monitor.ts → classifyMessage()`) — extracts `[TAG]` from subject
5. **Body parsing** (`src/queen/decision-handler.ts → parseMessageBody()`) — structured key-value extraction
6. **Event emission** — every mail operation emits events (`mail_sent`, `mail_acked`, `mail_read`, `thread_created`, `thread_activity`)

### Database Schema (Same as Swarm-Mail)

```sql
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  project_key TEXT NOT NULL,
  from_agent TEXT NOT NULL,
  to_recipients TEXT NOT NULL,   -- Comma-separated agent names
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  thread_id TEXT,
  importance TEXT DEFAULT 'normal',
  ack_required INTEGER DEFAULT 0,
  created_at TEXT NOT NULL,
  read_at TEXT,                  -- Cortex addition
  acked_at TEXT                  -- Cortex addition
);
```

---

## 12. Message Flow Examples

### Example 1: Normal Task Completion

```
Worker-1 → Queen:
  Subject: [STATUS] bd-a3f8.2: in_progress
  Body: status: in_progress\npercent_complete: 10\nblockers: none

Worker-1 → Queen:
  Subject: [STATUS] bd-a3f8.2: executing
  Body: status: executing\npercent_complete: 50\nfiles: src/auth/client.ts

Worker-1 → Queen:
  Subject: [DONE] bd-a3f8.2: OAuth client
  Body: files: src/auth/client.ts\ncommit: a1b2c3d\nlearnings: use 5min buffer

Queen → Worker-1:
  Subject: [APPROVED] bd-a3f8.2: verified
  Body: summary: OAuth client verified
```

### Example 2: Discovery + Approval

```
Worker-1 → Queen:
  Subject: [DISCOVERY] bd-a3f8.2: Found refresh token rotation
  Body: child_bead: bd-a3f8.2.1\ndescription: Rotation + revoke\npriority: P2

Queen → Worker-1:
  Subject: [APPROVED] bd-a3f8.2.1: Rotation + revoke
  Body: reason: Approved discovery with priority P2.
```

### Example 3: Review Failure + Fix

```
Worker-2 → Queen:
  Subject: [DONE] bd-a3f8.3: Token storage
  Body: files: src/auth/store.ts\ncommit: d4e5f6g

Queen → Worker-2:
  Subject: [REVIEW] bd-a3f8.3: needs changes
  Body: issues:\n- tests missing for refresh flow\n- lint error in store.ts

Worker-2 → Queen:
  Subject: [DONE] bd-a3f8.3: Token storage (fixed)
  Body: files: src/auth/store.ts\ncommit: h7i8j9k

Queen → Worker-2:
  Subject: [APPROVED] bd-a3f8.3: verified
  Body: summary: Token storage verified
```

### Example 4: Help Request + Deferral

```
Worker-3 → Queen:
  Subject: [HELP] bd-a3f8.4: How to handle token expiry?
  Body: what_tried: manual check\nfailed: race condition\noptions: [polling, event]\nrecommendation:

Queen → Worker-3:
  Subject: [DEFERRED] bd-a3f8.4: recommendation needed
  Body: please try your best option and report back
```

### Example 5: Phase Verification Failure

```
(All tasks complete, Queen runs phase verification)

Queen → All Workers (broadcast):
  Subject: [CONTEXT] Phase verification failed
  Body: source: phase-verifier\naction_needed: Fix beads created

Queen → Worker-4:
  Subject: [CONTEXT] Fix build verification failures
  Body: source: phase-verifier\naffected_files: src/auth/*\naction_needed: bd-a3f8.5 created
```

---

## 13. Migration from Swarm-Mail

When forking swarm-tools, the mail system migration is minimal:

### Direct Mapping

| Swarm-Mail Call | Cortex Equivalent | Notes |
|---|---|---|
| `swarmmail_send({ to, subject, body })` | `sendMessage({ to, subject, body, projectKey, fromAgent })` | Add projectKey and fromAgent |
| `swarmmail_inbox({ limit })` | `getInbox({ projectKey, agentName, limit })` | Add projectKey and agentName |
| `swarmmail_read_message({ message_id })` | `readMessage(id)` | Same |
| `swarmmail_ack({ message_id })` | `ackMessage(id)` | Same |
| `swarmmail_reserve({ paths })` | `reserveFiles({ paths, agentName, projectKey })` | Add identity |
| `swarmmail_release({ paths })` | `releaseFiles({ agentName, projectKey, paths })` | Add identity |

### New Capabilities

| Cortex Feature | Why Added |
|---|---|
| `classifyMessage(subject)` | O(1) message routing without body parsing |
| `parseMessageBody(body)` | Structured data extraction from plain text |
| Typed sender functions | Type-safe message construction |
| Thread management | Conversation tracking per task |
| Read/unread tracking | Queen can track which messages are new |
| Event emission on all ops | Full audit trail |
