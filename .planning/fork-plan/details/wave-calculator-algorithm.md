# Wave Calculator Algorithm

## Purpose

The wave calculator transforms a flat list of tasks with dependencies into ordered groups (waves) where all tasks within a wave can execute in parallel. This is the core scheduling algorithm for Cortex's execution engine.

---

## Interface

### Input

```typescript
interface Task {
  id: string;           // Bead ID (e.g., "bd-a3f8.1")
  title: string;
  dependencies: string[]; // IDs of tasks this depends on (must complete before this starts)
  priority: number;      // 0 (critical) to 4 (low) — used for ordering within a wave
  files: string[];       // Files this task modifies — used for conflict detection
}
```

### Output

```typescript
interface Wave {
  number: number;        // 1-indexed wave number
  tasks: Task[];         // Tasks in this wave (can run in parallel)
}

type WaveResult = {
  waves: Wave[];
  total_tasks: number;
  max_parallelism: number;  // Largest wave size
  estimated_sequential_waves: number;
};
```

---

## Algorithm

### Core: Kahn's Algorithm (Modified Topological Sort by Depth)

The algorithm uses a modified Kahn's topological sort that groups nodes by their dependency depth rather than producing a flat ordering.

**Dependency depth** = the longest path from any root (task with no dependencies) to this task. Tasks at the same depth are independent of each other and can run in parallel.

### Pseudocode

```
function computeWaves(tasks: Task[]): WaveResult
  // 1. Build adjacency structures
  let inDegree: Map<string, number> = {}    // How many deps does this task have?
  let dependents: Map<string, string[]> = {} // Who depends on this task?
  let taskMap: Map<string, Task> = {}        // Quick lookup by ID

  for each task in tasks:
    taskMap[task.id] = task
    inDegree[task.id] = task.dependencies.length
    dependents[task.id] = []

  for each task in tasks:
    for each depId in task.dependencies:
      dependents[depId].push(task.id)

  // 2. Initialize with root tasks (no dependencies)
  let currentWave: string[] = []
  for each task in tasks:
    if inDegree[task.id] == 0:
      currentWave.push(task.id)

  if currentWave is empty AND tasks is not empty:
    ERROR: "Circular dependency detected — no root tasks found"

  // 3. Process waves using BFS by depth level
  let waves: Wave[] = []
  let waveNumber = 1
  let processed: Set<string> = {}

  while currentWave is not empty:
    // Sort tasks within wave by priority (lower = higher priority)
    let waveTasks = currentWave
      .map(id => taskMap[id])
      .sort((a, b) => a.priority - b.priority)

    waves.push({ number: waveNumber, tasks: waveTasks })

    // Mark all tasks in this wave as processed
    let nextWave: string[] = []
    for each taskId in currentWave:
      processed.add(taskId)

      // Reduce in-degree of dependents
      for each dependentId in dependents[taskId]:
        inDegree[dependentId] -= 1
        if inDegree[dependentId] == 0:
          nextWave.push(dependentId)

    currentWave = nextWave
    waveNumber += 1

  // 4. Check for unprocessed tasks (circular dependencies)
  if processed.size != tasks.length:
    let unprocessed = tasks
      .filter(t => !processed.has(t.id))
      .map(t => t.id)
    ERROR: "Circular dependency detected involving: " + unprocessed

  // 5. Return result
  return {
    waves: waves,
    total_tasks: tasks.length,
    max_parallelism: max(waves.map(w => w.tasks.length)),
    estimated_sequential_waves: waves.length
  }
```

### Step-by-Step Example

Given tasks:
```
A: no deps          (CSS variables)
B: no deps          (Theme types)
C: depends on [A]   (Theme provider — needs CSS vars)
D: depends on [A,B] (Toggle component — needs CSS vars + types)
E: depends on [C,D] (Integration tests — needs provider + toggle)
```

**Step 1: Build structures**
```
inDegree:  { A:0, B:0, C:1, D:2, E:2 }
dependents: { A:[C,D], B:[D], C:[E], D:[E], E:[] }
```

**Step 2: Root tasks (inDegree=0)**
```
currentWave = [A, B]
```

**Step 3: Process waves**

Wave 1: `[A, B]` (both have no deps → parallel)
- Process A: dependents [C,D] → inDegree[C]=0, inDegree[D]=1
- Process B: dependents [D] → inDegree[D]=0
- nextWave = [C, D] (both now have inDegree=0)

Wave 2: `[C, D]` (both unblocked → parallel)
- Process C: dependents [E] → inDegree[E]=1
- Process D: dependents [E] → inDegree[E]=0
- nextWave = [E]

Wave 3: `[E]` (single task)
- Process E: no dependents
- nextWave = []

**Result:**
```
Wave 1: [A, B]     ← parallel
Wave 2: [C, D]     ← parallel (after wave 1)
Wave 3: [E]        ← sequential (after wave 2)

max_parallelism: 2
estimated_sequential_waves: 3
```

---

## Edge Cases

### 1. Circular Dependencies → Error

```
A depends on [B]
B depends on [A]
```

Detection: After BFS completes, `processed.size < tasks.length`. The unprocessed tasks form the cycle.

**Response:** Return error with the IDs involved. The Queen must resolve by:
- Removing one dependency
- Splitting one task into sub-tasks
- Asking the user for guidance

### 2. Single-Task Waves → Sequential Bottleneck

```
A → B → C → D → E  (chain of dependencies)
```

Result: 5 waves, each with 1 task. No parallelism possible.

**Response:** This is valid — some work is inherently sequential. The wave calculator reports `max_parallelism: 1` to signal this. The Queen may choose to:
- Proceed sequentially
- Ask if the dependency chain is truly necessary
- Split tasks differently to enable parallelism

### 3. All Tasks Independent → Single Wave

```
A: no deps
B: no deps
C: no deps
D: no deps
```

Result: 1 wave with 4 tasks. Maximum parallelism.

**Response:** All tasks dispatch simultaneously. `parallel_workers_per_wave` config limits concurrency if needed (default: 4).

### 4. Missing Dependency Reference

```
A depends on [X]  ← X is not in the task list
```

**Response:** Treat as error. The dependency refers to a task outside the current scope. Options:
- If X is a bead that's already closed → remove from deps (it's satisfied)
- If X is a bead that's open → add to the task list
- If X doesn't exist → error

### 5. Empty Task List

**Response:** Return `{ waves: [], total_tasks: 0, max_parallelism: 0, estimated_sequential_waves: 0 }`.

### 6. Self-Dependency

```
A depends on [A]
```

**Response:** Detected as circular dependency (inDegree never reaches 0).

---

## File Conflict Detection (Post-Wave Calculation)

After computing waves, run a file conflict check within each wave:

```
function detectFileConflicts(wave: Wave): Conflict[]
  let fileMap: Map<string, string[]> = {}  // file → [task IDs that touch it]

  for each task in wave.tasks:
    for each file in task.files:
      if fileMap[file] exists:
        fileMap[file].push(task.id)
      else:
        fileMap[file] = [task.id]

  let conflicts: Conflict[] = []
  for each [file, taskIds] in fileMap:
    if taskIds.length > 1:
      conflicts.push({ file, tasks: taskIds })

  return conflicts
```

**If conflicts found:**
1. Move one conflicting task to the next wave
2. Prefer keeping the higher-priority task in the current wave
3. Add an implicit dependency between the conflicting tasks
4. Re-compute waves

This ensures file reservations won't conflict within a wave.

---

## Integration with Swarm Decomposition

Swarm's decomposition strategies (`file-based`, `feature-based`, `risk-based`) already produce tasks with file assignments. The wave calculator consumes these directly:

```typescript
// Swarm decomposition output (CellTree)
interface CellTree {
  epic: { title: string; description: string };
  subtasks: Array<{
    title: string;
    description: string;
    files: string[];
    priority: number;
  }>;
}

// Bridge: CellTree → Task[] for wave calculator
function cellTreeToTasks(tree: CellTree, beadIds: string[]): Task[] {
  return tree.subtasks.map((subtask, i) => ({
    id: beadIds[i],           // Assigned after bd create
    title: subtask.title,
    dependencies: [],          // Computed from bd dep tree
    priority: subtask.priority,
    files: subtask.files,
  }));
}

// After bd dep add creates dependencies:
function loadDependencies(tasks: Task[], beadDeps: BeadDependency[]): Task[] {
  for (const dep of beadDeps) {
    const task = tasks.find(t => t.id === dep.from);
    if (task) {
      task.dependencies.push(dep.to);
    }
  }
  return tasks;
}
```

The wave calculator is **strategy-agnostic** — it works with any decomposition strategy's output as long as tasks have IDs, dependencies, and files.

---

## TypeScript Implementation Signature

```typescript
// src/executor/wave-calculator.ts

export interface WaveTask {
  id: string;
  title: string;
  dependencies: string[];
  priority: number;
  files: string[];
}

export interface Wave {
  number: number;
  tasks: WaveTask[];
}

export interface WaveResult {
  waves: Wave[];
  totalTasks: number;
  maxParallelism: number;
  sequentialWaves: number;
}

export interface FileConflict {
  file: string;
  taskIds: string[];
}

export class CircularDependencyError extends Error {
  involvedTasks: string[];
  constructor(tasks: string[]) {
    super(`Circular dependency detected involving: ${tasks.join(", ")}`);
    this.name = "CircularDependencyError";
    this.involvedTasks = tasks;
  }
}

export class MissingDependencyError extends Error {
  missingId: string;
  referencedBy: string;
  constructor(missingId: string, referencedBy: string) {
    super(`Task "${referencedBy}" depends on "${missingId}" which is not in the task list`);
    this.name = "MissingDependencyError";
    this.missingId = missingId;
    this.referencedBy = referencedBy;
  }
}

/**
 * Compute parallel execution waves from a task dependency graph.
 * Uses modified Kahn's algorithm (BFS by depth level).
 *
 * @throws CircularDependencyError if circular deps detected
 * @throws MissingDependencyError if dependency references unknown task
 */
export function computeWaves(tasks: WaveTask[]): WaveResult;

/**
 * Detect file conflicts within a single wave.
 * Returns list of files touched by multiple tasks.
 */
export function detectFileConflicts(wave: Wave): FileConflict[];

/**
 * Resolve file conflicts by splitting waves.
 * Moves lower-priority conflicting tasks to next wave.
 * Returns new wave list with conflicts resolved.
 */
export function resolveFileConflicts(waves: Wave[]): Wave[];
```

---

## Complexity

- **Time:** O(V + E) where V = tasks, E = dependencies (standard Kahn's)
- **Space:** O(V + E) for adjacency structures
- **File conflict detection:** O(W × F) per wave where W = wave size, F = avg files per task

For typical Cortex usage (≤20 tasks, ≤50 dependencies), this runs in <1ms.
