import { describe, test, expect, beforeEach } from "bun:test";

import type { GsdTask, GsdWave, GsdPlan, GsdState, VerificationResult } from "./gsd-types.js";
import type { StateManager } from "./state-manager.js";
import type { TaskDispatcher } from "./gsd-orchestrator.js";
import {
  createGsdIntegration,
  DEFAULT_GSD_CONFIG,
  type GsdIntegration,
  type GsdIntegrationConfig,
  type EventStoreAdapter,
} from "./gsd-integration.js";

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

function makeSuccessDispatcher(): TaskDispatcher {
  return async (task: GsdTask) => ({
    taskId: task.id,
    success: true,
    filesModified: task.files,
  });
}

function mockEventStore(): EventStoreAdapter & { events: unknown[] } {
  const events: unknown[] = [];
  return {
    events,
    append: async (event: unknown) => {
      events.push(event);
    },
  };
}

function mockStateManager(): StateManager {
  let storedState: GsdState | null = null;
  return {
    save: async (state: GsdState) => {
      storedState = state;
    },
    load: async () => storedState,
  };
}

describe("createGsdIntegration", () => {
  describe("factory pattern", () => {
    test("returns a GsdIntegration object", () => {
      const integration = createGsdIntegration({
        projectKey: "/test/project",
        eventStore: mockEventStore(),
        stateManager: mockStateManager(),
      });

      expect(integration).toBeDefined();
      expect(typeof integration.initGsd).toBe("function");
      expect(typeof integration.getOrchestrator).toBe("function");
      expect(typeof integration.getConfig).toBe("function");
    });

    test("uses default config when none provided", () => {
      const integration = createGsdIntegration({
        projectKey: "/test/project",
        eventStore: mockEventStore(),
        stateManager: mockStateManager(),
      });

      const config = integration.getConfig();
      expect(config.maxFixIterations).toBe(DEFAULT_GSD_CONFIG.maxFixIterations);
      expect(config.waveTimeoutMs).toBe(DEFAULT_GSD_CONFIG.waveTimeoutMs);
    });

    test("merges custom config with defaults", () => {
      const integration = createGsdIntegration({
        projectKey: "/test/project",
        eventStore: mockEventStore(),
        stateManager: mockStateManager(),
        maxFixIterations: 5,
      });

      const config = integration.getConfig();
      expect(config.maxFixIterations).toBe(5);
      expect(config.waveTimeoutMs).toBe(DEFAULT_GSD_CONFIG.waveTimeoutMs);
    });
  });

  describe("initGsd", () => {
    test("returns an initialized orchestrator with sub-modules", () => {
      const integration = createGsdIntegration({
        projectKey: "/test/project",
        eventStore: mockEventStore(),
        stateManager: mockStateManager(),
      });

      const result = integration.initGsd();

      expect(result.orchestrator).toBeDefined();
      expect(typeof result.orchestrator.execute).toBe("function");
      expect(typeof result.orchestrator.executeWave).toBe("function");
      expect(typeof result.orchestrator.resume).toBe("function");
      expect(typeof result.orchestrator.getStatus).toBe("function");
      expect(result.planGenerator).toBeDefined();
      expect(result.waveCalculator).toBeDefined();
      expect(result.verificationEngine).toBeDefined();
    });

    test("returns the same orchestrator on repeated calls", () => {
      const integration = createGsdIntegration({
        projectKey: "/test/project",
        eventStore: mockEventStore(),
        stateManager: mockStateManager(),
      });

      const first = integration.initGsd();
      const second = integration.initGsd();

      expect(first.orchestrator).toBe(second.orchestrator);
    });
  });

  describe("getOrchestrator", () => {
    test("returns orchestrator after initGsd", () => {
      const integration = createGsdIntegration({
        projectKey: "/test/project",
        eventStore: mockEventStore(),
        stateManager: mockStateManager(),
      });

      integration.initGsd();
      const orchestrator = integration.getOrchestrator();

      expect(orchestrator).toBeDefined();
      expect(typeof orchestrator!.execute).toBe("function");
    });

    test("returns null before initGsd is called", () => {
      const integration = createGsdIntegration({
        projectKey: "/test/project",
        eventStore: mockEventStore(),
        stateManager: mockStateManager(),
      });

      expect(integration.getOrchestrator()).toBeNull();
    });
  });

  describe("event store wiring", () => {
    test("GSD events flow into event store during execution", async () => {
      const store = mockEventStore();
      const integration = createGsdIntegration({
        projectKey: "/test/project",
        eventStore: store,
        stateManager: mockStateManager(),
      });

      const { orchestrator } = integration.initGsd();
      const plan = makePlan();
      await orchestrator.execute(plan, makeSuccessDispatcher());

      expect(store.events.length).toBeGreaterThan(0);

      const eventTypes = store.events.map(
        (e) => (e as { type: string }).type,
      );
      expect(eventTypes).toContain("gsd_wave_started");
      expect(eventTypes).toContain("gsd_wave_completed");
      expect(eventTypes).toContain("gsd_task_executed");
      expect(eventTypes).toContain("gsd_verification_passed");
    });

    test("emits state_updated events", async () => {
      const store = mockEventStore();
      const integration = createGsdIntegration({
        projectKey: "/test/project",
        eventStore: store,
        stateManager: mockStateManager(),
      });

      const { orchestrator } = integration.initGsd();
      await orchestrator.execute(makePlan(), makeSuccessDispatcher());

      const stateEvents = store.events.filter(
        (e) => (e as { type: string }).type === "gsd_state_updated",
      );
      expect(stateEvents.length).toBeGreaterThan(0);
    });

    test("events include project_key", async () => {
      const store = mockEventStore();
      const integration = createGsdIntegration({
        projectKey: "/my/project",
        eventStore: store,
        stateManager: mockStateManager(),
      });

      const { orchestrator } = integration.initGsd();
      await orchestrator.execute(makePlan(), makeSuccessDispatcher());

      for (const event of store.events) {
        expect((event as { project_key: string }).project_key).toBe(
          "/my/project",
        );
      }
    });

    test("events include timestamps", async () => {
      const store = mockEventStore();
      const integration = createGsdIntegration({
        projectKey: "/test/project",
        eventStore: store,
        stateManager: mockStateManager(),
      });

      const { orchestrator } = integration.initGsd();
      await orchestrator.execute(makePlan(), makeSuccessDispatcher());

      for (const event of store.events) {
        const ts = (event as { timestamp: number }).timestamp;
        expect(typeof ts).toBe("number");
        expect(ts).toBeGreaterThan(0);
      }
    });
  });

  describe("multi-wave execution through integration", () => {
    test("executes 3-wave plan with event tracking", async () => {
      const store = mockEventStore();
      const sm = mockStateManager();
      const integration = createGsdIntegration({
        projectKey: "/test/project",
        eventStore: store,
        stateManager: sm,
      });

      const tasks = [
        makeTask({ id: "t1", wave: 1, name: "Setup" }),
        makeTask({ id: "t2", wave: 1, name: "Config" }),
        makeTask({ id: "t3", wave: 2, name: "Build" }),
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

      const { orchestrator } = integration.initGsd();
      const result = await orchestrator.execute(plan, makeSuccessDispatcher());

      expect(result.success).toBe(true);
      expect(result.completedTasks).toHaveLength(4);
      expect(result.wavesCompleted).toBe(3);

      const waveStarted = store.events.filter(
        (e) => (e as { type: string }).type === "gsd_wave_started",
      );
      expect(waveStarted).toHaveLength(3);

      const waveCompleted = store.events.filter(
        (e) => (e as { type: string }).type === "gsd_wave_completed",
      );
      expect(waveCompleted).toHaveLength(3);
    });

    test("handles partial failure and reports via events", async () => {
      const store = mockEventStore();
      const integration = createGsdIntegration({
        projectKey: "/test/project",
        eventStore: store,
        stateManager: mockStateManager(),
      });

      const tasks = [
        makeTask({ id: "ok-task", wave: 1 }),
        makeTask({ id: "bad-task", wave: 1 }),
      ];

      const plan = makePlan({
        tasks,
        waves: [
          makeWave({
            wave_number: 1,
            task_ids: ["ok-task", "bad-task"],
            parallel: true,
          }),
        ],
      });

      const dispatcher: TaskDispatcher = async (task) => ({
        taskId: task.id,
        success: task.id !== "bad-task",
        filesModified: task.files,
        error: task.id === "bad-task" ? "Intentional failure" : undefined,
      });

      const { orchestrator } = integration.initGsd();
      const result = await orchestrator.execute(plan, dispatcher);

      expect(result.completedTasks).toContain("ok-task");
      expect(result.failedTasks).toContain("bad-task");

      const waveFailed = store.events.filter(
        (e) => (e as { type: string }).type === "gsd_wave_failed",
      );
      expect(waveFailed.length).toBeGreaterThan(0);
    });
  });

  describe("sub-module access", () => {
    test("plan generator can generate and parse plans", () => {
      const integration = createGsdIntegration({
        projectKey: "/test/project",
        eventStore: mockEventStore(),
        stateManager: mockStateManager(),
      });

      const { planGenerator } = integration.initGsd();

      const tasks = [makeTask({ id: "t1" })];
      const markdown = planGenerator.generate(tasks, {
        id: "plan-1",
        title: "Test",
        phase: "1",
        mode: "quick",
        type: "execute",
        bead_id: "bd-1",
        epic_id: "ep-1",
        worker_id: "w-1",
      });

      expect(markdown).toContain("plan-1");
      expect(markdown).toContain("Test");

      const parsed = planGenerator.parse(markdown);
      expect(parsed.id).toBe("plan-1");
      expect(parsed.tasks).toHaveLength(1);
    });

    test("wave calculator computes waves from tasks", () => {
      const integration = createGsdIntegration({
        projectKey: "/test/project",
        eventStore: mockEventStore(),
        stateManager: mockStateManager(),
      });

      const { waveCalculator } = integration.initGsd();

      const tasks = [
        makeTask({ id: "a", wave: 1 }),
        makeTask({ id: "b", wave: 1, dependencies: [] }),
        makeTask({ id: "c", wave: 2, dependencies: ["a", "b"] }),
      ];

      const result = waveCalculator.calculateWaves(tasks);
      expect(result.waves.length).toBeGreaterThanOrEqual(1);
      expect(result.totalTasks).toBe(3);
    });

    test("verification engine can run verification", () => {
      const integration = createGsdIntegration({
        projectKey: "/test/project",
        eventStore: mockEventStore(),
        stateManager: mockStateManager(),
      });

      const { verificationEngine } = integration.initGsd();

      const plan = makePlan();
      const result = verificationEngine.verify(plan, {
        completed_task_ids: ["task-1"],
        failed_task_ids: [],
      });

      expect(result.status).toBeDefined();
    });
  });

  describe("event store adapter resilience", () => {
    test("execution continues when event store throws", async () => {
      const failingStore: EventStoreAdapter = {
        append: async () => {
          throw new Error("Event store unavailable");
        },
      };

      const integration = createGsdIntegration({
        projectKey: "/test/project",
        eventStore: failingStore,
        stateManager: mockStateManager(),
      });

      const { orchestrator } = integration.initGsd();
      const result = await orchestrator.execute(
        makePlan(),
        makeSuccessDispatcher(),
      );

      expect(result.success).toBe(true);
    });
  });

  describe("config validation", () => {
    test("DEFAULT_GSD_CONFIG has sensible defaults", () => {
      expect(DEFAULT_GSD_CONFIG.maxFixIterations).toBe(3);
      expect(DEFAULT_GSD_CONFIG.waveTimeoutMs).toBe(1800000);
    });

    test("custom waveTimeoutMs is applied", () => {
      const integration = createGsdIntegration({
        projectKey: "/test/project",
        eventStore: mockEventStore(),
        stateManager: mockStateManager(),
        waveTimeoutMs: 60000,
      });

      const config = integration.getConfig();
      expect(config.waveTimeoutMs).toBe(60000);
    });
  });

  describe("state manager injection", () => {
    test("uses injected state manager for persistence", async () => {
      const sm = mockStateManager();
      const integration = createGsdIntegration({
        projectKey: "/test/project",
        eventStore: mockEventStore(),
        stateManager: sm,
      });

      const { orchestrator } = integration.initGsd();
      await orchestrator.execute(makePlan(), makeSuccessDispatcher());

      const state = await sm.load();
      expect(state).not.toBeNull();
      expect(state!.status).toBe("completed");
    });

    test("resume works through integration layer", async () => {
      const sm = mockStateManager();
      const integration = createGsdIntegration({
        projectKey: "/test/project",
        eventStore: mockEventStore(),
        stateManager: sm,
      });

      const tasks = [
        makeTask({ id: "t1", wave: 1 }),
        makeTask({ id: "t2", wave: 2 }),
      ];
      const plan = makePlan({
        id: "plan-resume",
        tasks,
        waves: [
          makeWave({ wave_number: 1, task_ids: ["t1"] }),
          makeWave({ wave_number: 2, task_ids: ["t2"] }),
        ],
      });

      const { orchestrator } = integration.initGsd();

      const firstResult = await orchestrator.execute(plan, makeSuccessDispatcher());
      expect(firstResult.success).toBe(true);

      const resumeResult = await orchestrator.resume(plan, makeSuccessDispatcher());
      expect(resumeResult.success).toBe(true);
    });
  });
});
