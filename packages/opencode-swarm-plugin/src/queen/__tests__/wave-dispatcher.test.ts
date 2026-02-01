// @ts-nocheck
import { beforeEach, describe, expect, mock, test } from "bun:test";

import { createWaveDispatcher } from "../wave-dispatcher.js";

import type { WaveDispatcherConfig } from "../wave-dispatcher.js";
import type {
  TaskWithDeps,
  WaveDispatcher,
  WaveDispatcherDeps,
  WaveResult,
} from "../wave-dispatcher.js";

const buildTasks = (count: number): TaskWithDeps[] =>
  Array.from({ length: count }, (_unused, index) => ({
    id: `task-${index + 1}`,
    name: `Task ${index + 1}`,
    files: [`src/file-${index + 1}.ts`],
    dependencies: [],
  }));

const baseConfig: WaveDispatcherConfig = {
  projectKey: "proj",
  projectPath: "/tmp/proj",
  epicBeadId: "epic-1",
  planningDir: "/tmp/planning",
};

const buildWaveResult = (tasks: TaskWithDeps[]) => ({
  waves: [{ number: 1, tasks }],
  totalTasks: tasks.length,
  maxParallelism: tasks.length,
  sequentialWaves: tasks.length ? 1 : 0,
});

const buildDeps = (overrides: Partial<WaveDispatcherDeps> = {}) => {
  const calculateWaves = mock((tasks: TaskWithDeps[]) => buildWaveResult(tasks));
  const saveState = mock(async () => undefined);
  const loadState = mock(async () => null);
  const spawnWorker = mock(async () => ({ status: "completed" as const }));
  const verifyWave = mock(async () => ({ passed: true, errors: [] as string[] }));
  const createFixBead = mock(async (_title: string) => "fix-bead");
  const eventEmit = mock((_type: string, _data: any) => undefined);

  return {
    calculateWaves,
    saveState,
    loadState,
    spawnWorker,
    verifyWave,
    createFixBead,
    eventEmit,
    ...overrides,
  } as WaveDispatcherDeps & {
    calculateWaves: ReturnType<typeof mock>;
    saveState: ReturnType<typeof mock>;
    loadState: ReturnType<typeof mock>;
    spawnWorker: ReturnType<typeof mock>;
    verifyWave: ReturnType<typeof mock>;
    createFixBead: ReturnType<typeof mock>;
    eventEmit: ReturnType<typeof mock>;
  };
};

const createDeferred = () => {
  let resolve: (value: { status: "completed" }) => void = () => undefined;
  const promise = new Promise<{ status: "completed" }>((res) => {
    resolve = res;
  });
  return { promise, resolve };
};

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe("Wave dispatcher", () => {
  let deps: ReturnType<typeof buildDeps>;
  let buildDispatcher: (config?: WaveDispatcherConfig) => WaveDispatcher;

  beforeEach(() => {
    deps = buildDeps();
    buildDispatcher = (config: WaveDispatcherConfig = baseConfig) =>
      createWaveDispatcher(config, deps) as WaveDispatcher;
  });

  test("executeEpic with 1 wave and 2 tasks completes", () => {
    const dispatcher = buildDispatcher();
    const tasks = buildTasks(2);

    return dispatcher.executeEpic(tasks).then((result) => {
      expect(result.success).toBe(true);
      expect(result.wavesCompleted).toBe(1);
      expect(result.totalWaves).toBe(1);
      expect(result.allResults[0]?.tasksCompleted.length).toBe(2);
    });
  });

  test("executeEpic processes wave 1 before wave 2", async () => {
    const wave1 = buildTasks(2);
    const wave2 = [{ ...buildTasks(1)[0], id: "task-3" }];
    deps.calculateWaves.mockImplementation(() => ({
      waves: [
        { number: 1, tasks: wave1 },
        { number: 2, tasks: wave2 },
      ],
      totalTasks: 3,
      maxParallelism: 2,
      sequentialWaves: 2,
    }));

    const seen: string[] = [];
    deps.spawnWorker.mockImplementation(async (beadId: string) => {
      seen.push(beadId);
      return { status: "completed" };
    });

    const dispatcher = buildDispatcher();
    return dispatcher.executeEpic([...wave1, ...wave2]).then(() => {
      expect(seen.indexOf("task-1")).toBeLessThan(seen.indexOf("task-3"));
      expect(seen.indexOf("task-2")).toBeLessThan(seen.indexOf("task-3"));
    });
  });

  test("executeEpic handles 3 waves", () => {
    const tasks = buildTasks(3);
    deps.calculateWaves.mockImplementation(() => ({
      waves: [
        { number: 1, tasks: [tasks[0]!] },
        { number: 2, tasks: [tasks[1]!] },
        { number: 3, tasks: [tasks[2]!] },
      ],
      totalTasks: 3,
      maxParallelism: 1,
      sequentialWaves: 3,
    }));

    const dispatcher = buildDispatcher();
    return dispatcher.executeEpic(tasks).then((result) => {
      expect(result.wavesCompleted).toBe(3);
      expect(result.totalWaves).toBe(3);
    });
  });

  test("executeWave chunks by parallelWorkersPerWave", () => {
    const dispatcher = buildDispatcher({
      ...baseConfig,
      parallelWorkersPerWave: 2,
    });
    const tasks = buildTasks(4);
    const deferredA = createDeferred();
    const deferredB = createDeferred();
    let callCount = 0;

    deps.spawnWorker.mockImplementation(async () => {
      callCount += 1;
      if (callCount === 1) return deferredA.promise;
      if (callCount === 2) return deferredB.promise;
      return { status: "completed" };
    });

    const resultPromise: Promise<WaveResult> = dispatcher.executeWave({
      number: 1,
      tasks,
    });
    return tick()
      .then(() => {
        expect(callCount).toBe(2);
        deferredA.resolve({ status: "completed" });
        deferredB.resolve({ status: "completed" });
        return resultPromise;
      })
      .then((result) => {
        expect(callCount).toBe(4);
        expect(result.tasksCompleted.length).toBe(4);
      });
  });

  test("all tasks fail marks wave failed", () => {
    deps.spawnWorker.mockImplementation(async () => ({ status: "failed" }));
    const dispatcher = buildDispatcher();
    return dispatcher.executeEpic(buildTasks(2)).then((result) => {
      expect(result.success).toBe(false);
      expect(result.allResults[0]?.tasksFailed.length).toBe(2);
    });
  });

  test("executeWave categorizes mixed results", () => {
    const dispatcher = buildDispatcher();
    const tasks = buildTasks(3);
    deps.spawnWorker.mockImplementation(async (beadId: string) => {
      if (beadId === "task-1") return { status: "completed" };
      if (beadId === "task-2") return { status: "failed" };
      return { status: "blocked" };
    });

    return dispatcher.executeWave({ number: 1, tasks }).then((result) => {
      expect(result.tasksCompleted).toEqual(["task-1"]);
      expect(result.tasksFailed).toEqual(["task-2"]);
      expect(result.tasksBlocked).toEqual(["task-3"]);
    });
  });

  test("executeEpic with empty task list returns success", () => {
    const dispatcher = buildDispatcher();
    return dispatcher.executeEpic([]).then((result) => {
      expect(result.success).toBe(true);
      expect(result.totalWaves).toBe(0);
    });
  });

  test("worker rejection counts as failure", () => {
    const dispatcher = buildDispatcher();
    const tasks = buildTasks(2);
    deps.spawnWorker.mockImplementation(async (beadId: string) => {
      if (beadId === "task-2") throw new Error("boom");
      return { status: "completed" };
    });

    return dispatcher.executeWave({ number: 1, tasks }).then((result) => {
      expect(result.tasksFailed).toEqual(["task-2"]);
    });
  });

  test("parallelWorkersPerWave greater than task count works", () => {
    const dispatcher = buildDispatcher({
      ...baseConfig,
      parallelWorkersPerWave: 10,
    });
    const tasks = buildTasks(2);

    return dispatcher.executeWave({ number: 1, tasks }).then((result) => {
      expect(result.tasksCompleted.length).toBe(2);
    });
  });

  test("verification runs when enabled", () => {
    const dispatcher = buildDispatcher();
    const tasks = buildTasks(1);

    return dispatcher.executeWave({ number: 1, tasks }).then(() => {
      expect(deps.verifyWave.mock.calls.length).toBe(1);
      const [firstCall] = deps.verifyWave.mock.calls;
      expect(firstCall?.[0]).toEqual(["src/file-1.ts"]);
    });
  });

  test("verification failure triggers fix tasks", () => {
    const dispatcher = buildDispatcher();
    const tasks = buildTasks(1);

    deps.verifyWave.mockImplementationOnce(async () => ({
      passed: false,
      errors: ["fail"],
    }));
    deps.verifyWave.mockImplementation(async () => ({
      passed: true,
      errors: [],
    }));

    return dispatcher.executeEpic(tasks).then((result) => {
      expect(result.success).toBe(true);
      expect(deps.createFixBead.mock.calls.length).toBe(1);
    });
  });

  test("fix wave executes and succeeds", () => {
    deps.verifyWave.mockImplementationOnce(async () => ({
      passed: false,
      errors: ["fail"],
    }));
    deps.verifyWave.mockImplementation(async () => ({
      passed: true,
      errors: [],
    }));

    const dispatcher = buildDispatcher();
    return dispatcher.executeEpic(buildTasks(1)).then((result) => {
      expect(result.success).toBe(true);
      expect(result.wavesCompleted).toBe(1);
    });
  });

  test("max fix iterations aborts", () => {
    deps.verifyWave.mockImplementation(async () => ({
      passed: false,
      errors: ["nope"],
    }));

    const dispatcher = buildDispatcher({
      ...baseConfig,
      maxFixIterations: 2,
    });
    return dispatcher.executeEpic(buildTasks(1)).then((result) => {
      expect(result.success).toBe(false);
      expect(deps.createFixBead.mock.calls.length).toBe(2);
    });
  });

  test("fix wave succeeds on second attempt", () => {
    let fixCall = 0;
    deps.spawnWorker.mockImplementation(async (beadId: string) => {
      if (beadId === "task-1") return { status: "failed" };
      if (beadId.startsWith("fix")) {
        fixCall += 1;
        return { status: fixCall === 1 ? "failed" : "completed" };
      }
      return { status: "completed" };
    });

    deps.createFixBead.mockImplementation(async () => `fix-${fixCall + 1}`);

    const dispatcher = buildDispatcher({
      ...baseConfig,
      maxFixIterations: 2,
    });
    return dispatcher.executeEpic(buildTasks(1)).then((result) => {
      expect(result.success).toBe(true);
      expect(deps.createFixBead.mock.calls.length).toBe(2);
    });
  });

  test("fix bead uses epicBeadId as parent", () => {
    deps.verifyWave.mockImplementationOnce(async () => ({
      passed: false,
      errors: ["fail"],
    }));
    deps.verifyWave.mockImplementation(async () => ({
      passed: true,
      errors: [],
    }));

    const dispatcher = buildDispatcher();
    return dispatcher.executeEpic(buildTasks(1)).then(() => {
      const [firstCall] = deps.createFixBead.mock.calls;
      expect(firstCall?.[2]).toBe(baseConfig.epicBeadId);
    });
  });

  test("state is saved after each wave", () => {
    const tasks = buildTasks(2);
    deps.calculateWaves.mockImplementation(() => ({
      waves: [
        { number: 1, tasks: [tasks[0]!] },
        { number: 2, tasks: [tasks[1]!] },
      ],
      totalTasks: 2,
      maxParallelism: 1,
      sequentialWaves: 2,
    }));

    const dispatcher = buildDispatcher();
    return dispatcher.executeEpic(tasks).then(() => {
      expect(deps.saveState.mock.calls.length).toBe(4);
    });
  });

  test("resume loads state", () => {
    deps.loadState.mockImplementation(async () => ({
      plan_id: "epic",
      status: "in_progress",
      mode: "project",
      current_wave: 1,
      completed_tasks: [],
      failed_tasks: [],
      verification_results: [],
      started_at: new Date().toISOString(),
      last_updated: new Date().toISOString(),
      tasks: buildTasks(1),
    }));

    const dispatcher = buildDispatcher();
    return dispatcher.resume("/tmp/state").then(() => {
      expect(deps.loadState.mock.calls.length).toBe(1);
    });
  });

  test("resume skips completed tasks", () => {
    const tasks = buildTasks(2);
    deps.loadState.mockImplementation(async () => ({
      plan_id: "epic",
      status: "in_progress",
      mode: "project",
      current_wave: 2,
      completed_tasks: ["task-1"],
      failed_tasks: [],
      verification_results: [],
      started_at: new Date().toISOString(),
      last_updated: new Date().toISOString(),
      tasks,
    }));

    const dispatcher = buildDispatcher();
    return dispatcher.resume("/tmp/state").then(() => {
      expect(deps.spawnWorker.mock.calls.length).toBe(1);
      expect(deps.spawnWorker.mock.calls[0]?.[0]).toBe("task-2");
    });
  });

  test("resume dispatches pending tasks", () => {
    const tasks = buildTasks(3);
    deps.loadState.mockImplementation(async () => ({
      plan_id: "epic",
      status: "in_progress",
      mode: "project",
      current_wave: 2,
      completed_tasks: ["task-1", "task-2"],
      failed_tasks: [],
      verification_results: [],
      started_at: new Date().toISOString(),
      last_updated: new Date().toISOString(),
      tasks,
    }));

    const dispatcher = buildDispatcher();
    return dispatcher.resume("/tmp/state").then(() => {
      const calledIds = deps.spawnWorker.mock.calls.map((call) => call[0]);
      expect(calledIds).toEqual(["task-3"]);
    });
  });

  test("resume with null state throws", () => {
    deps.loadState.mockImplementation(async () => null);
    const dispatcher = buildDispatcher();

    return expect(dispatcher.resume("/tmp/state")).rejects.toThrow("No state found");
  });

  test("state tracks wave number", () => {
    const tasks = buildTasks(2);
    deps.calculateWaves.mockImplementation(() => ({
      waves: [
        { number: 1, tasks: [tasks[0]!] },
        { number: 2, tasks: [tasks[1]!] },
      ],
      totalTasks: 2,
      maxParallelism: 1,
      sequentialWaves: 2,
    }));

    const dispatcher = buildDispatcher();
    return dispatcher.executeEpic(tasks).then(() => {
      const calls = deps.saveState.mock.calls;
      const lastCall = calls[calls.length - 2];
      const stateArg = lastCall ? lastCall[0] : undefined;
      expect(stateArg?.current_wave).toBe(2);
    });
  });

  test("progress uses wavesCompleted and totalWaves", () => {
    const tasks = buildTasks(1);
    const dispatcher = buildDispatcher();

    return dispatcher.executeEpic(tasks).then((result) => {
      expect(result.wavesCompleted / result.totalWaves).toBe(1);
    });
  });

  test("gsd_wave_started emitted at wave start", () => {
    const dispatcher = buildDispatcher();
    return dispatcher.executeEpic(buildTasks(1)).then(() => {
      const [firstCall] = deps.eventEmit.mock.calls;
      expect(firstCall?.[0]).toBe("gsd_wave_started");
    });
  });

  test("gsd_wave_completed emitted on success", () => {
    const dispatcher = buildDispatcher();
    return dispatcher.executeEpic(buildTasks(1)).then(() => {
      const types = deps.eventEmit.mock.calls.map((call) => call[0]);
      expect(types).toContain("gsd_wave_completed");
    });
  });

  test("gsd_wave_failed emitted on failure", () => {
    deps.spawnWorker.mockImplementation(async () => ({ status: "failed" }));
    const dispatcher = buildDispatcher();
    return dispatcher.executeEpic(buildTasks(1)).then(() => {
      const types = deps.eventEmit.mock.calls.map((call) => call[0]);
      expect(types).toContain("gsd_wave_failed");
    });
  });

  test("events include epic id and wave number", () => {
    const dispatcher = buildDispatcher();
    return dispatcher.executeEpic(buildTasks(1)).then(() => {
      const startedEvent = deps.eventEmit.mock.calls.find(
        (call) => call[0] === "gsd_wave_started",
      )?.[1];
      expect(startedEvent?.epic_id).toBe(baseConfig.epicBeadId);
      expect(startedEvent?.wave_number).toBe(1);
    });
  });

  test("events emitted in order", () => {
    const dispatcher = buildDispatcher();
    return dispatcher.executeEpic(buildTasks(1)).then(() => {
      const types = deps.eventEmit.mock.calls.map((call) => call[0]);
      expect(types.indexOf("gsd_wave_started")).toBeLessThan(
        types.indexOf("gsd_wave_completed"),
      );
    });
  });

  test("single-task wave works", () => {
    const dispatcher = buildDispatcher();
    return dispatcher
      .executeWave({ number: 1, tasks: buildTasks(1) })
      .then((result) => {
        expect(result.tasksCompleted).toEqual(["task-1"]);
      });
  });

  test("parallelWorkersPerWave=1 executes sequentially", () => {
    const dispatcher = buildDispatcher({
      ...baseConfig,
      parallelWorkersPerWave: 1,
    });
    const tasks = buildTasks(2);
    const firstDeferred = createDeferred();
    let callCount = 0;
    deps.spawnWorker.mockImplementation(async () => {
      callCount += 1;
      if (callCount === 1) return firstDeferred.promise;
      return { status: "completed" };
    });

    const resultPromise: Promise<WaveResult> = dispatcher.executeWave({
      number: 1,
      tasks,
    });
    return tick()
      .then(() => {
        expect(callCount).toBe(1);
        firstDeferred.resolve({ status: "completed" });
        return resultPromise;
      })
      .then(() => {
        expect(callCount).toBe(2);
      });
  });

  test("verifyAfterEachWave=false skips verification", () => {
    const dispatcher = buildDispatcher({
      ...baseConfig,
      verifyAfterEachWave: false,
    });

    return dispatcher
      .executeWave({ number: 1, tasks: buildTasks(1) })
      .then(() => {
        expect(deps.verifyWave.mock.calls.length).toBe(0);
      });
  });

  test("verifyAfterEachWave=false skips fix loop", () => {
    deps.spawnWorker.mockImplementation(async () => ({ status: "failed" }));
    const dispatcher = buildDispatcher({
      ...baseConfig,
      verifyAfterEachWave: false,
    });

    return dispatcher.executeEpic(buildTasks(1)).then((result) => {
      expect(result.success).toBe(false);
      expect(deps.createFixBead.mock.calls.length).toBe(0);
    });
  });
});
