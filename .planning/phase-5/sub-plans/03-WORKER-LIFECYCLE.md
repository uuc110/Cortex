# Sub-Plan 03: Worker Lifecycle

**Parent:** Phase 5 Task 3
**Wave:** 2 (Parallel with Sub-Plan 02)
**Depends On:** Sub-Plan 01 (message types)
**Output:** `packages/opencode-swarm-plugin/src/worker/{lifecycle,context-loader,self-verifier,mail-sender,discovery-handler}.ts`
**Tests:** `packages/opencode-swarm-plugin/src/worker/__tests__/{lifecycle,context-loader,self-verifier,mail-sender}.test.ts`

---

## Problem

Swarm workers are dumb executors — they receive a prompt and implement. They don't:
- Know what their siblings are doing
- Know what was already completed by dependencies
- Recall relevant past learnings
- Self-verify before reporting done
- Store insights for future workers
- Follow any lifecycle protocol

See `ORCHESTRATION-ANALYSIS.md` section 2.3 for full gap analysis.

## Solution

An 8-step worker lifecycle with full context loading, self-verification, learning capture, and typed communication.

---

## Module 1: lifecycle.ts — The 8-Step Engine

### Factory

```typescript
export interface WorkerConfig {
  beadId: string;          // Task to execute
  projectPath: string;     // Project root
  projectKey: string;      // Project identifier
  workerName: string;      // Agent identity (e.g., "worker-1")
}

export interface WorkerDeps {
  beadClient: BeadClientInterface;        // From Phase 3 bridge
  sendMail: (params: SendMailParams) => Promise<void>;
  memoryStore: (info: string, tags: string) => Promise<void>;      // hivemind_store
  memoryRecall: (query: string, opts?: { limit?: number }) => Promise<RankedMemory[]>; // hivemind_find
  eventStore: EventStoreInterface;        // createEvent + appendEvent
  contextLoader: ContextLoader;           // From context-loader.ts
  selfVerifier: SelfVerifier;             // From self-verifier.ts
  mailSender: WorkerMailSender;           // From mail-sender.ts
  discoveryHandler: DiscoveryHandlerFn;   // From discovery-handler.ts
}

export type TaskExecutor = (context: WorkerContext, plan: string) => Promise<ExecutionResult>;

export interface ExecutionResult {
  success: boolean;
  files: string[];
  commit?: string;
  learnings?: Array<{ info: string; tags: string }>;
  errors?: string[];
}

export interface WorkerResult {
  status: "completed" | "blocked" | "failed";
  executionResult?: ExecutionResult;
  verificationResult?: VerificationResult;
  context: WorkerContext;
}

export function createWorkerLifecycle(config: WorkerConfig, deps: WorkerDeps): WorkerLifecycle;

export interface WorkerLifecycle {
  run(taskExecutor: TaskExecutor): Promise<WorkerResult>;
  getCurrentStep(): WorkerStep;
}

export type WorkerStep = "pickup" | "orient" | "plan" | "execute" | "verify" | "learn" | "report" | "close";
```

### The 8 Steps

```
Step 1: PICKUP
  - beadClient.update(beadId, { status: "in_progress" })
  - eventStore.emit("task_started", { beadId, workerName })
  - mailSender.sendStatus(beadId, "planning", 5)

Step 2: ORIENT
  - context = contextLoader.loadWorkerContext(beadId, deps)
  - Returns: { bead, epic, siblings, dependencies, memoryContext }
  - mailSender.sendStatus(beadId, "planning", 10)

Step 3: PLAN
  - Generate local execution plan from context
  - plan = formatPlanFromContext(context)
  - This is a STRING the task executor receives (not a PLAN.md)
  - mailSender.sendStatus(beadId, "planning", 15)

Step 4: EXECUTE
  - result = taskExecutor(context, plan)
  - Task executor is a CALLBACK — the lifecycle doesn't know HOW work gets done
  - During execution, the task executor can call:
    - mailSender.sendStatus(beadId, status, percent)  — progress updates
    - mailSender.sendBlocked(beadId, blocker)          — if stuck
    - mailSender.sendHelpRequest(beadId, question, ctx) — if needs help
    - mailSender.sendDecisionNeeded(beadId, q, opts)   — if needs scope decision
    - discoveryHandler(discovery, deps)                — if finds new work
  - mailSender.sendStatus(beadId, "executing", 50)  — midpoint update

Step 5: VERIFY
  - IF result.success:
    - verification = selfVerifier.verify(projectPath, result.files)
    - IF verification.passed → continue to LEARN
    - IF verification.failed → mailSender.sendBlocked(beadId, verification.errors)
                              → return { status: "blocked" }
  - IF result.success === false:
    - mailSender.sendBlocked(beadId, result.errors.join("\n"))
    - return { status: "failed" }

Step 6: LEARN
  - For each learning in result.learnings:
    - memoryStore(learning.info, learning.tags)
    - eventStore.emit("learning_stored", { beadId, info: learning.info })
  - mailSender.sendStatus(beadId, "learning", 90)

Step 7: REPORT
  - mailSender.sendCompleted(beadId, summary, result.files, result.commit, result.learnings)
  - This sends [DONE] to Queen → Queen will review and approve/reject
  - Worker waits for Queen's [REVIEW] response? NO — worker reports and moves to CLOSE.
    Queen review is async. If Queen requests changes, a NEW worker lifecycle is started.

Step 8: CLOSE
  - beadClient.close(beadId, `Done. Files: ${result.files.join(", ")}`)
  - eventStore.emit("task_completed", { beadId, workerName, files: result.files })
  - return { status: "completed", executionResult: result, verificationResult: verification, context }
```

---

## Module 2: context-loader.ts

### Factory

```typescript
export interface WorkerContext {
  bead: BeadInfo;                    // Own task: title, description, priority, status
  epic: BeadInfo | null;             // Parent epic: overall goal, acceptance criteria
  siblings: BeadInfo[];              // Sibling tasks: what other workers are doing
  dependencies: BeadInfo[];          // Completed deps: what was already done (with summaries)
  memoryContext: RankedMemory[];     // Past patterns relevant to this task
  projectPath: string;
  projectKey: string;
}

export interface BeadInfo {
  id: string;
  title: string;
  description: string;
  status: string;
  priority: number;
  parentId?: string;
}

export interface ContextLoader {
  loadWorkerContext(beadId: string): Promise<WorkerContext>;
}

export function createContextLoader(deps: ContextLoaderDeps): ContextLoader;
```

### Loading Steps

```
loadWorkerContext(beadId):
  1. bead = beadClient.show(beadId)
     - IF bd unavailable → fallback: build minimal bead from hive cell
  2. epic = bead.parentId ? beadClient.show(bead.parentId) : null
     - Provides overall goal context
  3. siblings = beadClient.list({ parentId: epic?.id })
     - Filter out own bead
     - Provides awareness of parallel work
  4. dependencies = beadClient.listDeps(beadId)
     - For each dep: beadClient.show(dep.id)
     - Provides completed work context (summaries, commits)
  5. memoryContext = memoryRecall(
       `${bead.title} ${bead.description}`,
       { limit: 10 }
     )
     - Relevant past learnings from hivemind
  6. Return { bead, epic, siblings, dependencies, memoryContext, projectPath, projectKey }
```

### Fallback Behavior

If `bd` CLI is unavailable:
- Build minimal bead from hive cell data (via hiveAdapter)
- Skip epic/siblings/dependencies (set to null/[])
- Still load memory context
- Log warning: "bd CLI unavailable, reduced context"

---

## Module 3: self-verifier.ts

### Factory

```typescript
export interface VerificationResult {
  passed: boolean;
  buildOk: boolean;
  testsOk: boolean;
  typeCheckOk: boolean;
  errors: string[];
}

export interface SelfVerifier {
  verify(projectPath: string, filesTouched: string[]): Promise<VerificationResult>;
}

export function createSelfVerifier(): SelfVerifier;
```

### Behavior

```
verify(projectPath, filesTouched):
  1. BUILD: Bun.spawn("bun", ["run", "build"], { cwd: projectPath, timeout: 60000 })
     - buildOk = exitCode === 0
     - If fails: capture stderr for errors
     - If command not found: buildOk = true (skip)

  2. TESTS: Bun.spawn("bun", ["test", ...relatedTestFiles], { cwd: projectPath, timeout: 60000 })
     - Find test files: *.test.ts, *.spec.ts matching filesTouched
     - testsOk = exitCode === 0
     - If no test files found: testsOk = true (skip)
     - If fails: capture stderr for errors

  3. TYPECHECK: Bun.spawn("bunx", ["tsc", "--noEmit"], { cwd: projectPath, timeout: 60000 })
     - typeCheckOk = exitCode === 0
     - If tsc not found: typeCheckOk = true (skip)
     - If fails: capture stderr for errors

  4. passed = buildOk && testsOk && typeCheckOk
  5. Return { passed, buildOk, testsOk, typeCheckOk, errors }
```

### Differences from swarm-verify.ts

Swarm's `swarm-verify.ts` does similar checks but:
- It's a tool (called by swarm_complete), not a module
- We reuse the LOGIC but make it injectable/mockable for testing
- Workers call self-verifier directly, not via MCP tool

---

## Module 4: mail-sender.ts

### Factory

```typescript
export interface WorkerMailSender {
  sendStatus(beadId: string, status: string, percent: number, opts?: { files?: string[]; blockers?: string[] }): Promise<void>;
  sendCompleted(beadId: string, summary: string, files: string[], commit?: string, learnings?: Array<{ info: string; tags: string }>): Promise<void>;
  sendBlocked(beadId: string, blocker: string, attempts?: number, suggestion?: string): Promise<void>;
  sendDiscovery(beadId: string, childBeadId: string, title: string, priority: number, rationale: string): Promise<void>;
  sendDecisionNeeded(beadId: string, question: string, options: Array<{ label: string; description: string }>, recommendation?: string): Promise<void>;
  sendHelpRequest(beadId: string, question: string, context: string, recommendation?: string): Promise<void>;
  sendFileHeadsUp(beadId: string, files: string[], changeType: "created" | "modified" | "deleted" | "renamed"): Promise<void>;
  sendDependencyReady(beadId: string, dependentBeadIds: string[]): Promise<void>;
}

export function createWorkerMailSender(
  sendMail: SendMailFn,
  workerName: string,
  threadId: string,  // epic ID
): WorkerMailSender;
```

### Implementation

Each method:
1. Constructs a typed `CortexMessage` object
2. Calls `createMailEnvelope(msg, workerName, ["queen"], threadId)` from message-types.ts
3. Calls `sendMail(envelope)` to deliver via swarm-mail

---

## Module 5: discovery-handler.ts

### Factory

```typescript
export type DiscoveryHandlerFn = (discovery: DiscoveryInput, deps: DiscoveryDeps) => Promise<string>;

export interface DiscoveryInput {
  title: string;
  description?: string;
  priority: number;    // 0-4
  parentBeadId: string;
}

export function createDiscoveryHandler(deps: DiscoveryDeps): DiscoveryHandlerFn;
```

### Behavior

```
handleDiscovery(discovery, deps):
  1. childBeadId = beadClient.create({
       title: discovery.title,
       description: discovery.description,
       parentId: discovery.parentBeadId,
       priority: discovery.priority,
       type: "task",
     })
  2. mappingStore.createMapping(childCellId, childBeadId)
  3. mailSender.sendDiscovery(discovery.parentBeadId, childBeadId, discovery.title, discovery.priority, discovery.description)
  4. eventStore.emit("beads_task_created", { childBeadId, parentBeadId })
  5. Return childBeadId
```

---

## Worker Guardrails (ENFORCED)

These are checked at the boundary of each module:

| Guardrail | Where Enforced | How |
|-----------|---------------|-----|
| Cannot modify other workers' beads | lifecycle.ts → only updates own beadId | beadClient calls filtered to own ID |
| Cannot create epics | discovery-handler.ts | Always creates type: "task" with parentId |
| Cannot promote to long-term memory | lifecycle.ts → uses memoryStore (short-term only) | No hivemind_store call with persist=true |
| Cannot close parent epic | lifecycle.ts → only closes own bead | beadClient.close(ownBeadId) only |
| Cannot release other workers' files | Not applicable (workers don't manage file reservations directly) | File reservations are wave-level (Queen manages) |

---

## Test Requirements (50+ tests)

### lifecycle.test.ts (20+ tests)
1. Full 8-step lifecycle executes successfully
2. PICKUP: bead status updated to in_progress
3. PICKUP: task_started event emitted
4. ORIENT: context loaded with all 5 parts (bead, epic, siblings, deps, memory)
5. PLAN: plan string generated from context
6. EXECUTE: taskExecutor callback invoked with context and plan
7. VERIFY (pass): continues to LEARN
8. VERIFY (fail): returns blocked, sends BLOCKED mail
9. LEARN: each learning stored via memoryStore
10. REPORT: DONE message sent to Queen
11. CLOSE: bead closed, task_completed event emitted
12. getCurrentStep() returns correct step during execution
13. Execute failure (result.success=false) → returns failed
14. Guardrail: lifecycle only updates own bead
15. Guardrail: no epic creation attempt

### context-loader.test.ts (10+ tests)
16. Loads bead successfully
17. Loads epic from bead.parentId
18. Loads siblings (excludes own bead)
19. Loads dependencies (resolved beads)
20. Loads memory context (top 10 relevant)
21. bd CLI unavailable → fallback to hive cell
22. No parent → epic is null
23. No dependencies → empty array
24. No relevant memories → empty array
25. All parts combined into WorkerContext

### self-verifier.test.ts (10+ tests)
26. All pass → { passed: true, buildOk: true, testsOk: true, typeCheckOk: true }
27. Build fails → { passed: false, buildOk: false, errors: [...] }
28. Tests fail → { passed: false, testsOk: false, errors: [...] }
29. Typecheck fails → { passed: false, typeCheckOk: false, errors: [...] }
30. No test files found → testsOk: true (skipped)
31. tsc not found → typeCheckOk: true (skipped)
32. Timeout → error captured
33. Combined: build passes, tests fail → passed: false

### mail-sender.test.ts (10+ tests)
34. sendStatus creates correct typed message
35. sendCompleted creates correct typed message with learnings
36. sendBlocked creates correct typed message
37. sendDiscovery creates correct typed message
38. sendDecisionNeeded creates correct typed message (min 2 options)
39. sendHelpRequest creates correct typed message
40. sendFileHeadsUp creates correct typed message
41. sendDependencyReady creates correct typed message
42. All messages pass CortexMessageSchema validation
43. createMailEnvelope sets correct importance/ackRequired

---

## What To AVOID

- Do NOT use real `bd` CLI in tests → mock `beadClient` completely
- Do NOT use real `Bun.spawn` in tests → mock `selfVerifier`
- Do NOT couple worker to specific AI model → taskExecutor is an opaque callback
- Do NOT let worker decide when to stop → lifecycle controls the flow
- Do NOT import from original Cortex `src/worker/` → clean rewrite
- Do NOT put Queen logic in worker → worker only sends messages, never makes decisions
