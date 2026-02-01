/**
 * Tests for gsd-types.ts — Foundation types for the GSD (Get Shit Done) module.
 *
 * TDD RED phase: These tests define the contract BEFORE implementation.
 * Cross-references:
 *   - GSD event schemas: packages/swarm-mail/src/streams/events.ts L777-872
 *   - Integration spec: .planning/fork-plan/02-INTEGRATION-SWARM-GSD.md
 *   - PLAN.md template: .planning/fork-plan/details/plan-md-template.md
 *   - Bead types pattern: packages/opencode-swarm-plugin/src/bridge/bead-types.ts
 */
import { describe, expect, test } from "bun:test";

import {
  // Const arrays / enum-like objects
  GSD_MODES,
  GSD_PLAN_STATUSES,
  GSD_PLAN_TYPES,
  GSD_TASK_PRIORITIES,
  GSD_TASK_STATUSES,
  GSD_TASK_TYPES,
  GSD_VERIFICATION_STATUSES,
  GSD_WAVE_STATUSES,
  GSD_ARTIFACT_CHECK_LEVELS,
  GSD_KEY_LINK_TYPES,

  // Type guards
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

  // Types (import for structural checks)
  type GsdMode,
  type GsdPlanStatus,
  type GsdPlanType,
  type GsdTaskStatus,
  type GsdTaskPriority,
  type GsdTaskType,
  type GsdWaveStatus,
  type GsdVerificationStatus,
  type GsdArtifactCheckLevel,
  type GsdKeyLinkType,
  type GsdPlan,
  type GsdTask,
  type GsdSubtask,
  type GsdWave,
  type GsdState,
  type VerificationResult,
  type VerificationTruth,
  type VerificationArtifact,
  type VerificationKeyLink,
  type PlanningDirectoryConfig,
  type GsdPlanFrontmatter,
} from "../gsd-types.js";

// ============================================================================
// GSD_MODES — "quick" | "project"
// ============================================================================
describe("GSD_MODES", () => {
  test("has exactly 2 modes", () => {
    expect(GSD_MODES).toHaveLength(2);
  });

  test("contains quick and project", () => {
    expect(GSD_MODES).toContain("quick");
    expect(GSD_MODES).toContain("project");
  });

  test("is frozen (immutable)", () => {
    expect(Object.isFrozen(GSD_MODES)).toBe(true);
  });

  test("has no duplicate values", () => {
    const unique = new Set(GSD_MODES);
    expect(unique.size).toBe(GSD_MODES.length);
  });
});

// ============================================================================
// GSD_PLAN_STATUSES
// ============================================================================
describe("GSD_PLAN_STATUSES", () => {
  test("has exactly 8 statuses", () => {
    expect(GSD_PLAN_STATUSES).toHaveLength(8);
  });

  test("contains all statuses from STATE.md + PLAN.md frontmatter specs", () => {
    expect(GSD_PLAN_STATUSES).toContain("pending");
    expect(GSD_PLAN_STATUSES).toContain("planning");
    expect(GSD_PLAN_STATUSES).toContain("researching");
    expect(GSD_PLAN_STATUSES).toContain("in_progress");
    expect(GSD_PLAN_STATUSES).toContain("executing");
    expect(GSD_PLAN_STATUSES).toContain("verifying");
    expect(GSD_PLAN_STATUSES).toContain("completed");
    expect(GSD_PLAN_STATUSES).toContain("failed");
  });

  test("is frozen", () => {
    expect(Object.isFrozen(GSD_PLAN_STATUSES)).toBe(true);
  });

  test("has no duplicates", () => {
    const unique = new Set(GSD_PLAN_STATUSES);
    expect(unique.size).toBe(GSD_PLAN_STATUSES.length);
  });
});

// ============================================================================
// GSD_PLAN_TYPES
// ============================================================================
describe("GSD_PLAN_TYPES", () => {
  test("has exactly 3 types", () => {
    expect(GSD_PLAN_TYPES).toHaveLength(3);
  });

  test("contains execute, fix, research", () => {
    // From plan-md-template.md frontmatter: type: "execute" | "fix" | "research"
    expect(GSD_PLAN_TYPES).toContain("execute");
    expect(GSD_PLAN_TYPES).toContain("fix");
    expect(GSD_PLAN_TYPES).toContain("research");
  });

  test("is frozen", () => {
    expect(Object.isFrozen(GSD_PLAN_TYPES)).toBe(true);
  });
});

// ============================================================================
// GSD_TASK_STATUSES
// ============================================================================
describe("GSD_TASK_STATUSES", () => {
  test("has exactly 5 statuses", () => {
    expect(GSD_TASK_STATUSES).toHaveLength(5);
  });

  test("contains all task statuses from XML spec", () => {
    // From plan-md-template.md task XML: status="pending" | "in_progress" | "completed" | "failed" | "skipped"
    expect(GSD_TASK_STATUSES).toContain("pending");
    expect(GSD_TASK_STATUSES).toContain("in_progress");
    expect(GSD_TASK_STATUSES).toContain("completed");
    expect(GSD_TASK_STATUSES).toContain("failed");
    expect(GSD_TASK_STATUSES).toContain("skipped");
  });

  test("is frozen", () => {
    expect(Object.isFrozen(GSD_TASK_STATUSES)).toBe(true);
  });

  test("has no duplicates", () => {
    const unique = new Set(GSD_TASK_STATUSES);
    expect(unique.size).toBe(GSD_TASK_STATUSES.length);
  });
});

// ============================================================================
// GSD_TASK_PRIORITIES
// ============================================================================
describe("GSD_TASK_PRIORITIES", () => {
  test("has exactly 4 priorities", () => {
    expect(GSD_TASK_PRIORITIES).toHaveLength(4);
  });

  test("contains critical, high, medium, low", () => {
    // From plan-md-template.md: priority="critical" | "high" | "medium" | "low"
    expect(GSD_TASK_PRIORITIES).toContain("critical");
    expect(GSD_TASK_PRIORITIES).toContain("high");
    expect(GSD_TASK_PRIORITIES).toContain("medium");
    expect(GSD_TASK_PRIORITIES).toContain("low");
  });

  test("is frozen", () => {
    expect(Object.isFrozen(GSD_TASK_PRIORITIES)).toBe(true);
  });
});

// ============================================================================
// GSD_TASK_TYPES
// ============================================================================
describe("GSD_TASK_TYPES", () => {
  test("has exactly 4 types", () => {
    expect(GSD_TASK_TYPES).toHaveLength(4);
  });

  test("contains auto, human-verify, human-action, decision", () => {
    // From plan-md-template.md: type="auto" | "human-verify" | "human-action" | "decision"
    expect(GSD_TASK_TYPES).toContain("auto");
    expect(GSD_TASK_TYPES).toContain("human-verify");
    expect(GSD_TASK_TYPES).toContain("human-action");
    expect(GSD_TASK_TYPES).toContain("decision");
  });

  test("is frozen", () => {
    expect(Object.isFrozen(GSD_TASK_TYPES)).toBe(true);
  });
});

// ============================================================================
// GSD_WAVE_STATUSES
// ============================================================================
describe("GSD_WAVE_STATUSES", () => {
  test("has exactly 4 statuses", () => {
    expect(GSD_WAVE_STATUSES).toHaveLength(4);
  });

  test("contains pending, in_progress, completed, failed", () => {
    expect(GSD_WAVE_STATUSES).toContain("pending");
    expect(GSD_WAVE_STATUSES).toContain("in_progress");
    expect(GSD_WAVE_STATUSES).toContain("completed");
    expect(GSD_WAVE_STATUSES).toContain("failed");
  });

  test("is frozen", () => {
    expect(Object.isFrozen(GSD_WAVE_STATUSES)).toBe(true);
  });
});

// ============================================================================
// GSD_VERIFICATION_STATUSES
// ============================================================================
describe("GSD_VERIFICATION_STATUSES", () => {
  test("has exactly 4 statuses", () => {
    expect(GSD_VERIFICATION_STATUSES).toHaveLength(4);
  });

  test("contains pending, running, passed, failed", () => {
    expect(GSD_VERIFICATION_STATUSES).toContain("pending");
    expect(GSD_VERIFICATION_STATUSES).toContain("running");
    expect(GSD_VERIFICATION_STATUSES).toContain("passed");
    expect(GSD_VERIFICATION_STATUSES).toContain("failed");
  });

  test("is frozen", () => {
    expect(Object.isFrozen(GSD_VERIFICATION_STATUSES)).toBe(true);
  });
});

// ============================================================================
// GSD_ARTIFACT_CHECK_LEVELS
// ============================================================================
describe("GSD_ARTIFACT_CHECK_LEVELS", () => {
  test("has exactly 3 levels", () => {
    expect(GSD_ARTIFACT_CHECK_LEVELS).toHaveLength(3);
  });

  test("contains exists, substantive, wired", () => {
    // From 02-INTEGRATION-SWARM-GSD.md must_haves artifacts:
    //   check: "substantive" | "wired" (+ implied "exists")
    expect(GSD_ARTIFACT_CHECK_LEVELS).toContain("exists");
    expect(GSD_ARTIFACT_CHECK_LEVELS).toContain("substantive");
    expect(GSD_ARTIFACT_CHECK_LEVELS).toContain("wired");
  });

  test("is frozen", () => {
    expect(Object.isFrozen(GSD_ARTIFACT_CHECK_LEVELS)).toBe(true);
  });
});

// ============================================================================
// GSD_KEY_LINK_TYPES
// ============================================================================
describe("GSD_KEY_LINK_TYPES", () => {
  test("has exactly 4 link types", () => {
    expect(GSD_KEY_LINK_TYPES).toHaveLength(4);
  });

  test("contains renders-within, imported-by, calls, extends", () => {
    // From 02-INTEGRATION-SWARM-GSD.md key_links:
    //   type: "renders-within" | "imported-by" (+ common ones)
    expect(GSD_KEY_LINK_TYPES).toContain("renders-within");
    expect(GSD_KEY_LINK_TYPES).toContain("imported-by");
    expect(GSD_KEY_LINK_TYPES).toContain("calls");
    expect(GSD_KEY_LINK_TYPES).toContain("extends");
  });

  test("is frozen", () => {
    expect(Object.isFrozen(GSD_KEY_LINK_TYPES)).toBe(true);
  });
});

// ============================================================================
// Type guard: isGsdMode()
// ============================================================================
describe("isGsdMode()", () => {
  test("returns true for 'quick'", () => {
    expect(isGsdMode("quick")).toBe(true);
  });

  test("returns true for 'project'", () => {
    expect(isGsdMode("project")).toBe(true);
  });

  test("returns false for invalid strings", () => {
    expect(isGsdMode("fast")).toBe(false);
    expect(isGsdMode("")).toBe(false);
    expect(isGsdMode("Quick")).toBe(false);
  });

  test("returns false for non-string values", () => {
    expect(isGsdMode(null)).toBe(false);
    expect(isGsdMode(undefined)).toBe(false);
    expect(isGsdMode(42)).toBe(false);
    expect(isGsdMode(true)).toBe(false);
  });
});

// ============================================================================
// Type guard: isGsdPlanStatus()
// ============================================================================
describe("isGsdPlanStatus()", () => {
  test("returns true for all valid plan statuses", () => {
    for (const status of GSD_PLAN_STATUSES) {
      expect(isGsdPlanStatus(status)).toBe(true);
    }
  });

  test("returns false for invalid values", () => {
    expect(isGsdPlanStatus("active")).toBe(false);
    expect(isGsdPlanStatus(null)).toBe(false);
  });
});

// ============================================================================
// Type guard: isGsdPlanType()
// ============================================================================
describe("isGsdPlanType()", () => {
  test("returns true for all valid plan types", () => {
    for (const t of GSD_PLAN_TYPES) {
      expect(isGsdPlanType(t)).toBe(true);
    }
  });

  test("returns false for invalid values", () => {
    expect(isGsdPlanType("build")).toBe(false);
    expect(isGsdPlanType(undefined)).toBe(false);
  });
});

// ============================================================================
// Type guard: isGsdTaskStatus()
// ============================================================================
describe("isGsdTaskStatus()", () => {
  test("returns true for all valid task statuses", () => {
    for (const status of GSD_TASK_STATUSES) {
      expect(isGsdTaskStatus(status)).toBe(true);
    }
  });

  test("returns false for invalid values", () => {
    expect(isGsdTaskStatus("done")).toBe(false);
    expect(isGsdTaskStatus(0)).toBe(false);
  });
});

// ============================================================================
// Type guard: isGsdTaskPriority()
// ============================================================================
describe("isGsdTaskPriority()", () => {
  test("returns true for all valid priorities", () => {
    for (const p of GSD_TASK_PRIORITIES) {
      expect(isGsdTaskPriority(p)).toBe(true);
    }
  });

  test("returns false for invalid values", () => {
    expect(isGsdTaskPriority("urgent")).toBe(false);
    expect(isGsdTaskPriority(1)).toBe(false);
  });
});

// ============================================================================
// Type guard: isGsdTaskType()
// ============================================================================
describe("isGsdTaskType()", () => {
  test("returns true for all valid task types", () => {
    for (const t of GSD_TASK_TYPES) {
      expect(isGsdTaskType(t)).toBe(true);
    }
  });

  test("returns false for invalid values", () => {
    expect(isGsdTaskType("manual")).toBe(false);
    expect(isGsdTaskType(null)).toBe(false);
  });
});

// ============================================================================
// Type guard: isGsdWaveStatus()
// ============================================================================
describe("isGsdWaveStatus()", () => {
  test("returns true for all valid wave statuses", () => {
    for (const s of GSD_WAVE_STATUSES) {
      expect(isGsdWaveStatus(s)).toBe(true);
    }
  });

  test("returns false for invalid values", () => {
    expect(isGsdWaveStatus("running")).toBe(false);
  });
});

// ============================================================================
// Type guard: isGsdVerificationStatus()
// ============================================================================
describe("isGsdVerificationStatus()", () => {
  test("returns true for all valid verification statuses", () => {
    for (const s of GSD_VERIFICATION_STATUSES) {
      expect(isGsdVerificationStatus(s)).toBe(true);
    }
  });

  test("returns false for invalid values", () => {
    expect(isGsdVerificationStatus("success")).toBe(false);
  });
});

// ============================================================================
// Type guard: isGsdArtifactCheckLevel()
// ============================================================================
describe("isGsdArtifactCheckLevel()", () => {
  test("returns true for all valid levels", () => {
    for (const l of GSD_ARTIFACT_CHECK_LEVELS) {
      expect(isGsdArtifactCheckLevel(l)).toBe(true);
    }
  });

  test("returns false for invalid values", () => {
    expect(isGsdArtifactCheckLevel("deep")).toBe(false);
  });
});

// ============================================================================
// Type guard: isGsdKeyLinkType()
// ============================================================================
describe("isGsdKeyLinkType()", () => {
  test("returns true for all valid link types", () => {
    for (const l of GSD_KEY_LINK_TYPES) {
      expect(isGsdKeyLinkType(l)).toBe(true);
    }
  });

  test("returns false for invalid values", () => {
    expect(isGsdKeyLinkType("depends-on")).toBe(false);
  });
});

// ============================================================================
// Type guard: isGsdPlan()
// ============================================================================
describe("isGsdPlan()", () => {
  const validPlan: GsdPlan = {
    id: "plan-001",
    title: "Add dark mode toggle",
    phase: "quick-bd-a3f8",
    created: "2026-02-01T09:00:00Z",
    status: "pending",
    mode: "quick",
    type: "execute",
    tasks: [],
    waves: [],
  };

  test("returns true for a valid plan", () => {
    expect(isGsdPlan(validPlan)).toBe(true);
  });

  test("returns true for plan with all optional fields", () => {
    const fullPlan: GsdPlan = {
      ...validPlan,
      bead_id: "bd-a3f8.2",
      epic_id: "bd-a3f8",
      worker_id: "worker-1",
      depends_on: ["bd-a3f8.1"],
      files_modified: ["src/foo.ts"],
      autonomous: true,
      plan_number: "01",
      verification: {
        status: "pending",
        truths: [],
        artifacts: [],
        key_links: [],
      },
    };
    expect(isGsdPlan(fullPlan)).toBe(true);
  });

  test("returns false for null/undefined", () => {
    expect(isGsdPlan(null)).toBe(false);
    expect(isGsdPlan(undefined)).toBe(false);
  });

  test("returns false for missing required fields", () => {
    expect(isGsdPlan({ id: "x" })).toBe(false);
    expect(isGsdPlan({ id: "x", title: "y" })).toBe(false);
  });

  test("returns false for invalid status", () => {
    expect(isGsdPlan({ ...validPlan, status: "active" })).toBe(false);
  });

  test("returns false for invalid mode", () => {
    expect(isGsdPlan({ ...validPlan, mode: "fast" })).toBe(false);
  });

  test("returns false for invalid type", () => {
    expect(isGsdPlan({ ...validPlan, type: "build" })).toBe(false);
  });

  test("returns false for non-array tasks", () => {
    expect(isGsdPlan({ ...validPlan, tasks: "not-array" })).toBe(false);
  });
});

// ============================================================================
// Type guard: isGsdTask()
// ============================================================================
describe("isGsdTask()", () => {
  const validTask: GsdTask = {
    id: "1",
    name: "Implement CSS variables",
    status: "pending",
    wave: 1,
    priority: "high",
    type: "auto",
    files: ["src/styles/themes.css"],
    action: "Create CSS custom properties for light and dark themes",
  };

  test("returns true for a valid task", () => {
    expect(isGsdTask(validTask)).toBe(true);
  });

  test("returns true for task with all optional fields", () => {
    const fullTask: GsdTask = {
      ...validTask,
      verify: "Build passes, tests pass",
      done: "CSS variables are defined and working",
      dependencies: ["bd-a3f8.1"],
      subtasks: [
        { id: "1.1", name: "Light theme vars", files: ["src/light.css"], action: "Define light vars" },
      ],
    };
    expect(isGsdTask(fullTask)).toBe(true);
  });

  test("returns false for null/undefined", () => {
    expect(isGsdTask(null)).toBe(false);
    expect(isGsdTask(undefined)).toBe(false);
  });

  test("returns false for missing required fields", () => {
    expect(isGsdTask({ id: "1" })).toBe(false);
    expect(isGsdTask({ id: "1", name: "x" })).toBe(false);
  });

  test("returns false for invalid status", () => {
    expect(isGsdTask({ ...validTask, status: "done" })).toBe(false);
  });

  test("returns false for invalid priority", () => {
    expect(isGsdTask({ ...validTask, priority: "urgent" })).toBe(false);
  });

  test("returns false for invalid type", () => {
    expect(isGsdTask({ ...validTask, type: "manual" })).toBe(false);
  });

  test("returns false for non-positive wave", () => {
    expect(isGsdTask({ ...validTask, wave: 0 })).toBe(false);
    expect(isGsdTask({ ...validTask, wave: -1 })).toBe(false);
  });

  test("returns false for non-array files", () => {
    expect(isGsdTask({ ...validTask, files: "single-file.ts" })).toBe(false);
  });
});

// ============================================================================
// Type guard: isGsdWave()
// ============================================================================
describe("isGsdWave()", () => {
  const validWave: GsdWave = {
    wave_number: 1,
    task_ids: ["1", "2"],
    status: "pending",
    parallel: true,
  };

  test("returns true for a valid wave", () => {
    expect(isGsdWave(validWave)).toBe(true);
  });

  test("returns false for null/undefined", () => {
    expect(isGsdWave(null)).toBe(false);
    expect(isGsdWave(undefined)).toBe(false);
  });

  test("returns false for invalid wave_number", () => {
    expect(isGsdWave({ ...validWave, wave_number: 0 })).toBe(false);
    expect(isGsdWave({ ...validWave, wave_number: -1 })).toBe(false);
  });

  test("returns false for non-array task_ids", () => {
    expect(isGsdWave({ ...validWave, task_ids: "1" })).toBe(false);
  });

  test("returns false for invalid status", () => {
    expect(isGsdWave({ ...validWave, status: "running" })).toBe(false);
  });

  test("returns false for non-boolean parallel", () => {
    expect(isGsdWave({ ...validWave, parallel: "yes" })).toBe(false);
  });
});

// ============================================================================
// Type guard: isGsdState()
// ============================================================================
describe("isGsdState()", () => {
  const validState: GsdState = {
    plan_id: "plan-001",
    status: "executing",
    mode: "quick",
    current_wave: 2,
    completed_tasks: ["1"],
    failed_tasks: [],
    verification_results: [],
    started_at: "2026-02-01T09:00:00Z",
    last_updated: "2026-02-01T10:00:00Z",
  };

  test("returns true for a valid state", () => {
    expect(isGsdState(validState)).toBe(true);
  });

  test("returns true for state with optional fields", () => {
    const fullState: GsdState = {
      ...validState,
      current_phase: 1,
      decisions: ["Using CSS custom properties"],
      context_notes: ["Theme system follows existing pattern"],
      completed_at: "2026-02-01T11:00:00Z",
    };
    expect(isGsdState(fullState)).toBe(true);
  });

  test("returns false for null/undefined", () => {
    expect(isGsdState(null)).toBe(false);
    expect(isGsdState(undefined)).toBe(false);
  });

  test("returns false for missing plan_id", () => {
    const { plan_id, ...noId } = validState;
    expect(isGsdState(noId)).toBe(false);
  });

  test("returns false for invalid status", () => {
    expect(isGsdState({ ...validState, status: "active" })).toBe(false);
  });

  test("returns false for invalid mode", () => {
    expect(isGsdState({ ...validState, mode: "fast" })).toBe(false);
  });

  test("returns false for non-array completed_tasks", () => {
    expect(isGsdState({ ...validState, completed_tasks: "1" })).toBe(false);
  });
});

// ============================================================================
// Type guard: isVerificationResult()
// ============================================================================
describe("isVerificationResult()", () => {
  const validResult: VerificationResult = {
    status: "passed",
    truths: [{ description: "Dark mode toggle works", passed: true }],
    artifacts: [{ path: "src/toggle.tsx", check: "exists", passed: true }],
    key_links: [{ from: "Toggle", to: "Provider", type: "renders-within", passed: true }],
  };

  test("returns true for a valid result", () => {
    expect(isVerificationResult(validResult)).toBe(true);
  });

  test("returns true for result with optional fields", () => {
    const fullResult: VerificationResult = {
      ...validResult,
      checked_at: "2026-02-01T11:00:00Z",
      total_checks: 3,
      passed_checks: 3,
      failed_checks: 0,
    };
    expect(isVerificationResult(fullResult)).toBe(true);
  });

  test("returns false for null/undefined", () => {
    expect(isVerificationResult(null)).toBe(false);
    expect(isVerificationResult(undefined)).toBe(false);
  });

  test("returns false for invalid status", () => {
    expect(isVerificationResult({ ...validResult, status: "success" })).toBe(false);
  });

  test("returns false for non-array truths", () => {
    expect(isVerificationResult({ ...validResult, truths: "none" })).toBe(false);
  });

  test("returns false for non-array artifacts", () => {
    expect(isVerificationResult({ ...validResult, artifacts: {} })).toBe(false);
  });

  test("returns false for non-array key_links", () => {
    expect(isVerificationResult({ ...validResult, key_links: null })).toBe(false);
  });
});

// ============================================================================
// Type guard: isPlanningDirectoryConfig()
// ============================================================================
describe("isPlanningDirectoryConfig()", () => {
  const validConfig: PlanningDirectoryConfig = {
    mode: "quick",
    root: ".planning",
  };

  test("returns true for a valid config", () => {
    expect(isPlanningDirectoryConfig(validConfig)).toBe(true);
  });

  test("returns true for config with optional fields", () => {
    const fullConfig: PlanningDirectoryConfig = {
      ...validConfig,
      mode: "project",
      project_path: ".planning/PROJECT.md",
      roadmap_path: ".planning/ROADMAP.md",
      state_path: ".planning/STATE.md",
      research_dir: ".planning/research",
      phases_dir: ".planning/phases",
      quick_dir: ".planning/quick",
    };
    expect(isPlanningDirectoryConfig(fullConfig)).toBe(true);
  });

  test("returns false for null/undefined", () => {
    expect(isPlanningDirectoryConfig(null)).toBe(false);
    expect(isPlanningDirectoryConfig(undefined)).toBe(false);
  });

  test("returns false for invalid mode", () => {
    expect(isPlanningDirectoryConfig({ ...validConfig, mode: "fast" })).toBe(false);
  });

  test("returns false for missing root", () => {
    expect(isPlanningDirectoryConfig({ mode: "quick" })).toBe(false);
  });
});

// ============================================================================
// Type structures — compile-time + runtime shape verification
// ============================================================================
describe("Type structures (compile-time + runtime shape verification)", () => {
  test("GsdTask has all required fields", () => {
    const task: GsdTask = {
      id: "1",
      name: "Build auth module",
      status: "pending",
      wave: 1,
      priority: "high",
      type: "auto",
      files: ["src/auth.ts"],
      action: "Implement OAuth flow",
    };

    expect(task.id).toBe("1");
    expect(task.name).toBe("Build auth module");
    expect(task.status).toBe("pending");
    expect(task.wave).toBe(1);
    expect(task.priority).toBe("high");
    expect(task.type).toBe("auto");
    expect(task.files).toEqual(["src/auth.ts"]);
    expect(task.action).toBe("Implement OAuth flow");
  });

  test("GsdTask supports optional fields", () => {
    const task: GsdTask = {
      id: "2",
      name: "Verify OAuth redirect",
      status: "pending",
      wave: 2,
      priority: "high",
      type: "human-verify",
      files: [],
      action: "Manual OAuth verification",
      verify: "Check redirect works",
      done: "Human verified the flow",
      dependencies: ["1"],
      subtasks: [
        {
          id: "2.1",
          name: "Test redirect",
          files: ["tests/auth.test.ts"],
          action: "Run redirect tests",
        },
      ],
    };

    expect(task.verify).toBe("Check redirect works");
    expect(task.done).toBe("Human verified the flow");
    expect(task.dependencies).toEqual(["1"]);
    expect(task.subtasks).toHaveLength(1);
  });

  test("GsdSubtask has required fields", () => {
    const subtask: GsdSubtask = {
      id: "1.1",
      name: "Light theme variables",
      files: ["src/light.css"],
      action: "Define CSS custom properties for light theme",
    };

    expect(subtask.id).toBe("1.1");
    expect(subtask.name).toBe("Light theme variables");
    expect(subtask.files).toEqual(["src/light.css"]);
    expect(subtask.action).toBe("Define CSS custom properties for light theme");
  });

  test("GsdWave has all required fields", () => {
    const wave: GsdWave = {
      wave_number: 1,
      task_ids: ["1", "2"],
      status: "pending",
      parallel: true,
    };

    expect(wave.wave_number).toBe(1);
    expect(wave.task_ids).toEqual(["1", "2"]);
    expect(wave.status).toBe("pending");
    expect(wave.parallel).toBe(true);
  });

  test("GsdWave supports optional fields", () => {
    const wave: GsdWave = {
      wave_number: 2,
      task_ids: ["3"],
      status: "completed",
      parallel: false,
      started_at: "2026-02-01T09:00:00Z",
      completed_at: "2026-02-01T10:00:00Z",
      duration_ms: 3600000,
    };

    expect(wave.started_at).toBeDefined();
    expect(wave.completed_at).toBeDefined();
    expect(wave.duration_ms).toBe(3600000);
  });

  test("VerificationTruth has description and passed", () => {
    const truth: VerificationTruth = {
      description: "Dark mode persists user preference",
      passed: true,
    };

    expect(truth.description).toBe("Dark mode persists user preference");
    expect(truth.passed).toBe(true);
  });

  test("VerificationArtifact has path, check, and passed", () => {
    const artifact: VerificationArtifact = {
      path: "src/components/ThemeToggle.tsx",
      check: "substantive",
      passed: true,
    };

    expect(artifact.path).toBe("src/components/ThemeToggle.tsx");
    expect(artifact.check).toBe("substantive");
    expect(artifact.passed).toBe(true);
  });

  test("VerificationKeyLink has from, to, type, and passed", () => {
    const link: VerificationKeyLink = {
      from: "ThemeToggle",
      to: "ThemeProvider",
      type: "renders-within",
      passed: true,
    };

    expect(link.from).toBe("ThemeToggle");
    expect(link.to).toBe("ThemeProvider");
    expect(link.type).toBe("renders-within");
    expect(link.passed).toBe(true);
  });

  test("GsdPlanFrontmatter matches PLAN.md YAML spec", () => {
    const frontmatter: GsdPlanFrontmatter = {
      phase: "quick-bd-a3f8",
      plan: "01",
      type: "execute",
      mode: "quick",
      status: "pending",
      created: "2026-02-01T09:00:00Z",
      wave: 1,
      depends_on: [],
      files_modified: ["src/foo.ts"],
      autonomous: true,
      bead_id: "bd-a3f8.2",
      epic_id: "bd-a3f8",
      worker_id: "worker-1",
    };

    expect(frontmatter.phase).toBe("quick-bd-a3f8");
    expect(frontmatter.plan).toBe("01");
    expect(frontmatter.type).toBe("execute");
    expect(frontmatter.mode).toBe("quick");
    expect(frontmatter.status).toBe("pending");
    expect(frontmatter.wave).toBe(1);
    expect(frontmatter.autonomous).toBe(true);
  });

  test("GsdState has all required fields", () => {
    const state: GsdState = {
      plan_id: "plan-001",
      status: "executing",
      mode: "quick",
      current_wave: 2,
      completed_tasks: ["1"],
      failed_tasks: [],
      verification_results: [],
      started_at: "2026-02-01T09:00:00Z",
      last_updated: "2026-02-01T10:00:00Z",
    };

    expect(state.plan_id).toBe("plan-001");
    expect(state.status).toBe("executing");
    expect(state.mode).toBe("quick");
    expect(state.current_wave).toBe(2);
    expect(state.completed_tasks).toEqual(["1"]);
    expect(state.failed_tasks).toEqual([]);
  });
});

// ============================================================================
// JSON Serialization Safety
// ============================================================================
describe("JSON serialization safety", () => {
  test("GsdPlan is JSON-serializable", () => {
    const plan: GsdPlan = {
      id: "plan-001",
      title: "Dark mode",
      phase: "quick-bd-a3f8",
      created: "2026-02-01T09:00:00Z",
      status: "pending",
      mode: "quick",
      type: "execute",
      tasks: [
        {
          id: "1",
          name: "CSS vars",
          status: "pending",
          wave: 1,
          priority: "high",
          type: "auto",
          files: ["src/styles.css"],
          action: "Create vars",
        },
      ],
      waves: [{ wave_number: 1, task_ids: ["1"], status: "pending", parallel: true }],
    };

    const json = JSON.stringify(plan);
    const parsed = JSON.parse(json) as GsdPlan;
    expect(parsed.id).toBe("plan-001");
    expect(parsed.tasks).toHaveLength(1);
    expect(parsed.waves).toHaveLength(1);
  });

  test("GsdState is JSON-serializable", () => {
    const state: GsdState = {
      plan_id: "plan-001",
      status: "completed",
      mode: "project",
      current_wave: 3,
      completed_tasks: ["1", "2", "3"],
      failed_tasks: [],
      verification_results: [
        {
          status: "passed",
          truths: [{ description: "works", passed: true }],
          artifacts: [{ path: "src/x.ts", check: "exists", passed: true }],
          key_links: [],
        },
      ],
      started_at: "2026-02-01T09:00:00Z",
      last_updated: "2026-02-01T12:00:00Z",
    };

    const json = JSON.stringify(state);
    const parsed = JSON.parse(json) as GsdState;
    expect(parsed.plan_id).toBe("plan-001");
    expect(parsed.completed_tasks).toHaveLength(3);
    expect(parsed.verification_results).toHaveLength(1);
  });

  test("VerificationResult is JSON-serializable", () => {
    const result: VerificationResult = {
      status: "failed",
      truths: [{ description: "toggle works", passed: false }],
      artifacts: [{ path: "src/toggle.tsx", check: "wired", passed: false }],
      key_links: [{ from: "A", to: "B", type: "imported-by", passed: true }],
    };

    const json = JSON.stringify(result);
    const parsed = JSON.parse(json) as VerificationResult;
    expect(parsed.status).toBe("failed");
    expect(parsed.truths[0].passed).toBe(false);
  });

  test("const arrays are JSON-serializable", () => {
    expect(JSON.parse(JSON.stringify(GSD_MODES))).toEqual(["quick", "project"]);
    expect(JSON.parse(JSON.stringify(GSD_TASK_STATUSES))).toHaveLength(5);
    expect(JSON.parse(JSON.stringify(GSD_TASK_TYPES))).toHaveLength(4);
  });
});

// ============================================================================
// Edge cases and defensive behavior
// ============================================================================
describe("Edge cases", () => {
  test("isGsdPlan rejects plan with empty id", () => {
    expect(
      isGsdPlan({
        id: "",
        title: "X",
        phase: "y",
        created: "z",
        status: "pending",
        mode: "quick",
        type: "execute",
        tasks: [],
        waves: [],
      }),
    ).toBe(false);
  });

  test("isGsdTask rejects task with empty id", () => {
    expect(
      isGsdTask({
        id: "",
        name: "X",
        status: "pending",
        wave: 1,
        priority: "high",
        type: "auto",
        files: [],
        action: "do something",
      }),
    ).toBe(false);
  });

  test("isGsdWave rejects wave with empty task_ids", () => {
    // Empty task_ids is technically valid — a wave with no tasks
    // But wave_number must be >= 1
    expect(
      isGsdWave({
        wave_number: 1,
        task_ids: [],
        status: "pending",
        parallel: true,
      }),
    ).toBe(true); // Empty task_ids is valid
  });

  test("type guards handle deeply invalid input gracefully", () => {
    expect(isGsdPlan(42)).toBe(false);
    expect(isGsdPlan("string")).toBe(false);
    expect(isGsdPlan([])).toBe(false);
    expect(isGsdTask(42)).toBe(false);
    expect(isGsdWave(42)).toBe(false);
    expect(isGsdState(42)).toBe(false);
    expect(isVerificationResult(42)).toBe(false);
    expect(isPlanningDirectoryConfig(42)).toBe(false);
  });
});
