import type { GsdTask, GsdTaskPriority, GsdWave } from "./gsd-types.js";

export interface CycleInfo {
  path: string[];
}

export interface MissingDependencyInfo {
  taskId: string;
  missingDepId: string;
}

export interface DependencyValidation {
  valid: boolean;
  missingDependencies: MissingDependencyInfo[];
  selfReferences: string[];
  cycles: CycleInfo[];
}

export interface WaveCalculatorResult {
  waves: GsdWave[];
  totalTasks: number;
  maxParallelism: number;
  sequentialWaves: number;
}

export interface FileConflict {
  file: string;
  taskIds: string[];
}

export interface WaveCalculator {
  calculateWaves(tasks: GsdTask[]): WaveCalculatorResult;
  detectCycles(tasks: GsdTask[]): CycleInfo[];
  getExecutionOrder(waves: GsdWave[]): string[];
  validateDependencies(tasks: GsdTask[]): DependencyValidation;
}

const PRIORITY_ORDER: Record<GsdTaskPriority, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

function getDeps(task: GsdTask): string[] {
  return task.dependencies ?? [];
}

function findCyclesDFS(tasks: GsdTask[]): CycleInfo[] {
  const taskIds = new Set(tasks.map((t) => t.id));
  const adjacency = new Map<string, string[]>();
  for (const task of tasks) {
    adjacency.set(
      task.id,
      getDeps(task).filter((d) => taskIds.has(d)),
    );
  }

  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  const color = new Map<string, number>();
  for (const id of taskIds) color.set(id, WHITE);

  const cycles: CycleInfo[] = [];
  const stack: string[] = [];

  function dfs(nodeId: string): void {
    color.set(nodeId, GRAY);
    stack.push(nodeId);

    for (const neighbor of adjacency.get(nodeId) ?? []) {
      const neighborColor = color.get(neighbor);
      if (neighborColor === GRAY) {
        const cycleStart = stack.indexOf(neighbor);
        const cyclePath = stack.slice(cycleStart);
        cycles.push({ path: cyclePath });
      } else if (neighborColor === WHITE) {
        dfs(neighbor);
      }
    }

    stack.pop();
    color.set(nodeId, BLACK);
  }

  for (const id of taskIds) {
    if (color.get(id) === WHITE) {
      dfs(id);
    }
  }

  return cycles;
}

export function createWaveCalculator(): WaveCalculator {
  function calculateWaves(tasks: GsdTask[]): WaveCalculatorResult {
    if (tasks.length === 0) {
      return { waves: [], totalTasks: 0, maxParallelism: 0, sequentialWaves: 0 };
    }

    const taskMap = new Map<string, GsdTask>();
    const inDegree = new Map<string, number>();
    const dependents = new Map<string, string[]>();

    for (const task of tasks) {
      taskMap.set(task.id, task);
      dependents.set(task.id, []);
    }

    for (const task of tasks) {
      const deps = getDeps(task);
      let validDepCount = 0;
      for (const depId of deps) {
        if (depId === task.id) {
          throw new Error(
            `Circular dependency detected: task "${task.id}" depends on itself`,
          );
        }
        if (!taskMap.has(depId)) {
          throw new Error(
            `Task "${task.id}" depends on "${depId}" which is not in the task list`,
          );
        }
        validDepCount++;
        dependents.get(depId)!.push(task.id);
      }
      inDegree.set(task.id, validDepCount);
    }

    let currentWaveIds: string[] = [];
    for (const task of tasks) {
      if (inDegree.get(task.id) === 0) {
        currentWaveIds.push(task.id);
      }
    }

    if (currentWaveIds.length === 0) {
      const involvedIds = tasks.map((t) => t.id);
      throw new Error(
        `Circular dependency detected involving: ${involvedIds.join(", ")}`,
      );
    }

    const waves: GsdWave[] = [];
    let waveNumber = 1;
    const processed = new Set<string>();

    while (currentWaveIds.length > 0) {
      const sortedIds = [...currentWaveIds].sort((a, b) => {
        const taskA = taskMap.get(a)!;
        const taskB = taskMap.get(b)!;
        return PRIORITY_ORDER[taskA.priority] - PRIORITY_ORDER[taskB.priority];
      });

      const wave: GsdWave = {
        wave_number: waveNumber,
        task_ids: sortedIds,
        status: "pending",
        parallel: sortedIds.length > 1,
      };
      waves.push(wave);

      const nextWaveIds: string[] = [];
      for (const taskId of currentWaveIds) {
        processed.add(taskId);
        for (const dependentId of dependents.get(taskId) ?? []) {
          const newDegree = inDegree.get(dependentId)! - 1;
          inDegree.set(dependentId, newDegree);
          if (newDegree === 0) {
            nextWaveIds.push(dependentId);
          }
        }
      }

      currentWaveIds = nextWaveIds;
      waveNumber++;
    }

    if (processed.size !== tasks.length) {
      const unprocessed = tasks
        .filter((t) => !processed.has(t.id))
        .map((t) => t.id);
      throw new Error(
        `Circular dependency detected involving: ${unprocessed.join(", ")}`,
      );
    }

    const maxParallelism = Math.max(...waves.map((w) => w.task_ids.length));

    return {
      waves,
      totalTasks: tasks.length,
      maxParallelism,
      sequentialWaves: waves.length,
    };
  }

  function detectCycles(tasks: GsdTask[]): CycleInfo[] {
    if (tasks.length === 0) return [];
    return findCyclesDFS(tasks);
  }

  function getExecutionOrder(waves: GsdWave[]): string[] {
    const result: string[] = [];
    for (const wave of waves) {
      result.push(...wave.task_ids);
    }
    return result;
  }

  function validateDependencies(tasks: GsdTask[]): DependencyValidation {
    const taskIds = new Set(tasks.map((t) => t.id));
    const missingDependencies: MissingDependencyInfo[] = [];
    const selfReferences: string[] = [];

    for (const task of tasks) {
      for (const depId of getDeps(task)) {
        if (depId === task.id) {
          selfReferences.push(task.id);
        } else if (!taskIds.has(depId)) {
          missingDependencies.push({ taskId: task.id, missingDepId: depId });
        }
      }
    }

    const cycles = findCyclesDFS(tasks);

    const valid =
      missingDependencies.length === 0 &&
      selfReferences.length === 0 &&
      cycles.length === 0;

    return { valid, missingDependencies, selfReferences, cycles };
  }

  return { calculateWaves, detectCycles, getExecutionOrder, validateDependencies };
}
