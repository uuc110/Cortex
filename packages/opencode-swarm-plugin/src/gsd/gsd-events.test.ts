/**
 * Tests for gsd-events.ts — GSD event payload factories.
 *
 * Follows bead-events.test.ts pattern: each factory tested for
 * correct type, required fields, optional fields, and omission.
 *
 * Cross-references:
 *   - Spec: .planning/fork-plan/02-INTEGRATION-SWARM-GSD.md (Event Types)
 *   - Pattern: src/bridge/__tests__/bead-events.test.ts
 */
import { describe, expect, test } from "bun:test";

import {
  gsdPlanCreated,
  gsdWaveStarted,
  gsdWaveCompleted,
  gsdWaveFailed,
  gsdTaskExecuted,
  gsdVerificationRun,
  gsdVerificationPassed,
  gsdVerificationFailed,
  gsdStateUpdated,
  gsdCheckpointGate,
  gsdFixPlanGenerated,
  gsdFixPlanCompleted,
  gsdResearchStarted,
  gsdResearchCompleted,
  gsdRoadmapPhaseStarted,
} from "./gsd-events.js";

import type { GsdEventBase } from "./gsd-events.js";

const BASE: GsdEventBase = {
  project_key: "/test/project",
  timestamp: 1_700_000_000_000,
};

describe("GsdEvents", () => {
  describe("gsdPlanCreated", () => {
    test("returns correct type", () => {
      const event = gsdPlanCreated(BASE, {
        plan_id: "plan-1",
        plan_path: ".planning/quick/plan-1/01-PLAN.md",
        task_count: 3,
        wave_count: 2,
      });
      expect(event.type).toBe("gsd_plan_created");
    });

    test("includes all required fields", () => {
      const event = gsdPlanCreated(BASE, {
        plan_id: "plan-1",
        plan_path: ".planning/quick/plan-1/01-PLAN.md",
        task_count: 3,
        wave_count: 2,
      });
      expect(event).toMatchObject({
        project_key: BASE.project_key,
        timestamp: BASE.timestamp,
        plan_id: "plan-1",
        plan_path: ".planning/quick/plan-1/01-PLAN.md",
        task_count: 3,
        wave_count: 2,
      });
    });

    test("includes optional fields when provided", () => {
      const event = gsdPlanCreated(BASE, {
        plan_id: "plan-1",
        plan_path: ".planning/quick/plan-1/01-PLAN.md",
        task_count: 3,
        wave_count: 2,
        bead_id: "bead-1",
        epic_id: "epic-1",
        autonomous: true,
      });
      expect(event).toMatchObject({
        bead_id: "bead-1",
        epic_id: "epic-1",
        autonomous: true,
      });
    });

    test("omits optional fields when not provided", () => {
      const event = gsdPlanCreated(BASE, {
        plan_id: "plan-1",
        plan_path: ".planning/quick/plan-1/01-PLAN.md",
        task_count: 3,
        wave_count: 2,
      });
      expect("bead_id" in event).toBe(false);
      expect("epic_id" in event).toBe(false);
      expect("autonomous" in event).toBe(false);
    });
  });

  describe("gsdWaveStarted", () => {
    test("returns correct type", () => {
      const event = gsdWaveStarted(BASE, {
        wave_number: 1,
        task_count: 3,
        parallel_workers: 3,
      });
      expect(event.type).toBe("gsd_wave_started");
    });

    test("includes all required fields", () => {
      const event = gsdWaveStarted(BASE, {
        wave_number: 1,
        task_count: 3,
        parallel_workers: 3,
      });
      expect(event).toMatchObject({
        project_key: BASE.project_key,
        timestamp: BASE.timestamp,
        wave_number: 1,
        task_count: 3,
        parallel_workers: 3,
      });
    });

    test("includes optional fields when provided", () => {
      const event = gsdWaveStarted(BASE, {
        wave_number: 1,
        task_count: 3,
        parallel_workers: 3,
        epic_id: "epic-1",
        files_in_scope: ["src/foo.ts", "src/bar.ts"],
      });
      expect(event.epic_id).toBe("epic-1");
      expect(event.files_in_scope).toEqual(["src/foo.ts", "src/bar.ts"]);
    });

    test("omits optional fields when not provided", () => {
      const event = gsdWaveStarted(BASE, {
        wave_number: 1,
        task_count: 3,
        parallel_workers: 3,
      });
      expect("epic_id" in event).toBe(false);
      expect("files_in_scope" in event).toBe(false);
    });
  });

  describe("gsdWaveCompleted", () => {
    test("returns correct type", () => {
      const event = gsdWaveCompleted(BASE, {
        wave_number: 1,
        tasks_completed: 3,
      });
      expect(event.type).toBe("gsd_wave_completed");
    });

    test("includes all required fields", () => {
      const event = gsdWaveCompleted(BASE, {
        wave_number: 1,
        tasks_completed: 3,
      });
      expect(event).toMatchObject({
        project_key: BASE.project_key,
        timestamp: BASE.timestamp,
        wave_number: 1,
        tasks_completed: 3,
      });
    });

    test("includes optional fields when provided", () => {
      const event = gsdWaveCompleted(BASE, {
        wave_number: 1,
        tasks_completed: 3,
        tasks_failed: 0,
        duration_ms: 5000,
        epic_id: "epic-1",
      });
      expect(event).toMatchObject({
        tasks_failed: 0,
        duration_ms: 5000,
        epic_id: "epic-1",
      });
    });

    test("omits optional fields when not provided", () => {
      const event = gsdWaveCompleted(BASE, {
        wave_number: 1,
        tasks_completed: 3,
      });
      expect("tasks_failed" in event).toBe(false);
      expect("duration_ms" in event).toBe(false);
      expect("epic_id" in event).toBe(false);
    });
  });

  describe("gsdWaveFailed", () => {
    test("returns correct type", () => {
      const event = gsdWaveFailed(BASE, {
        wave_number: 2,
        failures: ["task-3 timed out"],
      });
      expect(event.type).toBe("gsd_wave_failed");
    });

    test("includes all required fields", () => {
      const event = gsdWaveFailed(BASE, {
        wave_number: 2,
        failures: ["task-3 timed out", "task-4 type error"],
      });
      expect(event).toMatchObject({
        project_key: BASE.project_key,
        timestamp: BASE.timestamp,
        wave_number: 2,
        failures: ["task-3 timed out", "task-4 type error"],
      });
    });

    test("includes optional fields when provided", () => {
      const event = gsdWaveFailed(BASE, {
        wave_number: 2,
        failures: ["task-3 timed out"],
        epic_id: "epic-1",
        fix_wave_created: true,
      });
      expect(event.epic_id).toBe("epic-1");
      expect(event.fix_wave_created).toBe(true);
    });

    test("omits optional fields when not provided", () => {
      const event = gsdWaveFailed(BASE, {
        wave_number: 2,
        failures: ["task-3 timed out"],
      });
      expect("epic_id" in event).toBe(false);
      expect("fix_wave_created" in event).toBe(false);
    });
  });

  describe("gsdTaskExecuted", () => {
    test("returns correct type", () => {
      const event = gsdTaskExecuted(BASE, {
        task_name: "Create component",
        success: true,
      });
      expect(event.type).toBe("gsd_task_executed");
    });

    test("includes all required fields", () => {
      const event = gsdTaskExecuted(BASE, {
        task_name: "Create component",
        success: true,
      });
      expect(event).toMatchObject({
        project_key: BASE.project_key,
        timestamp: BASE.timestamp,
        task_name: "Create component",
        success: true,
      });
    });

    test("includes optional fields when provided", () => {
      const event = gsdTaskExecuted(BASE, {
        task_name: "Create component",
        success: true,
        bead_id: "bead-1",
        epic_id: "epic-1",
        wave_number: 1,
        files_modified: ["src/foo.ts"],
        commit_sha: "abc123",
      });
      expect(event).toMatchObject({
        bead_id: "bead-1",
        epic_id: "epic-1",
        wave_number: 1,
        files_modified: ["src/foo.ts"],
        commit_sha: "abc123",
      });
    });

    test("omits optional fields when not provided", () => {
      const event = gsdTaskExecuted(BASE, {
        task_name: "Create component",
        success: true,
      });
      expect("bead_id" in event).toBe(false);
      expect("epic_id" in event).toBe(false);
      expect("wave_number" in event).toBe(false);
      expect("files_modified" in event).toBe(false);
      expect("commit_sha" in event).toBe(false);
    });
  });

  describe("gsdVerificationRun", () => {
    test("returns correct type", () => {
      const event = gsdVerificationRun(BASE, {
        verification_type: "task",
      });
      expect(event.type).toBe("gsd_verification_run");
    });

    test("includes all required fields", () => {
      const event = gsdVerificationRun(BASE, {
        verification_type: "phase",
      });
      expect(event).toMatchObject({
        project_key: BASE.project_key,
        timestamp: BASE.timestamp,
        verification_type: "phase",
      });
    });

    test("includes optional fields when provided", () => {
      const event = gsdVerificationRun(BASE, {
        verification_type: "task",
        epic_id: "epic-1",
        phase_num: 1,
        must_haves_checked: 5,
        artifacts_checked: 3,
        key_links_checked: 2,
      });
      expect(event).toMatchObject({
        epic_id: "epic-1",
        phase_num: 1,
        must_haves_checked: 5,
        artifacts_checked: 3,
        key_links_checked: 2,
      });
    });

    test("omits optional fields when not provided", () => {
      const event = gsdVerificationRun(BASE, {
        verification_type: "task",
      });
      expect("epic_id" in event).toBe(false);
      expect("phase_num" in event).toBe(false);
      expect("must_haves_checked" in event).toBe(false);
    });
  });

  describe("gsdVerificationPassed", () => {
    test("returns correct type", () => {
      const event = gsdVerificationPassed(BASE, {
        must_haves_passed: 5,
        artifacts_passed: 3,
        key_links_passed: 2,
        total_checks: 10,
      });
      expect(event.type).toBe("gsd_verification_passed");
    });

    test("includes all required fields", () => {
      const event = gsdVerificationPassed(BASE, {
        must_haves_passed: 5,
        artifacts_passed: 3,
        key_links_passed: 2,
        total_checks: 10,
      });
      expect(event).toMatchObject({
        project_key: BASE.project_key,
        timestamp: BASE.timestamp,
        must_haves_passed: 5,
        artifacts_passed: 3,
        key_links_passed: 2,
        total_checks: 10,
      });
    });

    test("includes optional fields when provided", () => {
      const event = gsdVerificationPassed(BASE, {
        must_haves_passed: 5,
        artifacts_passed: 3,
        key_links_passed: 2,
        total_checks: 10,
        epic_id: "epic-1",
        phase_num: 2,
      });
      expect(event.epic_id).toBe("epic-1");
      expect(event.phase_num).toBe(2);
    });

    test("omits optional fields when not provided", () => {
      const event = gsdVerificationPassed(BASE, {
        must_haves_passed: 5,
        artifacts_passed: 3,
        key_links_passed: 2,
        total_checks: 10,
      });
      expect("epic_id" in event).toBe(false);
      expect("phase_num" in event).toBe(false);
    });
  });

  describe("gsdVerificationFailed", () => {
    test("returns correct type", () => {
      const event = gsdVerificationFailed(BASE, {
        failures: ["Missing artifact: src/foo.ts"],
      });
      expect(event.type).toBe("gsd_verification_failed");
    });

    test("includes all required fields", () => {
      const event = gsdVerificationFailed(BASE, {
        failures: ["Missing artifact: src/foo.ts", "Truth check failed"],
      });
      expect(event).toMatchObject({
        project_key: BASE.project_key,
        timestamp: BASE.timestamp,
        failures: ["Missing artifact: src/foo.ts", "Truth check failed"],
      });
    });

    test("includes optional fields when provided", () => {
      const event = gsdVerificationFailed(BASE, {
        failures: ["Missing artifact"],
        epic_id: "epic-1",
        phase_num: 1,
        fix_tasks_created: 2,
        retry_count: 1,
      });
      expect(event).toMatchObject({
        epic_id: "epic-1",
        phase_num: 1,
        fix_tasks_created: 2,
        retry_count: 1,
      });
    });

    test("omits optional fields when not provided", () => {
      const event = gsdVerificationFailed(BASE, {
        failures: ["Missing artifact"],
      });
      expect("epic_id" in event).toBe(false);
      expect("phase_num" in event).toBe(false);
      expect("fix_tasks_created" in event).toBe(false);
      expect("retry_count" in event).toBe(false);
    });
  });

  describe("gsdStateUpdated", () => {
    test("returns correct type", () => {
      const event = gsdStateUpdated(BASE, {});
      expect(event.type).toBe("gsd_state_updated");
    });

    test("includes base fields", () => {
      const event = gsdStateUpdated(BASE, {});
      expect(event).toMatchObject({
        project_key: BASE.project_key,
        timestamp: BASE.timestamp,
      });
    });

    test("includes optional fields when provided", () => {
      const event = gsdStateUpdated(BASE, {
        current_phase: 2,
        current_wave: 3,
        tasks_completed: 5,
        tasks_remaining: 2,
      });
      expect(event).toMatchObject({
        current_phase: 2,
        current_wave: 3,
        tasks_completed: 5,
        tasks_remaining: 2,
      });
    });

    test("omits optional fields when not provided", () => {
      const event = gsdStateUpdated(BASE, {});
      expect("current_phase" in event).toBe(false);
      expect("current_wave" in event).toBe(false);
      expect("tasks_completed" in event).toBe(false);
      expect("tasks_remaining" in event).toBe(false);
    });
  });

  describe("gsdCheckpointGate", () => {
    test("returns correct type", () => {
      const event = gsdCheckpointGate(BASE, {
        gate_type: "human-verify",
        description: "Verify UI looks correct",
      });
      expect(event.type).toBe("gsd_checkpoint_gate");
    });

    test("includes all required fields", () => {
      const event = gsdCheckpointGate(BASE, {
        gate_type: "decision",
        description: "Choose database provider",
      });
      expect(event).toMatchObject({
        project_key: BASE.project_key,
        timestamp: BASE.timestamp,
        gate_type: "decision",
        description: "Choose database provider",
      });
    });

    test("includes optional fields when provided", () => {
      const event = gsdCheckpointGate(BASE, {
        gate_type: "human-action",
        description: "Set up API keys",
        epic_id: "epic-1",
        response: "Done, keys configured",
      });
      expect(event.epic_id).toBe("epic-1");
      expect(event.response).toBe("Done, keys configured");
    });

    test("omits optional fields when not provided", () => {
      const event = gsdCheckpointGate(BASE, {
        gate_type: "human-verify",
        description: "Check output",
      });
      expect("epic_id" in event).toBe(false);
      expect("response" in event).toBe(false);
    });
  });

  describe("gsdFixPlanGenerated", () => {
    test("returns correct type", () => {
      const event = gsdFixPlanGenerated(BASE, {
        source_verification: "ver-1",
        fix_tasks: ["fix-1", "fix-2"],
      });
      expect(event.type).toBe("gsd_fix_plan_generated");
    });

    test("includes all required fields", () => {
      const event = gsdFixPlanGenerated(BASE, {
        source_verification: "ver-1",
        fix_tasks: ["fix-1"],
      });
      expect(event).toMatchObject({
        project_key: BASE.project_key,
        timestamp: BASE.timestamp,
        source_verification: "ver-1",
        fix_tasks: ["fix-1"],
      });
    });

    test("includes optional fields when provided", () => {
      const event = gsdFixPlanGenerated(BASE, {
        source_verification: "ver-1",
        fix_tasks: ["fix-1"],
        epic_id: "epic-1",
        phase_num: 2,
      });
      expect(event.epic_id).toBe("epic-1");
      expect(event.phase_num).toBe(2);
    });

    test("omits optional fields when not provided", () => {
      const event = gsdFixPlanGenerated(BASE, {
        source_verification: "ver-1",
        fix_tasks: ["fix-1"],
      });
      expect("epic_id" in event).toBe(false);
      expect("phase_num" in event).toBe(false);
    });
  });

  describe("gsdFixPlanCompleted", () => {
    test("returns correct type", () => {
      const event = gsdFixPlanCompleted(BASE, {
        fix_tasks: ["fix-1"],
        re_verification_passed: true,
      });
      expect(event.type).toBe("gsd_fix_plan_completed");
    });

    test("includes all required fields", () => {
      const event = gsdFixPlanCompleted(BASE, {
        fix_tasks: ["fix-1", "fix-2"],
        re_verification_passed: false,
      });
      expect(event).toMatchObject({
        project_key: BASE.project_key,
        timestamp: BASE.timestamp,
        fix_tasks: ["fix-1", "fix-2"],
        re_verification_passed: false,
      });
    });

    test("includes optional fields when provided", () => {
      const event = gsdFixPlanCompleted(BASE, {
        fix_tasks: ["fix-1"],
        re_verification_passed: true,
        epic_id: "epic-1",
        phase_num: 1,
        duration_ms: 12000,
      });
      expect(event).toMatchObject({
        epic_id: "epic-1",
        phase_num: 1,
        duration_ms: 12000,
      });
    });

    test("omits optional fields when not provided", () => {
      const event = gsdFixPlanCompleted(BASE, {
        fix_tasks: ["fix-1"],
        re_verification_passed: true,
      });
      expect("epic_id" in event).toBe(false);
      expect("phase_num" in event).toBe(false);
      expect("duration_ms" in event).toBe(false);
    });
  });

  describe("gsdResearchStarted", () => {
    test("returns correct type", () => {
      const event = gsdResearchStarted(BASE, {
        project_key_ref: "proj-1",
        round: 1,
      });
      expect(event.type).toBe("gsd_research_started");
    });

    test("includes all required fields", () => {
      const event = gsdResearchStarted(BASE, {
        project_key_ref: "proj-1",
        round: 2,
      });
      expect(event).toMatchObject({
        project_key: BASE.project_key,
        timestamp: BASE.timestamp,
        project_key_ref: "proj-1",
        round: 2,
      });
    });

    test("includes optional fields when provided", () => {
      const event = gsdResearchStarted(BASE, {
        project_key_ref: "proj-1",
        round: 1,
        epic_id: "epic-1",
        queries: ["Stripe API docs", "existing payment patterns"],
      });
      expect(event.epic_id).toBe("epic-1");
      expect(event.queries).toEqual([
        "Stripe API docs",
        "existing payment patterns",
      ]);
    });

    test("omits optional fields when not provided", () => {
      const event = gsdResearchStarted(BASE, {
        project_key_ref: "proj-1",
        round: 1,
      });
      expect("epic_id" in event).toBe(false);
      expect("queries" in event).toBe(false);
    });
  });

  describe("gsdResearchCompleted", () => {
    test("returns correct type", () => {
      const event = gsdResearchCompleted(BASE, {
        project_key_ref: "proj-1",
        findings_path: ".planning/research/findings.md",
        round: 1,
      });
      expect(event.type).toBe("gsd_research_completed");
    });

    test("includes all required fields", () => {
      const event = gsdResearchCompleted(BASE, {
        project_key_ref: "proj-1",
        findings_path: ".planning/research/findings.md",
        round: 2,
      });
      expect(event).toMatchObject({
        project_key: BASE.project_key,
        timestamp: BASE.timestamp,
        project_key_ref: "proj-1",
        findings_path: ".planning/research/findings.md",
        round: 2,
      });
    });

    test("includes optional fields when provided", () => {
      const event = gsdResearchCompleted(BASE, {
        project_key_ref: "proj-1",
        findings_path: ".planning/research/findings.md",
        round: 1,
        epic_id: "epic-1",
        findings_count: 5,
      });
      expect(event.epic_id).toBe("epic-1");
      expect(event.findings_count).toBe(5);
    });

    test("omits optional fields when not provided", () => {
      const event = gsdResearchCompleted(BASE, {
        project_key_ref: "proj-1",
        findings_path: ".planning/research/findings.md",
        round: 1,
      });
      expect("epic_id" in event).toBe(false);
      expect("findings_count" in event).toBe(false);
    });
  });

  describe("gsdRoadmapPhaseStarted", () => {
    test("returns correct type", () => {
      const event = gsdRoadmapPhaseStarted(BASE, {
        phase_num: 1,
        phase_name: "Foundation",
      });
      expect(event.type).toBe("gsd_roadmap_phase_started");
    });

    test("includes all required fields", () => {
      const event = gsdRoadmapPhaseStarted(BASE, {
        phase_num: 2,
        phase_name: "Integration",
      });
      expect(event).toMatchObject({
        project_key: BASE.project_key,
        timestamp: BASE.timestamp,
        phase_num: 2,
        phase_name: "Integration",
      });
    });

    test("includes optional fields when provided", () => {
      const event = gsdRoadmapPhaseStarted(BASE, {
        phase_num: 1,
        phase_name: "Foundation",
        epic_id: "epic-1",
        acceptance_criteria: ["All tests pass", "Docs updated"],
      });
      expect(event.epic_id).toBe("epic-1");
      expect(event.acceptance_criteria).toEqual([
        "All tests pass",
        "Docs updated",
      ]);
    });

    test("omits optional fields when not provided", () => {
      const event = gsdRoadmapPhaseStarted(BASE, {
        phase_num: 1,
        phase_name: "Foundation",
      });
      expect("epic_id" in event).toBe(false);
      expect("acceptance_criteria" in event).toBe(false);
    });
  });
});
