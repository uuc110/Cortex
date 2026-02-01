/**
 * Tests for gsd-types.ts — GSD type definitions, const arrays, and type guards.
 *
 * Verifies:
 *   - All const arrays contain expected values per spec
 *   - GSD_PLAN_STATUSES is a superset of STATE.md + PLAN.md statuses
 *   - Type guard functions validate correctly
 *   - Interface contracts enforced via type guards
 *
 * Cross-references:
 *   - Spec: .planning/fork-plan/02-INTEGRATION-SWARM-GSD.md
 *   - STATE.md statuses: planning, researching, executing, verifying, completed, failed
 */
import { describe, expect, test } from "bun:test";

import {
  GSD_MODES,
  GSD_PLAN_STATUSES,
  GSD_PLAN_TYPES,
  GSD_TASK_STATUSES,
  GSD_TASK_PRIORITIES,
  GSD_TASK_TYPES,
  GSD_WAVE_STATUSES,
  GSD_VERIFICATION_STATUSES,
  GSD_ARTIFACT_CHECK_LEVELS,
  GSD_KEY_LINK_TYPES,
  isGsdMode,
  isGsdPlanStatus,
  isGsdPlanType,
  isGsdTaskStatus,
  isGsdTaskPriority,
  isGsdTaskType,
  isGsdWaveStatus,
  isGsdVerificationStatus,
  isGsdArtifactCheckLevel,
  isGsdKeyLinkType,
  isGsdPlan,
  isGsdTask,
  isGsdWave,
  isGsdState,
  isVerificationResult,
  isPlanningDirectoryConfig,
} from "./gsd-types.js";

// ============================================================================
// Const array completeness
// ============================================================================

describe("GSD Const Arrays", () => {
  test("GSD_MODES contains quick and project", () => {
    expect(GSD_MODES).toContain("quick");
    expect(GSD_MODES).toContain("project");
    expect(GSD_MODES).toHaveLength(2);
  });

  test("GSD_PLAN_STATUSES is superset of STATE.md lifecycle statuses", () => {
    const stateStatuses: string[] = [
      "planning",
      "researching",
      "executing",
      "verifying",
      "completed",
      "failed",
    ];
    const planStatuses: readonly string[] = GSD_PLAN_STATUSES;
    for (const status of stateStatuses) {
      expect(planStatuses).toContain(status);
    }
  });

  test("GSD_PLAN_STATUSES includes additional statuses beyond STATE.md", () => {
    // Additional statuses for PLAN.md frontmatter
    expect(GSD_PLAN_STATUSES).toContain("pending");
    expect(GSD_PLAN_STATUSES).toContain("in_progress");
  });

  test("GSD_PLAN_STATUSES has exactly 8 values", () => {
    expect(GSD_PLAN_STATUSES).toHaveLength(8);
  });

  test("GSD_PLAN_TYPES contains execute, fix, research", () => {
    expect(GSD_PLAN_TYPES).toContain("execute");
    expect(GSD_PLAN_TYPES).toContain("fix");
    expect(GSD_PLAN_TYPES).toContain("research");
    expect(GSD_PLAN_TYPES).toHaveLength(3);
  });

  test("GSD_TASK_STATUSES contains all expected values", () => {
    expect(GSD_TASK_STATUSES).toContain("pending");
    expect(GSD_TASK_STATUSES).toContain("in_progress");
    expect(GSD_TASK_STATUSES).toContain("completed");
    expect(GSD_TASK_STATUSES).toContain("failed");
    expect(GSD_TASK_STATUSES).toContain("skipped");
    expect(GSD_TASK_STATUSES).toHaveLength(5);
  });

  test("GSD_TASK_PRIORITIES contains all expected values", () => {
    expect(GSD_TASK_PRIORITIES).toContain("critical");
    expect(GSD_TASK_PRIORITIES).toContain("high");
    expect(GSD_TASK_PRIORITIES).toContain("medium");
    expect(GSD_TASK_PRIORITIES).toContain("low");
    expect(GSD_TASK_PRIORITIES).toHaveLength(4);
  });

  test("GSD_TASK_TYPES contains all expected values", () => {
    expect(GSD_TASK_TYPES).toContain("auto");
    expect(GSD_TASK_TYPES).toContain("human-verify");
    expect(GSD_TASK_TYPES).toContain("human-action");
    expect(GSD_TASK_TYPES).toContain("decision");
    expect(GSD_TASK_TYPES).toHaveLength(4);
  });

  test("GSD_WAVE_STATUSES contains all expected values", () => {
    expect(GSD_WAVE_STATUSES).toContain("pending");
    expect(GSD_WAVE_STATUSES).toContain("in_progress");
    expect(GSD_WAVE_STATUSES).toContain("completed");
    expect(GSD_WAVE_STATUSES).toContain("failed");
    expect(GSD_WAVE_STATUSES).toHaveLength(4);
  });

  test("GSD_VERIFICATION_STATUSES contains all expected values", () => {
    expect(GSD_VERIFICATION_STATUSES).toContain("pending");
    expect(GSD_VERIFICATION_STATUSES).toContain("running");
    expect(GSD_VERIFICATION_STATUSES).toContain("passed");
    expect(GSD_VERIFICATION_STATUSES).toContain("failed");
    expect(GSD_VERIFICATION_STATUSES).toHaveLength(4);
  });

  test("GSD_ARTIFACT_CHECK_LEVELS matches spec (exists, substantive, wired)", () => {
    expect(GSD_ARTIFACT_CHECK_LEVELS).toContain("exists");
    expect(GSD_ARTIFACT_CHECK_LEVELS).toContain("substantive");
    expect(GSD_ARTIFACT_CHECK_LEVELS).toContain("wired");
    expect(GSD_ARTIFACT_CHECK_LEVELS).toHaveLength(3);
  });

  test("GSD_KEY_LINK_TYPES matches spec", () => {
    expect(GSD_KEY_LINK_TYPES).toContain("renders-within");
    expect(GSD_KEY_LINK_TYPES).toContain("imported-by");
    expect(GSD_KEY_LINK_TYPES).toContain("calls");
    expect(GSD_KEY_LINK_TYPES).toContain("extends");
    expect(GSD_KEY_LINK_TYPES).toHaveLength(4);
  });

  test("all const arrays are frozen (immutable)", () => {
    expect(Object.isFrozen(GSD_MODES)).toBe(true);
    expect(Object.isFrozen(GSD_PLAN_STATUSES)).toBe(true);
    expect(Object.isFrozen(GSD_PLAN_TYPES)).toBe(true);
    expect(Object.isFrozen(GSD_TASK_STATUSES)).toBe(true);
    expect(Object.isFrozen(GSD_TASK_PRIORITIES)).toBe(true);
    expect(Object.isFrozen(GSD_TASK_TYPES)).toBe(true);
    expect(Object.isFrozen(GSD_WAVE_STATUSES)).toBe(true);
    expect(Object.isFrozen(GSD_VERIFICATION_STATUSES)).toBe(true);
    expect(Object.isFrozen(GSD_ARTIFACT_CHECK_LEVELS)).toBe(true);
    expect(Object.isFrozen(GSD_KEY_LINK_TYPES)).toBe(true);
  });
});

// ============================================================================
// Type guard functions
// ============================================================================

describe("Type Guards — Scalar", () => {
  describe("isGsdMode", () => {
    test("accepts valid modes", () => {
      expect(isGsdMode("quick")).toBe(true);
      expect(isGsdMode("project")).toBe(true);
    });

    test("rejects invalid strings", () => {
      expect(isGsdMode("invalid")).toBe(false);
      expect(isGsdMode("")).toBe(false);
    });

    test("rejects non-strings", () => {
      expect(isGsdMode(123)).toBe(false);
      expect(isGsdMode(null)).toBe(false);
      expect(isGsdMode(undefined)).toBe(false);
      expect(isGsdMode({})).toBe(false);
    });
  });

  describe("isGsdPlanStatus", () => {
    test("accepts all valid plan statuses", () => {
      for (const status of GSD_PLAN_STATUSES) {
        expect(isGsdPlanStatus(status)).toBe(true);
      }
    });

    test("rejects invalid values", () => {
      expect(isGsdPlanStatus("invalid")).toBe(false);
      expect(isGsdPlanStatus(42)).toBe(false);
      expect(isGsdPlanStatus(null)).toBe(false);
    });
  });

  describe("isGsdPlanType", () => {
    test("accepts all valid plan types", () => {
      for (const type of GSD_PLAN_TYPES) {
        expect(isGsdPlanType(type)).toBe(true);
      }
    });

    test("rejects invalid values", () => {
      expect(isGsdPlanType("invalid")).toBe(false);
    });
  });

  describe("isGsdTaskStatus", () => {
    test("accepts all valid task statuses", () => {
      for (const status of GSD_TASK_STATUSES) {
        expect(isGsdTaskStatus(status)).toBe(true);
      }
    });

    test("rejects invalid values", () => {
      expect(isGsdTaskStatus("invalid")).toBe(false);
    });
  });

  describe("isGsdTaskPriority", () => {
    test("accepts all valid priorities", () => {
      for (const priority of GSD_TASK_PRIORITIES) {
        expect(isGsdTaskPriority(priority)).toBe(true);
      }
    });

    test("rejects invalid values", () => {
      expect(isGsdTaskPriority("urgent")).toBe(false);
    });
  });

  describe("isGsdTaskType", () => {
    test("accepts all valid task types", () => {
      for (const type of GSD_TASK_TYPES) {
        expect(isGsdTaskType(type)).toBe(true);
      }
    });

    test("rejects invalid values", () => {
      expect(isGsdTaskType("manual")).toBe(false);
    });
  });

  describe("isGsdWaveStatus", () => {
    test("accepts all valid wave statuses", () => {
      for (const status of GSD_WAVE_STATUSES) {
        expect(isGsdWaveStatus(status)).toBe(true);
      }
    });

    test("rejects invalid values", () => {
      expect(isGsdWaveStatus("running")).toBe(false);
    });
  });

  describe("isGsdVerificationStatus", () => {
    test("accepts all valid verification statuses", () => {
      for (const status of GSD_VERIFICATION_STATUSES) {
        expect(isGsdVerificationStatus(status)).toBe(true);
      }
    });

    test("rejects invalid values", () => {
      expect(isGsdVerificationStatus("in_progress")).toBe(false);
    });
  });

  describe("isGsdArtifactCheckLevel", () => {
    test("accepts all valid check levels", () => {
      for (const level of GSD_ARTIFACT_CHECK_LEVELS) {
        expect(isGsdArtifactCheckLevel(level)).toBe(true);
      }
    });

    test("rejects invalid values", () => {
      expect(isGsdArtifactCheckLevel("deep")).toBe(false);
    });
  });

  describe("isGsdKeyLinkType", () => {
    test("accepts all valid link types", () => {
      for (const type of GSD_KEY_LINK_TYPES) {
        expect(isGsdKeyLinkType(type)).toBe(true);
      }
    });

    test("rejects invalid values", () => {
      expect(isGsdKeyLinkType("depends-on")).toBe(false);
    });
  });
});

// ============================================================================
// Type Guards — Composite (interfaces)
// ============================================================================

describe("Type Guards — Composite", () => {
  describe("isGsdTask", () => {
    const validTask = {
      id: "task-1",
      name: "Implement feature",
      status: "pending" as const,
      wave: 1,
      priority: "high" as const,
      type: "auto" as const,
      files: ["src/foo.ts"],
      action: "Create the component",
    };

    test("accepts valid task", () => {
      expect(isGsdTask(validTask)).toBe(true);
    });

    test("accepts task with optional fields", () => {
      const task = {
        ...validTask,
        verify: "bun test",
        done: "Component renders correctly",
        dependencies: ["task-0"],
        subtasks: [{ id: "sub-1", name: "Sub", files: [], action: "Do" }],
      };
      expect(isGsdTask(task)).toBe(true);
    });

    test("rejects task with missing required fields", () => {
      expect(isGsdTask({ ...validTask, id: undefined })).toBe(false);
      expect(isGsdTask({ ...validTask, name: undefined })).toBe(false);
      expect(isGsdTask({ ...validTask, status: undefined })).toBe(false);
      expect(isGsdTask({ ...validTask, wave: undefined })).toBe(false);
      expect(isGsdTask({ ...validTask, priority: undefined })).toBe(false);
      expect(isGsdTask({ ...validTask, type: undefined })).toBe(false);
      expect(isGsdTask({ ...validTask, files: undefined })).toBe(false);
      expect(isGsdTask({ ...validTask, action: undefined })).toBe(false);
    });

    test("rejects task with empty id", () => {
      expect(isGsdTask({ ...validTask, id: "" })).toBe(false);
    });

    test("rejects task with wave < 1", () => {
      expect(isGsdTask({ ...validTask, wave: 0 })).toBe(false);
    });

    test("rejects task with invalid status", () => {
      expect(isGsdTask({ ...validTask, status: "invalid" })).toBe(false);
    });

    test("rejects non-objects", () => {
      expect(isGsdTask(null)).toBe(false);
      expect(isGsdTask(undefined)).toBe(false);
      expect(isGsdTask("string")).toBe(false);
      expect(isGsdTask(42)).toBe(false);
      expect(isGsdTask([])).toBe(false);
    });
  });

  describe("isGsdWave", () => {
    const validWave = {
      wave_number: 1,
      task_ids: ["task-1", "task-2"],
      status: "pending" as const,
      parallel: true,
    };

    test("accepts valid wave", () => {
      expect(isGsdWave(validWave)).toBe(true);
    });

    test("accepts wave with optional timing fields", () => {
      const wave = {
        ...validWave,
        started_at: "2026-01-01T00:00:00Z",
        completed_at: "2026-01-01T01:00:00Z",
        duration_ms: 3600000,
      };
      expect(isGsdWave(wave)).toBe(true);
    });

    test("rejects wave with wave_number < 1", () => {
      expect(isGsdWave({ ...validWave, wave_number: 0 })).toBe(false);
    });

    test("rejects wave with missing fields", () => {
      expect(isGsdWave({ ...validWave, task_ids: undefined })).toBe(false);
      expect(isGsdWave({ ...validWave, status: undefined })).toBe(false);
      expect(isGsdWave({ ...validWave, parallel: undefined })).toBe(false);
    });

    test("rejects non-objects", () => {
      expect(isGsdWave(null)).toBe(false);
      expect(isGsdWave(undefined)).toBe(false);
    });
  });

  describe("isGsdPlan", () => {
    const validPlan = {
      id: "plan-1",
      title: "Feature plan",
      phase: "01-foundation",
      created: "2026-01-01T00:00:00Z",
      status: "pending" as const,
      mode: "quick" as const,
      type: "execute" as const,
      tasks: [],
      waves: [],
    };

    test("accepts valid plan", () => {
      expect(isGsdPlan(validPlan)).toBe(true);
    });

    test("accepts plan with optional fields", () => {
      const plan = {
        ...validPlan,
        bead_id: "bead-1",
        epic_id: "epic-1",
        worker_id: "worker-1",
        depends_on: ["plan-0"],
        files_modified: ["src/foo.ts"],
        autonomous: true,
        plan_number: "01",
      };
      expect(isGsdPlan(plan)).toBe(true);
    });

    test("rejects plan with empty id", () => {
      expect(isGsdPlan({ ...validPlan, id: "" })).toBe(false);
    });

    test("rejects plan with invalid status", () => {
      expect(isGsdPlan({ ...validPlan, status: "invalid" })).toBe(false);
    });

    test("rejects plan with invalid mode", () => {
      expect(isGsdPlan({ ...validPlan, mode: "invalid" })).toBe(false);
    });

    test("rejects plan with invalid type", () => {
      expect(isGsdPlan({ ...validPlan, type: "invalid" })).toBe(false);
    });

    test("rejects non-objects", () => {
      expect(isGsdPlan(null)).toBe(false);
      expect(isGsdPlan(undefined)).toBe(false);
    });
  });

  describe("isGsdState", () => {
    const validState = {
      plan_id: "plan-1",
      status: "executing" as const,
      mode: "quick" as const,
      current_wave: 2,
      completed_tasks: ["task-1"],
      failed_tasks: [],
      verification_results: [],
      started_at: "2026-01-01T00:00:00Z",
      last_updated: "2026-01-01T01:00:00Z",
    };

    test("accepts valid state", () => {
      expect(isGsdState(validState)).toBe(true);
    });

    test("accepts state with optional fields", () => {
      const state = {
        ...validState,
        current_phase: 1,
        decisions: ["Used CSS variables"],
        context_notes: ["Existing pattern in src/styles/"],
        completed_at: "2026-01-01T02:00:00Z",
      };
      expect(isGsdState(state)).toBe(true);
    });

    test("rejects state with empty plan_id", () => {
      expect(isGsdState({ ...validState, plan_id: "" })).toBe(false);
    });

    test("rejects state with invalid status", () => {
      expect(isGsdState({ ...validState, status: "invalid" })).toBe(false);
    });

    test("rejects state with invalid mode", () => {
      expect(isGsdState({ ...validState, mode: "invalid" })).toBe(false);
    });

    test("rejects non-objects", () => {
      expect(isGsdState(null)).toBe(false);
      expect(isGsdState(undefined)).toBe(false);
    });
  });

  describe("isVerificationResult", () => {
    const validResult = {
      status: "passed" as const,
      truths: [{ description: "Feature works", passed: true }],
      artifacts: [{ path: "src/foo.ts", check: "substantive" as const, passed: true }],
      key_links: [
        {
          from: "Foo",
          to: "Bar",
          type: "imported-by" as const,
          passed: true,
        },
      ],
    };

    test("accepts valid verification result", () => {
      expect(isVerificationResult(validResult)).toBe(true);
    });

    test("accepts result with optional count fields", () => {
      const result = {
        ...validResult,
        checked_at: "2026-01-01T00:00:00Z",
        total_checks: 3,
        passed_checks: 3,
        failed_checks: 0,
      };
      expect(isVerificationResult(result)).toBe(true);
    });

    test("rejects result with invalid status", () => {
      expect(
        isVerificationResult({ ...validResult, status: "invalid" }),
      ).toBe(false);
    });

    test("rejects non-objects", () => {
      expect(isVerificationResult(null)).toBe(false);
      expect(isVerificationResult(undefined)).toBe(false);
    });
  });

  describe("isPlanningDirectoryConfig", () => {
    test("accepts valid config", () => {
      expect(
        isPlanningDirectoryConfig({ mode: "quick", root: "/path" }),
      ).toBe(true);
    });

    test("accepts config with optional fields", () => {
      expect(
        isPlanningDirectoryConfig({
          mode: "project",
          root: "/path",
          project_path: "/path/PROJECT.md",
          roadmap_path: "/path/ROADMAP.md",
          state_path: "/path/STATE.md",
          research_dir: "/path/research",
          phases_dir: "/path/phases",
          quick_dir: "/path/quick",
        }),
      ).toBe(true);
    });

    test("rejects config with invalid mode", () => {
      expect(
        isPlanningDirectoryConfig({ mode: "invalid", root: "/path" }),
      ).toBe(false);
    });

    test("rejects config with missing root", () => {
      expect(isPlanningDirectoryConfig({ mode: "quick" })).toBe(false);
    });

    test("rejects non-objects", () => {
      expect(isPlanningDirectoryConfig(null)).toBe(false);
      expect(isPlanningDirectoryConfig(undefined)).toBe(false);
    });
  });
});
