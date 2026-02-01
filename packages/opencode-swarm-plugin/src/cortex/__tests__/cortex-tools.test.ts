import type { ToolContext } from "@opencode-ai/plugin";
import { describe, expect, test } from "bun:test";
import { cortex_decompose, cortex_verify, cortex_status } from "../cortex-tools.js";

const mockCtx = {} as ToolContext;

function validCellTreeJson(): string {
  return JSON.stringify({
    epic: { title: "Test Epic", description: "A test" },
    subtasks: [
      {
        title: "Setup schema",
        description: "Create DB tables",
        files: ["src/schema.ts"],
        dependencies: [],
        estimated_complexity: 2,
      },
      {
        title: "Add routes",
        description: "API endpoints",
        files: ["src/routes.ts"],
        dependencies: [0],
        estimated_complexity: 3,
      },
    ],
  });
}

// ─── cortex_decompose ────────────────────────────────────────────

describe("cortex_decompose", () => {
  test("returns error when cell_tree is missing", async () => {
    const result = await cortex_decompose.execute(
      { cell_tree: "" } as any,
      mockCtx,
    );
    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(false);
    expect(parsed.error).toContain("Missing required parameter");
  });

  test("returns error for invalid JSON", async () => {
    const result = await cortex_decompose.execute(
      { cell_tree: "not json" },
      mockCtx,
    );
    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(false);
    expect(parsed.error).toContain("Decomposition bridge failed");
  });

  test("successfully decomposes a valid CellTree", async () => {
    const result = await cortex_decompose.execute(
      { cell_tree: validCellTreeJson() },
      mockCtx,
    );
    const parsed = JSON.parse(result);

    expect(parsed.success).toBe(true);
    expect(parsed.total_tasks).toBe(2);
    expect(parsed.total_waves).toBe(2);
    expect(parsed.max_parallelism).toBe(1);
    expect(parsed.epic_id).toContain("epic-ctx-");
    expect(parsed.waves).toHaveLength(2);
    expect(parsed.tasks).toHaveLength(2);
    expect(parsed.plan_markdown).toContain("---");
    expect(parsed.dispatcher_tasks).toHaveLength(2);
  });

  test("auto-detects quick mode for small tasks", async () => {
    const result = await cortex_decompose.execute(
      { cell_tree: validCellTreeJson() },
      mockCtx,
    );
    const parsed = JSON.parse(result);

    expect(parsed.mode).toBe("quick");
    expect(parsed.mode_auto_detected).toBe(true);
  });

  test("respects explicit mode override", async () => {
    const result = await cortex_decompose.execute(
      { cell_tree: validCellTreeJson(), mode: "project", phase: "phase-1" },
      mockCtx,
    );
    const parsed = JSON.parse(result);

    expect(parsed.mode).toBe("project");
    expect(parsed.mode_auto_detected).toBe(false);
  });

  test("includes must_haves in plan when provided", async () => {
    const mustHaves = JSON.stringify({
      truths: ["API works"],
      artifacts: [{ path: "src/api.ts", check: "exists" }],
      key_links: [],
    });

    const result = await cortex_decompose.execute(
      { cell_tree: validCellTreeJson(), must_haves_json: mustHaves },
      mockCtx,
    );
    const parsed = JSON.parse(result);

    expect(parsed.success).toBe(true);
    expect(parsed.plan_markdown).toContain("<must_haves>");
    expect(parsed.plan_markdown).toContain("API works");
  });

  test("includes research_context in plan when provided", async () => {
    const result = await cortex_decompose.execute(
      { cell_tree: validCellTreeJson(), research_context: "Found lib X" },
      mockCtx,
    );
    const parsed = JSON.parse(result);

    expect(parsed.success).toBe(true);
    expect(parsed.plan_markdown).toContain("<research_context>");
    expect(parsed.plan_markdown).toContain("Found lib X");
  });

  test("returns invalid must_haves error", async () => {
    const result = await cortex_decompose.execute(
      { cell_tree: validCellTreeJson(), must_haves_json: "not json" },
      mockCtx,
    );
    const parsed = JSON.parse(result);

    expect(parsed.success).toBe(false);
    expect(parsed.error).toContain("must_haves_json");
  });

  test("wave structure has correct shape", async () => {
    const result = await cortex_decompose.execute(
      { cell_tree: validCellTreeJson() },
      mockCtx,
    );
    const parsed = JSON.parse(result);

    for (const wave of parsed.waves) {
      expect(wave).toHaveProperty("wave_number");
      expect(wave).toHaveProperty("task_count");
      expect(wave).toHaveProperty("task_ids");
      expect(wave).toHaveProperty("parallel");
    }
  });

  test("task structure has correct shape", async () => {
    const result = await cortex_decompose.execute(
      { cell_tree: validCellTreeJson() },
      mockCtx,
    );
    const parsed = JSON.parse(result);

    for (const task of parsed.tasks) {
      expect(task).toHaveProperty("id");
      expect(task).toHaveProperty("name");
      expect(task).toHaveProperty("wave");
      expect(task).toHaveProperty("priority");
      expect(task).toHaveProperty("files");
      expect(task).toHaveProperty("dependencies");
    }
  });

  test("handles double-stringified JSON input", async () => {
    const doubleStringified = JSON.stringify(validCellTreeJson());
    const result = await cortex_decompose.execute(
      { cell_tree: doubleStringified },
      mockCtx,
    );
    const parsed = JSON.parse(result);

    expect(parsed.success).toBe(true);
    expect(parsed.total_tasks).toBe(2);
  });
});

// ─── cortex_verify ───────────────────────────────────────────────

describe("cortex_verify", () => {
  test("returns error when plan_markdown is missing", async () => {
    const result = await cortex_verify.execute(
      { plan_markdown: "", completed_task_ids: "[]" } as any,
      mockCtx,
    );
    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(false);
    expect(parsed.error).toContain("Missing required parameter");
  });

  test("returns error for invalid completed_task_ids JSON", async () => {
    const decomposed = await cortex_decompose.execute(
      { cell_tree: validCellTreeJson() },
      mockCtx,
    );
    const { plan_markdown } = JSON.parse(decomposed);

    const result = await cortex_verify.execute(
      { plan_markdown, completed_task_ids: "not json" },
      mockCtx,
    );
    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(false);
    expect(parsed.error).toContain("completed_task_ids");
  });

  test("verifies a plan with completed tasks", async () => {
    const decomposed = await cortex_decompose.execute(
      { cell_tree: validCellTreeJson() },
      mockCtx,
    );
    const { plan_markdown, tasks } = JSON.parse(decomposed);
    const taskIds = tasks.map((t: any) => t.id);

    const result = await cortex_verify.execute(
      {
        plan_markdown,
        completed_task_ids: JSON.stringify(taskIds),
      },
      mockCtx,
    );
    const parsed = JSON.parse(result);

    expect(parsed.success).toBe(true);
    expect(parsed).toHaveProperty("verified");
    expect(parsed).toHaveProperty("status");
  });
});

// ─── cortex_status ───────────────────────────────────────────────

describe("cortex_status", () => {
  test("returns error when planning_dir is missing", async () => {
    const result = await cortex_status.execute(
      { planning_dir: "" } as any,
      mockCtx,
    );
    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(false);
    expect(parsed.error).toContain("Missing required parameter");
  });

  test("returns has_state=false for non-existent directory", async () => {
    const result = await cortex_status.execute(
      { planning_dir: "/tmp/cortex-test-nonexistent-dir-12345" },
      mockCtx,
    );
    const parsed = JSON.parse(result);

    expect(parsed.success).toBe(true);
    expect(parsed.has_state).toBe(false);
  });
});
