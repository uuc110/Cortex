# Sub-Plan 04: Wave Execution — GSD↔Swarm Wiring

**Parent:** Phase 5 Task 4
**Wave:** 3
**Depends On:** Sub-Plans 02 (Queen), 03 (Worker), Phase 4 GSD modules
**Output:** `packages/opencode-swarm-plugin/src/queen/wave-dispatcher.ts`
**Tests:** `packages/opencode-swarm-plugin/src/queen/__tests__/wave-dispatcher.test.ts`

---

## Problem

This is the **most critical missing piece** in the entire Cortex architecture. Phase 4 built standalone GSD modules (wave calculator, state manager, verification engine), and Tasks 2-3 build Queen/Worker modules. But NOTHING connects them.

Swarm's existing coordinator dispatches tasks one-at-a-time as they become "ready." There is no concept of computing parallel groups, executing them as a batch, verifying the batch, then moving to the next batch.

See `ORCHESTRATION-ANALYSIS.md` section 2.1 and `02-INTEGRATION-SWARM-GSD.md` lines 48-63 for the full spec.

## Solution

A `wave-dispatcher.ts` that is the **core orchestration loop** — the single module that ties everything together.

---

## What Already Exists (DO NOT REBUILD)

| Module | Package | What It Does |
|--------|---------|-------------|
| `wave-calculator.ts` | `src/gsd/` (Phase 4) | Topological sort → parallel wave groups. Cycle detection, file conflict detection. 238 lines, 616 tests. |
| `state-manager.ts` | `src/gsd/` (Phase 4) | STATE.md serialize/deserialize, task/wave status tracking, progress calculation. 573 lines, 714 tests. |
| `gsd-events.ts` | `src/gsd/` (Phase 4) | 15 GSD event factory functions. 259 lines. |
| `verification-engine.ts` | `src/gsd/` (Phase 4) | Truths/artifacts/key-links checking, fix plan generation. 531 lines, 1,136 tests. |
| `monitor.ts` | `src/queen/` (Task 2) | Inbox polling, message classification, routing. |
| `lifecycle.ts` | `src/worker/` (Task 3) | 8-step worker execution engine. |

The wave dispatcher IMPORTS and USES these — it does not duplicate them.

---

## Factory

```typescript
import { createWaveCalculator, type Wave } from "../gsd/wave-calculator";
import { createStateManager, type GsdState } from "../gsd/state-manager";
import { gsdWaveStarted, gsdWaveCompleted, gsdWaveFailed } from "../gsd/gsd-events";
import type { QueenMonitor } from "./monitor";
import type { WorkerLifecycle } from "../worker/lifecycle";

export interface WaveDispatcherConfig {
  projectKey: string;
  projectPath: string;
  epicBeadId: string;
  planningDir: string;              // e.g., ".planning/quick/bd-abc123/"
  waveTimeoutMs?: number;           // Default: 1800000 (30 min)
  maxFixIterations?: number;        // Default: 3
  verifyAfterEachWave?: boolean;    // Default: true
  parallelWorkersPerWave?: number;  // Default: 4
}

export interface WaveDispatcherDeps {
  waveCalculator: ReturnType<typeof createWaveCalculator>;
  stateManager: ReturnType<typeof createStateManager>;
  queenMonitor: QueenMonitor;
  spawnWorker: (beadId: string, files: string[]) => Promise<WorkerResult>;
  verificationRunner: VerificationRunner;
  beadClient: BeadClientInterface;
  eventStore: EventStoreInterface;
}

export function createWaveDispatcher(config: WaveDispatcherConfig, deps: WaveDispatcherDeps): WaveDispatcher;

export interface WaveDispatcher {
  executeEpic(tasks: TaskWithDeps[]): Promise<EpicExecutionResult>;
  executeWave(wave: Wave): Promise<WaveResult>;
  resume(stateFilePath: string): Promise<EpicExecutionResult>;
}

export interface TaskWithDeps {
  beadId: string;
  title: string;
  files: string[];
  dependencies: string[];  // beadIds of dependencies
}

export interface WaveResult {
  waveNumber: number;
  tasksCompleted: string[];
  tasksFailed: string[];
  tasksBlocked: string[];
  verificationPassed: boolean;
  fixTasksCreated?: string[];
}

export interface EpicExecutionResult {
  success: boolean;
  wavesCompleted: number;
  totalWaves: number;
  allResults: WaveResult[];
  phaseVerificationPassed?: boolean;
}
```

---

## The Core Orchestration Loop

This is the HEART of Cortex. Read carefully.

```
executeEpic(tasks):

  1. COMPUTE WAVES
     waves = waveCalculator.calculateWaves(tasks)
     // Returns: Wave[] where each Wave = { number, tasks[] }
     // Tasks in same wave are PROVEN INDEPENDENT (no deps on each other)

  2. INITIALIZE STATE
     state = stateManager.createInitialState(epicBeadId, waves)
     stateManager.saveState(state)

  3. FOR EACH WAVE:
     waveResult = executeWave(wave)

     3a. DISPATCH
         - For each task in wave (up to parallelWorkersPerWave):
           - workerResult = spawnWorker(task.beadId, task.files)
           - Run workers in PARALLEL (Promise.allSettled)
         - eventStore.emit(gsdWaveStarted({ epicId, waveNumber, taskIds }))
         - stateManager.updateWaveStatus(waveNumber, "in_progress")

     3b. MONITOR
         - While any task in wave is not complete:
           - queenMonitor.processOnce()  // Process inbox messages
           - Check bead statuses for all wave tasks
           - Handle: BLOCKED → log, HELP → route to decision handler
           - Timeout check: if elapsed > waveTimeoutMs → mark remaining as blocked

     3c. COLLECT RESULTS
         - tasksCompleted: tasks where worker returned "completed"
         - tasksFailed: tasks where worker returned "failed"
         - tasksBlocked: tasks where worker returned "blocked"

     3d. WAVE-LEVEL VERIFY (if verifyAfterEachWave)
         - Run integration tests (not just per-task tests)
         - Check that wave outputs are consistent with each other
         - IF verification fails:
           → Create fix tasks as new beads (type: bug, P0)
           → Execute fix tasks as a "fix wave"
           → Re-verify (up to maxFixIterations)

     3e. UPDATE STATE
         - stateManager.updateWaveStatus(waveNumber, "completed" | "failed")
         - stateManager.saveState(state)
         - eventStore.emit(gsdWaveCompleted/gsdWaveFailed)

     3f. ADVANCE
         - IF wave succeeded → proceed to next wave
         - IF wave failed after fix iterations → abort execution, return partial result

  4. PHASE VERIFICATION (after all waves)
     - delegated to phase-verifier.ts (Sub-Plan 05)

  5. RETURN EpicExecutionResult
```

---

## Wave Execution Detail

### Parallel Worker Spawning

```typescript
async executeWave(wave: Wave): Promise<WaveResult> {
  const tasks = wave.tasks;

  // Cap at parallelWorkersPerWave
  const batches = chunk(tasks, config.parallelWorkersPerWave);

  const allResults: WorkerResult[] = [];

  for (const batch of batches) {
    // Spawn batch in parallel
    const results = await Promise.allSettled(
      batch.map(task => deps.spawnWorker(task.beadId, task.files))
    );

    // Process results
    for (const result of results) {
      if (result.status === "fulfilled") {
        allResults.push(result.value);
      } else {
        allResults.push({
          status: "failed",
          error: result.reason.message,
        });
      }
    }
  }

  // Categorize
  const completed = allResults.filter(r => r.status === "completed");
  const failed = allResults.filter(r => r.status === "failed");
  const blocked = allResults.filter(r => r.status === "blocked");

  return {
    waveNumber: wave.number,
    tasksCompleted: completed.map(r => r.beadId),
    tasksFailed: failed.map(r => r.beadId),
    tasksBlocked: blocked.map(r => r.beadId),
    verificationPassed: false, // Set after verification
  };
}
```

### Fix Wave Generation

When wave-level verification fails:

```
1. Analyze verification failures → categorize by type (build, test, type, integration)
2. For each failure category:
   - Create a fix bead: beadClient.create({ title: "Fix: ...", type: "bug", priority: 0, parentId: epicId })
   - Assign files from the original failing tasks
3. Execute fix beads as a "fix wave" (same process as regular wave)
4. Re-verify
5. Repeat up to maxFixIterations (default: 3)
6. If still failing after max iterations → abort, report gaps
```

### Resume Protocol

```
resume(stateFilePath):
  1. state = stateManager.loadState(stateFilePath)
  2. Find currentWave from state
  3. For current wave: check bead statuses
     - If some tasks completed, some not → re-dispatch incomplete ones
     - If wave fully completed → move to next wave
  4. Continue executeEpic from current position
  5. Return EpicExecutionResult
```

---

## Integration with Existing Swarm

### Where Wave Dispatcher Fits

```
User: "cortex goal 'Add dark mode'"
  │
  ▼
swarm_decompose() ──→ CellTree { epic, subtasks[] }  [EXISTING]
  │
  ▼
waveCalculator.calculateWaves(subtasks) ──→ Wave[]     [PHASE 4, existing]
  │
  ▼
waveDispatcher.executeEpic(tasks) ──→                   [THIS MODULE]
  │
  ├──→ Wave 1: spawnWorker(T1) + spawnWorker(T2)       [Sub-Plan 03]
  │      └── queenMonitor.processOnce() loop            [Sub-Plan 02]
  │
  ├──→ Wave-level verification                          [Sub-Plan 05]
  │
  ├──→ Wave 2: spawnWorker(T3)                          [Sub-Plan 03]
  │
  └──→ phaseVerifier.verifyPhase()                      [Sub-Plan 05]
```

### The spawnWorker Callback

The `spawnWorker` function is injected as a dependency. In production, it:
1. Creates a `WorkerLifecycle` (from Sub-Plan 03)
2. Creates a `TaskExecutor` (the actual AI agent that implements the task)
3. Calls `lifecycle.run(taskExecutor)`
4. Returns the `WorkerResult`

This keeps the wave dispatcher decoupled from HOW workers execute — it only knows that spawning returns a result.

---

## Test Requirements (30+ tests)

### Core Loop (10+ tests)
1. executeEpic with 1 wave, 2 tasks → both complete
2. executeEpic with 2 waves → wave 1 completes before wave 2 starts
3. executeEpic with 3 waves, wave 2 has dependency on wave 1
4. executeWave spawns workers in parallel (Promise.allSettled)
5. Wave timeout → remaining tasks marked blocked
6. All tasks fail → wave marked failed
7. Mixed results (1 pass, 1 fail) → correct categorization

### Fix Waves (5+ tests)
8. Wave verification fails → fix tasks created
9. Fix wave executes and re-verifies
10. Max 3 fix iterations then abort
11. Fix wave succeeds on 2nd attempt → continues
12. Fix bead created with type: "bug", P0

### State Management (8+ tests)
13. State initialized with correct wave count
14. State updated after each wave
15. State saved to STATE.md after each wave
16. Resume reads STATE.md correctly
17. Resume re-dispatches incomplete tasks
18. Resume skips completed waves
19. State tracks decisions made during execution
20. Progress calculation correct (completed/total)

### Events (5+ tests)
21. gsdWaveStarted emitted at wave start
22. gsdWaveCompleted emitted on wave success
23. gsdWaveFailed emitted on wave failure
24. Events include correct epicId, waveNumber, taskIds
25. Events emitted via existing swarm-mail eventStore

### Edge Cases (5+ tests)
26. Empty wave (no tasks) → skipped
27. Single-task wave → works like regular wave
28. Worker throws exception → caught, task marked failed
29. parallelWorkersPerWave=1 → sequential execution
30. parallelWorkersPerWave > task count → no issue

---

## What To AVOID

- Do NOT rebuild wave calculator → use Phase 4's `createWaveCalculator()`
- Do NOT rebuild state manager → use Phase 4's `createStateManager()`
- Do NOT rebuild event factories → use Phase 4's `gsdWaveStarted()` etc.
- Do NOT put worker execution logic here → use `spawnWorker` callback
- Do NOT put verification logic here → delegate to Sub-Plan 05
- Do NOT use real bd CLI in tests → mock everything
- Do NOT assume workers are AI agents → they're opaque callbacks that return results
