# Sub-Plan 01: Structured Mail Message Types

**Parent:** Phase 5 Task 1
**Wave:** 1 (Foundation — everything depends on this)
**Depends On:** Nothing
**Output:** `packages/opencode-swarm-plugin/src/queen/message-types.ts`
**Tests:** `packages/opencode-swarm-plugin/src/queen/__tests__/message-types.test.ts`

---

## Problem

Swarm-tools uses free-text mail with `[TAG]` conventions in subject lines (see `swarm-orchestrate.ts` line 775: `subject: \`Progress: ${args.bead_id} - ${args.status}\``). These are NOT enforced — workers can send anything. The Queen can't reliably parse or validate worker messages.

## Solution

17 Zod discriminated union schemas on a `tag` field. Every message to/from Queen/Worker is parsed, validated, and typed at runtime.

---

## Exact TypeScript Interface

```typescript
import { z } from "zod";

// ============================================================================
// Message Tag Enum
// ============================================================================

export const MessageTagSchema = z.enum([
  // Worker → Queen (6)
  "STATUS", "DONE", "BLOCKED", "DISCOVERY", "DECISION", "HELP",
  // Queen → Worker (6)
  "APPROVED", "REJECTED", "DEFERRED", "REVIEW", "CONTEXT", "UNBLOCKED",
  // Worker → Worker (2)
  "FILE", "READY",
  // Special (3)
  "SCOPE_CHANGE", "LEARNING", "PHASE_GATE",
]);
export type MessageTag = z.infer<typeof MessageTagSchema>;

// ============================================================================
// Worker → Queen Messages (6)
// ============================================================================

export const StatusUpdateSchema = z.object({
  tag: z.literal("STATUS"),
  beadId: z.string(),
  status: z.enum(["planning", "executing", "verifying", "learning"]),
  percentComplete: z.number().min(0).max(100),
  files: z.array(z.string()).optional(),
  blockers: z.array(z.string()).optional(),
  message: z.string().optional(),
});

export const CompletedSchema = z.object({
  tag: z.literal("DONE"),
  beadId: z.string(),
  summary: z.string().min(1),
  files: z.array(z.string()),
  commit: z.string().optional(),       // commit SHA
  learnings: z.array(z.object({
    info: z.string(),
    tags: z.string(),
  })).optional(),
});

export const BlockedSchema = z.object({
  tag: z.literal("BLOCKED"),
  beadId: z.string(),
  blocker: z.string().min(1),
  attempts: z.number().optional(),
  suggestion: z.string().optional(),
});

export const DiscoverySchema = z.object({
  tag: z.literal("DISCOVERY"),
  beadId: z.string(),               // parent bead (worker's own task)
  childBeadId: z.string(),          // newly created child bead
  title: z.string().min(1),
  priority: z.number().min(0).max(4), // P0-P4
  rationale: z.string().min(1),
});

export const DecisionNeededSchema = z.object({
  tag: z.literal("DECISION"),
  beadId: z.string(),
  question: z.string().min(1),
  options: z.array(z.object({
    label: z.string(),
    description: z.string(),
    tradeoffs: z.string().optional(),
  })).min(2),
  recommendation: z.string().optional(),
});

export const HelpRequestSchema = z.object({
  tag: z.literal("HELP"),
  beadId: z.string(),
  question: z.string().min(1),
  context: z.string(),              // what the worker already tried
  recommendation: z.string().optional(),
});

// ============================================================================
// Queen → Worker Messages (6)
// ============================================================================

export const ApprovedSchema = z.object({
  tag: z.literal("APPROVED"),
  beadId: z.string(),
  decision: z.string(),             // what was approved
  reason: z.string().optional(),
});

export const RejectedSchema = z.object({
  tag: z.literal("REJECTED"),
  beadId: z.string(),
  decision: z.string(),             // what was rejected
  reason: z.string().min(1),        // MUST explain why
});

export const DeferredSchema = z.object({
  tag: z.literal("DEFERRED"),
  beadId: z.string(),
  reason: z.string().min(1),
  waitingFor: z.string().optional(), // what/who we're waiting for
});

export const ReviewFeedbackSchema = z.object({
  tag: z.literal("REVIEW"),
  beadId: z.string(),
  status: z.enum(["approved", "needs_changes"]),
  issues: z.array(z.object({
    file: z.string(),
    line: z.number().optional(),
    issue: z.string(),
    suggestion: z.string().optional(),
  })).optional(),
  summary: z.string().optional(),
  remainingAttempts: z.number().optional(),
});

export const ContextUpdateSchema = z.object({
  tag: z.literal("CONTEXT"),
  beadId: z.string().optional(),     // null for broadcast
  update: z.string().min(1),
  fromWorker: z.string().optional(), // which worker originated this info
});

export const UnblockedSchema = z.object({
  tag: z.literal("UNBLOCKED"),
  beadId: z.string(),
  resolution: z.string().min(1),
});

// ============================================================================
// Worker → Worker Messages (2)
// ============================================================================

export const FileHeadsUpSchema = z.object({
  tag: z.literal("FILE"),
  beadId: z.string(),
  files: z.array(z.string()).min(1),
  changeType: z.enum(["created", "modified", "deleted", "renamed"]),
});

export const DependencyReadySchema = z.object({
  tag: z.literal("READY"),
  beadId: z.string(),               // the completed bead
  dependentBeadIds: z.array(z.string()), // beads that were waiting on this
});

// ============================================================================
// Special Messages (3)
// ============================================================================

export const ScopeChangeRequestSchema = z.object({
  tag: z.literal("SCOPE_CHANGE"),
  beadId: z.string(),
  proposedChange: z.string().min(1),
  impact: z.enum(["minor", "moderate", "major"]),
});

export const LearningReportSchema = z.object({
  tag: z.literal("LEARNING"),
  beadId: z.string(),
  learnings: z.array(z.object({
    info: z.string(),
    tags: z.string(),
    confidence: z.number().min(0).max(1).optional(),
  })),
});

export const PhaseGateSchema = z.object({
  tag: z.literal("PHASE_GATE"),
  phaseId: z.string(),
  status: z.enum(["passed", "failed", "pending_review"]),
  results: z.object({
    truthsPassed: z.number(),
    truthsFailed: z.number(),
    artifactsPassed: z.number(),
    artifactsFailed: z.number(),
    keyLinksPassed: z.number(),
    keyLinksFailed: z.number(),
  }),
});

// ============================================================================
// Discriminated Union
// ============================================================================

export const CortexMessageSchema = z.discriminatedUnion("tag", [
  // Worker → Queen
  StatusUpdateSchema,
  CompletedSchema,
  BlockedSchema,
  DiscoverySchema,
  DecisionNeededSchema,
  HelpRequestSchema,
  // Queen → Worker
  ApprovedSchema,
  RejectedSchema,
  DeferredSchema,
  ReviewFeedbackSchema,
  ContextUpdateSchema,
  UnblockedSchema,
  // Worker → Worker
  FileHeadsUpSchema,
  DependencyReadySchema,
  // Special
  ScopeChangeRequestSchema,
  LearningReportSchema,
  PhaseGateSchema,
]);

export type CortexMessage = z.infer<typeof CortexMessageSchema>;
```

---

## Helper Functions

### classifyMessage(subject: string): MessageTag | null

```typescript
// Extracts [TAG] from subject prefix
// "[STATUS] bd-123: planning" → "STATUS"
// "[DONE] bd-123: completed" → "DONE"
// "Random subject" → null
export function classifyMessage(subject: string): MessageTag | null {
  const match = subject.match(/^\[([A-Z_]+)\]/);
  if (!match) return null;
  const tag = match[1];
  const result = MessageTagSchema.safeParse(tag);
  return result.success ? result.data : null;
}
```

### parseCortexMessage(subject: string, body: string): CortexMessage | null

```typescript
// Parse subject + body into typed message
// 1. Extract tag from subject via classifyMessage()
// 2. Parse body as key-value pairs (line format: "key: value")
// 3. Merge tag + parsed body
// 4. Validate against CortexMessageSchema
// 5. Return typed message or null on failure
export function parseCortexMessage(subject: string, body: string): CortexMessage | null;
```

### formatMessageBody(msg: CortexMessage): string

```typescript
// Serialize structured message to key-value body string
// Each field becomes "fieldName: value" line
// Arrays become JSON-encoded
// Nested objects become JSON-encoded
export function formatMessageBody(msg: CortexMessage): string;
```

### createMailEnvelope(msg: CortexMessage, from: string, to: string[], threadId: string)

```typescript
// Create ready-to-send swarm-mail params from typed message
// Returns: { fromAgent, toAgents, subject, body, threadId, importance, ackRequired }
export function createMailEnvelope(
  msg: CortexMessage,
  from: string,
  to: string[],
  threadId: string,
): {
  fromAgent: string;
  toAgents: string[];
  subject: string;       // "[TAG] beadId: summary"
  body: string;          // formatMessageBody(msg)
  threadId: string;
  importance: "low" | "normal" | "high" | "urgent";
  ackRequired: boolean;
};
```

**Importance mapping:**
- BLOCKED, DONE → "high"
- PHASE_GATE (failed) → "urgent"
- STATUS → "normal"
- FILE → "low"
- Everything else → "normal"

**ackRequired mapping:**
- BLOCKED, PHASE_GATE → true
- Everything else → false

---

## Test Requirements (30+ tests)

### Validation Tests (17 tests — one per type)
1. StatusUpdateSchema validates correct input
2. CompletedSchema validates correct input
3. BlockedSchema validates correct input
4. DiscoverySchema validates correct input
5. DecisionNeededSchema validates correct input (min 2 options)
6. HelpRequestSchema validates correct input
7. ApprovedSchema validates correct input
8. RejectedSchema validates correct input (reason required)
9. DeferredSchema validates correct input
10. ReviewFeedbackSchema validates correct input
11. ContextUpdateSchema validates correct input
12. UnblockedSchema validates correct input
13. FileHeadsUpSchema validates correct input (min 1 file)
14. DependencyReadySchema validates correct input
15. ScopeChangeRequestSchema validates correct input
16. LearningReportSchema validates correct input
17. PhaseGateSchema validates correct input

### Rejection Tests (5+ tests)
18. Missing required field → validation fails
19. Wrong tag value → discriminated union rejects
20. Empty beadId → fails
21. DecisionNeeded with 0 options → fails
22. RejectedSchema with empty reason → fails

### Helper Tests (8+ tests)
23. classifyMessage("[STATUS] bd-123: planning") → "STATUS"
24. classifyMessage("[DONE] bd-123: completed") → "DONE"
25. classifyMessage("Random subject") → null
26. classifyMessage("[INVALID] something") → null
27. parseCortexMessage round-trips with formatMessageBody (STATUS type)
28. parseCortexMessage round-trips with formatMessageBody (DONE type with learnings array)
29. parseCortexMessage with malformed body → null
30. createMailEnvelope sets correct importance for BLOCKED (high) vs STATUS (normal)

---

## Implementation Notes

- **File location:** `packages/opencode-swarm-plugin/src/queen/message-types.ts`
- **Test location:** `packages/opencode-swarm-plugin/src/queen/__tests__/message-types.test.ts`
- **Import Zod from:** `zod` (already a dependency of the package)
- **Do NOT import** from `swarm-mail` — message types are a standalone validation layer
- **Do NOT import** from original Cortex `src/` — clean rewrite
- **Body parsing:** Use simple line-based key-value parsing (not JSON) for human-readability in mail
  - Single values: `key: value`
  - Arrays: `key: ["item1", "item2"]` (JSON-encoded)
  - Nested objects: `key: {"nested": "value"}` (JSON-encoded)
