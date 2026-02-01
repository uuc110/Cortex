import { describe, test, expect } from "bun:test";

import type { GsdPlan, GsdTask, GsdWave, GsdState, VerificationResult } from "./gsd-types.js";
import type { StateManager } from "./state-manager.js";
import type { PlanGenerator } from "./plan-generator.js";
import type { WaveCalculator, WaveCalculatorResult } from "./wave-calculator.js";
import type { VerificationEngine, TaskResults, VerificationFailure } from "./verification-engine.js";

import {
  createGsdOrchestrator,
  type GsdOrchestratorDeps,
  type TaskDispatcher,
  type OrchestratorConfig,
} from "./gsd-orchestrator.js";

// ─── Test Helpers ──────────────────────────────────────────────

function makeTask(overrides: Partial<GsdTask> = {}): GsdTask {
  return {
    id: "task-1",
    name: "Test task",
    status: "pending",
    wave: 1,
    priority: "medium",
    type: "auto",
    files: ["src/foo.ts"],
    action: "Do something",
    ...overrides,
  };
}

function makeWave(overrides: Partial<GsdWave> = {}): GsdWave {
  return {
    wave_number: 1,
    task_ids: ["task-1"],
    status: "pending",
    parallel: false,
    ...overrides,
  };
}

function makePlan(overrides: Partial<GsdPlan> = {}): GsdPlan {
  return {
    id: "plan-1",
    title: "Test plan",
    phase: "1",
    created: "2026-02-01T00:00:00Z",
    status: "pending",
    mode: "quick",
    type: "execute",
    tasks: [makeTask()],
    waves: [makeWave()],
    ...overrides,
  };
}

function makeVerificationResult(overrides: Partial<VerificationResult> = {}): VerificationResult {
  return {
    status: "passed",
    truths: [],
    artifacts: [],
    key_links: [],
    total_checks: 0,
    passed_checks: 0,
    failed_checks: 0,
    checked_at: "2026-02-01T00:00:00Z",
    ...overrides,
  };
}

function makeState(overrides: Partial<GsdState> = {}): GsdState {
  return {
    plan_id: "plan-1",
    status: "pending",
    mode: "quick",
    current_wave: 1,
    completed_tasks: [],
    failed_tasks: [],
    verification_results: [],
    started_at: "2026-02-01T00:00:00Z",
    last_updated: "2026-02-01T00:00:00Z",
    ...overrides,
  };
}

function makeSuccessDispatcher(): TaskDispatcher {
  return async (task: GsdTask) => ({
    taskId: task.id,
    success: true,
    filesModified: task.files,
  });
}

function makeFailingDispatcher(taskIds: string[]): TaskDispatcher {
  return async (task: GsdTask) => ({
    taskId: task.id,
    success: !taskIds.includes(task.id),
    filesModified: task.files,
    error: taskIds.includes(task.id) ? "Task execution failed" : undefined,
  });
}

// Mock implementations for sub-modules
function mockStateManager(): StateManager {
  let storedState: GsdState | null = null;
  return {
    save: async (state: GsdState) => {
      storedState = state;
    },
    load: async () => storedState,
  };
}

function mockPlanGenerator(): PlanGenerator {
  return {
    generate: (_tasks: GsdTask[], _options: unknown) => "---\nmocked plan\n---",
    parse: (markdown: string) => makePlan({ title: `Parsed: ${markdown.slice(0, 20)}` }),
    validate: (_plan: GsdPlan) => ({ valid: true, errors: [] }),
  };
}

function mockWaveCalculator(): WaveCalculator {
  return {
    calculateWaves: (tasks: GsdTask[]): WaveCalculatorResult => {
      // Group tasks by wave number
      const waveMap = new Map<number, string[]>();
      for (const task of tasks) {
        const ids = waveMap.get(task.wave) ?? [];
        ids.push(task.id);
        waveMap.set(task.wave, ids);
      }

      const waves: GsdWave[] = [];
      const sorted = [...waveMap.keys()].sort((a, b) => a - b);
      for (const waveNum of sorted) {
        const taskIds = waveMap.get(waveNum)!;
        waves.push({
          wave_number: waveNum,
          task_ids: taskIds,
          status: "pending",
          parallel: taskIds.length > 1,
        });
      }

      return {
        waves,
        totalTasks: tasks.length,
        maxParallelism: Math.max(0, ...waves.map((w) => w.task_ids.length)),
        sequentialWaves: waves.length,
      };
    },
    detectCycles: () => [],
    getExecutionOrder: (waves: GsdWave[]) => waves.flatMap((w) => w.task_ids),
    validateDependencies: () => ({
      valid: true,
      missingDependencies: [],
      selfReferences: [],
      cycles: [],
    }),
  };
}

function mockVerificationEngine(passVerification = true): VerificationEngine {
  return {
    verify: (_plan: GsdPlan, _results: TaskResults): VerificationResult =>
      makeVerificationResult({
        status: passVerification ? "passed" : "failed",
        total_checks: 3,
        passed_checks: passVerification ? 3 : 1,
        failed_checks: passVerification ? 0 : 2,
        truths: passVerification
          ? [{ description: "Works", passed: true }]
          : [{ description: "Broken", passed: false }],
      }),
    checkTruths: (truths) => truths.map((t) => ({ description: t.description, passed: t.passed, evidence: "" })),
    checkArtifacts: (artifacts) => artifacts.map((a) => ({ path: a.path, check: a.check, passed: a.passed })),
    checkKeyLinks: (links) => links.map((l) => ({ from: l.from, to: l.to, type: l.type, passed: l.passed })),
    generateFixPlan: (failures: VerificationFailure[]): GsdTask[] =>
      failures.map((f, i) => makeTask({
        id: `fix-${i + 1}`,
        name: `Fix: ${f.description}`,
        wave: 1,
        status: "pending",
      })),
    isFullyVerified: (result: VerificationResult) => result.status === "passed",
  };
}

function makeDeps(overrides: Partial<GsdOrchestratorDeps> = {}): GsdOrchestratorDeps {
  return {
    stateManager: mockStateManager(),
    planGenerator: mockPlanGenerator(),
    waveCalculator: mockWaveCalculator(),
    verificationEngine: mockVerificationEngine(),
    emitEvent: async () => {},
    ...overrides,
  };
}

function makeConfig(overrides: Partial<OrchestratorConfig> = {}): OrchestratorConfig {
  return {
    projectKey: "/test/project",
    maxFixIterations: 3,
    waveTimeoutMs: 30000,
    ...overrides,
  };
}

// ─── Tests ─────────────────────────────────────────────────────

describe("createGsdOrchestrator", () => {
  describe("factory pattern", () => {
    test("returns an orchestrator object with execute method", () => {
      const orchestrator = createGsdOrchestrator(makeDeps(), makeConfig());
      expect(orchestrator).toBeDefined();
      expect(typeof orchestrator.execute).toBe("function");
    });

    test("returns executeWave method", () => {
      const orchestrator = createGsdOrchestrator(makeDeps(), makeConfig());
      expect(typeof orchestrator.executeWave).toBe("function");
    });

    test("returns resume method", () => {
      const orchestrator = createGsdOrchestrator(makeDeps(), makeConfig());
      expect(typeof orchestrator.resume).toBe("function");
    });

    test("returns getStatus method", () => {
      const orchestrator = createGsdOrchestrator(makeDeps(), makeConfig());
      expect(typeof orchestrator.getStatus).toBe("function");
    });
  });

  describe("Quick Mode execution (≤5 tasks)", () => {
    test("executes a single-task plan end-to-end", async () => {
      const plan = makePlan({
        mode: "quick",
        tasks: [makeTask({ id: "t1" })],
        waves: [makeWave({ wave_number: 1, task_ids: ["t1"] })],
      });

      const orchestrator = createGsdOrchestrator(makeDeps(), makeConfig());
      const result = await orchestrator.execute(plan, makeSuccessDispatcher());

      expect(result.success).toBe(true);
      expect(result.completedTasks).toContain("t1");
      expect(result.failedTasks).toHaveLength(0);
    });

    test("executes multi-wave quick mode plan", async () => {
      const tasks = [
        makeTask({ id: "t1", wave: 1 }),
        makeTask({ id: "t2", wave: 1 }),
        makeTask({ id: "t3", wave: 2, dependencies: ["t1", "t2"] }),
      ];
      const plan = makePlan({
        mode: "quick",
        tasks,
        waves: [
          makeWave({ wave_number: 1, task_ids: ["t1", "t2"], parallel: true }),
          makeWave({ wave_number: 2, task_ids: ["t3"] }),
        ],
      });

      const orchestrator = createGsdOrchestrator(makeDeps(), makeConfig());
      const result = await orchestrator.execute(plan, makeSuccessDispatcher());

      expect(result.success).toBe(true);
      expect(result.completedTasks).toEqual(expect.arrayContaining(["t1", "t2", "t3"]));
      expect(result.wavesCompleted).toBe(2);
    });

    test("quick mode skips research phase", async () => {
      const events: string[] = [];
      const deps = makeDeps({
        emitEvent: async (event) => {
          events.push((event as { type: string }).type);
        },
      });

      const plan = makePlan({ mode: "quick" });
      const orchestrator = createGsdOrchestrator(deps, makeConfig());
      await orchestrator.execute(plan, makeSuccessDispatcher());

      expect(events).not.toContain("gsd_research_started");
    });

    test("quick mode enforces ≤5 tasks limit (informational)", async () => {
      const tasks = Array.from({ length: 6 }, (_, i) =>
        makeTask({ id: `t${i + 1}`, wave: 1 }),
      );
      const plan = makePlan({
        mode: "quick",
        tasks,
        waves: [makeWave({ wave_number: 1, task_ids: tasks.map((t) => t.id) })],
      });

      const orchestrator = createGsdOrchestrator(makeDeps(), makeConfig());
      // Should still execute but warn - quick mode is advisory not enforcement
      const result = await orchestrator.execute(plan, makeSuccessDispatcher());
      expect(result.success).toBe(true);
    });
  });

  describe("Project Mode execution", () => {
    test("executes project mode plan with multiple phases", async () => {
      const tasks = [
        makeTask({ id: "t1", wave: 1 }),
        makeTask({ id: "t2", wave: 2, dependencies: ["t1"] }),
      ];
      const plan = makePlan({
        mode: "project",
        tasks,
        waves: [
          makeWave({ wave_number: 1, task_ids: ["t1"] }),
          makeWave({ wave_number: 2, task_ids: ["t2"] }),
        ],
      });

      const orchestrator = createGsdOrchestrator(makeDeps(), makeConfig());
      const result = await orchestrator.execute(plan, makeSuccessDispatcher());

      expect(result.success).toBe(true);
      expect(result.completedTasks).toEqual(expect.arrayContaining(["t1", "t2"]));
    });

    test("project mode tracks current phase in state", async () => {
      const sm = mockStateManager();
      const deps = makeDeps({ stateManager: sm });

      const plan = makePlan({
        mode: "project",
        tasks: [makeTask({ id: "t1", wave: 1 })],
        waves: [makeWave({ wave_number: 1, task_ids: ["t1"] })],
      });

      const orchestrator = createGsdOrchestrator(deps, makeConfig());
      await orchestrator.execute(plan, makeSuccessDispatcher());

      const savedState = await sm.load();
      expect(savedState).not.toBeNull();
      expect(savedState!.status).toBe("completed");
    });
  });

  describe("Wave Execution Protocol", () => {
    test("dispatches tasks to dispatcher function", async () => {
      const dispatched: string[] = [];
      const dispatcher: TaskDispatcher = async (task) => {
        dispatched.push(task.id);
        return { taskId: task.id, success: true, filesModified: task.files };
      };

      const plan = makePlan({
        tasks: [makeTask({ id: "t1" }), makeTask({ id: "t2", wave: 1 })],
        waves: [makeWave({ wave_number: 1, task_ids: ["t1", "t2"], parallel: true })],
      });

      const orchestrator = createGsdOrchestrator(makeDeps(), makeConfig());
      await orchestrator.execute(plan, dispatcher);

      expect(dispatched).toEqual(expect.arrayContaining(["t1", "t2"]));
    });

    test("executes waves sequentially (wave 1 before wave 2)", async () => {
      const executionOrder: string[] = [];
      const dispatcher: TaskDispatcher = async (task) => {
        executionOrder.push(task.id);
        return { taskId: task.id, success: true, filesModified: [] };
      };

      const plan = makePlan({
        tasks: [
          makeTask({ id: "w1t1", wave: 1 }),
          makeTask({ id: "w2t1", wave: 2 }),
        ],
        waves: [
          makeWave({ wave_number: 1, task_ids: ["w1t1"] }),
          makeWave({ wave_number: 2, task_ids: ["w2t1"] }),
        ],
      });

      const orchestrator = createGsdOrchestrator(makeDeps(), makeConfig());
      await orchestrator.execute(plan, dispatcher);

      const w1Index = executionOrder.indexOf("w1t1");
      const w2Index = executionOrder.indexOf("w2t1");
      expect(w1Index).toBeLessThan(w2Index);
    });

    test("dispatches parallel tasks within same wave concurrently", async () => {
      const startTimes: Record<string, number> = {};
      const dispatcher: TaskDispatcher = async (task) => {
        startTimes[task.id] = Date.now();
        await new Promise((resolve) => setTimeout(resolve, 10));
        return { taskId: task.id, success: true, filesModified: [] };
      };

      const plan = makePlan({
        tasks: [
          makeTask({ id: "p1", wave: 1 }),
          makeTask({ id: "p2", wave: 1 }),
          makeTask({ id: "p3", wave: 1 }),
        ],
        waves: [makeWave({ wave_number: 1, task_ids: ["p1", "p2", "p3"], parallel: true })],
      });

      const orchestrator = createGsdOrchestrator(makeDeps(), makeConfig());
      await orchestrator.execute(plan, dispatcher);

      // Parallel tasks should start nearly at the same time
      const times = Object.values(startTimes);
      const maxDiff = Math.max(...times) - Math.min(...times);
      // They should start within ~5ms of each other (concurrent)
      expect(maxDiff).toBeLessThan(50);
    });
  });

  describe("Event emission", () => {
    test("emits wave_started and wave_completed events", async () => {
      const eventTypes: string[] = [];
      const deps = makeDeps({
        emitEvent: async (event) => {
          eventTypes.push((event as { type: string }).type);
        },
      });

      const plan = makePlan();
      const orchestrator = createGsdOrchestrator(deps, makeConfig());
      await orchestrator.execute(plan, makeSuccessDispatcher());

      expect(eventTypes).toContain("gsd_wave_started");
      expect(eventTypes).toContain("gsd_wave_completed");
    });

    test("emits task_executed for each task", async () => {
      const events: Array<{ type: string; task_name?: string }> = [];
      const deps = makeDeps({
        emitEvent: async (event) => {
          events.push(event as { type: string; task_name?: string });
        },
      });

      const plan = makePlan({
        tasks: [makeTask({ id: "t1", name: "First" }), makeTask({ id: "t2", name: "Second", wave: 1 })],
        waves: [makeWave({ wave_number: 1, task_ids: ["t1", "t2"] })],
      });

      const orchestrator = createGsdOrchestrator(deps, makeConfig());
      await orchestrator.execute(plan, makeSuccessDispatcher());

      const taskEvents = events.filter((e) => e.type === "gsd_task_executed");
      expect(taskEvents).toHaveLength(2);
    });

    test("emits verification_passed on success", async () => {
      const eventTypes: string[] = [];
      const deps = makeDeps({
        emitEvent: async (event) => {
          eventTypes.push((event as { type: string }).type);
        },
      });

      const plan = makePlan();
      const orchestrator = createGsdOrchestrator(deps, makeConfig());
      await orchestrator.execute(plan, makeSuccessDispatcher());

      expect(eventTypes).toContain("gsd_verification_passed");
    });

    test("emits verification_failed when verification fails", async () => {
      const eventTypes: string[] = [];
      const deps = makeDeps({
        verificationEngine: mockVerificationEngine(false),
        emitEvent: async (event) => {
          eventTypes.push((event as { type: string }).type);
        },
      });

      const plan = makePlan();
      const orchestrator = createGsdOrchestrator(deps, makeConfig());
      // Max fix iterations = 0 to prevent looping
      await orchestrator.execute(plan, makeSuccessDispatcher());

      expect(eventTypes).toContain("gsd_verification_failed");
    });

    test("emits state_updated events during execution", async () => {
      const eventTypes: string[] = [];
      const deps = makeDeps({
        emitEvent: async (event) => {
          eventTypes.push((event as { type: string }).type);
        },
      });

      const plan = makePlan();
      const orchestrator = createGsdOrchestrator(deps, makeConfig());
      await orchestrator.execute(plan, makeSuccessDispatcher());

      expect(eventTypes).toContain("gsd_state_updated");
    });
  });

  describe("State persistence", () => {
    test("saves state after each wave", async () => {
      let saveCount = 0;
      const sm: StateManager = {
        save: async () => {
          saveCount++;
        },
        load: async () => null,
      };

      const plan = makePlan({
        tasks: [
          makeTask({ id: "t1", wave: 1 }),
          makeTask({ id: "t2", wave: 2 }),
        ],
        waves: [
          makeWave({ wave_number: 1, task_ids: ["t1"] }),
          makeWave({ wave_number: 2, task_ids: ["t2"] }),
        ],
      });

      const orchestrator = createGsdOrchestrator(makeDeps({ stateManager: sm }), makeConfig());
      await orchestrator.execute(plan, makeSuccessDispatcher());

      // Should save: initial + after wave 1 + after wave 2 + final
      expect(saveCount).toBeGreaterThanOrEqual(3);
    });

    test("updates completed_tasks in state", async () => {
      const sm = mockStateManager();
      const deps = makeDeps({ stateManager: sm });

      const plan = makePlan({
        tasks: [makeTask({ id: "t1" }), makeTask({ id: "t2", wave: 1 })],
        waves: [makeWave({ wave_number: 1, task_ids: ["t1", "t2"] })],
      });

      const orchestrator = createGsdOrchestrator(deps, makeConfig());
      await orchestrator.execute(plan, makeSuccessDispatcher());

      const saved = await sm.load();
      expect(saved!.completed_tasks).toEqual(expect.arrayContaining(["t1", "t2"]));
    });

    test("updates failed_tasks in state when tasks fail", async () => {
      const sm = mockStateManager();
      const deps = makeDeps({ stateManager: sm });

      const plan = makePlan({
        tasks: [makeTask({ id: "t1" }), makeTask({ id: "t2", wave: 1 })],
        waves: [makeWave({ wave_number: 1, task_ids: ["t1", "t2"] })],
      });

      const orchestrator = createGsdOrchestrator(deps, makeConfig());
      await orchestrator.execute(plan, makeFailingDispatcher(["t2"]));

      const saved = await sm.load();
      expect(saved!.failed_tasks).toContain("t2");
    });

    test("state tracks current wave progression", async () => {
      const waveStates: number[] = [];
      const sm: StateManager = {
        save: async (state) => {
          waveStates.push(state.current_wave);
        },
        load: async () => null,
      };

      const plan = makePlan({
        tasks: [
          makeTask({ id: "t1", wave: 1 }),
          makeTask({ id: "t2", wave: 2 }),
          makeTask({ id: "t3", wave: 3 }),
        ],
        waves: [
          makeWave({ wave_number: 1, task_ids: ["t1"] }),
          makeWave({ wave_number: 2, task_ids: ["t2"] }),
          makeWave({ wave_number: 3, task_ids: ["t3"] }),
        ],
      });

      const orchestrator = createGsdOrchestrator(makeDeps({ stateManager: sm }), makeConfig());
      await orchestrator.execute(plan, makeSuccessDispatcher());

      // Wave numbers should progress from 1 → 2 → 3
      expect(waveStates).toEqual(expect.arrayContaining([1, 2, 3]));
    });
  });

  describe("Verification integration", () => {
    test("runs verification after all waves complete", async () => {
      let verifyCallCount = 0;
      const ve = mockVerificationEngine(true);
      const originalVerify = ve.verify;
      ve.verify = (plan, results) => {
        verifyCallCount++;
        return originalVerify(plan, results);
      };

      const deps = makeDeps({ verificationEngine: ve });
      const orchestrator = createGsdOrchestrator(deps, makeConfig());
      await orchestrator.execute(makePlan(), makeSuccessDispatcher());

      expect(verifyCallCount).toBeGreaterThanOrEqual(1);
    });

    test("reports verification result in execute output", async () => {
      const orchestrator = createGsdOrchestrator(makeDeps(), makeConfig());
      const result = await orchestrator.execute(makePlan(), makeSuccessDispatcher());

      expect(result.verification).toBeDefined();
      expect(result.verification!.status).toBe("passed");
    });

    test("marks plan as failed when verification fails after max retries", async () => {
      // Verification always fails
      const deps = makeDeps({
        verificationEngine: mockVerificationEngine(false),
      });

      const config = makeConfig({ maxFixIterations: 0 });
      const orchestrator = createGsdOrchestrator(deps, config);
      const result = await orchestrator.execute(makePlan(), makeSuccessDispatcher());

      expect(result.success).toBe(false);
      expect(result.verification!.status).toBe("failed");
    });
  });

  describe("Fix plan generation and retry", () => {
    test("generates fix tasks when verification fails", async () => {
      let fixPlanGenerated = false;
      const eventTypes: string[] = [];
      const deps = makeDeps({
        verificationEngine: mockVerificationEngine(false),
        emitEvent: async (event) => {
          const type = (event as { type: string }).type;
          eventTypes.push(type);
          if (type === "gsd_fix_plan_generated") fixPlanGenerated = true;
        },
      });

      const config = makeConfig({ maxFixIterations: 1 });
      const orchestrator = createGsdOrchestrator(deps, config);
      await orchestrator.execute(makePlan(), makeSuccessDispatcher());

      expect(fixPlanGenerated).toBe(true);
    });

    test("retries execution with fix tasks up to maxFixIterations", async () => {
      let verifyCount = 0;
      const ve = mockVerificationEngine(false);
      const originalVerify = ve.verify;
      ve.verify = (plan, results) => {
        verifyCount++;
        // Pass on 3rd verification (after 2 fix iterations)
        if (verifyCount >= 3) {
          return makeVerificationResult({ status: "passed", total_checks: 1, passed_checks: 1, failed_checks: 0 });
        }
        return originalVerify(plan, results);
      };

      const deps = makeDeps({ verificationEngine: ve });
      const config = makeConfig({ maxFixIterations: 3 });
      const orchestrator = createGsdOrchestrator(deps, config);
      const result = await orchestrator.execute(makePlan(), makeSuccessDispatcher());

      expect(result.success).toBe(true);
      expect(verifyCount).toBe(3);
    });

    test("stops retrying after maxFixIterations", async () => {
      let verifyCount = 0;
      const ve = mockVerificationEngine(false);
      const originalVerify = ve.verify;
      ve.verify = (plan, results) => {
        verifyCount++;
        return originalVerify(plan, results);
      };

      const deps = makeDeps({ verificationEngine: ve });
      const config = makeConfig({ maxFixIterations: 2 });
      const orchestrator = createGsdOrchestrator(deps, config);
      const result = await orchestrator.execute(makePlan(), makeSuccessDispatcher());

      expect(result.success).toBe(false);
      // Initial verification + 2 fix iteration verifications = 3
      expect(verifyCount).toBe(3);
    });
  });

  describe("Error handling", () => {
    test("handles dispatcher errors gracefully", async () => {
      const dispatcher: TaskDispatcher = async (_task) => {
        throw new Error("Dispatcher crashed");
      };

      const orchestrator = createGsdOrchestrator(makeDeps(), makeConfig());
      const result = await orchestrator.execute(makePlan(), dispatcher);

      expect(result.success).toBe(false);
      expect(result.failedTasks).toHaveLength(1);
    });

    test("handles partial wave failure (some tasks succeed, some fail)", async () => {
      const plan = makePlan({
        tasks: [
          makeTask({ id: "t1", wave: 1 }),
          makeTask({ id: "t2", wave: 1 }),
          makeTask({ id: "t3", wave: 1 }),
        ],
        waves: [makeWave({ wave_number: 1, task_ids: ["t1", "t2", "t3"], parallel: true })],
      });

      const orchestrator = createGsdOrchestrator(makeDeps(), makeConfig());
      const result = await orchestrator.execute(plan, makeFailingDispatcher(["t2"]));

      expect(result.completedTasks).toContain("t1");
      expect(result.completedTasks).toContain("t3");
      expect(result.failedTasks).toContain("t2");
    });

    test("saves state on error for resumability", async () => {
      const sm = mockStateManager();
      const deps = makeDeps({ stateManager: sm });

      const dispatcher: TaskDispatcher = async (_task) => {
        throw new Error("Boom");
      };

      const plan = makePlan();
      const orchestrator = createGsdOrchestrator(deps, makeConfig());
      await orchestrator.execute(plan, dispatcher);

      const saved = await sm.load();
      expect(saved).not.toBeNull();
      expect(saved!.status).toBe("failed");
    });
  });

  describe("Resume from saved state", () => {
    test("resumes from last completed wave", async () => {
      const savedState = makeState({
        plan_id: "plan-1",
        status: "executing",
        current_wave: 2,
        completed_tasks: ["t1"],
        mode: "quick",
      });

      const sm: StateManager = {
        save: async () => {},
        load: async () => savedState,
      };

      const dispatched: string[] = [];
      const dispatcher: TaskDispatcher = async (task) => {
        dispatched.push(task.id);
        return { taskId: task.id, success: true, filesModified: [] };
      };

      const plan = makePlan({
        id: "plan-1",
        tasks: [
          makeTask({ id: "t1", wave: 1 }),
          makeTask({ id: "t2", wave: 2 }),
        ],
        waves: [
          makeWave({ wave_number: 1, task_ids: ["t1"] }),
          makeWave({ wave_number: 2, task_ids: ["t2"] }),
        ],
      });

      const deps = makeDeps({ stateManager: sm });
      const orchestrator = createGsdOrchestrator(deps, makeConfig());
      const result = await orchestrator.resume(plan, dispatcher);

      // Should only dispatch wave 2's task (t1 already completed)
      expect(dispatched).toContain("t2");
      expect(dispatched).not.toContain("t1");
      expect(result.success).toBe(true);
    });

    test("resume returns fresh execution when no saved state", async () => {
      const sm: StateManager = {
        save: async () => {},
        load: async () => null,
      };

      const dispatched: string[] = [];
      const dispatcher: TaskDispatcher = async (task) => {
        dispatched.push(task.id);
        return { taskId: task.id, success: true, filesModified: [] };
      };

      const plan = makePlan({
        tasks: [makeTask({ id: "t1" })],
        waves: [makeWave({ wave_number: 1, task_ids: ["t1"] })],
      });

      const deps = makeDeps({ stateManager: sm });
      const orchestrator = createGsdOrchestrator(deps, makeConfig());
      const result = await orchestrator.resume(plan, dispatcher);

      expect(dispatched).toContain("t1");
      expect(result.success).toBe(true);
    });
  });

  describe("getStatus", () => {
    test("returns current execution status from state", async () => {
      const sm = mockStateManager();
      const deps = makeDeps({ stateManager: sm });
      const orchestrator = createGsdOrchestrator(deps, makeConfig());

      // Execute first
      await orchestrator.execute(makePlan(), makeSuccessDispatcher());

      const status = await orchestrator.getStatus();
      expect(status).not.toBeNull();
      expect(status!.status).toBe("completed");
    });

    test("returns null when no execution has occurred", async () => {
      const orchestrator = createGsdOrchestrator(makeDeps(), makeConfig());
      const status = await orchestrator.getStatus();
      expect(status).toBeNull();
    });
  });

  describe("executeWave (individual wave)", () => {
    test("executes a single wave and returns results", async () => {
      const wave = makeWave({ wave_number: 1, task_ids: ["t1", "t2"], parallel: true });
      const tasks = [
        makeTask({ id: "t1", wave: 1 }),
        makeTask({ id: "t2", wave: 1 }),
      ];

      const orchestrator = createGsdOrchestrator(makeDeps(), makeConfig());
      const result = await orchestrator.executeWave(wave, tasks, makeSuccessDispatcher());

      expect(result.waveNumber).toBe(1);
      expect(result.completedTasks).toEqual(expect.arrayContaining(["t1", "t2"]));
      expect(result.failedTasks).toHaveLength(0);
      expect(result.success).toBe(true);
    });

    test("reports failed tasks in wave result", async () => {
      const wave = makeWave({ wave_number: 1, task_ids: ["t1", "t2"] });
      const tasks = [
        makeTask({ id: "t1", wave: 1 }),
        makeTask({ id: "t2", wave: 1 }),
      ];

      const orchestrator = createGsdOrchestrator(makeDeps(), makeConfig());
      const result = await orchestrator.executeWave(wave, tasks, makeFailingDispatcher(["t2"]));

      expect(result.completedTasks).toContain("t1");
      expect(result.failedTasks).toContain("t2");
      expect(result.success).toBe(false);
    });
  });

  describe("Edge cases", () => {
    test("handles empty plan (no tasks)", async () => {
      const plan = makePlan({
        tasks: [],
        waves: [],
      });

      const orchestrator = createGsdOrchestrator(makeDeps(), makeConfig());
      const result = await orchestrator.execute(plan, makeSuccessDispatcher());

      expect(result.success).toBe(true);
      expect(result.completedTasks).toHaveLength(0);
      expect(result.wavesCompleted).toBe(0);
    });

    test("handles plan with single task in single wave", async () => {
      const plan = makePlan({
        tasks: [makeTask({ id: "solo" })],
        waves: [makeWave({ wave_number: 1, task_ids: ["solo"] })],
      });

      const orchestrator = createGsdOrchestrator(makeDeps(), makeConfig());
      const result = await orchestrator.execute(plan, makeSuccessDispatcher());

      expect(result.success).toBe(true);
      expect(result.completedTasks).toEqual(["solo"]);
    });

    test("handles 5 tasks in quick mode (upper bound)", async () => {
      const tasks = Array.from({ length: 5 }, (_, i) =>
        makeTask({ id: `t${i + 1}`, wave: (i % 2) + 1 }),
      );
      const wave1Ids = tasks.filter((t) => t.wave === 1).map((t) => t.id);
      const wave2Ids = tasks.filter((t) => t.wave === 2).map((t) => t.id);

      const plan = makePlan({
        mode: "quick",
        tasks,
        waves: [
          makeWave({ wave_number: 1, task_ids: wave1Ids, parallel: true }),
          makeWave({ wave_number: 2, task_ids: wave2Ids, parallel: true }),
        ],
      });

      const orchestrator = createGsdOrchestrator(makeDeps(), makeConfig());
      const result = await orchestrator.execute(plan, makeSuccessDispatcher());

      expect(result.success).toBe(true);
      expect(result.completedTasks).toHaveLength(5);
    });

    test("emitEvent failure does not crash execution", async () => {
      const deps = makeDeps({
        emitEvent: async () => {
          throw new Error("Event emission failed");
        },
      });

      const orchestrator = createGsdOrchestrator(deps, makeConfig());
      const result = await orchestrator.execute(makePlan(), makeSuccessDispatcher());

      // Should still complete despite event emission errors
      expect(result.success).toBe(true);
    });

    test("state manager save failure does not crash execution", async () => {
      const sm: StateManager = {
        save: async () => {
          throw new Error("Disk full");
        },
        load: async () => null,
      };

      const orchestrator = createGsdOrchestrator(makeDeps({ stateManager: sm }), makeConfig());
      const result = await orchestrator.execute(makePlan(), makeSuccessDispatcher());

      // Should still complete despite state save errors
      expect(result.success).toBe(true);
    });
  });

  describe("Wave execution timing", () => {
    test("tracks wave duration_ms", async () => {
      const orchestrator = createGsdOrchestrator(makeDeps(), makeConfig());
      const wave = makeWave({ wave_number: 1, task_ids: ["t1"] });
      const tasks = [makeTask({ id: "t1" })];

      const result = await orchestrator.executeWave(wave, tasks, makeSuccessDispatcher());

      expect(result.durationMs).toBeDefined();
      expect(typeof result.durationMs).toBe("number");
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });
  });

  describe("Full integration scenario", () => {
    test("3-wave plan with verification and state tracking", async () => {
      const sm = mockStateManager();
      const events: string[] = [];

      const deps = makeDeps({
        stateManager: sm,
        emitEvent: async (event) => {
          events.push((event as { type: string }).type);
        },
      });

      const tasks = [
        makeTask({ id: "t1", wave: 1, name: "Setup" }),
        makeTask({ id: "t2", wave: 1, name: "Config" }),
        makeTask({ id: "t3", wave: 2, name: "Implement" }),
        makeTask({ id: "t4", wave: 3, name: "Test" }),
      ];

      const plan = makePlan({
        tasks,
        waves: [
          makeWave({ wave_number: 1, task_ids: ["t1", "t2"], parallel: true }),
          makeWave({ wave_number: 2, task_ids: ["t3"] }),
          makeWave({ wave_number: 3, task_ids: ["t4"] }),
        ],
      });

      const orchestrator = createGsdOrchestrator(deps, makeConfig());
      const result = await orchestrator.execute(plan, makeSuccessDispatcher());

      expect(result.success).toBe(true);
      expect(result.completedTasks).toHaveLength(4);
      expect(result.wavesCompleted).toBe(3);

      // Should have wave events for each wave
      const waveStartEvents = events.filter((e) => e === "gsd_wave_started");
      expect(waveStartEvents).toHaveLength(3);

      const waveCompleteEvents = events.filter((e) => e === "gsd_wave_completed");
      expect(waveCompleteEvents).toHaveLength(3);

      // Final state should be completed
      const finalState = await sm.load();
      expect(finalState!.status).toBe("completed");
      expect(finalState!.completed_tasks).toHaveLength(4);
    });
  });
});
