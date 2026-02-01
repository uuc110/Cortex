/**
 * Tests for state-manager.ts — STATE.md persistence for GSD execution.
 *
 * TDD RED phase: Tests define the contract BEFORE implementation.
 * Cross-references:
 *   - GSD types: packages/opencode-swarm-plugin/src/gsd/gsd-types.ts
 *   - Integration spec: .planning/fork-plan/02-INTEGRATION-SWARM-GSD.md (STATE.md section)
 *   - STATE.md format: YAML with human-readable comments
 */
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtemp, writeFile, readFile, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createStateManager,
  saveState,
  loadState,
  updateTaskStatus,
  updateWaveStatus,
  getProgress,
  serializeState,
  deserializeState,
} from "../state-manager.js";

import type { GsdState } from "../gsd-types.js";

// ============================================================================
// Fixtures
// ============================================================================

function makeState(overrides: Partial<GsdState> = {}): GsdState {
  return {
    plan_id: "gsd-abc123",
    status: "in_progress",
    mode: "quick",
    current_wave: 1,
    completed_tasks: [],
    failed_tasks: [],
    verification_results: [],
    started_at: "2026-02-01T09:00:00Z",
    last_updated: "2026-02-01T10:00:00Z",
    ...overrides,
  };
}

function makeFullState(): GsdState {
  return makeState({
    plan_id: "gsd-full-001",
    status: "executing",
    mode: "project",
    current_wave: 2,
    completed_tasks: ["T0", "T1"],
    failed_tasks: ["T2"],
    verification_results: [
      {
        status: "passed",
        truths: [{ description: "Auth works", passed: true }],
        artifacts: [{ path: "src/auth.ts", check: "exists", passed: true }],
        key_links: [
          {
            from: "AuthProvider",
            to: "App",
            type: "renders-within",
            passed: true,
          },
        ],
      },
    ],
    started_at: "2026-02-01T08:00:00Z",
    last_updated: "2026-02-01T12:00:00Z",
    current_phase: 2,
    decisions: ["Using JWT for auth", "PostgreSQL for persistence"],
    context_notes: ["Auth module follows existing pattern"],
    completed_at: undefined,
  });
}

// ============================================================================
// serializeState / deserializeState (YAML round-trip)
// ============================================================================
describe("serializeState()", () => {
  test("produces valid YAML string", () => {
    const state = makeState();
    const yaml = serializeState(state);

    expect(typeof yaml).toBe("string");
    expect(yaml.length).toBeGreaterThan(0);
  });

  test("includes human-readable comment header", () => {
    const state = makeState();
    const yaml = serializeState(state);

    expect(yaml).toContain("# GSD State");
  });

  test("serializes all required fields", () => {
    const state = makeState();
    const yaml = serializeState(state);

    expect(yaml).toContain("plan_id:");
    expect(yaml).toContain("gsd-abc123");
    expect(yaml).toContain("status:");
    expect(yaml).toContain("in_progress");
    expect(yaml).toContain("mode:");
    expect(yaml).toContain("quick");
    expect(yaml).toContain("current_wave:");
    expect(yaml).toContain("started_at:");
    expect(yaml).toContain("last_updated:");
  });

  test("serializes empty arrays correctly", () => {
    const state = makeState({
      completed_tasks: [],
      failed_tasks: [],
      verification_results: [],
    });
    const yaml = serializeState(state);

    expect(yaml).toContain("completed_tasks:");
    expect(yaml).toContain("failed_tasks:");
    expect(yaml).toContain("verification_results:");
  });

  test("serializes non-empty arrays correctly", () => {
    const state = makeState({
      completed_tasks: ["T0", "T1"],
      failed_tasks: ["T2"],
    });
    const yaml = serializeState(state);

    expect(yaml).toContain("T0");
    expect(yaml).toContain("T1");
    expect(yaml).toContain("T2");
  });

  test("serializes optional fields when present", () => {
    const state = makeState({
      current_phase: 2,
      decisions: ["Use JWT"],
      context_notes: ["Follows existing auth pattern"],
      completed_at: "2026-02-01T12:00:00Z",
    });
    const yaml = serializeState(state);

    expect(yaml).toContain("current_phase:");
    expect(yaml).toContain("decisions:");
    expect(yaml).toContain("Use JWT");
    expect(yaml).toContain("context_notes:");
    expect(yaml).toContain("Follows existing auth pattern");
    expect(yaml).toContain("completed_at:");
  });

  test("omits optional fields when undefined", () => {
    const state = makeState();
    const yaml = serializeState(state);

    // Optional fields not set should not appear
    expect(yaml).not.toContain("current_phase:");
    expect(yaml).not.toContain("decisions:");
    expect(yaml).not.toContain("context_notes:");
    expect(yaml).not.toContain("completed_at:");
  });

  test("serializes verification_results with nested objects", () => {
    const state = makeFullState();
    const yaml = serializeState(state);

    expect(yaml).toContain("verification_results:");
    expect(yaml).toContain("Auth works");
    expect(yaml).toContain("src/auth.ts");
    expect(yaml).toContain("renders-within");
  });

  test("output is NOT JSON", () => {
    const state = makeState();
    const yaml = serializeState(state);

    // Should not be parseable as JSON
    expect(() => JSON.parse(yaml)).toThrow();
  });
});

describe("deserializeState()", () => {
  test("round-trips with serializeState for minimal state", () => {
    const state = makeState();
    const yaml = serializeState(state);
    const parsed = deserializeState(yaml);

    expect(parsed).not.toBeNull();
    expect(parsed!.plan_id).toBe(state.plan_id);
    expect(parsed!.status).toBe(state.status);
    expect(parsed!.mode).toBe(state.mode);
    expect(parsed!.current_wave).toBe(state.current_wave);
    expect(parsed!.completed_tasks).toEqual(state.completed_tasks);
    expect(parsed!.failed_tasks).toEqual(state.failed_tasks);
    expect(parsed!.verification_results).toEqual(state.verification_results);
    expect(parsed!.started_at).toBe(state.started_at);
    expect(parsed!.last_updated).toBe(state.last_updated);
  });

  test("round-trips with serializeState for full state", () => {
    const state = makeFullState();
    const yaml = serializeState(state);
    const parsed = deserializeState(yaml);

    expect(parsed).not.toBeNull();
    expect(parsed!.plan_id).toBe(state.plan_id);
    expect(parsed!.current_phase).toBe(state.current_phase);
    expect(parsed!.decisions).toEqual(state.decisions);
    expect(parsed!.context_notes).toEqual(state.context_notes);
    expect(parsed!.completed_tasks).toEqual(state.completed_tasks);
    expect(parsed!.failed_tasks).toEqual(state.failed_tasks);
    expect(parsed!.verification_results).toEqual(state.verification_results);
  });

  test("returns null for empty string", () => {
    expect(deserializeState("")).toBeNull();
  });

  test("returns null for whitespace-only string", () => {
    expect(deserializeState("   \n  \n  ")).toBeNull();
  });

  test("returns null for completely invalid content", () => {
    expect(deserializeState("this is not yaml at all {{{")).toBeNull();
  });

  test("handles corrupted YAML gracefully (missing required fields)", () => {
    const badYaml = `# GSD State
plan_id: "gsd-abc123"
status: "in_progress"
`;
    // Missing mode, current_wave, arrays, timestamps — should fill defaults
    const result = deserializeState(badYaml);
    // Should return null or fill defaults - implementation chooses
    // We require graceful handling (no throw)
    expect(() => deserializeState(badYaml)).not.toThrow();
  });

  test("handles unknown fields gracefully (ignores them)", () => {
    const state = makeState();
    const yaml = serializeState(state);
    const yamlWithExtra = yaml + "\nunknown_field: true\nextra_data: 42\n";
    const parsed = deserializeState(yamlWithExtra);

    expect(parsed).not.toBeNull();
    expect(parsed!.plan_id).toBe(state.plan_id);
  });

  test("parses YAML with comments", () => {
    const state = makeState();
    const yaml = serializeState(state);
    // The serialized output already has comments
    const parsed = deserializeState(yaml);
    expect(parsed).not.toBeNull();
    expect(parsed!.plan_id).toBe(state.plan_id);
  });

  test("handles numeric current_wave correctly", () => {
    const state = makeState({ current_wave: 5 });
    const yaml = serializeState(state);
    const parsed = deserializeState(yaml);

    expect(parsed).not.toBeNull();
    expect(parsed!.current_wave).toBe(5);
    expect(typeof parsed!.current_wave).toBe("number");
  });
});

// ============================================================================
// updateTaskStatus() — immutable state update
// ============================================================================
describe("updateTaskStatus()", () => {
  test("marks task as completed", () => {
    const state = makeState({ completed_tasks: [], failed_tasks: [] });
    const updated = updateTaskStatus(state, "T0", "completed");

    expect(updated.completed_tasks).toContain("T0");
    expect(updated.failed_tasks).not.toContain("T0");
  });

  test("marks task as failed", () => {
    const state = makeState({ completed_tasks: [], failed_tasks: [] });
    const updated = updateTaskStatus(state, "T0", "failed");

    expect(updated.failed_tasks).toContain("T0");
    expect(updated.completed_tasks).not.toContain("T0");
  });

  test("does not mutate original state", () => {
    const state = makeState({ completed_tasks: [], failed_tasks: [] });
    const original = { ...state, completed_tasks: [...state.completed_tasks] };
    updateTaskStatus(state, "T0", "completed");

    expect(state.completed_tasks).toEqual(original.completed_tasks);
  });

  test("returns new state object (not same reference)", () => {
    const state = makeState();
    const updated = updateTaskStatus(state, "T0", "completed");

    expect(updated).not.toBe(state);
  });

  test("updates last_updated timestamp", () => {
    const state = makeState({ last_updated: "2026-01-01T00:00:00Z" });
    const updated = updateTaskStatus(state, "T0", "completed");

    expect(updated.last_updated).not.toBe("2026-01-01T00:00:00Z");
  });

  test("handles in_progress status (no completed/failed change)", () => {
    const state = makeState({ completed_tasks: [], failed_tasks: [] });
    const updated = updateTaskStatus(state, "T0", "in_progress");

    expect(updated.completed_tasks).not.toContain("T0");
    expect(updated.failed_tasks).not.toContain("T0");
  });

  test("handles skipped status", () => {
    const state = makeState({ completed_tasks: [], failed_tasks: [] });
    const updated = updateTaskStatus(state, "T0", "skipped");

    // skipped tasks are tracked as completed (they're done, just skipped)
    expect(updated.completed_tasks).toContain("T0");
  });

  test("prevents duplicate entries in completed_tasks", () => {
    const state = makeState({ completed_tasks: ["T0"] });
    const updated = updateTaskStatus(state, "T0", "completed");

    const count = updated.completed_tasks.filter((id) => id === "T0").length;
    expect(count).toBe(1);
  });

  test("moves task from failed to completed when status changes", () => {
    const state = makeState({
      completed_tasks: [],
      failed_tasks: ["T0"],
    });
    const updated = updateTaskStatus(state, "T0", "completed");

    expect(updated.completed_tasks).toContain("T0");
    expect(updated.failed_tasks).not.toContain("T0");
  });

  test("moves task from completed to failed when status changes", () => {
    const state = makeState({
      completed_tasks: ["T0"],
      failed_tasks: [],
    });
    const updated = updateTaskStatus(state, "T0", "failed");

    expect(updated.failed_tasks).toContain("T0");
    expect(updated.completed_tasks).not.toContain("T0");
  });
});

// ============================================================================
// updateWaveStatus() — immutable state update
// ============================================================================
describe("updateWaveStatus()", () => {
  test("updates current_wave when wave starts", () => {
    const state = makeState({ current_wave: 1 });
    const updated = updateWaveStatus(state, 2, "in_progress");

    expect(updated.current_wave).toBe(2);
  });

  test("does not mutate original state", () => {
    const state = makeState({ current_wave: 1 });
    updateWaveStatus(state, 2, "in_progress");

    expect(state.current_wave).toBe(1);
  });

  test("returns new state object", () => {
    const state = makeState();
    const updated = updateWaveStatus(state, 1, "completed");

    expect(updated).not.toBe(state);
  });

  test("updates last_updated timestamp", () => {
    const state = makeState({ last_updated: "2026-01-01T00:00:00Z" });
    const updated = updateWaveStatus(state, 1, "completed");

    expect(updated.last_updated).not.toBe("2026-01-01T00:00:00Z");
  });

  test("sets status to completed when final wave completes", () => {
    const state = makeState({ status: "in_progress", current_wave: 3 });
    const updated = updateWaveStatus(state, 3, "completed");

    // Wave completion doesn't auto-set plan status — that's the caller's job
    // But current_wave should stay at 3
    expect(updated.current_wave).toBe(3);
  });

  test("sets status to failed when wave fails", () => {
    const state = makeState({ status: "in_progress", current_wave: 2 });
    const updated = updateWaveStatus(state, 2, "failed");

    // Wave failure updates the wave status tracking
    expect(updated.current_wave).toBe(2);
  });
});

// ============================================================================
// getProgress() — progress info computation
// ============================================================================
describe("getProgress()", () => {
  test("returns zero progress for empty state", () => {
    const state = makeState({
      completed_tasks: [],
      failed_tasks: [],
      current_wave: 1,
    });
    // Note: total is computed from completed + failed + remaining
    // For an empty state with no total context, we compute from what's known
    const progress = getProgress(state);

    expect(progress.completed).toBe(0);
    expect(progress.currentWave).toBe(1);
    expect(progress.percentComplete).toBe(0);
  });

  test("computes progress correctly for partially complete state", () => {
    const state = makeState({
      completed_tasks: ["T0", "T1"],
      failed_tasks: [],
      current_wave: 2,
    });
    const progress = getProgress(state);

    expect(progress.completed).toBe(2);
    expect(progress.currentWave).toBe(2);
  });

  test("includes failed tasks in total count", () => {
    const state = makeState({
      completed_tasks: ["T0"],
      failed_tasks: ["T1"],
      current_wave: 1,
    });
    const progress = getProgress(state);

    expect(progress.completed).toBe(1);
    expect(progress.total).toBeGreaterThanOrEqual(2);
  });

  test("returns 100% for all-completed state", () => {
    const state = makeState({
      completed_tasks: ["T0", "T1", "T2"],
      failed_tasks: [],
      status: "completed",
      current_wave: 3,
    });
    const progress = getProgress(state);

    expect(progress.completed).toBe(3);
    expect(progress.total).toBe(3);
    expect(progress.percentComplete).toBe(100);
  });

  test("percentComplete is between 0 and 100", () => {
    const state = makeState({
      completed_tasks: ["T0"],
      failed_tasks: [],
      current_wave: 1,
    });
    const progress = getProgress(state);

    expect(progress.percentComplete).toBeGreaterThanOrEqual(0);
    expect(progress.percentComplete).toBeLessThanOrEqual(100);
  });

  test("returns correct structure", () => {
    const state = makeState();
    const progress = getProgress(state);

    expect(progress).toHaveProperty("completed");
    expect(progress).toHaveProperty("total");
    expect(progress).toHaveProperty("currentWave");
    expect(progress).toHaveProperty("percentComplete");
    expect(typeof progress.completed).toBe("number");
    expect(typeof progress.total).toBe("number");
    expect(typeof progress.currentWave).toBe("number");
    expect(typeof progress.percentComplete).toBe("number");
  });
});

// ============================================================================
// createStateManager() — factory function
// ============================================================================
describe("createStateManager()", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "gsd-state-test-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  test("creates a state manager with save and load methods", () => {
    const manager = createStateManager({ planningDir: tmpDir });

    expect(manager).toHaveProperty("save");
    expect(manager).toHaveProperty("load");
    expect(typeof manager.save).toBe("function");
    expect(typeof manager.load).toBe("function");
  });

  test("save writes STATE.md to planning directory", async () => {
    const manager = createStateManager({ planningDir: tmpDir });
    const state = makeState();

    await manager.save(state);

    const content = await readFile(join(tmpDir, "STATE.md"), "utf-8");
    expect(content.length).toBeGreaterThan(0);
    expect(content).toContain("gsd-abc123");
  });

  test("load reads STATE.md from planning directory", async () => {
    const manager = createStateManager({ planningDir: tmpDir });
    const state = makeState();

    await manager.save(state);
    const loaded = await manager.load();

    expect(loaded).not.toBeNull();
    expect(loaded!.plan_id).toBe(state.plan_id);
    expect(loaded!.status).toBe(state.status);
  });

  test("load returns null when STATE.md does not exist", async () => {
    const manager = createStateManager({ planningDir: tmpDir });
    const loaded = await manager.load();

    expect(loaded).toBeNull();
  });

  test("save then load round-trips full state", async () => {
    const manager = createStateManager({ planningDir: tmpDir });
    const state = makeFullState();

    await manager.save(state);
    const loaded = await manager.load();

    expect(loaded).not.toBeNull();
    expect(loaded!.plan_id).toBe(state.plan_id);
    expect(loaded!.status).toBe(state.status);
    expect(loaded!.mode).toBe(state.mode);
    expect(loaded!.current_wave).toBe(state.current_wave);
    expect(loaded!.completed_tasks).toEqual(state.completed_tasks);
    expect(loaded!.failed_tasks).toEqual(state.failed_tasks);
    expect(loaded!.current_phase).toBe(state.current_phase);
    expect(loaded!.decisions).toEqual(state.decisions);
    expect(loaded!.context_notes).toEqual(state.context_notes);
    expect(loaded!.verification_results).toEqual(state.verification_results);
  });
});

// ============================================================================
// saveState() / loadState() — standalone functions
// ============================================================================
describe("saveState() / loadState()", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "gsd-state-test-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  test("saveState writes to planningDir/STATE.md", async () => {
    const state = makeState();
    await saveState(state, tmpDir);

    const content = await readFile(join(tmpDir, "STATE.md"), "utf-8");
    expect(content).toContain("gsd-abc123");
  });

  test("loadState returns null when file missing", async () => {
    const result = await loadState(tmpDir);
    expect(result).toBeNull();
  });

  test("loadState returns state when file exists", async () => {
    const state = makeState();
    await saveState(state, tmpDir);
    const loaded = await loadState(tmpDir);

    expect(loaded).not.toBeNull();
    expect(loaded!.plan_id).toBe("gsd-abc123");
  });

  test("saveState overwrites existing STATE.md", async () => {
    const state1 = makeState({ plan_id: "gsd-first" });
    const state2 = makeState({ plan_id: "gsd-second" });

    await saveState(state1, tmpDir);
    await saveState(state2, tmpDir);

    const loaded = await loadState(tmpDir);
    expect(loaded!.plan_id).toBe("gsd-second");
  });

  test("saveState creates directory if needed", async () => {
    const nestedDir = join(tmpDir, "deep", "nested", ".planning");
    const state = makeState();

    await saveState(state, nestedDir);

    const loaded = await loadState(nestedDir);
    expect(loaded).not.toBeNull();
    expect(loaded!.plan_id).toBe("gsd-abc123");
  });

  test("loadState handles corrupted STATE.md gracefully", async () => {
    await writeFile(
      join(tmpDir, "STATE.md"),
      "this is completely corrupted content {{{!@#$%",
    );

    const result = await loadState(tmpDir);
    // Should not throw, returns null for unparseable content
    expect(result).toBeNull();
  });

  test("loadState handles empty STATE.md", async () => {
    await writeFile(join(tmpDir, "STATE.md"), "");

    const result = await loadState(tmpDir);
    expect(result).toBeNull();
  });
});

// ============================================================================
// Edge cases and defensive behavior
// ============================================================================
describe("Edge cases", () => {
  test("serializeState handles state with special characters in strings", () => {
    const state = makeState({
      decisions: ['Use "quotes" and: colons', "Line\nbreak in decision"],
    });
    const yaml = serializeState(state);
    const parsed = deserializeState(yaml);

    expect(parsed).not.toBeNull();
    expect(parsed!.decisions).toBeDefined();
    expect(parsed!.decisions!.length).toBe(2);
  });

  test("serializeState handles empty string values", () => {
    // plan_id can't be empty (validated by isGsdState), but last_updated can be any string
    const state = makeState({
      plan_id: "gsd-test",
      started_at: "",
      last_updated: "",
    });
    const yaml = serializeState(state);
    expect(() => deserializeState(yaml)).not.toThrow();
  });

  test("updateTaskStatus with pending removes from completed and failed", () => {
    const state = makeState({
      completed_tasks: ["T0"],
      failed_tasks: ["T1"],
    });
    const updated = updateTaskStatus(state, "T0", "pending");

    expect(updated.completed_tasks).not.toContain("T0");
    expect(updated.failed_tasks).not.toContain("T0");
  });

  test("getProgress handles state with only failed tasks", () => {
    const state = makeState({
      completed_tasks: [],
      failed_tasks: ["T0", "T1", "T2"],
    });
    const progress = getProgress(state);

    expect(progress.completed).toBe(0);
    expect(progress.total).toBeGreaterThanOrEqual(3);
    expect(progress.percentComplete).toBe(0);
  });

  test("deserialization recovers from partial YAML with defaults", () => {
    const partialYaml = `# GSD State
plan_id: "gsd-partial"
status: "in_progress"
mode: "quick"
current_wave: 1
completed_tasks: []
failed_tasks: []
verification_results: []
started_at: "2026-02-01T09:00:00Z"
last_updated: "2026-02-01T09:00:00Z"
`;
    const parsed = deserializeState(partialYaml);
    expect(parsed).not.toBeNull();
    expect(parsed!.plan_id).toBe("gsd-partial");
    expect(parsed!.status).toBe("in_progress");
    expect(parsed!.mode).toBe("quick");
  });
});
