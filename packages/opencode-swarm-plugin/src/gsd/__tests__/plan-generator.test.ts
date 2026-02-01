/**
 * Tests for plan-generator.ts — PLAN.md generation, parsing, and validation.
 *
 * TDD RED phase: Tests define the contract BEFORE implementation.
 * Cross-references:
 *   - PLAN.md template spec: .planning/fork-plan/details/plan-md-template.md
 *   - Integration spec: .planning/fork-plan/02-INTEGRATION-SWARM-GSD.md
 *   - GSD types (T0): packages/opencode-swarm-plugin/src/gsd/gsd-types.ts
 *   - Factory pattern: packages/opencode-swarm-plugin/src/bridge/bead-client.ts
 */
import { describe, expect, test } from "bun:test";

import {
  createPlanGenerator,
  generatePlan,
  parsePlan,
  validatePlan,
  type GeneratePlanOptions,
  type PlanGenerator,
  type ValidationResult,
} from "../plan-generator.js";

import type {
  GsdPlan,
  GsdTask,
  GsdSubtask,
  GsdPlanFrontmatter,
} from "../gsd-types.js";

// ============================================================================
// Test fixtures
// ============================================================================

function makeTask(overrides: Partial<GsdTask> = {}): GsdTask {
  return {
    id: "1",
    name: "Implement CSS variables",
    status: "pending",
    wave: 1,
    priority: "high",
    type: "auto",
    files: ["src/styles/themes.css"],
    action: "Create CSS custom properties for light and dark themes",
    ...overrides,
  };
}

function makeTaskWithOptionals(overrides: Partial<GsdTask> = {}): GsdTask {
  return {
    ...makeTask(),
    verify: "Build passes, tests pass",
    done: "CSS variables are defined and working",
    dependencies: ["bd-a3f8.1"],
    ...overrides,
  };
}

function makeSubtask(overrides: Partial<GsdSubtask> = {}): GsdSubtask {
  return {
    id: "2.1",
    name: "Light theme variables",
    files: ["src/light.css"],
    action: "Define CSS custom properties for light theme",
    ...overrides,
  };
}

function makeOptions(overrides: Partial<GeneratePlanOptions> = {}): GeneratePlanOptions {
  return {
    id: "plan-001",
    title: "Add dark mode toggle",
    phase: "quick-bd-a3f8",
    mode: "quick",
    type: "execute",
    bead_id: "bd-a3f8.2",
    epic_id: "bd-a3f8",
    worker_id: "worker-1",
    ...overrides,
  };
}

// ============================================================================
// createPlanGenerator() — Factory function
// ============================================================================
describe("createPlanGenerator()", () => {
  test("returns a PlanGenerator object", () => {
    const generator = createPlanGenerator();
    expect(generator).toBeDefined();
    expect(typeof generator.generate).toBe("function");
    expect(typeof generator.parse).toBe("function");
    expect(typeof generator.validate).toBe("function");
  });

  test("accepts optional config", () => {
    const generator = createPlanGenerator({ indentSize: 2 });
    expect(generator).toBeDefined();
  });

  test("generate produces valid markdown", () => {
    const generator = createPlanGenerator();
    const result = generator.generate([makeTask()], makeOptions());
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });

  test("parse returns a GsdPlan", () => {
    const generator = createPlanGenerator();
    const markdown = generator.generate([makeTask()], makeOptions());
    const plan = generator.parse(markdown);
    expect(plan.id).toBe("plan-001");
    expect(plan.title).toBe("Add dark mode toggle");
  });

  test("validate returns a ValidationResult", () => {
    const generator = createPlanGenerator();
    const markdown = generator.generate([makeTask()], makeOptions());
    const plan = generator.parse(markdown);
    const result = generator.validate(plan);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });
});

// ============================================================================
// generatePlan() — Standalone function
// ============================================================================
describe("generatePlan()", () => {
  // --------------------------------------------------------------------------
  // YAML Frontmatter
  // --------------------------------------------------------------------------
  describe("YAML frontmatter", () => {
    test("starts and ends with --- delimiters", () => {
      const output = generatePlan([makeTask()], makeOptions());
      const lines = output.split("\n");
      expect(lines[0]).toBe("---");
      const secondDelimiter = lines.indexOf("---", 1);
      expect(secondDelimiter).toBeGreaterThan(1);
    });

    test("includes all required frontmatter fields", () => {
      const output = generatePlan([makeTask()], makeOptions());
      expect(output).toContain("phase:");
      expect(output).toContain("plan:");
      expect(output).toContain("type:");
      expect(output).toContain("mode:");
      expect(output).toContain("status:");
      expect(output).toContain("created:");
      expect(output).toContain("wave:");
      expect(output).toContain("depends_on:");
      expect(output).toContain("files_modified:");
      expect(output).toContain("autonomous:");
      expect(output).toContain("bead_id:");
      expect(output).toContain("epic_id:");
      expect(output).toContain("worker_id:");
    });

    test("uses values from options", () => {
      const opts = makeOptions({
        phase: "phase-2",
        mode: "project",
        type: "fix",
        bead_id: "bd-xyz",
        epic_id: "bd-epic",
        worker_id: "worker-42",
      });
      const output = generatePlan([makeTask()], opts);
      expect(output).toContain('phase: "phase-2"');
      expect(output).toContain('mode: "project"');
      expect(output).toContain('type: "fix"');
      expect(output).toContain('bead_id: "bd-xyz"');
      expect(output).toContain('epic_id: "bd-epic"');
      expect(output).toContain('worker_id: "worker-42"');
    });

    test("defaults status to pending", () => {
      const output = generatePlan([makeTask()], makeOptions());
      expect(output).toContain('status: "pending"');
    });

    test("defaults plan number to 01", () => {
      const output = generatePlan([makeTask()], makeOptions());
      expect(output).toContain('plan: "01"');
    });

    test("accepts custom plan number", () => {
      const output = generatePlan([makeTask()], makeOptions({ plan_number: "02" }));
      expect(output).toContain('plan: "02"');
    });

    test("calculates wave from minimum task wave", () => {
      const tasks = [makeTask({ wave: 2 }), makeTask({ id: "2", wave: 3 })];
      const output = generatePlan(tasks, makeOptions());
      expect(output).toContain("wave: 2");
    });

    test("includes depends_on when provided", () => {
      const output = generatePlan([makeTask()], makeOptions({ depends_on: ["bd-1", "bd-2"] }));
      expect(output).toContain("depends_on:");
      expect(output).toContain("bd-1");
      expect(output).toContain("bd-2");
    });

    test("defaults depends_on to empty array", () => {
      const output = generatePlan([makeTask()], makeOptions());
      expect(output).toContain("depends_on: []");
    });

    test("collects files_modified from all tasks", () => {
      const tasks = [
        makeTask({ files: ["src/a.ts"] }),
        makeTask({ id: "2", files: ["src/b.ts", "src/c.ts"] }),
      ];
      const output = generatePlan(tasks, makeOptions());
      expect(output).toContain("src/a.ts");
      expect(output).toContain("src/b.ts");
      expect(output).toContain("src/c.ts");
    });

    test("deduplicates files_modified", () => {
      const tasks = [
        makeTask({ files: ["src/a.ts", "src/b.ts"] }),
        makeTask({ id: "2", files: ["src/a.ts"] }),
      ];
      const output = generatePlan(tasks, makeOptions());
      // Count occurrences in the files_modified YAML array (not in task XML)
      const frontmatter = output.split("---")[1];
      const matches = frontmatter.match(/src\/a\.ts/g);
      // Should only appear once in frontmatter files_modified
      expect(matches).toHaveLength(1);
    });

    test("sets autonomous based on task types", () => {
      // All auto tasks = autonomous true
      const autoTasks = [makeTask({ type: "auto" })];
      const autoOutput = generatePlan(autoTasks, makeOptions());
      expect(autoOutput).toContain("autonomous: true");

      // Has human-verify = autonomous false
      const humanTasks = [makeTask({ type: "human-verify" })];
      const humanOutput = generatePlan(humanTasks, makeOptions());
      expect(humanOutput).toContain("autonomous: false");
    });

    test("includes created timestamp in ISO format", () => {
      const output = generatePlan([makeTask()], makeOptions());
      const isoRegex = /created: "\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;
      expect(output).toMatch(isoRegex);
    });
  });

  // --------------------------------------------------------------------------
  // XML Task Blocks
  // --------------------------------------------------------------------------
  describe("XML task blocks", () => {
    test("wraps tasks in <tasks> element", () => {
      const output = generatePlan([makeTask()], makeOptions());
      expect(output).toContain("<tasks>");
      expect(output).toContain("</tasks>");
    });

    test("generates task with all required attributes", () => {
      const output = generatePlan([makeTask()], makeOptions());
      expect(output).toMatch(/<task\s+id="1"/);
      expect(output).toMatch(/status="pending"/);
      expect(output).toMatch(/wave="1"/);
      expect(output).toMatch(/priority="high"/);
      expect(output).toMatch(/type="auto"/);
    });

    test("generates <name> element", () => {
      const output = generatePlan([makeTask()], makeOptions());
      expect(output).toContain("<name>Implement CSS variables</name>");
    });

    test("generates <files> element", () => {
      const task = makeTask({ files: ["src/a.ts", "src/b.ts"] });
      const output = generatePlan([task], makeOptions());
      expect(output).toContain("<files>src/a.ts, src/b.ts</files>");
    });

    test("generates <action> element", () => {
      const output = generatePlan([makeTask()], makeOptions());
      expect(output).toContain("<action>");
      expect(output).toContain("Create CSS custom properties for light and dark themes");
      expect(output).toContain("</action>");
    });

    test("generates optional <verify> element when present", () => {
      const task = makeTaskWithOptionals();
      const output = generatePlan([task], makeOptions());
      expect(output).toContain("<verify>");
      expect(output).toContain("Build passes, tests pass");
      expect(output).toContain("</verify>");
    });

    test("generates optional <done> element when present", () => {
      const task = makeTaskWithOptionals();
      const output = generatePlan([task], makeOptions());
      expect(output).toContain("<done>");
      expect(output).toContain("CSS variables are defined and working");
      expect(output).toContain("</done>");
    });

    test("omits <verify> and <done> when not present", () => {
      const output = generatePlan([makeTask()], makeOptions());
      expect(output).not.toContain("<verify>");
      expect(output).not.toContain("<done>");
    });

    test("generates multiple tasks", () => {
      const tasks = [
        makeTask({ id: "1", name: "Task one" }),
        makeTask({ id: "2", name: "Task two", wave: 2 }),
      ];
      const output = generatePlan(tasks, makeOptions());
      expect(output).toMatch(/<task\s+id="1"/);
      expect(output).toMatch(/<task\s+id="2"/);
      expect(output).toContain("<name>Task one</name>");
      expect(output).toContain("<name>Task two</name>");
    });

    test("generates subtasks when present", () => {
      const task = makeTask({
        id: "2",
        subtasks: [
          makeSubtask({ id: "2.1", name: "Sub A" }),
          makeSubtask({ id: "2.2", name: "Sub B" }),
        ],
      });
      const output = generatePlan([task], makeOptions());
      expect(output).toMatch(/<subtask\s+id="2\.1">/);
      expect(output).toMatch(/<subtask\s+id="2\.2">/);
      expect(output).toContain("<name>Sub A</name>");
      expect(output).toContain("<name>Sub B</name>");
      expect(output).toContain("</subtask>");
    });

    test("subtask has name, files, and action elements", () => {
      const task = makeTask({
        subtasks: [makeSubtask()],
      });
      const output = generatePlan([task], makeOptions());
      expect(output).toContain("<name>Light theme variables</name>");
      expect(output).toContain("<files>src/light.css</files>");
      expect(output).toContain("Define CSS custom properties for light theme");
    });
  });

  // --------------------------------------------------------------------------
  // Edge cases
  // --------------------------------------------------------------------------
  describe("edge cases", () => {
    test("handles empty tasks array", () => {
      const output = generatePlan([], makeOptions());
      expect(output).toContain("<tasks>");
      expect(output).toContain("</tasks>");
      // Should still have valid frontmatter
      expect(output).toContain("---");
    });

    test("handles task with empty files array", () => {
      const task = makeTask({ files: [] });
      const output = generatePlan([task], makeOptions());
      expect(output).toContain("<files></files>");
    });

    test("escapes XML special characters in action text", () => {
      const task = makeTask({ action: 'Use <div> tags & "quotes"' });
      const output = generatePlan([task], makeOptions());
      // Action content should be preserved (it's within CDATA-like context in markdown)
      expect(output).toContain("<action>");
      expect(output).toContain("</action>");
    });

    test("handles task with multiline action", () => {
      const task = makeTask({
        action: "Step 1: Do this\nStep 2: Do that\nStep 3: Done",
      });
      const output = generatePlan([task], makeOptions());
      expect(output).toContain("Step 1: Do this");
      expect(output).toContain("Step 2: Do that");
      expect(output).toContain("Step 3: Done");
    });

    test("handles special characters in task name", () => {
      const task = makeTask({ name: "Fix <auth> & 'session' module" });
      const output = generatePlan([task], makeOptions());
      expect(output).toContain("Fix <auth> & 'session' module");
    });
  });
});

// ============================================================================
// parsePlan() — Standalone function
// ============================================================================
describe("parsePlan()", () => {
  // --------------------------------------------------------------------------
  // Frontmatter parsing
  // --------------------------------------------------------------------------
  describe("frontmatter parsing", () => {
    test("parses all frontmatter fields", () => {
      const markdown = generatePlan([makeTask()], makeOptions());
      const plan = parsePlan(markdown);

      expect(plan.id).toBe("plan-001");
      expect(plan.title).toBe("Add dark mode toggle");
      expect(plan.phase).toBe("quick-bd-a3f8");
      expect(plan.mode).toBe("quick");
      expect(plan.type).toBe("execute");
      expect(plan.status).toBe("pending");
      expect(plan.bead_id).toBe("bd-a3f8.2");
      expect(plan.epic_id).toBe("bd-a3f8");
      expect(plan.worker_id).toBe("worker-1");
    });

    test("parses created timestamp", () => {
      const markdown = generatePlan([makeTask()], makeOptions());
      const plan = parsePlan(markdown);
      expect(plan.created).toBeDefined();
      expect(plan.created.length).toBeGreaterThan(0);
    });

    test("parses depends_on array", () => {
      const markdown = generatePlan(
        [makeTask()],
        makeOptions({ depends_on: ["bd-1", "bd-2"] }),
      );
      const plan = parsePlan(markdown);
      expect(plan.depends_on).toEqual(["bd-1", "bd-2"]);
    });

    test("parses empty depends_on", () => {
      const markdown = generatePlan([makeTask()], makeOptions());
      const plan = parsePlan(markdown);
      expect(plan.depends_on).toEqual([]);
    });

    test("parses files_modified from frontmatter", () => {
      const markdown = generatePlan(
        [makeTask({ files: ["src/a.ts", "src/b.ts"] })],
        makeOptions(),
      );
      const plan = parsePlan(markdown);
      expect(plan.files_modified).toBeDefined();
      expect(plan.files_modified).toContain("src/a.ts");
      expect(plan.files_modified).toContain("src/b.ts");
    });

    test("parses autonomous flag", () => {
      const autoMarkdown = generatePlan([makeTask({ type: "auto" })], makeOptions());
      const autoPlan = parsePlan(autoMarkdown);
      expect(autoPlan.autonomous).toBe(true);

      const humanMarkdown = generatePlan([makeTask({ type: "human-verify" })], makeOptions());
      const humanPlan = parsePlan(humanMarkdown);
      expect(humanPlan.autonomous).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // Task parsing
  // --------------------------------------------------------------------------
  describe("task parsing", () => {
    test("parses single task", () => {
      const markdown = generatePlan([makeTask()], makeOptions());
      const plan = parsePlan(markdown);
      expect(plan.tasks).toHaveLength(1);
      expect(plan.tasks[0].id).toBe("1");
      expect(plan.tasks[0].name).toBe("Implement CSS variables");
      expect(plan.tasks[0].status).toBe("pending");
      expect(plan.tasks[0].wave).toBe(1);
      expect(plan.tasks[0].priority).toBe("high");
      expect(plan.tasks[0].type).toBe("auto");
    });

    test("parses task files", () => {
      const markdown = generatePlan(
        [makeTask({ files: ["src/a.ts", "src/b.ts"] })],
        makeOptions(),
      );
      const plan = parsePlan(markdown);
      expect(plan.tasks[0].files).toEqual(["src/a.ts", "src/b.ts"]);
    });

    test("parses task action", () => {
      const markdown = generatePlan([makeTask()], makeOptions());
      const plan = parsePlan(markdown);
      expect(plan.tasks[0].action).toContain(
        "Create CSS custom properties for light and dark themes",
      );
    });

    test("parses optional verify and done", () => {
      const markdown = generatePlan([makeTaskWithOptionals()], makeOptions());
      const plan = parsePlan(markdown);
      expect(plan.tasks[0].verify).toContain("Build passes, tests pass");
      expect(plan.tasks[0].done).toContain("CSS variables are defined and working");
    });

    test("parses multiple tasks", () => {
      const tasks = [
        makeTask({ id: "1", name: "Task one", wave: 1 }),
        makeTask({ id: "2", name: "Task two", wave: 2 }),
      ];
      const markdown = generatePlan(tasks, makeOptions());
      const plan = parsePlan(markdown);
      expect(plan.tasks).toHaveLength(2);
      expect(plan.tasks[0].id).toBe("1");
      expect(plan.tasks[1].id).toBe("2");
    });

    test("parses subtasks", () => {
      const task = makeTask({
        id: "2",
        subtasks: [
          makeSubtask({ id: "2.1", name: "Sub A" }),
          makeSubtask({ id: "2.2", name: "Sub B" }),
        ],
      });
      const markdown = generatePlan([task], makeOptions());
      const plan = parsePlan(markdown);
      expect(plan.tasks[0].subtasks).toHaveLength(2);
      expect(plan.tasks[0].subtasks![0].id).toBe("2.1");
      expect(plan.tasks[0].subtasks![0].name).toBe("Sub A");
      expect(plan.tasks[0].subtasks![1].id).toBe("2.2");
      expect(plan.tasks[0].subtasks![1].name).toBe("Sub B");
    });

    test("parses tasks with no optional elements", () => {
      const markdown = generatePlan([makeTask()], makeOptions());
      const plan = parsePlan(markdown);
      expect(plan.tasks[0].verify).toBeUndefined();
      expect(plan.tasks[0].done).toBeUndefined();
      expect(plan.tasks[0].subtasks).toBeUndefined();
    });
  });

  // --------------------------------------------------------------------------
  // Wave derivation
  // --------------------------------------------------------------------------
  describe("wave derivation", () => {
    test("derives waves from tasks", () => {
      const tasks = [
        makeTask({ id: "1", wave: 1 }),
        makeTask({ id: "2", wave: 1 }),
        makeTask({ id: "3", wave: 2 }),
      ];
      const markdown = generatePlan(tasks, makeOptions());
      const plan = parsePlan(markdown);
      expect(plan.waves).toHaveLength(2);
      expect(plan.waves[0].wave_number).toBe(1);
      expect(plan.waves[0].task_ids).toContain("1");
      expect(plan.waves[0].task_ids).toContain("2");
      expect(plan.waves[1].wave_number).toBe(2);
      expect(plan.waves[1].task_ids).toContain("3");
    });

    test("sets wave status to pending", () => {
      const markdown = generatePlan([makeTask()], makeOptions());
      const plan = parsePlan(markdown);
      expect(plan.waves[0].status).toBe("pending");
    });

    test("sets parallel to true for waves with multiple tasks", () => {
      const tasks = [
        makeTask({ id: "1", wave: 1 }),
        makeTask({ id: "2", wave: 1 }),
      ];
      const markdown = generatePlan(tasks, makeOptions());
      const plan = parsePlan(markdown);
      expect(plan.waves[0].parallel).toBe(true);
    });

    test("sets parallel to false for single-task waves", () => {
      const markdown = generatePlan([makeTask()], makeOptions());
      const plan = parsePlan(markdown);
      expect(plan.waves[0].parallel).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // Roundtrip: generate → parse
  // --------------------------------------------------------------------------
  describe("roundtrip (generate → parse)", () => {
    test("preserves all frontmatter fields through roundtrip", () => {
      const opts = makeOptions({
        phase: "phase-3",
        mode: "project",
        type: "fix",
        plan_number: "02",
        depends_on: ["bd-1", "bd-2"],
      });
      const tasks = [makeTask({ files: ["src/x.ts"] })];
      const markdown = generatePlan(tasks, opts);
      const plan = parsePlan(markdown);

      expect(plan.id).toBe("plan-001");
      expect(plan.title).toBe("Add dark mode toggle");
      expect(plan.phase).toBe("phase-3");
      expect(plan.mode).toBe("project");
      expect(plan.type).toBe("fix");
      expect(plan.plan_number).toBe("02");
      expect(plan.depends_on).toEqual(["bd-1", "bd-2"]);
    });

    test("preserves task details through roundtrip", () => {
      const task = makeTaskWithOptionals({
        id: "5",
        name: "Build auth module",
        status: "pending",
        wave: 3,
        priority: "critical",
        type: "human-verify",
        files: ["src/auth.ts", "tests/auth.test.ts"],
        action: "Implement OAuth with:\n1. Login\n2. Logout\n3. Refresh",
        verify: "All tests pass\nNo lint errors",
        done: "Auth module is complete",
      });
      const markdown = generatePlan([task], makeOptions());
      const plan = parsePlan(markdown);

      expect(plan.tasks[0].id).toBe("5");
      expect(plan.tasks[0].name).toBe("Build auth module");
      expect(plan.tasks[0].wave).toBe(3);
      expect(plan.tasks[0].priority).toBe("critical");
      expect(plan.tasks[0].type).toBe("human-verify");
      expect(plan.tasks[0].files).toEqual(["src/auth.ts", "tests/auth.test.ts"]);
      expect(plan.tasks[0].action).toContain("Implement OAuth with:");
      expect(plan.tasks[0].verify).toContain("All tests pass");
      expect(plan.tasks[0].done).toContain("Auth module is complete");
    });

    test("preserves subtasks through roundtrip", () => {
      const task = makeTask({
        id: "2",
        subtasks: [
          makeSubtask({ id: "2.1", name: "Sub A", files: ["a.ts"], action: "Do A" }),
          makeSubtask({ id: "2.2", name: "Sub B", files: ["b.ts"], action: "Do B" }),
        ],
      });
      const markdown = generatePlan([task], makeOptions());
      const plan = parsePlan(markdown);

      expect(plan.tasks[0].subtasks).toHaveLength(2);
      expect(plan.tasks[0].subtasks![0].id).toBe("2.1");
      expect(plan.tasks[0].subtasks![0].name).toBe("Sub A");
      expect(plan.tasks[0].subtasks![0].files).toEqual(["a.ts"]);
      expect(plan.tasks[0].subtasks![0].action).toContain("Do A");
      expect(plan.tasks[0].subtasks![1].id).toBe("2.2");
      expect(plan.tasks[0].subtasks![1].name).toBe("Sub B");
    });
  });

  // --------------------------------------------------------------------------
  // Error handling
  // --------------------------------------------------------------------------
  describe("error handling", () => {
    test("throws on empty input", () => {
      expect(() => parsePlan("")).toThrow();
    });

    test("throws on missing frontmatter", () => {
      expect(() => parsePlan("# Just a heading\nSome content")).toThrow();
    });

    test("throws on missing closing frontmatter delimiter", () => {
      expect(() => parsePlan("---\nphase: quick\n")).toThrow();
    });

    test("throws on missing required frontmatter fields", () => {
      const minimal = "---\nphase: quick\n---\n<tasks></tasks>";
      expect(() => parsePlan(minimal)).toThrow();
    });
  });
});

// ============================================================================
// validatePlan() — Standalone function
// ============================================================================
describe("validatePlan()", () => {
  function makeValidPlan(overrides: Partial<GsdPlan> = {}): GsdPlan {
    return {
      id: "plan-001",
      title: "Add dark mode toggle",
      phase: "quick-bd-a3f8",
      created: "2026-02-01T09:00:00Z",
      status: "pending",
      mode: "quick",
      type: "execute",
      tasks: [makeTask()],
      waves: [{ wave_number: 1, task_ids: ["1"], status: "pending", parallel: false }],
      ...overrides,
    };
  }

  // --------------------------------------------------------------------------
  // Valid plans
  // --------------------------------------------------------------------------
  describe("valid plans", () => {
    test("returns valid for a well-formed plan", () => {
      const result = validatePlan(makeValidPlan());
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    test("returns valid for plan with multiple waves", () => {
      const plan = makeValidPlan({
        tasks: [
          makeTask({ id: "1", wave: 1 }),
          makeTask({ id: "2", wave: 2 }),
        ],
        waves: [
          { wave_number: 1, task_ids: ["1"], status: "pending", parallel: false },
          { wave_number: 2, task_ids: ["2"], status: "pending", parallel: false },
        ],
      });
      const result = validatePlan(plan);
      expect(result.valid).toBe(true);
    });

    test("returns valid for plan with subtasks", () => {
      const plan = makeValidPlan({
        tasks: [
          makeTask({
            subtasks: [
              makeSubtask({ id: "1.1" }),
              makeSubtask({ id: "1.2" }),
            ],
          }),
        ],
      });
      const result = validatePlan(plan);
      expect(result.valid).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // Required fields validation
  // --------------------------------------------------------------------------
  describe("required fields", () => {
    test("reports error for empty id", () => {
      const plan = makeValidPlan({ id: "" });
      const result = validatePlan(plan);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("id"))).toBe(true);
    });

    test("reports error for empty title", () => {
      const plan = makeValidPlan({ title: "" });
      const result = validatePlan(plan);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("title"))).toBe(true);
    });

    test("reports error for empty phase", () => {
      const plan = makeValidPlan({ phase: "" });
      const result = validatePlan(plan);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("phase"))).toBe(true);
    });

    test("reports error for empty created", () => {
      const plan = makeValidPlan({ created: "" });
      const result = validatePlan(plan);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("created"))).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // Task reference consistency
  // --------------------------------------------------------------------------
  describe("task reference consistency", () => {
    test("reports error when wave references non-existent task", () => {
      const plan = makeValidPlan({
        tasks: [makeTask({ id: "1" })],
        waves: [{ wave_number: 1, task_ids: ["1", "99"], status: "pending", parallel: true }],
      });
      const result = validatePlan(plan);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("99"))).toBe(true);
    });

    test("reports error when task is not in any wave", () => {
      const plan = makeValidPlan({
        tasks: [makeTask({ id: "1" }), makeTask({ id: "2", wave: 2 })],
        waves: [{ wave_number: 1, task_ids: ["1"], status: "pending", parallel: false }],
      });
      const result = validatePlan(plan);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("2"))).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // Dependency validation
  // --------------------------------------------------------------------------
  describe("dependency validation", () => {
    test("reports error for self-referencing dependency", () => {
      const plan = makeValidPlan({
        tasks: [makeTask({ id: "1", dependencies: ["1"] })],
      });
      const result = validatePlan(plan);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("self"))).toBe(true);
    });

    test("reports error for circular dependencies", () => {
      const plan = makeValidPlan({
        tasks: [
          makeTask({ id: "1", wave: 1, dependencies: ["2"] }),
          makeTask({ id: "2", wave: 2, dependencies: ["1"] }),
        ],
        waves: [
          { wave_number: 1, task_ids: ["1"], status: "pending", parallel: false },
          { wave_number: 2, task_ids: ["2"], status: "pending", parallel: false },
        ],
      });
      const result = validatePlan(plan);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.toLowerCase().includes("circular"))).toBe(true);
    });

    test("reports error for dependency on non-existent task", () => {
      const plan = makeValidPlan({
        tasks: [makeTask({ id: "1", dependencies: ["999"] })],
      });
      const result = validatePlan(plan);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("999"))).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // Duplicate detection
  // --------------------------------------------------------------------------
  describe("duplicate detection", () => {
    test("reports error for duplicate task IDs", () => {
      const plan = makeValidPlan({
        tasks: [makeTask({ id: "1" }), makeTask({ id: "1", name: "Duplicate" })],
        waves: [{ wave_number: 1, task_ids: ["1"], status: "pending", parallel: false }],
      });
      const result = validatePlan(plan);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("duplicate") || e.includes("Duplicate"))).toBe(true);
    });

    test("reports error for duplicate wave numbers", () => {
      const plan = makeValidPlan({
        waves: [
          { wave_number: 1, task_ids: ["1"], status: "pending", parallel: false },
          { wave_number: 1, task_ids: ["1"], status: "pending", parallel: false },
        ],
      });
      const result = validatePlan(plan);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("duplicate") || e.includes("Duplicate"))).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // Edge cases
  // --------------------------------------------------------------------------
  describe("edge cases", () => {
    test("empty tasks array is valid (plan with no work)", () => {
      const plan = makeValidPlan({ tasks: [], waves: [] });
      const result = validatePlan(plan);
      expect(result.valid).toBe(true);
    });

    test("validates task with empty files array", () => {
      const plan = makeValidPlan({
        tasks: [makeTask({ files: [] })],
      });
      const result = validatePlan(plan);
      expect(result.valid).toBe(true);
    });
  });
});

// ============================================================================
// Integration: all 3 functions work together
// ============================================================================
describe("integration: generate → parse → validate", () => {
  test("full pipeline produces valid plan", () => {
    const tasks = [
      makeTask({ id: "1", wave: 1, files: ["src/a.ts"] }),
      makeTask({ id: "2", wave: 1, files: ["src/b.ts"], dependencies: ["1"] }),
      makeTask({ id: "3", wave: 2, files: ["src/c.ts"], dependencies: ["1", "2"] }),
    ];
    const options = makeOptions({
      depends_on: ["external-bd-1"],
    });

    const markdown = generatePlan(tasks, options);
    const plan = parsePlan(markdown);
    const result = validatePlan(plan);

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(plan.tasks).toHaveLength(3);
    expect(plan.waves.length).toBeGreaterThanOrEqual(2);
  });

  test("complex plan with subtasks roundtrips cleanly", () => {
    const tasks = [
      makeTask({
        id: "1",
        wave: 1,
        type: "auto",
        subtasks: [
          makeSubtask({ id: "1.1", name: "Setup", files: ["setup.ts"], action: "Init" }),
          makeSubtask({ id: "1.2", name: "Config", files: ["config.ts"], action: "Configure" }),
        ],
        verify: "All setup complete",
        done: "Ready for next phase",
      }),
      makeTask({
        id: "2",
        wave: 2,
        type: "human-verify",
        dependencies: ["1"],
        action: "Verify OAuth redirect manually",
      }),
    ];

    const markdown = generatePlan(tasks, makeOptions());
    const plan = parsePlan(markdown);
    const result = validatePlan(plan);

    expect(result.valid).toBe(true);
    expect(plan.tasks[0].subtasks).toHaveLength(2);
    expect(plan.autonomous).toBe(false); // has human-verify task
  });
});
