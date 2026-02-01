/**
 * Tests for wave-calculator.ts — Topological sort → parallel execution waves.
 *
 * TDD RED phase: Tests define the contract BEFORE implementation.
 * Cross-references:
 *   - Algorithm spec: .planning/fork-plan/details/wave-calculator-algorithm.md
 *   - GSD types: packages/opencode-swarm-plugin/src/gsd/gsd-types.ts
 *   - Integration spec: .planning/fork-plan/02-INTEGRATION-SWARM-GSD.md
 */
import { describe, expect, test } from "bun:test";

import {
  createWaveCalculator,
  type CycleInfo,
  type DependencyValidation,
  type FileConflict,
  type WaveCalculatorResult,
} from "../wave-calculator.js";

import type { GsdTask, GsdWave } from "../gsd-types.js";

// ============================================================================
// Test helpers
// ============================================================================

/** Create a minimal valid GsdTask for testing */
function makeTask(
  overrides: Partial<GsdTask> & { id: string },
): GsdTask {
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

// ============================================================================
// createWaveCalculator() factory
// ============================================================================
describe("createWaveCalculator()", () => {
  test("returns an object with calculateWaves, detectCycles, getExecutionOrder, validateDependencies", () => {
    const calculator = createWaveCalculator();
    expect(typeof calculator.calculateWaves).toBe("function");
    expect(typeof calculator.detectCycles).toBe("function");
    expect(typeof calculator.getExecutionOrder).toBe("function");
    expect(typeof calculator.validateDependencies).toBe("function");
  });
});

// ============================================================================
// calculateWaves() — core algorithm (Kahn's topological sort by depth)
// ============================================================================
describe("calculateWaves()", () => {
  const { calculateWaves } = createWaveCalculator();

  // ---------- Empty / trivial inputs ----------
  describe("empty and trivial inputs", () => {
    test("returns empty result for empty task list", () => {
      const result = calculateWaves([]);
      expect(result.waves).toEqual([]);
      expect(result.totalTasks).toBe(0);
      expect(result.maxParallelism).toBe(0);
      expect(result.sequentialWaves).toBe(0);
    });

    test("single task with no dependencies → single wave", () => {
      const tasks = [makeTask({ id: "A" })];
      const result = calculateWaves(tasks);

      expect(result.waves).toHaveLength(1);
      expect(result.waves[0].wave_number).toBe(1);
      expect(result.waves[0].task_ids).toEqual(["A"]);
      expect(result.waves[0].status).toBe("pending");
      expect(result.waves[0].parallel).toBe(false); // single task → not parallel
      expect(result.totalTasks).toBe(1);
      expect(result.maxParallelism).toBe(1);
      expect(result.sequentialWaves).toBe(1);
    });
  });

  // ---------- All independent tasks → single wave ----------
  describe("all independent tasks", () => {
    test("all tasks with no dependencies → single wave with all tasks", () => {
      const tasks = [
        makeTask({ id: "A" }),
        makeTask({ id: "B" }),
        makeTask({ id: "C" }),
        makeTask({ id: "D" }),
      ];
      const result = calculateWaves(tasks);

      expect(result.waves).toHaveLength(1);
      expect(result.waves[0].wave_number).toBe(1);
      expect(result.waves[0].task_ids).toHaveLength(4);
      expect(result.waves[0].task_ids).toContain("A");
      expect(result.waves[0].task_ids).toContain("B");
      expect(result.waves[0].task_ids).toContain("C");
      expect(result.waves[0].task_ids).toContain("D");
      expect(result.waves[0].parallel).toBe(true); // multiple tasks → parallel
      expect(result.totalTasks).toBe(4);
      expect(result.maxParallelism).toBe(4);
      expect(result.sequentialWaves).toBe(1);
    });
  });

  // ---------- Linear chain → N waves ----------
  describe("linear dependency chain", () => {
    test("A → B → C → D → E creates 5 sequential waves", () => {
      const tasks = [
        makeTask({ id: "A" }),
        makeTask({ id: "B", dependencies: ["A"] }),
        makeTask({ id: "C", dependencies: ["B"] }),
        makeTask({ id: "D", dependencies: ["C"] }),
        makeTask({ id: "E", dependencies: ["D"] }),
      ];
      const result = calculateWaves(tasks);

      expect(result.waves).toHaveLength(5);
      expect(result.waves[0].task_ids).toEqual(["A"]);
      expect(result.waves[1].task_ids).toEqual(["B"]);
      expect(result.waves[2].task_ids).toEqual(["C"]);
      expect(result.waves[3].task_ids).toEqual(["D"]);
      expect(result.waves[4].task_ids).toEqual(["E"]);
      expect(result.maxParallelism).toBe(1);
      expect(result.sequentialWaves).toBe(5);
    });
  });

  // ---------- Diamond dependencies ----------
  describe("diamond dependency pattern", () => {
    test("diamond: A → {B,C} → D creates 3 waves", () => {
      // A has no deps, B and C depend on A, D depends on B and C
      const tasks = [
        makeTask({ id: "A" }),
        makeTask({ id: "B", dependencies: ["A"] }),
        makeTask({ id: "C", dependencies: ["A"] }),
        makeTask({ id: "D", dependencies: ["B", "C"] }),
      ];
      const result = calculateWaves(tasks);

      expect(result.waves).toHaveLength(3);
      expect(result.waves[0].task_ids).toEqual(["A"]);
      expect(result.waves[1].task_ids).toHaveLength(2);
      expect(result.waves[1].task_ids).toContain("B");
      expect(result.waves[1].task_ids).toContain("C");
      expect(result.waves[2].task_ids).toEqual(["D"]);
      expect(result.maxParallelism).toBe(2);
      expect(result.sequentialWaves).toBe(3);
    });
  });

  // ---------- Spec example (wave-calculator-algorithm.md) ----------
  describe("spec example from algorithm doc", () => {
    test("A,B (roots) → C(A), D(A,B) → E(C,D)", () => {
      const tasks = [
        makeTask({ id: "A", name: "CSS variables" }),
        makeTask({ id: "B", name: "Theme types" }),
        makeTask({ id: "C", name: "Theme provider", dependencies: ["A"] }),
        makeTask({ id: "D", name: "Toggle component", dependencies: ["A", "B"] }),
        makeTask({ id: "E", name: "Integration tests", dependencies: ["C", "D"] }),
      ];
      const result = calculateWaves(tasks);

      expect(result.waves).toHaveLength(3);

      // Wave 1: A, B (no deps)
      expect(result.waves[0].wave_number).toBe(1);
      expect(result.waves[0].task_ids).toHaveLength(2);
      expect(result.waves[0].task_ids).toContain("A");
      expect(result.waves[0].task_ids).toContain("B");
      expect(result.waves[0].parallel).toBe(true);

      // Wave 2: C, D (both unblocked after wave 1)
      expect(result.waves[1].wave_number).toBe(2);
      expect(result.waves[1].task_ids).toHaveLength(2);
      expect(result.waves[1].task_ids).toContain("C");
      expect(result.waves[1].task_ids).toContain("D");
      expect(result.waves[1].parallel).toBe(true);

      // Wave 3: E (depends on C and D)
      expect(result.waves[2].wave_number).toBe(3);
      expect(result.waves[2].task_ids).toEqual(["E"]);
      expect(result.waves[2].parallel).toBe(false);

      expect(result.totalTasks).toBe(5);
      expect(result.maxParallelism).toBe(2);
      expect(result.sequentialWaves).toBe(3);
    });
  });

  // ---------- Disconnected subgraphs ----------
  describe("disconnected subgraphs", () => {
    test("two independent chains are parallelized in shared waves", () => {
      // Chain 1: A → B
      // Chain 2: X → Y
      const tasks = [
        makeTask({ id: "A" }),
        makeTask({ id: "B", dependencies: ["A"] }),
        makeTask({ id: "X" }),
        makeTask({ id: "Y", dependencies: ["X"] }),
      ];
      const result = calculateWaves(tasks);

      expect(result.waves).toHaveLength(2);
      // Wave 1: A, X (both roots)
      expect(result.waves[0].task_ids).toHaveLength(2);
      expect(result.waves[0].task_ids).toContain("A");
      expect(result.waves[0].task_ids).toContain("X");
      // Wave 2: B, Y (both unblocked)
      expect(result.waves[1].task_ids).toHaveLength(2);
      expect(result.waves[1].task_ids).toContain("B");
      expect(result.waves[1].task_ids).toContain("Y");
      expect(result.maxParallelism).toBe(2);
    });
  });

  // ---------- GsdWave shape conformance ----------
  describe("output GsdWave shape", () => {
    test("each wave conforms to GsdWave interface", () => {
      const tasks = [
        makeTask({ id: "A" }),
        makeTask({ id: "B", dependencies: ["A"] }),
      ];
      const result = calculateWaves(tasks);

      for (const wave of result.waves) {
        expect(typeof wave.wave_number).toBe("number");
        expect(wave.wave_number).toBeGreaterThanOrEqual(1);
        expect(Array.isArray(wave.task_ids)).toBe(true);
        expect(typeof wave.status).toBe("string");
        expect(typeof wave.parallel).toBe("boolean");
      }
    });
  });

  // ---------- Priority ordering within waves ----------
  describe("priority ordering within waves", () => {
    test("tasks within a wave are ordered by priority (critical first)", () => {
      const tasks = [
        makeTask({ id: "A", priority: "low" }),
        makeTask({ id: "B", priority: "critical" }),
        makeTask({ id: "C", priority: "high" }),
        makeTask({ id: "D", priority: "medium" }),
      ];
      const result = calculateWaves(tasks);

      expect(result.waves).toHaveLength(1);
      const ids = result.waves[0].task_ids;
      // critical(B) → high(C) → medium(D) → low(A)
      expect(ids[0]).toBe("B");
      expect(ids[1]).toBe("C");
      expect(ids[2]).toBe("D");
      expect(ids[3]).toBe("A");
    });
  });

  // ---------- Tasks with undefined dependencies treated as no deps ----------
  describe("undefined dependencies", () => {
    test("tasks with undefined dependencies are treated as having no deps", () => {
      const tasks = [
        makeTask({ id: "A", dependencies: undefined }),
        makeTask({ id: "B" }), // no dependencies field at all
      ];
      const result = calculateWaves(tasks);

      expect(result.waves).toHaveLength(1);
      expect(result.waves[0].task_ids).toHaveLength(2);
    });
  });

  // ---------- Complex graph ----------
  describe("complex dependency graph", () => {
    test("wide graph with varying dependency depths", () => {
      //     A   B   C
      //     |   | / |
      //     D   E   F
      //      \ / \
      //       G   H
      const tasks = [
        makeTask({ id: "A" }),
        makeTask({ id: "B" }),
        makeTask({ id: "C" }),
        makeTask({ id: "D", dependencies: ["A"] }),
        makeTask({ id: "E", dependencies: ["B", "C"] }),
        makeTask({ id: "F", dependencies: ["C"] }),
        makeTask({ id: "G", dependencies: ["D", "E"] }),
        makeTask({ id: "H", dependencies: ["E"] }),
      ];
      const result = calculateWaves(tasks);

      expect(result.waves).toHaveLength(3);
      // Wave 1: A, B, C (roots)
      expect(result.waves[0].task_ids).toHaveLength(3);
      // Wave 2: D, E, F (all deps from wave 1)
      expect(result.waves[1].task_ids).toHaveLength(3);
      // Wave 3: G, H (deps from wave 2)
      expect(result.waves[2].task_ids).toHaveLength(2);
    });
  });
});

// ============================================================================
// detectCycles() — circular dependency detection
// ============================================================================
describe("detectCycles()", () => {
  const { detectCycles } = createWaveCalculator();

  test("returns empty array for acyclic graph", () => {
    const tasks = [
      makeTask({ id: "A" }),
      makeTask({ id: "B", dependencies: ["A"] }),
      makeTask({ id: "C", dependencies: ["B"] }),
    ];
    const cycles = detectCycles(tasks);
    expect(cycles).toEqual([]);
  });

  test("detects simple A ↔ B cycle", () => {
    const tasks = [
      makeTask({ id: "A", dependencies: ["B"] }),
      makeTask({ id: "B", dependencies: ["A"] }),
    ];
    const cycles = detectCycles(tasks);
    expect(cycles.length).toBeGreaterThan(0);
    // The cycle should involve both A and B
    const allInvolvedIds = cycles.flatMap((c) => c.path);
    expect(allInvolvedIds).toContain("A");
    expect(allInvolvedIds).toContain("B");
  });

  test("detects self-dependency cycle", () => {
    const tasks = [makeTask({ id: "A", dependencies: ["A"] })];
    const cycles = detectCycles(tasks);
    expect(cycles.length).toBeGreaterThan(0);
    const allInvolvedIds = cycles.flatMap((c) => c.path);
    expect(allInvolvedIds).toContain("A");
  });

  test("detects 3-node cycle: A → B → C → A", () => {
    const tasks = [
      makeTask({ id: "A", dependencies: ["C"] }),
      makeTask({ id: "B", dependencies: ["A"] }),
      makeTask({ id: "C", dependencies: ["B"] }),
    ];
    const cycles = detectCycles(tasks);
    expect(cycles.length).toBeGreaterThan(0);
    const allInvolvedIds = cycles.flatMap((c) => c.path);
    expect(allInvolvedIds).toContain("A");
    expect(allInvolvedIds).toContain("B");
    expect(allInvolvedIds).toContain("C");
  });

  test("detects cycle in partially cyclic graph", () => {
    // A → B (acyclic), C ↔ D (cyclic)
    const tasks = [
      makeTask({ id: "A" }),
      makeTask({ id: "B", dependencies: ["A"] }),
      makeTask({ id: "C", dependencies: ["D"] }),
      makeTask({ id: "D", dependencies: ["C"] }),
    ];
    const cycles = detectCycles(tasks);
    expect(cycles.length).toBeGreaterThan(0);
    const allInvolvedIds = cycles.flatMap((c) => c.path);
    expect(allInvolvedIds).toContain("C");
    expect(allInvolvedIds).toContain("D");
    // A and B should NOT be in cycles
    expect(allInvolvedIds).not.toContain("A");
    expect(allInvolvedIds).not.toContain("B");
  });

  test("CycleInfo has path array of task ids", () => {
    const tasks = [
      makeTask({ id: "X", dependencies: ["Y"] }),
      makeTask({ id: "Y", dependencies: ["X"] }),
    ];
    const cycles = detectCycles(tasks);
    expect(cycles.length).toBeGreaterThan(0);
    for (const cycle of cycles) {
      expect(Array.isArray(cycle.path)).toBe(true);
      expect(cycle.path.length).toBeGreaterThanOrEqual(2);
    }
  });

  test("returns empty for empty task list", () => {
    expect(detectCycles([])).toEqual([]);
  });
});

// ============================================================================
// getExecutionOrder() — flatten waves to ordered task list
// ============================================================================
describe("getExecutionOrder()", () => {
  const { calculateWaves, getExecutionOrder } = createWaveCalculator();

  test("returns empty array for empty waves", () => {
    const result = getExecutionOrder([]);
    expect(result).toEqual([]);
  });

  test("returns tasks in wave order", () => {
    const tasks = [
      makeTask({ id: "A" }),
      makeTask({ id: "B", dependencies: ["A"] }),
      makeTask({ id: "C", dependencies: ["B"] }),
    ];
    const { waves } = calculateWaves(tasks);
    const ordered = getExecutionOrder(waves);

    expect(ordered).toHaveLength(3);
    // A before B, B before C
    const idxA = ordered.findIndex((t) => t === "A");
    const idxB = ordered.findIndex((t) => t === "B");
    const idxC = ordered.findIndex((t) => t === "C");
    expect(idxA).toBeLessThan(idxB);
    expect(idxB).toBeLessThan(idxC);
  });

  test("all tasks from all waves are included", () => {
    const tasks = [
      makeTask({ id: "A" }),
      makeTask({ id: "B" }),
      makeTask({ id: "C", dependencies: ["A"] }),
    ];
    const { waves } = calculateWaves(tasks);
    const ordered = getExecutionOrder(waves);

    expect(ordered).toHaveLength(3);
    expect(ordered).toContain("A");
    expect(ordered).toContain("B");
    expect(ordered).toContain("C");
  });

  test("tasks from earlier waves come before tasks from later waves", () => {
    const tasks = [
      makeTask({ id: "root1" }),
      makeTask({ id: "root2" }),
      makeTask({ id: "child", dependencies: ["root1", "root2"] }),
    ];
    const { waves } = calculateWaves(tasks);
    const ordered = getExecutionOrder(waves);

    const childIdx = ordered.indexOf("child");
    const root1Idx = ordered.indexOf("root1");
    const root2Idx = ordered.indexOf("root2");
    expect(root1Idx).toBeLessThan(childIdx);
    expect(root2Idx).toBeLessThan(childIdx);
  });
});

// ============================================================================
// validateDependencies() — dependency validation
// ============================================================================
describe("validateDependencies()", () => {
  const { validateDependencies } = createWaveCalculator();

  test("returns valid for acyclic graph with all deps existing", () => {
    const tasks = [
      makeTask({ id: "A" }),
      makeTask({ id: "B", dependencies: ["A"] }),
    ];
    const validation = validateDependencies(tasks);
    expect(validation.valid).toBe(true);
    expect(validation.missingDependencies).toEqual([]);
    expect(validation.selfReferences).toEqual([]);
    expect(validation.cycles).toEqual([]);
  });

  test("detects missing dependencies", () => {
    const tasks = [
      makeTask({ id: "A", dependencies: ["NONEXISTENT"] }),
    ];
    const validation = validateDependencies(tasks);
    expect(validation.valid).toBe(false);
    expect(validation.missingDependencies).toHaveLength(1);
    expect(validation.missingDependencies[0].taskId).toBe("A");
    expect(validation.missingDependencies[0].missingDepId).toBe("NONEXISTENT");
  });

  test("detects self-references", () => {
    const tasks = [makeTask({ id: "A", dependencies: ["A"] })];
    const validation = validateDependencies(tasks);
    expect(validation.valid).toBe(false);
    expect(validation.selfReferences).toHaveLength(1);
    expect(validation.selfReferences[0]).toBe("A");
  });

  test("detects cycles", () => {
    const tasks = [
      makeTask({ id: "A", dependencies: ["B"] }),
      makeTask({ id: "B", dependencies: ["A"] }),
    ];
    const validation = validateDependencies(tasks);
    expect(validation.valid).toBe(false);
    expect(validation.cycles.length).toBeGreaterThan(0);
  });

  test("detects multiple issues simultaneously", () => {
    const tasks = [
      makeTask({ id: "A", dependencies: ["A", "MISSING"] }), // self-ref + missing
      makeTask({ id: "B", dependencies: ["C"] }),             // cycle
      makeTask({ id: "C", dependencies: ["B"] }),             // cycle
    ];
    const validation = validateDependencies(tasks);
    expect(validation.valid).toBe(false);
    expect(validation.selfReferences.length).toBeGreaterThanOrEqual(1);
    expect(validation.missingDependencies.length).toBeGreaterThanOrEqual(1);
    expect(validation.cycles.length).toBeGreaterThan(0);
  });

  test("returns valid for empty task list", () => {
    const validation = validateDependencies([]);
    expect(validation.valid).toBe(true);
    expect(validation.missingDependencies).toEqual([]);
    expect(validation.selfReferences).toEqual([]);
    expect(validation.cycles).toEqual([]);
  });

  test("handles tasks with undefined dependencies", () => {
    const tasks = [
      makeTask({ id: "A", dependencies: undefined }),
      makeTask({ id: "B" }),
    ];
    const validation = validateDependencies(tasks);
    expect(validation.valid).toBe(true);
  });
});

// ============================================================================
// calculateWaves() — error handling for invalid graphs
// ============================================================================
describe("calculateWaves() error handling", () => {
  const { calculateWaves } = createWaveCalculator();

  test("throws on circular dependency", () => {
    const tasks = [
      makeTask({ id: "A", dependencies: ["B"] }),
      makeTask({ id: "B", dependencies: ["A"] }),
    ];
    expect(() => calculateWaves(tasks)).toThrow(/[Cc]ircular/);
  });

  test("throws on self-dependency", () => {
    const tasks = [makeTask({ id: "A", dependencies: ["A"] })];
    expect(() => calculateWaves(tasks)).toThrow(/[Cc]ircular/);
  });

  test("throws on missing dependency reference", () => {
    const tasks = [
      makeTask({ id: "A", dependencies: ["NONEXISTENT"] }),
    ];
    expect(() => calculateWaves(tasks)).toThrow(/[Mm]issing|not.*found|not in the task list/);
  });

  test("throws on 3-node cycle", () => {
    const tasks = [
      makeTask({ id: "A", dependencies: ["C"] }),
      makeTask({ id: "B", dependencies: ["A"] }),
      makeTask({ id: "C", dependencies: ["B"] }),
    ];
    expect(() => calculateWaves(tasks)).toThrow(/[Cc]ircular/);
  });
});

// ============================================================================
// WaveCalculatorResult shape
// ============================================================================
describe("WaveCalculatorResult shape", () => {
  const { calculateWaves } = createWaveCalculator();

  test("has totalTasks, maxParallelism, sequentialWaves, waves", () => {
    const result = calculateWaves([makeTask({ id: "A" })]);
    expect(typeof result.totalTasks).toBe("number");
    expect(typeof result.maxParallelism).toBe("number");
    expect(typeof result.sequentialWaves).toBe("number");
    expect(Array.isArray(result.waves)).toBe(true);
  });
});

// ============================================================================
// Integration: full lifecycle
// ============================================================================
describe("full lifecycle integration", () => {
  test("validate → calculate → getExecutionOrder", () => {
    const calculator = createWaveCalculator();
    const tasks = [
      makeTask({ id: "types", priority: "critical" }),
      makeTask({ id: "utils", priority: "high" }),
      makeTask({ id: "component", dependencies: ["types", "utils"], priority: "medium" }),
      makeTask({ id: "tests", dependencies: ["component"], priority: "low" }),
    ];

    // Step 1: Validate
    const validation = calculator.validateDependencies(tasks);
    expect(validation.valid).toBe(true);

    // Step 2: Calculate waves
    const result = calculator.calculateWaves(tasks);
    expect(result.waves).toHaveLength(3);
    expect(result.totalTasks).toBe(4);
    expect(result.maxParallelism).toBe(2);

    // Step 3: Get execution order
    const order = calculator.getExecutionOrder(result.waves);
    expect(order).toHaveLength(4);
    // types and utils before component
    expect(order.indexOf("types")).toBeLessThan(order.indexOf("component"));
    expect(order.indexOf("utils")).toBeLessThan(order.indexOf("component"));
    // component before tests
    expect(order.indexOf("component")).toBeLessThan(order.indexOf("tests"));
  });
});
