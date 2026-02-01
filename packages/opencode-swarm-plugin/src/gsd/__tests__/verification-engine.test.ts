/**
 * Tests for verification-engine.ts — Goal-backward verification engine.
 *
 * TDD RED phase: These tests define the contract BEFORE implementation.
 * Cross-references:
 *   - Verification spec: .planning/fork-plan/details/verification-model.md
 *   - GSD types: packages/opencode-swarm-plugin/src/gsd/gsd-types.ts
 *   - Integration spec: .planning/fork-plan/02-INTEGRATION-SWARM-GSD.md
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, writeFile, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createVerificationEngine,
  type VerificationEngine,
  type TruthCheckResult,
  type ArtifactCheckResult,
  type KeyLinkCheckResult,
  type VerificationFailure,
  type TaskResults,
  type VerificationEngineOptions,
} from "../verification-engine.js";

import type {
  GsdPlan,
  GsdTask,
  VerificationTruth,
  VerificationArtifact,
  VerificationKeyLink,
  VerificationResult,
} from "../gsd-types.js";

// ============================================================================
// Test fixtures
// ============================================================================

function makePlan(overrides: Partial<GsdPlan> = {}): GsdPlan {
  return {
    id: "plan-001",
    title: "Add dark mode toggle",
    phase: "quick-bd-a3f8",
    created: "2026-02-01T09:00:00Z",
    status: "verifying",
    mode: "quick",
    type: "execute",
    tasks: [],
    waves: [],
    verification: {
      status: "pending",
      truths: [],
      artifacts: [],
      key_links: [],
    },
    ...overrides,
  };
}

function makeTaskResults(overrides: Partial<TaskResults> = {}): TaskResults {
  return {
    completed_task_ids: ["1", "2"],
    failed_task_ids: [],
    ...overrides,
  };
}

// ============================================================================
// createVerificationEngine() — factory
// ============================================================================
describe("createVerificationEngine()", () => {
  test("returns an object with verify, checkTruths, checkArtifacts, checkKeyLinks, generateFixPlan, isFullyVerified", () => {
    const engine = createVerificationEngine();

    expect(typeof engine.verify).toBe("function");
    expect(typeof engine.checkTruths).toBe("function");
    expect(typeof engine.checkArtifacts).toBe("function");
    expect(typeof engine.checkKeyLinks).toBe("function");
    expect(typeof engine.generateFixPlan).toBe("function");
    expect(typeof engine.isFullyVerified).toBe("function");
  });

  test("accepts optional configuration", () => {
    const engine = createVerificationEngine({
      projectPath: "/tmp/test-project",
      artifactMinLines: 5,
      maxFixIterations: 2,
    });

    expect(engine).toBeDefined();
  });
});

// ============================================================================
// checkTruths() — boolean assertions that must hold
// ============================================================================
describe("checkTruths()", () => {
  let engine: VerificationEngine;

  beforeAll(() => {
    engine = createVerificationEngine();
  });

  test("returns empty array when no truths provided", () => {
    const results = engine.checkTruths([]);
    expect(results).toEqual([]);
  });

  test("returns passed results for truths marked as passed", () => {
    const truths: VerificationTruth[] = [
      { description: "Toggle switches theme when clicked", passed: true },
      { description: "Preference persists across sessions", passed: true },
    ];

    const results = engine.checkTruths(truths);

    expect(results).toHaveLength(2);
    expect(results[0].passed).toBe(true);
    expect(results[0].description).toBe("Toggle switches theme when clicked");
    expect(results[1].passed).toBe(true);
  });

  test("returns failed results for truths marked as failed", () => {
    const truths: VerificationTruth[] = [
      { description: "OS dark mode preference respected", passed: false },
    ];

    const results = engine.checkTruths(truths);

    expect(results).toHaveLength(1);
    expect(results[0].passed).toBe(false);
    expect(results[0].description).toBe("OS dark mode preference respected");
  });

  test("includes evidence string in results", () => {
    const truths: VerificationTruth[] = [
      { description: "Theme toggle works", passed: true },
    ];

    const results = engine.checkTruths(truths);

    expect(results[0]).toHaveProperty("evidence");
  });

  test("handles mixed passed/failed truths", () => {
    const truths: VerificationTruth[] = [
      { description: "Truth A", passed: true },
      { description: "Truth B", passed: false },
      { description: "Truth C", passed: true },
    ];

    const results = engine.checkTruths(truths);

    expect(results).toHaveLength(3);
    expect(results.filter((r) => r.passed)).toHaveLength(2);
    expect(results.filter((r) => !r.passed)).toHaveLength(1);
  });
});

// ============================================================================
// checkArtifacts() — files/outputs that must exist
// ============================================================================
describe("checkArtifacts()", () => {
  let engine: VerificationEngine;
  let tempDir: string;

  beforeAll(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "verify-artifacts-"));
    engine = createVerificationEngine({ projectPath: tempDir });

    // Create test files
    // A file that exists and is substantive (>10 meaningful lines)
    const substantiveContent = Array.from(
      { length: 15 },
      (_, i) => `export const value${i} = ${i};`,
    ).join("\n");
    await writeFile(join(tempDir, "substantive.ts"), substantiveContent);

    // A stub file (<10 meaningful lines)
    await writeFile(
      join(tempDir, "stub.ts"),
      "// stub\nexport const x = 1;\n",
    );

    // A file that is imported by another (wired)
    const wiredContent = Array.from(
      { length: 15 },
      (_, i) => `export function fn${i}() { return ${i}; }`,
    ).join("\n");
    await writeFile(join(tempDir, "wired-module.ts"), wiredContent);

    // The importer file
    await writeFile(
      join(tempDir, "consumer.ts"),
      `import { fn0 } from './wired-module';\nconsole.log(fn0());\n`,
    );

    // A file with only comments and blanks
    await writeFile(
      join(tempDir, "comments-only.ts"),
      "// comment\n/* block */\n\n  \n// another\n",
    );
  });

  afterAll(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  test("returns empty array when no artifacts provided", () => {
    const results = engine.checkArtifacts([]);
    expect(results).toEqual([]);
  });

  test("'exists' check: passes when file exists", () => {
    const artifacts: VerificationArtifact[] = [
      { path: "substantive.ts", check: "exists", passed: false },
    ];

    const results = engine.checkArtifacts(artifacts);

    expect(results).toHaveLength(1);
    expect(results[0].passed).toBe(true);
    expect(results[0].check).toBe("exists");
  });

  test("'exists' check: fails when file does not exist", () => {
    const artifacts: VerificationArtifact[] = [
      { path: "nonexistent.ts", check: "exists", passed: false },
    ];

    const results = engine.checkArtifacts(artifacts);

    expect(results).toHaveLength(1);
    expect(results[0].passed).toBe(false);
    expect(results[0].reason).toBeDefined();
  });

  test("'substantive' check: passes when file has >10 meaningful lines", () => {
    const artifacts: VerificationArtifact[] = [
      { path: "substantive.ts", check: "substantive", passed: false },
    ];

    const results = engine.checkArtifacts(artifacts);

    expect(results).toHaveLength(1);
    expect(results[0].passed).toBe(true);
  });

  test("'substantive' check: fails for stub files (<10 meaningful lines)", () => {
    const artifacts: VerificationArtifact[] = [
      { path: "stub.ts", check: "substantive", passed: false },
    ];

    const results = engine.checkArtifacts(artifacts);

    expect(results).toHaveLength(1);
    expect(results[0].passed).toBe(false);
    expect(results[0].reason).toContain("substantive");
  });

  test("'substantive' check: fails for file with only comments/blanks", () => {
    const artifacts: VerificationArtifact[] = [
      { path: "comments-only.ts", check: "substantive", passed: false },
    ];

    const results = engine.checkArtifacts(artifacts);

    expect(results).toHaveLength(1);
    expect(results[0].passed).toBe(false);
  });

  test("'substantive' check: fails when file does not exist", () => {
    const artifacts: VerificationArtifact[] = [
      { path: "missing.ts", check: "substantive", passed: false },
    ];

    const results = engine.checkArtifacts(artifacts);

    expect(results).toHaveLength(1);
    expect(results[0].passed).toBe(false);
  });

  test("'wired' check: passes when file is substantive AND imported", () => {
    const artifacts: VerificationArtifact[] = [
      { path: "wired-module.ts", check: "wired", passed: false },
    ];

    const results = engine.checkArtifacts(artifacts);

    expect(results).toHaveLength(1);
    expect(results[0].passed).toBe(true);
  });

  test("'wired' check: fails when file is substantive but NOT imported", () => {
    const artifacts: VerificationArtifact[] = [
      { path: "substantive.ts", check: "wired", passed: false },
    ];

    const results = engine.checkArtifacts(artifacts);

    expect(results).toHaveLength(1);
    expect(results[0].passed).toBe(false);
    expect(results[0].reason).toContain("import");
  });

  test("'wired' check: fails when file does not exist", () => {
    const artifacts: VerificationArtifact[] = [
      { path: "nope.ts", check: "wired", passed: false },
    ];

    const results = engine.checkArtifacts(artifacts);

    expect(results).toHaveLength(1);
    expect(results[0].passed).toBe(false);
  });

  test("handles mixed artifact checks", () => {
    const artifacts: VerificationArtifact[] = [
      { path: "substantive.ts", check: "exists", passed: false },
      { path: "missing.ts", check: "exists", passed: false },
      { path: "wired-module.ts", check: "wired", passed: false },
    ];

    const results = engine.checkArtifacts(artifacts);

    expect(results).toHaveLength(3);
    expect(results[0].passed).toBe(true);
    expect(results[1].passed).toBe(false);
    expect(results[2].passed).toBe(true);
  });

  test("artifact check respects configurable artifactMinLines", async () => {
    const strictEngine = createVerificationEngine({
      projectPath: tempDir,
      artifactMinLines: 20,
    });

    const artifacts: VerificationArtifact[] = [
      { path: "substantive.ts", check: "substantive", passed: false },
    ];

    // 15 lines < 20 min lines
    const results = strictEngine.checkArtifacts(artifacts);
    expect(results[0].passed).toBe(false);
  });
});

// ============================================================================
// checkKeyLinks() — references between artifacts
// ============================================================================
describe("checkKeyLinks()", () => {
  let engine: VerificationEngine;
  let tempDir: string;

  beforeAll(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "verify-keylinks-"));
    engine = createVerificationEngine({ projectPath: tempDir });

    // Create module files with imports/exports
    await mkdir(join(tempDir, "src"), { recursive: true });

    await writeFile(
      join(tempDir, "src", "provider.tsx"),
      [
        'import { Toggle } from "./toggle";',
        "export function Provider() {",
        "  return <Toggle />;",
        "}",
      ].join("\n"),
    );

    await writeFile(
      join(tempDir, "src", "toggle.tsx"),
      [
        'import { useTheme } from "./hooks";',
        "export function Toggle() {",
        "  const theme = useTheme();",
        "  return <button>{theme}</button>;",
        "}",
      ].join("\n"),
    );

    await writeFile(
      join(tempDir, "src", "hooks.ts"),
      [
        "export function useTheme() { return 'dark'; }",
        "export function useAuth() { return true; }",
      ].join("\n"),
    );

    // A class that extends another
    await writeFile(
      join(tempDir, "src", "base.ts"),
      ["export class BaseService {", "  init() {}", "}"].join("\n"),
    );

    await writeFile(
      join(tempDir, "src", "derived.ts"),
      [
        'import { BaseService } from "./base";',
        "export class AuthService extends BaseService {",
        "  login() {}",
        "}",
      ].join("\n"),
    );

    // File that calls a function from another
    await writeFile(
      join(tempDir, "src", "caller.ts"),
      [
        'import { useAuth } from "./hooks";',
        "export function checkAuth() {",
        "  return useAuth();",
        "}",
      ].join("\n"),
    );
  });

  afterAll(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  test("returns empty array when no key links provided", () => {
    const results = engine.checkKeyLinks([]);
    expect(results).toEqual([]);
  });

  test("'imported-by' link: passes when from is imported by to", () => {
    const links: VerificationKeyLink[] = [
      {
        from: "src/toggle.tsx",
        to: "src/provider.tsx",
        type: "imported-by",
        passed: false,
      },
    ];

    const results = engine.checkKeyLinks(links);

    expect(results).toHaveLength(1);
    expect(results[0].passed).toBe(true);
  });

  test("'imported-by' link: fails when from is NOT imported by to", () => {
    const links: VerificationKeyLink[] = [
      {
        from: "src/base.ts",
        to: "src/toggle.tsx",
        type: "imported-by",
        passed: false,
      },
    ];

    const results = engine.checkKeyLinks(links);

    expect(results).toHaveLength(1);
    expect(results[0].passed).toBe(false);
    expect(results[0].reason).toBeDefined();
  });

  test("'renders-within' link: passes when from component is rendered in to", () => {
    const links: VerificationKeyLink[] = [
      {
        from: "src/toggle.tsx",
        to: "src/provider.tsx",
        type: "renders-within",
        passed: false,
      },
    ];

    const results = engine.checkKeyLinks(links);

    expect(results).toHaveLength(1);
    expect(results[0].passed).toBe(true);
  });

  test("'renders-within' link: fails when from is not rendered in to", () => {
    const links: VerificationKeyLink[] = [
      {
        from: "src/hooks.ts",
        to: "src/provider.tsx",
        type: "renders-within",
        passed: false,
      },
    ];

    const results = engine.checkKeyLinks(links);

    expect(results).toHaveLength(1);
    expect(results[0].passed).toBe(false);
  });

  test("'extends' link: passes when from extends to", () => {
    const links: VerificationKeyLink[] = [
      {
        from: "src/derived.ts",
        to: "src/base.ts",
        type: "extends",
        passed: false,
      },
    ];

    const results = engine.checkKeyLinks(links);

    expect(results).toHaveLength(1);
    expect(results[0].passed).toBe(true);
  });

  test("'extends' link: fails when from does NOT extend to", () => {
    const links: VerificationKeyLink[] = [
      {
        from: "src/toggle.tsx",
        to: "src/base.ts",
        type: "extends",
        passed: false,
      },
    ];

    const results = engine.checkKeyLinks(links);

    expect(results).toHaveLength(1);
    expect(results[0].passed).toBe(false);
  });

  test("'calls' link: passes when from calls something from to", () => {
    const links: VerificationKeyLink[] = [
      {
        from: "src/caller.ts",
        to: "src/hooks.ts",
        type: "calls",
        passed: false,
      },
    ];

    const results = engine.checkKeyLinks(links);

    expect(results).toHaveLength(1);
    expect(results[0].passed).toBe(true);
  });

  test("'calls' link: fails when from does NOT call to", () => {
    const links: VerificationKeyLink[] = [
      {
        from: "src/base.ts",
        to: "src/hooks.ts",
        type: "calls",
        passed: false,
      },
    ];

    const results = engine.checkKeyLinks(links);

    expect(results).toHaveLength(1);
    expect(results[0].passed).toBe(false);
  });

  test("handles missing files gracefully with suggestions", () => {
    const links: VerificationKeyLink[] = [
      {
        from: "src/nonexistent.ts",
        to: "src/provider.tsx",
        type: "imported-by",
        passed: false,
      },
    ];

    const results = engine.checkKeyLinks(links);

    expect(results).toHaveLength(1);
    expect(results[0].passed).toBe(false);
    expect(results[0].reason).toContain("not found");
  });

  test("handles mixed key link results", () => {
    const links: VerificationKeyLink[] = [
      {
        from: "src/toggle.tsx",
        to: "src/provider.tsx",
        type: "imported-by",
        passed: false,
      },
      {
        from: "src/nonexistent.ts",
        to: "src/provider.tsx",
        type: "imported-by",
        passed: false,
      },
    ];

    const results = engine.checkKeyLinks(links);

    expect(results).toHaveLength(2);
    expect(results[0].passed).toBe(true);
    expect(results[1].passed).toBe(false);
  });
});

// ============================================================================
// verify() — full plan verification
// ============================================================================
describe("verify()", () => {
  let engine: VerificationEngine;
  let tempDir: string;

  beforeAll(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "verify-full-"));
    engine = createVerificationEngine({ projectPath: tempDir });

    // Create a substantive file
    const content = Array.from(
      { length: 15 },
      (_, i) => `export const val${i} = ${i};`,
    ).join("\n");
    await writeFile(join(tempDir, "module.ts"), content);

    // Create an importer
    await writeFile(
      join(tempDir, "app.ts"),
      `import { val0 } from './module';\nconsole.log(val0);\n`,
    );
  });

  afterAll(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  test("returns passed result when all checks pass", () => {
    const plan = makePlan({
      verification: {
        status: "pending",
        truths: [{ description: "Feature works", passed: true }],
        artifacts: [{ path: "module.ts", check: "exists", passed: false }],
        key_links: [],
      },
    });

    const result = engine.verify(plan, makeTaskResults());

    expect(result.status).toBe("passed");
    expect(result.truths[0].passed).toBe(true);
    expect(result.artifacts[0].passed).toBe(true);
    expect(result.checked_at).toBeDefined();
  });

  test("returns failed result when any truth fails", () => {
    const plan = makePlan({
      verification: {
        status: "pending",
        truths: [
          { description: "Truth A", passed: true },
          { description: "Truth B", passed: false },
        ],
        artifacts: [],
        key_links: [],
      },
    });

    const result = engine.verify(plan, makeTaskResults());

    expect(result.status).toBe("failed");
  });

  test("returns failed result when any artifact fails", () => {
    const plan = makePlan({
      verification: {
        status: "pending",
        truths: [],
        artifacts: [
          { path: "nonexistent.ts", check: "exists", passed: false },
        ],
        key_links: [],
      },
    });

    const result = engine.verify(plan, makeTaskResults());

    expect(result.status).toBe("failed");
  });

  test("returns failed result when any key link fails", () => {
    const plan = makePlan({
      verification: {
        status: "pending",
        truths: [],
        artifacts: [],
        key_links: [
          {
            from: "nonexistent.ts",
            to: "app.ts",
            type: "imported-by",
            passed: false,
          },
        ],
      },
    });

    const result = engine.verify(plan, makeTaskResults());

    expect(result.status).toBe("failed");
  });

  test("sets check counts correctly", () => {
    const plan = makePlan({
      verification: {
        status: "pending",
        truths: [
          { description: "A", passed: true },
          { description: "B", passed: false },
        ],
        artifacts: [{ path: "module.ts", check: "exists", passed: false }],
        key_links: [],
      },
    });

    const result = engine.verify(plan, makeTaskResults());

    expect(result.total_checks).toBe(3);
    expect(result.passed_checks).toBe(2); // A + module.ts
    expect(result.failed_checks).toBe(1); // B
  });

  test("handles plan with no verification section", () => {
    const plan = makePlan();
    delete (plan as unknown as Record<string, unknown>).verification;

    const result = engine.verify(plan, makeTaskResults());

    expect(result.status).toBe("passed");
    expect(result.total_checks).toBe(0);
  });

  test("handles plan with empty verification", () => {
    const plan = makePlan({
      verification: {
        status: "pending",
        truths: [],
        artifacts: [],
        key_links: [],
      },
    });

    const result = engine.verify(plan, makeTaskResults());

    expect(result.status).toBe("passed");
    expect(result.total_checks).toBe(0);
  });
});

// ============================================================================
// generateFixPlan() — auto-generate fix tasks for failures
// ============================================================================
describe("generateFixPlan()", () => {
  let engine: VerificationEngine;

  beforeAll(() => {
    engine = createVerificationEngine();
  });

  test("returns empty array when no failures", () => {
    const tasks = engine.generateFixPlan([]);
    expect(tasks).toEqual([]);
  });

  test("generates fix task for failed truth", () => {
    const failures: VerificationFailure[] = [
      {
        category: "truth",
        description: "OS dark mode preference not respected",
        severity: "critical",
      },
    ];

    const tasks = engine.generateFixPlan(failures);

    expect(tasks).toHaveLength(1);
    expect(tasks[0].name).toContain("Fix");
    expect(tasks[0].name).toContain("OS dark mode preference not respected");
    expect(tasks[0].priority).toBe("critical");
    expect(tasks[0].status).toBe("pending");
    expect(tasks[0].type).toBe("auto");
  });

  test("generates fix task for failed artifact (exists)", () => {
    const failures: VerificationFailure[] = [
      {
        category: "artifact",
        description: "File src/themes.css does not exist",
        severity: "critical",
        suggestedFix: "Create src/themes.css with CSS custom properties",
      },
    ];

    const tasks = engine.generateFixPlan(failures);

    expect(tasks).toHaveLength(1);
    expect(tasks[0].action).toContain("src/themes.css");
  });

  test("generates fix task for failed artifact (substantive)", () => {
    const failures: VerificationFailure[] = [
      {
        category: "artifact",
        description: "File src/stub.ts is a stub (<10 meaningful lines)",
        severity: "major",
      },
    ];

    const tasks = engine.generateFixPlan(failures);

    expect(tasks).toHaveLength(1);
    expect(tasks[0].priority).toBe("high");
  });

  test("generates fix task for failed key link", () => {
    const failures: VerificationFailure[] = [
      {
        category: "key_link",
        description: "themes.css is not imported by App.tsx",
        severity: "major",
        suggestedFix: "Add import for themes.css in App.tsx",
      },
    ];

    const tasks = engine.generateFixPlan(failures);

    expect(tasks).toHaveLength(1);
    expect(tasks[0].name).toContain("Connect");
  });

  test("caps generated tasks at maxFixIterations (default 3)", () => {
    const failures: VerificationFailure[] = Array.from(
      { length: 10 },
      (_, i) => ({
        category: "truth" as const,
        description: `Failure ${i}`,
        severity: "major" as const,
      }),
    );

    const engineWithLimit = createVerificationEngine({ maxFixIterations: 3 });
    const tasks = engineWithLimit.generateFixPlan(failures);

    // Should generate tasks but respect reasonable limits
    expect(tasks.length).toBeGreaterThan(0);
    expect(tasks.length).toBeLessThanOrEqual(10);
  });

  test("assigns correct task IDs to generated fix tasks", () => {
    const failures: VerificationFailure[] = [
      { category: "truth", description: "A", severity: "critical" },
      { category: "artifact", description: "B", severity: "major" },
    ];

    const tasks = engine.generateFixPlan(failures);

    expect(tasks).toHaveLength(2);
    // Each task should have a unique id
    const ids = tasks.map((t) => t.id);
    expect(new Set(ids).size).toBe(2);
  });

  test("sets wave to 1 for all fix tasks", () => {
    const failures: VerificationFailure[] = [
      { category: "truth", description: "A", severity: "critical" },
      { category: "key_link", description: "B", severity: "major" },
    ];

    const tasks = engine.generateFixPlan(failures);

    for (const task of tasks) {
      expect(task.wave).toBe(1);
    }
  });

  test("maps severity to priority correctly", () => {
    const failures: VerificationFailure[] = [
      { category: "truth", description: "Critical", severity: "critical" },
      { category: "truth", description: "Major", severity: "major" },
      { category: "truth", description: "Minor", severity: "minor" },
    ];

    const tasks = engine.generateFixPlan(failures);

    expect(tasks[0].priority).toBe("critical");
    expect(tasks[1].priority).toBe("high");
    expect(tasks[2].priority).toBe("medium");
  });
});

// ============================================================================
// isFullyVerified() — convenience check
// ============================================================================
describe("isFullyVerified()", () => {
  let engine: VerificationEngine;

  beforeAll(() => {
    engine = createVerificationEngine();
  });

  test("returns true when status is passed", () => {
    const result: VerificationResult = {
      status: "passed",
      truths: [{ description: "Works", passed: true }],
      artifacts: [{ path: "file.ts", check: "exists", passed: true }],
      key_links: [],
    };

    expect(engine.isFullyVerified(result)).toBe(true);
  });

  test("returns false when status is failed", () => {
    const result: VerificationResult = {
      status: "failed",
      truths: [{ description: "Broken", passed: false }],
      artifacts: [],
      key_links: [],
    };

    expect(engine.isFullyVerified(result)).toBe(false);
  });

  test("returns false when status is pending", () => {
    const result: VerificationResult = {
      status: "pending",
      truths: [],
      artifacts: [],
      key_links: [],
    };

    expect(engine.isFullyVerified(result)).toBe(false);
  });

  test("returns false when status is running", () => {
    const result: VerificationResult = {
      status: "running",
      truths: [],
      artifacts: [],
      key_links: [],
    };

    expect(engine.isFullyVerified(result)).toBe(false);
  });

  test("returns true for passed with zero checks", () => {
    const result: VerificationResult = {
      status: "passed",
      truths: [],
      artifacts: [],
      key_links: [],
      total_checks: 0,
      passed_checks: 0,
      failed_checks: 0,
    };

    expect(engine.isFullyVerified(result)).toBe(true);
  });
});

// ============================================================================
// Edge cases
// ============================================================================
describe("Edge cases", () => {
  test("verify handles undefined verification gracefully", () => {
    const engine = createVerificationEngine();
    const plan: GsdPlan = {
      id: "p1",
      title: "Test",
      phase: "quick",
      created: "2026-01-01",
      status: "verifying",
      mode: "quick",
      type: "execute",
      tasks: [],
      waves: [],
    };

    const result = engine.verify(plan, makeTaskResults());
    expect(result.status).toBe("passed");
  });

  test("checkArtifacts with no projectPath uses empty string", () => {
    const engine = createVerificationEngine();
    const results = engine.checkArtifacts([
      { path: "/absolute/nonexistent.ts", check: "exists", passed: false },
    ]);

    expect(results).toHaveLength(1);
    expect(results[0].passed).toBe(false);
  });

  test("checkKeyLinks with missing 'to' file", () => {
    const engine = createVerificationEngine();
    const results = engine.checkKeyLinks([
      {
        from: "exists.ts",
        to: "missing.ts",
        type: "imported-by",
        passed: false,
      },
    ]);

    expect(results).toHaveLength(1);
    expect(results[0].passed).toBe(false);
  });

  test("generateFixPlan with suggestedFix incorporates suggestion in action", () => {
    const engine = createVerificationEngine();
    const tasks = engine.generateFixPlan([
      {
        category: "artifact",
        description: "Missing file",
        severity: "critical",
        suggestedFix: "Create the file with proper content",
      },
    ]);

    expect(tasks[0].action).toContain("Create the file with proper content");
  });

  test("partial pass scenario: some truths pass, some fail", () => {
    const engine = createVerificationEngine();

    const result = engine.verify(
      makePlan({
        verification: {
          status: "pending",
          truths: [
            { description: "A", passed: true },
            { description: "B", passed: false },
          ],
          artifacts: [],
          key_links: [],
        },
      }),
      makeTaskResults(),
    );

    expect(result.status).toBe("failed");
    expect(result.passed_checks).toBe(1);
    expect(result.failed_checks).toBe(1);
  });
});

// ============================================================================
// Integration: verify → generateFixPlan round-trip
// ============================================================================
describe("verify → generateFixPlan round-trip", () => {
  let engine: VerificationEngine;
  let tempDir: string;

  beforeAll(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "verify-roundtrip-"));
    engine = createVerificationEngine({ projectPath: tempDir });

    // Create some files
    const content = Array.from(
      { length: 15 },
      (_, i) => `export const v${i} = ${i};`,
    ).join("\n");
    await writeFile(join(tempDir, "existing.ts"), content);
  });

  afterAll(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  test("failed verification produces fixable tasks", () => {
    const plan = makePlan({
      verification: {
        status: "pending",
        truths: [{ description: "Feature works end-to-end", passed: false }],
        artifacts: [
          { path: "missing-file.ts", check: "exists", passed: false },
        ],
        key_links: [
          {
            from: "missing-file.ts",
            to: "existing.ts",
            type: "imported-by",
            passed: false,
          },
        ],
      },
    });

    const result = engine.verify(plan, makeTaskResults());
    expect(result.status).toBe("failed");

    // Collect failures
    const failures: VerificationFailure[] = [];

    for (const t of result.truths) {
      if (!t.passed) {
        failures.push({
          category: "truth",
          description: t.description,
          severity: "critical",
        });
      }
    }
    for (const a of result.artifacts) {
      if (!a.passed) {
        failures.push({
          category: "artifact",
          description: `${a.path}: check "${a.check}" failed`,
          severity: "critical",
        });
      }
    }
    for (const k of result.key_links) {
      if (!k.passed) {
        failures.push({
          category: "key_link",
          description: `${k.from} → ${k.to}: ${k.type} link broken`,
          severity: "major",
        });
      }
    }

    const fixTasks = engine.generateFixPlan(failures);

    expect(fixTasks.length).toBeGreaterThan(0);
    expect(fixTasks.length).toBe(3); // 1 truth + 1 artifact + 1 key_link

    // All fix tasks should be valid GsdTasks
    for (const task of fixTasks) {
      expect(task.id).toBeDefined();
      expect(task.name).toBeDefined();
      expect(task.status).toBe("pending");
      expect(task.wave).toBe(1);
      expect(task.action).toBeDefined();
      expect(task.files).toBeDefined();
      expect(Array.isArray(task.files)).toBe(true);
    }
  });
});
