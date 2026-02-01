/**
 * Cortex Bridge — CellTree → GSD → Wave Dispatcher
 *
 * Converts swarm_decompose's CellTree output (index-based deps) into
 * GSD's typed task graph (ID-based deps), runs wave calculation,
 * generates PLAN.md, and produces TaskWithDeps[] for wave-dispatcher.
 *
 * This is the core glue that connects the decomposition pipeline
 * to the execution pipeline.
 *
 * Flow:
 *   CellTree (from swarm_decompose)
 *     → GsdTask[] (ID-based deps, typed)
 *       → WaveCalculatorResult (topological sort → parallel waves)
 *         → PLAN.md (serialized execution plan)
 *           → TaskWithDeps[] (for wave-dispatcher)
 *
 * @module cortex/cortex-bridge
 */

import type { CellTree } from "../schemas/cell.js";
import type {
  GsdTask,
  GsdTaskPriority,
  GsdMode,
  MustHaves,
} from "../gsd/gsd-types.js";
import type { WaveCalculatorResult } from "../gsd/wave-calculator.js";
import type { TaskWithDeps } from "../queen/wave-dispatcher.js";
import type { GeneratePlanOptions } from "../gsd/plan-generator.js";

import { createWaveCalculator } from "../gsd/wave-calculator.js";
import { createPlanGenerator } from "../gsd/plan-generator.js";

// ─── ID Generation ───────────────────────────────────────────────

/**
 * Generate a deterministic task ID from epic title + subtask index.
 * Format: "ctx-{sanitized_epic}-{index}"
 *
 * Uses a short prefix from the epic title for human readability
 * while maintaining uniqueness via the index suffix.
 */
export function generateTaskId(epicTitle: string, subtaskIndex: number): string {
  const sanitized = epicTitle
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 20);
  return `ctx-${sanitized}-${subtaskIndex}`;
}

/**
 * Generate a deterministic epic ID from the epic title.
 * Format: "epic-ctx-{sanitized_title}"
 */
export function generateEpicId(epicTitle: string): string {
  const sanitized = epicTitle
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 30);
  return `epic-ctx-${sanitized}`;
}

// ─── Complexity → Priority Mapping ───────────────────────────────

/**
 * Map estimated_complexity (1-5) to GSD priority.
 *
 * Higher complexity = higher priority (gets scheduled first within wave).
 * This ensures complex tasks start early, maximizing parallel utilization.
 */
export function complexityToPriority(complexity: number): GsdTaskPriority {
  if (complexity >= 5) return "critical";
  if (complexity >= 4) return "high";
  if (complexity >= 2) return "medium";
  return "low";
}

// ─── CellTree → GsdTask[] ────────────────────────────────────────

export interface CellTreeToGsdOptions {
  /** Override the epic title for ID generation */
  epicTitle?: string;
}

/**
 * Convert a CellTree (from swarm_decompose) to an array of GsdTask[].
 *
 * Key transformation:
 *   - CellTree.subtasks[i].dependencies = [0, 2] (index-based)
 *   - GsdTask[i].dependencies = ["ctx-epic-0", "ctx-epic-2"] (ID-based)
 *
 * Wave numbers are NOT assigned here — that's the wave calculator's job.
 * We set wave=1 as a placeholder; the calculator will reassign.
 */
export function cellTreeToGsdTasks(
  cellTree: CellTree,
  options?: CellTreeToGsdOptions,
): GsdTask[] {
  const epicTitle = options?.epicTitle ?? cellTree.epic.title;
  const subtasks = cellTree.subtasks;

  const taskIds = subtasks.map((_, index) => generateTaskId(epicTitle, index));
  return subtasks.map((subtask, index) => {
    const dependencies = subtask.dependencies
      .filter((depIdx) => depIdx >= 0 && depIdx < subtasks.length && depIdx !== index)
      .map((depIdx) => taskIds[depIdx]);

    return {
      id: taskIds[index],
      name: subtask.title,
      status: "pending" as const,
      wave: 1,
      priority: complexityToPriority(subtask.estimated_complexity),
      type: "auto" as const,
      files: [...subtask.files],
      action: subtask.description || subtask.title,
      dependencies,
    };
  });
}

// ─── GsdTask[] → WaveCalculatorResult ────────────────────────────

/**
 * Run wave calculation on GsdTask[] and update wave assignments.
 *
 * Returns both the calculator result and the tasks with updated wave numbers.
 */
export function calculateTaskWaves(
  tasks: GsdTask[],
): { result: WaveCalculatorResult; tasks: GsdTask[] } {
  const calculator = createWaveCalculator();
  const result = calculator.calculateWaves(tasks);

  const waveMap = new Map<string, number>();
  for (const wave of result.waves) {
    for (const taskId of wave.task_ids) {
      waveMap.set(taskId, wave.wave_number);
    }
  }

  const updatedTasks = tasks.map((task) => ({
    ...task,
    wave: waveMap.get(task.id) ?? task.wave,
  }));

  return { result, tasks: updatedTasks };
}

// ─── GsdTask[] → TaskWithDeps[] ──────────────────────────────────

/**
 * Convert GsdTask[] to TaskWithDeps[] for the wave-dispatcher.
 *
 * TaskWithDeps is what createWaveDispatcher().executeEpic() consumes.
 * It's a simpler type — just id, name, files, dependencies, status, priority, type.
 */
export function gsdTasksToDispatcherTasks(tasks: GsdTask[]): TaskWithDeps[] {
  return tasks.map((task) => ({
    id: task.id,
    name: task.name,
    files: task.files,
    dependencies: task.dependencies ?? [],
    status: task.status,
    priority: task.priority,
    type: task.type,
  }));
}

// ─── PLAN.md Generation ──────────────────────────────────────────

export interface GenerateCortexPlanOptions {
  epicTitle: string;
  epicDescription?: string;
  phase?: string;
  mode?: GsdMode;
  beadId?: string;
  epicId?: string;
  workerId?: string;
  mustHaves?: MustHaves;
  researchContext?: string;
}

/**
 * Generate a PLAN.md string from GsdTask[].
 *
 * This is the serialized execution plan that gets written to
 * .planning/phases/N/PLAN.md for project mode or
 * .planning/quick/PLAN.md for quick mode.
 */
export function generateCortexPlan(
  tasks: GsdTask[],
  options: GenerateCortexPlanOptions,
): string {
  const generator = createPlanGenerator();
  const epicId = options.epicId ?? generateEpicId(options.epicTitle);

  const planOptions: GeneratePlanOptions = {
    id: `plan-${epicId}`,
    title: options.epicTitle,
    phase: options.phase ?? "integration",
    mode: options.mode ?? "quick",
    type: "execute",
    bead_id: options.beadId ?? epicId,
    epic_id: epicId,
    worker_id: options.workerId ?? "cortex",
    must_haves: options.mustHaves,
    research_context: options.researchContext,
  };

  return generator.generate(tasks, planOptions);
}

// ─── Full Pipeline ───────────────────────────────────────────────

export interface CortexBridgeResult {
  /** GSD tasks with ID-based deps and correct wave assignments */
  tasks: GsdTask[];
  /** Wave calculation result (waves, parallelism, etc.) */
  waveResult: WaveCalculatorResult;
  /** Tasks formatted for wave-dispatcher consumption */
  dispatcherTasks: TaskWithDeps[];
  /** Generated PLAN.md content */
  planMarkdown: string;
  /** Generated epic ID */
  epicId: string;
  /** Total number of waves */
  totalWaves: number;
  /** Maximum parallelism across all waves */
  maxParallelism: number;
}

/**
 * Full pipeline: CellTree → GsdTask[] → Waves → PLAN.md → TaskWithDeps[]
 *
 * This is the primary entry point. Takes decomposition output from
 * swarm_decompose and produces everything needed to execute via
 * the wave-dispatcher.
 *
 * @param cellTree - Output from swarm_validate_decomposition
 * @param options - Plan generation options
 * @returns Complete bridge result with all intermediate artifacts
 *
 * @example
 * ```typescript
 * const cellTree = CellTreeSchema.parse(JSON.parse(agentResponse));
 * const result = bridgeCellTreeToExecution(cellTree, {
 *   epicTitle: cellTree.epic.title,
 *   mode: "quick",
 * });
 * // result.dispatcherTasks → pass to wave-dispatcher
 * // result.planMarkdown → write to .planning/
 * ```
 */
export function bridgeCellTreeToExecution(
  cellTree: CellTree,
  options: GenerateCortexPlanOptions,
): CortexBridgeResult {
  const rawTasks = cellTreeToGsdTasks(cellTree, {
    epicTitle: options.epicTitle,
  });

  const { result: waveResult, tasks } = calculateTaskWaves(rawTasks);

  const epicId = options.epicId ?? generateEpicId(options.epicTitle);
  const planMarkdown = generateCortexPlan(tasks, { ...options, epicId });

  const dispatcherTasks = gsdTasksToDispatcherTasks(tasks);

  return {
    tasks,
    waveResult,
    dispatcherTasks,
    planMarkdown,
    epicId,
    totalWaves: waveResult.sequentialWaves,
    maxParallelism: waveResult.maxParallelism,
  };
}

// ─── Reverse: PLAN.md → TaskWithDeps[] ───────────────────────────

/**
 * Parse an existing PLAN.md back into TaskWithDeps[] for resumption.
 *
 * Used when resuming a previously planned but not-yet-executed epic.
 */
export function parsePlanToDispatcherTasks(planMarkdown: string): TaskWithDeps[] {
  const generator = createPlanGenerator();
  const plan = generator.parse(planMarkdown);
  return gsdTasksToDispatcherTasks(plan.tasks);
}
