import type {
  GsdPlan,
  GsdTask,
  GsdWave,
  GsdState,
  GsdPlanStatus,
  VerificationResult,
} from "./gsd-types.js";

import type { StateManager } from "./state-manager.js";
import type { PlanGenerator } from "./plan-generator.js";
import type { WaveCalculator } from "./wave-calculator.js";
import type {
  VerificationEngine,
  TaskResults,
  VerificationFailure,
} from "./verification-engine.js";

import type { GsdEventBase } from "./gsd-events.js";
import {
  gsdWaveStarted,
  gsdWaveCompleted,
  gsdWaveFailed,
  gsdTaskExecuted,
  gsdVerificationPassed,
  gsdVerificationFailed,
  gsdFixPlanGenerated,
  gsdFixPlanCompleted,
  gsdStateUpdated,
} from "./gsd-events.js";

export interface TaskDispatchResult {
  taskId: string;
  success: boolean;
  filesModified: string[];
  error?: string;
}

export type TaskDispatcher = (task: GsdTask) => Promise<TaskDispatchResult>;

export interface OrchestratorConfig {
  projectKey: string;
  maxFixIterations: number;
  waveTimeoutMs: number;
}

export interface GsdOrchestratorDeps {
  stateManager: StateManager;
  planGenerator: PlanGenerator;
  waveCalculator: WaveCalculator;
  verificationEngine: VerificationEngine;
  emitEvent: (event: unknown) => Promise<void>;
}

export interface WaveExecutionResult {
  waveNumber: number;
  completedTasks: string[];
  failedTasks: string[];
  success: boolean;
  durationMs: number;
}

export interface ExecuteResult {
  success: boolean;
  completedTasks: string[];
  failedTasks: string[];
  wavesCompleted: number;
  verification?: VerificationResult;
  fixIterations: number;
}

export interface ExecuteOptions {
  startFromWave?: number;
  skipCompletedTasks?: string[];
}

export interface GsdOrchestrator {
  execute(plan: GsdPlan, dispatcher: TaskDispatcher): Promise<ExecuteResult>;
  executeWave(
    wave: GsdWave,
    tasks: GsdTask[],
    dispatcher: TaskDispatcher,
  ): Promise<WaveExecutionResult>;
  resume(plan: GsdPlan, dispatcher: TaskDispatcher): Promise<ExecuteResult>;
  getStatus(): Promise<GsdState | null>;
}

function makeEventBase(projectKey: string): GsdEventBase {
  return { project_key: projectKey, timestamp: Date.now() };
}

async function safeEmit(
  emitEvent: GsdOrchestratorDeps["emitEvent"],
  event: unknown,
): Promise<void> {
  try {
    await emitEvent(event);
  } catch {}
}

async function safeSave(
  stateManager: StateManager,
  state: GsdState,
): Promise<void> {
  try {
    await stateManager.save(state);
  } catch {}
}

export function createGsdOrchestrator(
  deps: GsdOrchestratorDeps,
  config: OrchestratorConfig,
): GsdOrchestrator {
  const { stateManager, verificationEngine, emitEvent } = deps;

  function buildInitialState(plan: GsdPlan): GsdState {
    const now = new Date().toISOString();
    return {
      plan_id: plan.id,
      status: "executing" as GsdPlanStatus,
      mode: plan.mode,
      current_wave: 1,
      completed_tasks: [],
      failed_tasks: [],
      verification_results: [],
      started_at: now,
      last_updated: now,
    };
  }

  function getTasksForWave(
    wave: GsdWave,
    allTasks: GsdTask[],
  ): GsdTask[] {
    const idSet = new Set(wave.task_ids);
    return allTasks.filter((t) => idSet.has(t.id));
  }

  async function dispatchWaveTasks(
    waveTasks: GsdTask[],
    dispatcher: TaskDispatcher,
  ): Promise<TaskDispatchResult[]> {
    const promises = waveTasks.map(async (task): Promise<TaskDispatchResult> => {
      try {
        return await dispatcher(task);
      } catch (err) {
        return {
          taskId: task.id,
          success: false,
          filesModified: [],
          error: err instanceof Error ? err.message : String(err),
        };
      }
    });

    return Promise.all(promises);
  }

  async function executeWave(
    wave: GsdWave,
    tasks: GsdTask[],
    dispatcher: TaskDispatcher,
  ): Promise<WaveExecutionResult> {
    const startMs = Date.now();
    const waveTasks = getTasksForWave(wave, tasks);

    await safeEmit(
      emitEvent,
      gsdWaveStarted(makeEventBase(config.projectKey), {
        wave_number: wave.wave_number,
        task_count: waveTasks.length,
        parallel_workers: waveTasks.length,
        files_in_scope: waveTasks.flatMap((t) => t.files),
      }),
    );

    const results = await dispatchWaveTasks(waveTasks, dispatcher);

    const completedTasks: string[] = [];
    const failedTasks: string[] = [];

    for (const result of results) {
      if (result.success) {
        completedTasks.push(result.taskId);
      } else {
        failedTasks.push(result.taskId);
      }

      const matchingTask = waveTasks.find((t) => t.id === result.taskId);
      await safeEmit(
        emitEvent,
        gsdTaskExecuted(makeEventBase(config.projectKey), {
          task_name: matchingTask?.name ?? result.taskId,
          success: result.success,
          wave_number: wave.wave_number,
          files_modified: result.filesModified,
        }),
      );
    }

    const durationMs = Date.now() - startMs;
    const waveSuccess = failedTasks.length === 0;

    if (waveSuccess) {
      await safeEmit(
        emitEvent,
        gsdWaveCompleted(makeEventBase(config.projectKey), {
          wave_number: wave.wave_number,
          tasks_completed: completedTasks.length,
          tasks_failed: 0,
          duration_ms: durationMs,
        }),
      );
    } else {
      await safeEmit(
        emitEvent,
        gsdWaveFailed(makeEventBase(config.projectKey), {
          wave_number: wave.wave_number,
          failures: failedTasks,
        }),
      );
    }

    return {
      waveNumber: wave.wave_number,
      completedTasks,
      failedTasks,
      success: waveSuccess,
      durationMs,
    };
  }

  function buildTaskResults(state: GsdState): TaskResults {
    return {
      completed_task_ids: state.completed_tasks,
      failed_task_ids: state.failed_tasks,
    };
  }

  function extractFailures(
    verificationResult: VerificationResult,
  ): VerificationFailure[] {
    const failures: VerificationFailure[] = [];

    for (const truth of verificationResult.truths) {
      if (!truth.passed) {
        failures.push({
          category: "truth",
          description: truth.description,
          severity: "major",
        });
      }
    }

    for (const artifact of verificationResult.artifacts) {
      if (!artifact.passed) {
        failures.push({
          category: "artifact",
          description: `Artifact ${artifact.path} (${artifact.check})`,
          severity: "major",
        });
      }
    }

    for (const link of verificationResult.key_links) {
      if (!link.passed) {
        failures.push({
          category: "key_link",
          description: `Link ${link.from} → ${link.to} (${link.type})`,
          severity: "minor",
        });
      }
    }

    return failures;
  }

  async function runVerificationWithRetry(
    plan: GsdPlan,
    state: GsdState,
    dispatcher: TaskDispatcher,
  ): Promise<{ verification: VerificationResult; fixIterations: number }> {
    let verification = verificationEngine.verify(plan, buildTaskResults(state));
    let fixIterations = 0;

    if (verificationEngine.isFullyVerified(verification)) {
      await safeEmit(
        emitEvent,
        gsdVerificationPassed(makeEventBase(config.projectKey), {
          must_haves_passed: verification.truths.filter((t) => t.passed).length,
          artifacts_passed: verification.artifacts.filter((a) => a.passed).length,
          key_links_passed: verification.key_links.filter((l) => l.passed).length,
          total_checks: verification.total_checks ?? 0,
        }),
      );
      return { verification, fixIterations };
    }

    while (fixIterations < config.maxFixIterations) {
      const failures = extractFailures(verification);

      await safeEmit(
        emitEvent,
        gsdVerificationFailed(makeEventBase(config.projectKey), {
          failures: failures.map((f) => f.description),
          retry_count: fixIterations,
        }),
      );

      const fixTasks = verificationEngine.generateFixPlan(failures);

      if (fixTasks.length === 0) break;

      await safeEmit(
        emitEvent,
        gsdFixPlanGenerated(makeEventBase(config.projectKey), {
          source_verification: `iteration-${fixIterations}`,
          fix_tasks: fixTasks.map((t) => t.id),
        }),
      );

      const fixResults = await dispatchWaveTasks(fixTasks, dispatcher);

      for (const result of fixResults) {
        if (result.success && !state.completed_tasks.includes(result.taskId)) {
          state = {
            ...state,
            completed_tasks: [...state.completed_tasks, result.taskId],
            last_updated: new Date().toISOString(),
          };
        }
      }

      const fixPassed = fixResults.every((r) => r.success);

      await safeEmit(
        emitEvent,
        gsdFixPlanCompleted(makeEventBase(config.projectKey), {
          fix_tasks: fixTasks.map((t) => t.id),
          re_verification_passed: fixPassed,
        }),
      );

      fixIterations++;

      verification = verificationEngine.verify(plan, buildTaskResults(state));

      if (verificationEngine.isFullyVerified(verification)) {
        await safeEmit(
          emitEvent,
          gsdVerificationPassed(makeEventBase(config.projectKey), {
            must_haves_passed: verification.truths.filter((t) => t.passed).length,
            artifacts_passed: verification.artifacts.filter((a) => a.passed).length,
            key_links_passed: verification.key_links.filter((l) => l.passed).length,
            total_checks: verification.total_checks ?? 0,
          }),
        );
        return { verification, fixIterations };
      }
    }

    if (!verificationEngine.isFullyVerified(verification)) {
      const failures = extractFailures(verification);
      await safeEmit(
        emitEvent,
        gsdVerificationFailed(makeEventBase(config.projectKey), {
          failures: failures.map((f) => f.description),
          retry_count: fixIterations,
        }),
      );
    }

    return { verification, fixIterations };
  }

  async function execute(
    plan: GsdPlan,
    dispatcher: TaskDispatcher,
    options: ExecuteOptions = {},
  ): Promise<ExecuteResult> {
    if (plan.waves.length === 0) {
      const emptyState = buildInitialState(plan);
      emptyState.status = "completed";
      emptyState.completed_at = new Date().toISOString();
      await safeSave(stateManager, emptyState);
      return {
        success: true,
        completedTasks: [],
        failedTasks: [],
        wavesCompleted: 0,
        fixIterations: 0,
      };
    }

    let state = buildInitialState(plan);
    if (options.skipCompletedTasks) {
      state.completed_tasks = [...options.skipCompletedTasks];
    }
    if (options.startFromWave) {
      state.current_wave = options.startFromWave;
    }

    await safeSave(stateManager, state);

    const sortedWaves = [...plan.waves].sort(
      (a, b) => a.wave_number - b.wave_number,
    );

    let wavesCompleted = 0;

    for (const wave of sortedWaves) {
      if (wave.wave_number < state.current_wave) {
        wavesCompleted++;
        continue;
      }

      state = {
        ...state,
        current_wave: wave.wave_number,
        last_updated: new Date().toISOString(),
      };
      await safeSave(stateManager, state);

      await safeEmit(
        emitEvent,
        gsdStateUpdated(makeEventBase(config.projectKey), {
          current_wave: wave.wave_number,
          tasks_completed: state.completed_tasks.length,
          tasks_remaining: plan.tasks.length - state.completed_tasks.length - state.failed_tasks.length,
        }),
      );

      const activeTasks = getTasksForWave(wave, plan.tasks).filter(
        (t) => !state.completed_tasks.includes(t.id),
      );

      if (activeTasks.length === 0) {
        wavesCompleted++;
        continue;
      }

      const waveResult = await executeWave(
        wave,
        plan.tasks,
        async (task: GsdTask) => {
          if (state.completed_tasks.includes(task.id)) {
            return { taskId: task.id, success: true, filesModified: [] };
          }
          return dispatcher(task);
        },
      );

      state = {
        ...state,
        completed_tasks: [
          ...state.completed_tasks,
          ...waveResult.completedTasks.filter(
            (id) => !state.completed_tasks.includes(id),
          ),
        ],
        failed_tasks: [
          ...state.failed_tasks,
          ...waveResult.failedTasks.filter(
            (id) => !state.failed_tasks.includes(id),
          ),
        ],
        last_updated: new Date().toISOString(),
      };

      await safeSave(stateManager, state);
      wavesCompleted++;
    }

    const { verification, fixIterations } = await runVerificationWithRetry(
      plan,
      state,
      dispatcher,
    );

    const verificationPassed = verificationEngine.isFullyVerified(verification);
    const hasFailedTasks = state.failed_tasks.length > 0;
    const overallSuccess = verificationPassed && !hasFailedTasks;

    state = {
      ...state,
      status: overallSuccess ? "completed" : "failed",
      verification_results: [...state.verification_results, verification],
      last_updated: new Date().toISOString(),
      completed_at: new Date().toISOString(),
    };

    await safeSave(stateManager, state);

    return {
      success: overallSuccess,
      completedTasks: state.completed_tasks,
      failedTasks: state.failed_tasks,
      wavesCompleted,
      verification,
      fixIterations,
    };
  }

  async function resume(
    plan: GsdPlan,
    dispatcher: TaskDispatcher,
  ): Promise<ExecuteResult> {
    const savedState = await stateManager.load();

    if (!savedState || savedState.plan_id !== plan.id) {
      return execute(plan, dispatcher);
    }

    return execute(plan, dispatcher, {
      startFromWave: savedState.current_wave,
      skipCompletedTasks: savedState.completed_tasks,
    });
  }

  async function getStatus(): Promise<GsdState | null> {
    return stateManager.load();
  }

  return {
    execute: (plan, dispatcher) => execute(plan, dispatcher),
    executeWave,
    resume,
    getStatus,
  };
}
