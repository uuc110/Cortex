// @ts-nocheck
import { describe, expect, test } from "bun:test";

import { createCortexCoordinator } from "../cortex-coordinator.js";

import type {
  CortexCoordinator,
  CortexCoordinatorConfig,
  CortexCoordinatorDeps,
  ResearchResult,
} from "../cortex-coordinator.js";
import type { GsdState } from "../../gsd/gsd-types.js";

type SpyFn<T extends (...args: any[]) => any> =
  & ((...args: Parameters<T>) => ReturnType<T>)
  & { calls: Parameters<T>[] };

function spy<T extends (...args: any[]) => any>(fn: T): SpyFn<T> {
  const calls: Parameters<T>[] = [];
  const wrapped = (...args: Parameters<T>) => {
    calls.push(args);
    return fn(...args);
  };
  const spyFn = wrapped as SpyFn<T>;
  spyFn.calls = calls;
  return spyFn;
}

type MockDeps = CortexCoordinatorDeps & {
  decompose: SpyFn<CortexCoordinatorDeps["decompose"]>;
  spawnWorker: SpyFn<CortexCoordinatorDeps["spawnWorker"]>;
  verifyWave: SpyFn<CortexCoordinatorDeps["verifyWave"]>;
  createFixBead: SpyFn<CortexCoordinatorDeps["createFixBead"]>;
  saveState: SpyFn<CortexCoordinatorDeps["saveState"]>;
  loadState: SpyFn<CortexCoordinatorDeps["loadState"]>;
  writePlan: SpyFn<CortexCoordinatorDeps["writePlan"]>;
  eventEmit: SpyFn<CortexCoordinatorDeps["eventEmit"]>;
  research?: SpyFn<NonNullable<CortexCoordinatorDeps["research"]>>;
};

const baseConfig: CortexCoordinatorConfig = {
  projectKey: "proj",
  projectPath: "/tmp/proj",
  planningDir: "/tmp/planning",
  epicBeadId: "epic-1",
};

function buildCoordinator(
  deps: CortexCoordinatorDeps,
  config: CortexCoordinatorConfig = baseConfig,
): CortexCoordinator {
  return createCortexCoordinator(config, deps);
}

function makeMockDeps(overrides: Partial<CortexCoordinatorDeps> = {}): MockDeps {
  const decompose = spy(async (task: string, _context?: string) => ({
    epic: { title: task, description: `Decomposed: ${task}` },
    subtasks: [
      {
        title: "Task 1",
        description: "First task",
        files: ["src/a.ts"],
        dependencies: [],
        estimated_complexity: 2,
      },
      {
        title: "Task 2",
        description: "Second task",
        files: ["src/b.ts"],
        dependencies: [0],
        estimated_complexity: 3,
      },
    ],
  }));
  const spawnWorker = spy(async (_beadId: string, _files: string[]) => ({
    status: "completed" as const,
  }));
  const verifyWave = spy(async (_files: string[]) => ({
    passed: true,
    errors: [] as string[],
  }));
  const createFixBead = spy(
    async (title: string, _description: string, _parentId: string) => `fix-${title}`,
  );
  const saveState = spy(async (_state: GsdState, _path: string) => undefined);
  const loadState = spy(async (_path: string) => null);
  const writePlan = spy(async (_planMarkdown: string, _planningDir: string) => undefined);
  const eventEmit = spy((_type: string, _data: any) => undefined);

  const base: MockDeps = {
    decompose,
    spawnWorker,
    verifyWave,
    createFixBead,
    saveState,
    loadState,
    writePlan,
    eventEmit,
  };

  if (overrides.research) {
    base.research = overrides.research as MockDeps["research"];
  }

  return { ...base, ...overrides } as MockDeps;
}

describe("Cortex coordinator", () => {
  test("createCortexCoordinator returns object with execute method", () => {
    const coordinator = buildCoordinator(makeMockDeps());
    expect(typeof coordinator.execute).toBe("function");
  });

  test("execute() calls decompose with task string", () => {
    const deps = makeMockDeps();
    const coordinator = buildCoordinator(deps);

    return coordinator.execute("Do the thing").then(() => {
      expect(deps.decompose.calls[0]?.[0]).toBe("Do the thing");
    });
  });

  test("execute() bridges CellTree to execution plan", () => {
    const deps = makeMockDeps();
    const coordinator = buildCoordinator(deps);

    return coordinator.execute("Bridge me").then((result) => {
      expect(result.bridgeResult.dispatcherTasks.length).toBe(2);
      expect(result.bridgeResult.epicId.startsWith("epic-ctx-")).toBe(true);
    });
  });

  test("execute() writes PLAN.md via deps.writePlan", () => {
    const deps = makeMockDeps();
    const coordinator = buildCoordinator(deps);

    return coordinator.execute("Write plan").then(() => {
      expect(deps.writePlan.calls.length).toBe(1);
      expect(deps.writePlan.calls[0]?.[1]).toBe(baseConfig.planningDir);
    });
  });

  test("execute() creates wave-dispatcher and executes epic", () => {
    const deps = makeMockDeps();
    const coordinator = buildCoordinator(deps);

    return coordinator.execute("Dispatch wave").then(() => {
      expect(deps.spawnWorker.calls.length).toBeGreaterThan(0);
    });
  });

  test("execute() returns success when all waves pass", () => {
    const deps = makeMockDeps();
    const coordinator = buildCoordinator(deps);

    return coordinator.execute("All good").then((result) => {
      expect(result.success).toBe(true);
    });
  });

  test("execute() returns failure when wave execution fails", () => {
    const deps = makeMockDeps({
      spawnWorker: spy(async (_beadId: string, _files: string[]) => ({
        status: "failed" as const,
      })),
    });
    const coordinator = buildCoordinator(deps);

    return coordinator.execute("Failing run").then((result) => {
      expect(result.success).toBe(false);
    });
  });

  test("execute() auto-detects mode when config.mode omitted", () => {
    const deps = makeMockDeps();
    const coordinator = buildCoordinator(deps);

    return coordinator.execute("Quick mode").then((result) => {
      expect(result.mode).toBe("quick");
    });
  });

  test("execute() uses explicit mode when config.mode provided", () => {
    const deps = makeMockDeps();
    const coordinator = buildCoordinator(deps, { ...baseConfig, mode: "project" });

    return coordinator.execute("Override mode").then((result) => {
      expect(result.mode).toBe("project");
    });
  });

  test("execute() skips research when deps.research not provided", () => {
    const deps = makeMockDeps();
    const coordinator = buildCoordinator(deps);

    return coordinator.execute("No research").then(() => {
      expect(deps.decompose.calls[0]?.[1]).toBeUndefined();
    });
  });

  test("execute() runs research when deps.research provided", () => {
    const research = spy(async (): Promise<ResearchResult> => ({
      findings: "Findings",
      rounds: [{ round: 1, queries: ["a"], findings: ["b"] }],
      toolsUsed: ["web"],
    }));
    const deps = makeMockDeps({ research });
    const coordinator = buildCoordinator(deps);

    return coordinator.execute("Research task").then(() => {
      expect(research.calls.length).toBe(1);
    });
  });

  test("execute() passes research findings as research_context to bridge", () => {
    const research = spy(async (): Promise<ResearchResult> => ({
      findings: "Research insights",
      rounds: [],
      toolsUsed: [],
    }));
    const deps = makeMockDeps({ research });
    const coordinator = buildCoordinator(deps);

    return coordinator.execute("Bridge research").then(() => {
      const planContent = deps.writePlan.calls[0]?.[0] ?? "";
      expect(planContent.includes("<research_context>")).toBe(true);
      expect(planContent.includes("Research insights")).toBe(true);
    });
  });

  test("execute() passes research findings to decompose as context", () => {
    const research = spy(async (): Promise<ResearchResult> => ({
      findings: "Use this context",
      rounds: [],
      toolsUsed: [],
    }));
    const deps = makeMockDeps({ research });
    const coordinator = buildCoordinator(deps);

    return coordinator.execute("Decompose with context").then(() => {
      expect(deps.decompose.calls[0]?.[1]).toBe("Use this context");
    });
  });

  test("execute() emits events via deps.eventEmit", () => {
    const deps = makeMockDeps();
    const coordinator = buildCoordinator(deps);

    return coordinator.execute("Emit events").then(() => {
      const types = deps.eventEmit.calls.map((call) => call[0]);
      expect(types).toContain("cortex_execution_started");
      expect(types).toContain("cortex_execution_completed");
    });
  });

  test("execute() saves state via deps.saveState", () => {
    const deps = makeMockDeps();
    const coordinator = buildCoordinator(deps);

    return coordinator.execute("Save state").then(() => {
      expect(deps.saveState.calls.length).toBeGreaterThan(0);
    });
  });

  test("execute() handles decompose failure gracefully", () => {
    const deps = makeMockDeps({
      decompose: spy(async () => {
        throw new Error("boom");
      }),
    });
    const coordinator = buildCoordinator(deps);

    return coordinator.execute("Explode").then(
      () => {
        throw new Error("Expected decompose failure");
      },
      (error) => {
        const message = error instanceof Error ? error.message : String(error);
        expect(message).toContain("Cortex coordinator failed to decompose task");
        const types = deps.eventEmit.calls.map((call) => call[0]);
        expect(types).toContain("cortex_decompose_failed");
      },
    );
  });

  test("execute() with single task uses quick mode", () => {
    const deps = makeMockDeps({
      decompose: spy(async (task: string) => ({
        epic: { title: task, description: task },
        subtasks: [
          {
            title: "Only task",
            description: "Solo",
            files: ["src/solo.ts"],
            dependencies: [],
            estimated_complexity: 2,
          },
        ],
      })),
    });
    const coordinator = buildCoordinator(deps);

    return coordinator.execute("Single task").then((result) => {
      expect(result.mode).toBe("quick");
    });
  });
});
