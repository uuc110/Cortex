import type { GsdState } from "../gsd/gsd-types.js";
import type { WaveCalculatorResult } from "../gsd/wave-calculator.js";
import type { WorkerResult } from "../worker/lifecycle.js";

import {
  gsdWaveCompleted,
  gsdWaveFailed,
  gsdWaveStarted,
} from "../gsd/gsd-events.js";

export interface WaveDispatcherConfig {
  projectKey: string;
  projectPath: string;
  epicBeadId: string;
  planningDir: string;
  waveTimeoutMs?: number;
  maxFixIterations?: number;
  verifyAfterEachWave?: boolean;
  parallelWorkersPerWave?: number;
}

export interface WaveDispatcherDeps {
  calculateWaves: (tasks: TaskWithDeps[]) => WaveCalculatorResult;
  saveState: (state: GsdState, path: string) => Promise<void>;
  loadState: (path: string) => Promise<GsdState | null>;
  spawnWorker: (beadId: string, files: string[]) => Promise<WorkerResult>;
  verifyWave: (files: string[]) => Promise<{ passed: boolean; errors: string[] }>;
  createFixBead: (
    title: string,
    description: string,
    parentId: string,
  ) => Promise<string>;
  eventEmit: (type: string, data: any) => void;
}

export interface TaskWithDeps {
  id: string;
  name: string;
  files: string[];
  dependencies: string[];
  status?: string;
  priority?: string;
  type?: string;
}

export interface WaveResult {
  waveNumber: number;
  tasksCompleted: string[];
  tasksFailed: string[];
  tasksBlocked: string[];
  verificationPassed: boolean;
  fixTasksCreated: string[];
}

export interface EpicExecutionResult {
  success: boolean;
  wavesCompleted: number;
  totalWaves: number;
  allResults: WaveResult[];
}

export interface WaveDispatcher {
  executeEpic(tasks: TaskWithDeps[]): Promise<EpicExecutionResult>;
  executeWave(wave: { number: number; tasks: TaskWithDeps[] }): Promise<WaveResult>;
  resume(stateFilePath: string): Promise<EpicExecutionResult>;
}

const DEFAULT_WAVE_TIMEOUT_MS = 30 * 60 * 1000;
const DEFAULT_MAX_FIX_ITERATIONS = 3;
const DEFAULT_VERIFY_AFTER_EACH_WAVE = true;
const DEFAULT_PARALLEL_WORKERS = 4;

function chunk<T>(arr: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    result.push(arr.slice(i, i + size));
  }
  return result;
}

function unique(items: string[]): string[] {
  return Array.from(new Set(items));
}

function toTaskMap(tasks: TaskWithDeps[]): Map<string, TaskWithDeps> {
  const map = new Map<string, TaskWithDeps>();
  for (const task of tasks) {
    map.set(task.id, task);
  }
  return map;
}

function extractFiles(tasks: TaskWithDeps[]): string[] {
  const files: string[] = [];
  for (const task of tasks) {
    files.push(...(task.files ?? []));
  }
  return unique(files);
}

function normalizeWaves(
  result: WaveCalculatorResult,
  tasks: TaskWithDeps[],
): Array<{ number: number; tasks: TaskWithDeps[] }> {
  const taskMap = toTaskMap(tasks);
  return result.waves.map((wave: any) => {
    if (Array.isArray(wave.tasks)) {
      return { number: wave.number ?? wave.wave_number, tasks: wave.tasks };
    }

    const taskIds: string[] = Array.isArray(wave.task_ids)
      ? wave.task_ids
      : Array.isArray(wave.tasks)
        ? wave.tasks.map((task: TaskWithDeps) => task.id)
        : [];

    const waveTasks = taskIds
      .map((id) => taskMap.get(id))
      .filter((task): task is TaskWithDeps => Boolean(task));

    return { number: wave.number ?? wave.wave_number, tasks: waveTasks };
  });
}

function buildInitialState(config: WaveDispatcherConfig): GsdState {
  const timestamp = new Date().toISOString();
  return {
    plan_id: config.epicBeadId,
    status: "in_progress",
    mode: "project",
    current_wave: 1,
    completed_tasks: [],
    failed_tasks: [],
    verification_results: [],
    started_at: timestamp,
    last_updated: timestamp,
  };
}

export function createWaveDispatcher(
  config: WaveDispatcherConfig,
  deps: WaveDispatcherDeps,
): WaveDispatcher {
  const verifyAfterEachWave =
    config.verifyAfterEachWave ?? DEFAULT_VERIFY_AFTER_EACH_WAVE;
  const maxFixIterations = config.maxFixIterations ?? DEFAULT_MAX_FIX_ITERATIONS;
  const parallelWorkers =
    config.parallelWorkersPerWave ?? DEFAULT_PARALLEL_WORKERS;
  const waveTimeoutMs = config.waveTimeoutMs ?? DEFAULT_WAVE_TIMEOUT_MS;

  const executeWave = async (wave: {
    number: number;
    tasks: TaskWithDeps[];
  }): Promise<WaveResult> => {
    const tasksCompleted: string[] = [];
    const tasksFailed: string[] = [];
    const tasksBlocked: string[] = [];

    const batches = chunk(wave.tasks, Math.max(1, parallelWorkers));
    const deadline = Date.now() + waveTimeoutMs;

    for (const batch of batches) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        tasksFailed.push(...batch.map((task) => task.id));
        continue;
      }

      const settled = await Promise.race([
        Promise.allSettled(batch.map((task) => deps.spawnWorker(task.id, task.files))),
        new Promise<PromiseSettledResult<WorkerResult>[]>((_, reject) => {
          setTimeout(() => {
            reject(new Error("Wave execution timed out"));
          }, remaining);
        }),
      ]).catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        return batch.map((task) => ({
          status: "rejected",
          reason: new Error(message),
          taskId: task.id,
        })) as PromiseSettledResult<WorkerResult>[];
      });

      settled.forEach((result, index) => {
        const task = batch[index];
        if (!task) return;
        if (result.status === "fulfilled") {
          const status = result.value.status;
          if (status === "completed") {
            tasksCompleted.push(task.id);
          } else if (status === "blocked") {
            tasksBlocked.push(task.id);
          } else {
            tasksFailed.push(task.id);
          }
        } else {
          tasksFailed.push(task.id);
        }
      });
    }

    let verificationPassed = true;
    if (verifyAfterEachWave) {
      const files = extractFiles(
        wave.tasks.filter((task) => tasksCompleted.includes(task.id)),
      );
      const verification = await deps.verifyWave(files);
      verificationPassed = verification.passed;
    }

    return {
      waveNumber: wave.number,
      tasksCompleted: unique(tasksCompleted),
      tasksFailed: unique(tasksFailed),
      tasksBlocked: unique(tasksBlocked),
      verificationPassed,
      fixTasksCreated: [],
    };
  };

  const executeEpic = async (tasks: TaskWithDeps[]): Promise<EpicExecutionResult> => {
    if (tasks.length === 0) {
      return { success: true, wavesCompleted: 0, totalWaves: 0, allResults: [] };
    }

    const calculation = deps.calculateWaves(tasks);
    const waves = normalizeWaves(calculation, tasks);
    const totalWaves = waves.length;
    let wavesCompleted = 0;
    const allResults: WaveResult[] = [];
    const taskMap = toTaskMap(tasks);

    let state = buildInitialState(config);
    await deps.saveState(state, config.planningDir);

    for (const wave of waves) {
      const startedAt = Date.now();
      const startedEvent = gsdWaveStarted(
        { project_key: config.projectKey, timestamp: Date.now() },
        {
          wave_number: wave.number,
          task_count: wave.tasks.length,
          parallel_workers: parallelWorkers,
          epic_id: config.epicBeadId,
        },
      );
      deps.eventEmit(startedEvent.type, startedEvent);

      let waveResult = await executeWave(wave);
      let fixTasksCreated: string[] = [];
      let fixed = false;

      if (
        verifyAfterEachWave &&
        (waveResult.tasksFailed.length > 0 || !waveResult.verificationPassed)
      ) {
        let iteration = 0;
        let lastVerificationPassed = waveResult.verificationPassed;

        while (iteration < maxFixIterations && !fixed) {
          iteration += 1;
          const fixTasks: TaskWithDeps[] = [];

          if (waveResult.tasksFailed.length > 0) {
            for (const failedId of waveResult.tasksFailed) {
              const failedTask = taskMap.get(failedId);
              const title = failedTask
                ? `Fix ${failedTask.name}`
                : `Fix task ${failedId}`;
              const description = failedTask
                ? `Fix failed task ${failedTask.id} from wave ${wave.number}`
                : `Fix failed task ${failedId} from wave ${wave.number}`;
              const fixBeadId = await deps.createFixBead(
                title,
                description,
                config.epicBeadId,
              );
              fixTasksCreated.push(fixBeadId);
              fixTasks.push({
                id: fixBeadId,
                name: title,
                files: failedTask?.files ?? [],
                dependencies: [],
              });
            }
          } else if (!lastVerificationPassed) {
            const title = `Fix verification wave ${wave.number}`;
            const description = `Verification failed in wave ${wave.number}`;
            const fixBeadId = await deps.createFixBead(
              title,
              description,
              config.epicBeadId,
            );
            fixTasksCreated.push(fixBeadId);
            fixTasks.push({
              id: fixBeadId,
              name: title,
              files: [],
              dependencies: [],
            });
          }

          if (fixTasks.length === 0) break;

          const fixWaveResult = await executeWave({
            number: wave.number,
            tasks: fixTasks,
          });

          const combinedFiles = extractFiles([...wave.tasks, ...fixTasks]);
          const verification = await deps.verifyWave(combinedFiles);
          lastVerificationPassed = verification.passed;

          if (
            fixWaveResult.tasksFailed.length === 0 &&
            fixWaveResult.tasksBlocked.length === 0 &&
            lastVerificationPassed
          ) {
            fixed = true;
          }
        }

        waveResult = {
          ...waveResult,
          fixTasksCreated: unique(fixTasksCreated),
          verificationPassed: fixed ? true : waveResult.verificationPassed,
          tasksFailed: fixed ? [] : waveResult.tasksFailed,
          tasksBlocked: fixed ? [] : waveResult.tasksBlocked,
          tasksCompleted: fixed
            ? unique([...waveResult.tasksCompleted, ...waveResult.tasksFailed])
            : waveResult.tasksCompleted,
        };
      }

      const waveSuccess =
        waveResult.tasksFailed.length === 0 &&
        waveResult.tasksBlocked.length === 0 &&
        (!verifyAfterEachWave || waveResult.verificationPassed);

      state = {
        ...state,
        current_wave: wave.number,
        completed_tasks: unique([
          ...state.completed_tasks,
          ...waveResult.tasksCompleted,
        ]),
        failed_tasks: unique([...state.failed_tasks, ...waveResult.tasksFailed]),
        last_updated: new Date().toISOString(),
        status: waveSuccess ? "in_progress" : "failed",
      };

      await deps.saveState(state, config.planningDir);

      if (waveSuccess) {
        const completedEvent = gsdWaveCompleted(
          { project_key: config.projectKey, timestamp: Date.now() },
          {
            wave_number: wave.number,
            tasks_completed: waveResult.tasksCompleted.length,
            tasks_failed: waveResult.tasksFailed.length,
            duration_ms: Date.now() - startedAt,
            epic_id: config.epicBeadId,
          },
        );
        deps.eventEmit(completedEvent.type, completedEvent);
      } else {
        const failedEvent = gsdWaveFailed(
          { project_key: config.projectKey, timestamp: Date.now() },
          {
            wave_number: wave.number,
            failures: waveResult.tasksFailed,
            epic_id: config.epicBeadId,
            fix_wave_created: fixTasksCreated.length > 0,
          },
        );
        deps.eventEmit(failedEvent.type, failedEvent);
      }

      allResults.push(waveResult);

      if (!waveSuccess) {
        return { success: false, wavesCompleted, totalWaves, allResults };
      }

      wavesCompleted += 1;
    }

    state = {
      ...state,
      status: "completed",
      completed_at: new Date().toISOString(),
      last_updated: new Date().toISOString(),
    };
    await deps.saveState(state, config.planningDir);

    return { success: true, wavesCompleted, totalWaves, allResults };
  };

  const resume = async (stateFilePath: string): Promise<EpicExecutionResult> => {
    const state = await deps.loadState(stateFilePath);
    if (!state) throw new Error("No state found");

    const typedState = state as GsdState & { tasks?: TaskWithDeps[] };
    const tasks = typedState.tasks;
    if (!tasks) throw new Error("No tasks found in state");

    const completed = new Set(state.completed_tasks);
    const remainingTasks = tasks.filter((task) => !completed.has(task.id));

    return executeEpic(remainingTasks);
  };

  return { executeEpic, executeWave, resume };
}
