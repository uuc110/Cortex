import { describe, expect, test } from "bun:test";

import {
  generateTaskId,
  generateEpicId,
  complexityToPriority,
  cellTreeToGsdTasks,
  calculateTaskWaves,
  gsdTasksToDispatcherTasks,
  generateCortexPlan,
  bridgeCellTreeToExecution,
  parsePlanToDispatcherTasks,
} from "../cortex-bridge.js";

import type { CellTree, SubtaskSpec } from "../../schemas/cell.js";
import type { GsdTask } from "../../gsd/gsd-types.js";

function sub(overrides: Partial<SubtaskSpec> & { title: string }): SubtaskSpec {
  return {
    description: "",
    files: [],
    dependencies: [],
    estimated_complexity: 2,
    ...overrides,
  };
}

function makeCellTree(overrides?: Partial<CellTree>): CellTree {
  return {
    epic: { title: "Test Epic", description: "A test epic" },
    subtasks: [
      {
        title: "Setup database schema",
        description: "Create tables",
        files: ["src/db/schema.ts"],
        dependencies: [],
        estimated_complexity: 2,
      },
      {
        title: "Implement API endpoints",
        description: "REST routes",
        files: ["src/api/routes.ts"],
        dependencies: [0],
        estimated_complexity: 3,
      },
      {
        title: "Write tests",
        description: "Unit tests",
        files: ["src/tests/api.test.ts"],
        dependencies: [1],
        estimated_complexity: 1,
      },
    ],
    ...overrides,
  };
}

function makeTask(overrides: Partial<GsdTask> & { id: string }): GsdTask {
  return {
    name: `Task ${overrides.id}`,
    status: "pending",
    wave: 1,
    priority: "medium",
    type: "auto",
    files: [],
    action: `Action for ${overrides.id}`,
    ...overrides,
  };
}

// ─── generateTaskId ──────────────────────────────────────────────

describe("generateTaskId()", () => {
  test("generates deterministic IDs with ctx- prefix", () => {
    const id = generateTaskId("My Epic", 0);
    expect(id).toBe("ctx-my-epic-0");
  });

  test("sanitizes special characters", () => {
    const id = generateTaskId("Add user auth!!", 3);
    expect(id).toBe("ctx-add-user-auth-3");
  });

  test("truncates long titles to 20 chars", () => {
    const id = generateTaskId("This is a very long epic title that should be truncated", 1);
    expect(id.startsWith("ctx-")).toBe(true);
    const middle = id.slice(4, id.lastIndexOf("-"));
    expect(middle.length).toBeLessThanOrEqual(20);
  });

  test("different indices produce different IDs", () => {
    const id0 = generateTaskId("Epic", 0);
    const id1 = generateTaskId("Epic", 1);
    expect(id0).not.toBe(id1);
  });
});

// ─── generateEpicId ──────────────────────────────────────────────

describe("generateEpicId()", () => {
  test("generates epic IDs with epic-ctx- prefix", () => {
    const id = generateEpicId("My Epic");
    expect(id).toBe("epic-ctx-my-epic");
  });

  test("truncates to 30 chars", () => {
    const id = generateEpicId("This is a very very long epic title that needs truncation for sure");
    const body = id.replace("epic-ctx-", "");
    expect(body.length).toBeLessThanOrEqual(30);
  });
});

// ─── complexityToPriority ────────────────────────────────────────

describe("complexityToPriority()", () => {
  test("complexity 5 → critical", () => {
    expect(complexityToPriority(5)).toBe("critical");
  });

  test("complexity 4 → high", () => {
    expect(complexityToPriority(4)).toBe("high");
  });

  test("complexity 3 → medium", () => {
    expect(complexityToPriority(3)).toBe("medium");
  });

  test("complexity 2 → medium", () => {
    expect(complexityToPriority(2)).toBe("medium");
  });

  test("complexity 1 → low", () => {
    expect(complexityToPriority(1)).toBe("low");
  });
});

// ─── cellTreeToGsdTasks ──────────────────────────────────────────

describe("cellTreeToGsdTasks()", () => {
  test("converts index-based deps to ID-based deps", () => {
    const cellTree = makeCellTree();
    const tasks = cellTreeToGsdTasks(cellTree);

    expect(tasks).toHaveLength(3);
    expect(tasks[0].dependencies).toEqual([]);
    expect(tasks[1].dependencies).toEqual([tasks[0].id]);
    expect(tasks[2].dependencies).toEqual([tasks[1].id]);
  });

  test("maps complexity to priority", () => {
    const cellTree = makeCellTree();
    const tasks = cellTreeToGsdTasks(cellTree);

    expect(tasks[0].priority).toBe("medium");
    expect(tasks[1].priority).toBe("medium");
    expect(tasks[2].priority).toBe("low");
  });

  test("preserves file assignments", () => {
    const cellTree = makeCellTree();
    const tasks = cellTreeToGsdTasks(cellTree);

    expect(tasks[0].files).toEqual(["src/db/schema.ts"]);
    expect(tasks[1].files).toEqual(["src/api/routes.ts"]);
    expect(tasks[2].files).toEqual(["src/tests/api.test.ts"]);
  });

  test("sets all tasks to pending status", () => {
    const tasks = cellTreeToGsdTasks(makeCellTree());
    for (const task of tasks) {
      expect(task.status).toBe("pending");
    }
  });

  test("sets type to auto", () => {
    const tasks = cellTreeToGsdTasks(makeCellTree());
    for (const task of tasks) {
      expect(task.type).toBe("auto");
    }
  });

  test("uses description as action, falls back to title", () => {
    const cellTree = makeCellTree({
      subtasks: [
        { title: "Do thing", description: "", files: [], dependencies: [], estimated_complexity: 1 },
        { title: "Other", description: "Detailed action", files: [], dependencies: [], estimated_complexity: 1 },
      ],
    });
    const tasks = cellTreeToGsdTasks(cellTree);

    expect(tasks[0].action).toBe("Do thing");
    expect(tasks[1].action).toBe("Detailed action");
  });

  test("filters out self-referencing deps", () => {
    const cellTree = makeCellTree({
      subtasks: [
        sub({ title: "A", dependencies: [0], estimated_complexity: 1 }),
      ],
    });
    const tasks = cellTreeToGsdTasks(cellTree);
    expect(tasks[0].dependencies).toEqual([]);
  });

  test("filters out out-of-bounds deps", () => {
    const cellTree = makeCellTree({
      subtasks: [
        sub({ title: "A", dependencies: [99], estimated_complexity: 1 }),
      ],
    });
    const tasks = cellTreeToGsdTasks(cellTree);
    expect(tasks[0].dependencies).toEqual([]);
  });

  test("allows epicTitle override", () => {
    const cellTree = makeCellTree();
    const tasks = cellTreeToGsdTasks(cellTree, { epicTitle: "Custom Name" });

    expect(tasks[0].id).toContain("custom-name");
  });

  test("handles parallel subtasks (no deps)", () => {
    const cellTree = makeCellTree({
      subtasks: [
        sub({ title: "A", files: ["a.ts"] }),
        sub({ title: "B", files: ["b.ts"] }),
        sub({ title: "C", files: ["c.ts"] }),
      ],
    });
    const tasks = cellTreeToGsdTasks(cellTree);

    for (const task of tasks) {
      expect(task.dependencies).toEqual([]);
    }
  });
});

// ─── calculateTaskWaves ──────────────────────────────────────────

describe("calculateTaskWaves()", () => {
  test("assigns correct wave numbers for linear chain", () => {
    const cellTree = makeCellTree();
    const rawTasks = cellTreeToGsdTasks(cellTree);
    const { tasks, result } = calculateTaskWaves(rawTasks);

    expect(result.sequentialWaves).toBe(3);
    expect(tasks[0].wave).toBe(1);
    expect(tasks[1].wave).toBe(2);
    expect(tasks[2].wave).toBe(3);
  });

  test("groups independent tasks in same wave", () => {
    const t0 = makeTask({ id: "a", files: ["a.ts"] });
    const t1 = makeTask({ id: "b", files: ["b.ts"] });
    const t2 = makeTask({ id: "c", files: ["c.ts"], dependencies: ["a", "b"] });

    const { tasks, result } = calculateTaskWaves([t0, t1, t2]);

    expect(result.sequentialWaves).toBe(2);
    expect(tasks[0].wave).toBe(1);
    expect(tasks[1].wave).toBe(1);
    expect(tasks[2].wave).toBe(2);
  });

  test("returns maxParallelism", () => {
    const t0 = makeTask({ id: "a" });
    const t1 = makeTask({ id: "b" });
    const t2 = makeTask({ id: "c" });

    const { result } = calculateTaskWaves([t0, t1, t2]);
    expect(result.maxParallelism).toBe(3);
  });

  test("handles single task", () => {
    const t0 = makeTask({ id: "solo" });
    const { result } = calculateTaskWaves([t0]);

    expect(result.sequentialWaves).toBe(1);
    expect(result.totalTasks).toBe(1);
  });

  test("throws on circular dependencies", () => {
    const t0 = makeTask({ id: "a", dependencies: ["b"] });
    const t1 = makeTask({ id: "b", dependencies: ["a"] });

    expect(() => calculateTaskWaves([t0, t1])).toThrow();
  });
});

// ─── gsdTasksToDispatcherTasks ───────────────────────────────────

describe("gsdTasksToDispatcherTasks()", () => {
  test("maps GsdTask fields to TaskWithDeps", () => {
    const gsdTask: GsdTask = {
      id: "ctx-test-0",
      name: "Test task",
      status: "pending",
      wave: 1,
      priority: "high",
      type: "auto",
      files: ["src/a.ts"],
      action: "Do thing",
      dependencies: ["ctx-test-1"],
    };

    const [dispatched] = gsdTasksToDispatcherTasks([gsdTask]);

    expect(dispatched.id).toBe("ctx-test-0");
    expect(dispatched.name).toBe("Test task");
    expect(dispatched.files).toEqual(["src/a.ts"]);
    expect(dispatched.dependencies).toEqual(["ctx-test-1"]);
    expect(dispatched.status).toBe("pending");
    expect(dispatched.priority).toBe("high");
    expect(dispatched.type).toBe("auto");
  });

  test("defaults empty deps when undefined", () => {
    const gsdTask: GsdTask = {
      id: "t",
      name: "T",
      status: "pending",
      wave: 1,
      priority: "medium",
      type: "auto",
      files: [],
      action: "act",
    };

    const [dispatched] = gsdTasksToDispatcherTasks([gsdTask]);
    expect(dispatched.dependencies).toEqual([]);
  });
});

// ─── generateCortexPlan ──────────────────────────────────────────

describe("generateCortexPlan()", () => {
  test("generates valid PLAN.md with frontmatter", () => {
    const tasks = cellTreeToGsdTasks(makeCellTree());
    const { tasks: wavedTasks } = calculateTaskWaves(tasks);

    const planMd = generateCortexPlan(wavedTasks, {
      epicTitle: "Test Epic",
      mode: "quick",
    });

    expect(planMd).toContain("---");
    expect(planMd).toContain('title: "Test Epic"');
    expect(planMd).toContain('mode: "quick"');
    expect(planMd).toContain("<tasks>");
    expect(planMd).toContain("</tasks>");
  });

  test("includes must_haves when provided", () => {
    const tasks = cellTreeToGsdTasks(makeCellTree());
    const { tasks: wavedTasks } = calculateTaskWaves(tasks);

    const planMd = generateCortexPlan(wavedTasks, {
      epicTitle: "Test",
      mustHaves: {
        truths: ["API returns JSON"],
        artifacts: [{ path: "src/api.ts", check: "exists" }],
        key_links: [{ from: "src/api.ts", to: "src/db.ts", type: "calls" }],
      },
    });

    expect(planMd).toContain("<must_haves>");
    expect(planMd).toContain("API returns JSON");
    expect(planMd).toContain("src/api.ts");
  });

  test("includes research_context when provided", () => {
    const tasks = cellTreeToGsdTasks(makeCellTree());
    const { tasks: wavedTasks } = calculateTaskWaves(tasks);

    const planMd = generateCortexPlan(wavedTasks, {
      epicTitle: "Test",
      researchContext: "Found that lib X is best",
    });

    expect(planMd).toContain("<research_context>");
    expect(planMd).toContain("Found that lib X is best");
  });
});

// ─── bridgeCellTreeToExecution (full pipeline) ───────────────────

describe("bridgeCellTreeToExecution()", () => {
  test("produces all expected outputs", () => {
    const cellTree = makeCellTree();

    const result = bridgeCellTreeToExecution(cellTree, {
      epicTitle: "Test Epic",
      mode: "quick",
    });

    expect(result.tasks).toHaveLength(3);
    expect(result.dispatcherTasks).toHaveLength(3);
    expect(result.totalWaves).toBe(3);
    expect(result.maxParallelism).toBe(1);
    expect(result.epicId).toContain("epic-ctx-");
    expect(result.planMarkdown).toContain("---");
    expect(result.waveResult.waves).toHaveLength(3);
  });

  test("wave assignments match between tasks and waveResult", () => {
    const cellTree = makeCellTree();
    const result = bridgeCellTreeToExecution(cellTree, {
      epicTitle: "Test Epic",
    });

    for (const wave of result.waveResult.waves) {
      for (const taskId of wave.task_ids) {
        const task = result.tasks.find((t) => t.id === taskId);
        expect(task).toBeDefined();
        expect(task!.wave).toBe(wave.wave_number);
      }
    }
  });

  test("dispatcher tasks have correct dependencies", () => {
    const cellTree = makeCellTree();
    const result = bridgeCellTreeToExecution(cellTree, {
      epicTitle: "Test Epic",
    });

    const [first, second, third] = result.dispatcherTasks;
    expect(first.dependencies).toEqual([]);
    expect(second.dependencies).toEqual([first.id]);
    expect(third.dependencies).toEqual([second.id]);
  });

  test("handles all-parallel subtasks", () => {
    const cellTree = makeCellTree({
      subtasks: [
        sub({ title: "A", files: ["a.ts"], estimated_complexity: 1 }),
        sub({ title: "B", files: ["b.ts"] }),
        sub({ title: "C", files: ["c.ts"], estimated_complexity: 3 }),
      ],
    });

    const result = bridgeCellTreeToExecution(cellTree, {
      epicTitle: "Parallel",
    });

    expect(result.totalWaves).toBe(1);
    expect(result.maxParallelism).toBe(3);
  });

  test("handles diamond dependency pattern", () => {
    const cellTree = makeCellTree({
      subtasks: [
        sub({ title: "Root", files: ["root.ts"], estimated_complexity: 1 }),
        sub({ title: "Left", files: ["left.ts"], dependencies: [0] }),
        sub({ title: "Right", files: ["right.ts"], dependencies: [0] }),
        sub({ title: "Merge", files: ["merge.ts"], dependencies: [1, 2], estimated_complexity: 3 }),
      ],
    });

    const result = bridgeCellTreeToExecution(cellTree, {
      epicTitle: "Diamond",
    });

    expect(result.totalWaves).toBe(3);
    expect(result.maxParallelism).toBe(2);
  });
});

// ─── parsePlanToDispatcherTasks (round-trip) ─────────────────────

describe("parsePlanToDispatcherTasks()", () => {
  test("round-trips through PLAN.md generation and parsing", () => {
    const cellTree = makeCellTree();
    const bridgeResult = bridgeCellTreeToExecution(cellTree, {
      epicTitle: "Round Trip",
      mode: "quick",
    });

    const roundTripped = parsePlanToDispatcherTasks(bridgeResult.planMarkdown);

    expect(roundTripped).toHaveLength(3);
    expect(roundTripped[0].name).toBe("Setup database schema");
    expect(roundTripped[1].name).toBe("Implement API endpoints");
    expect(roundTripped[2].name).toBe("Write tests");
  });

  test("preserves file assignments through round-trip", () => {
    const cellTree = makeCellTree();
    const bridgeResult = bridgeCellTreeToExecution(cellTree, {
      epicTitle: "Files RT",
      mode: "quick",
    });

    const roundTripped = parsePlanToDispatcherTasks(bridgeResult.planMarkdown);

    expect(roundTripped[0].files).toEqual(["src/db/schema.ts"]);
    expect(roundTripped[1].files).toEqual(["src/api/routes.ts"]);
    expect(roundTripped[2].files).toEqual(["src/tests/api.test.ts"]);
  });
});
