/**
 * Tests for gsd-events.ts — GSD event payload factories.
 *
 * TDD RED phase: Tests define the contract BEFORE implementation.
 * Each factory output is validated against its Zod schema from swarm-mail.
 */
import { describe, expect, test } from "bun:test";

import {
  GsdPlanCreatedEventSchema,
  GsdWaveStartedEventSchema,
  GsdWaveCompletedEventSchema,
  GsdTaskExecutedEventSchema,
  GsdVerificationRunEventSchema,
  GsdVerificationPassedEventSchema,
  GsdVerificationFailedEventSchema,
  GsdStateUpdatedEventSchema,
  GsdCheckpointGateEventSchema,
  GsdRoadmapPhaseStartedEventSchema,
} from "../../../../swarm-mail/src/streams/events.js";

import {
  gsdPlanCreated,
  gsdWaveStarted,
  gsdWaveCompleted,
  gsdTaskExecuted,
  gsdVerificationRun,
  gsdVerificationPassed,
  gsdVerificationFailed,
  gsdStateUpdated,
  gsdCheckpointGate,
  gsdRoadmapPhaseStarted,
  type GsdEventBase,
} from "../gsd-events.js";

const BASE: GsdEventBase = {
  project_key: "/test/project",
  timestamp: 1_700_000_000_000,
};

describe("GsdEvents", () => {
  // =========================================================================
  // gsdPlanCreated
  // =========================================================================
  describe("gsdPlanCreated", () => {
    test("returns correct type", () => {
      const event = gsdPlanCreated(BASE, {
        plan_id: "plan-1",
        plan_path: "/plans/plan-1.md",
        task_count: 5,
        wave_count: 2,
      });
      expect(event.type).toBe("gsd_plan_created");
    });

    test("includes all required fields", () => {
      const event = gsdPlanCreated(BASE, {
        plan_id: "plan-1",
        plan_path: "/plans/plan-1.md",
        task_count: 5,
        wave_count: 2,
      });
      expect(event).toMatchObject({
        project_key: BASE.project_key,
        timestamp: BASE.timestamp,
        plan_id: "plan-1",
        plan_path: "/plans/plan-1.md",
        task_count: 5,
        wave_count: 2,
      });
    });

    test("includes optional fields when provided", () => {
      const event = gsdPlanCreated(BASE, {
        plan_id: "plan-1",
        plan_path: "/plans/plan-1.md",
        task_count: 5,
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
        plan_path: "/plans/plan-1.md",
        task_count: 5,
        wave_count: 2,
      });
      expect("bead_id" in event).toBe(false);
      expect("epic_id" in event).toBe(false);
      expect("autonomous" in event).toBe(false);
    });

    test("validates against Zod schema", () => {
      const event = gsdPlanCreated(BASE, {
        plan_id: "plan-1",
        plan_path: "/plans/plan-1.md",
        task_count: 5,
        wave_count: 2,
      });
      expect(() => GsdPlanCreatedEventSchema.parse(event)).not.toThrow();
    });
  });

  // =========================================================================
  // gsdWaveStarted
  // =========================================================================
  describe("gsdWaveStarted", () => {
    test("returns correct type", () => {
      const event = gsdWaveStarted(BASE, {
        wave_number: 1,
        task_count: 3,
        parallel_workers: 2,
      });
      expect(event.type).toBe("gsd_wave_started");
    });

    test("includes all required fields", () => {
      const event = gsdWaveStarted(BASE, {
        wave_number: 1,
        task_count: 3,
        parallel_workers: 2,
      });
      expect(event).toMatchObject({
        project_key: BASE.project_key,
        timestamp: BASE.timestamp,
        wave_number: 1,
        task_count: 3,
        parallel_workers: 2,
      });
    });

    test("includes optional fields when provided", () => {
      const event = gsdWaveStarted(BASE, {
        wave_number: 1,
        task_count: 3,
        parallel_workers: 2,
        epic_id: "epic-1",
        files_in_scope: ["src/auth.ts", "src/db.ts"],
      });
      expect(event).toMatchObject({
        epic_id: "epic-1",
        files_in_scope: ["src/auth.ts", "src/db.ts"],
      });
    });

    test("omits optional fields when not provided", () => {
      const event = gsdWaveStarted(BASE, {
        wave_number: 1,
        task_count: 3,
        parallel_workers: 2,
      });
      expect("epic_id" in event).toBe(false);
      expect("files_in_scope" in event).toBe(false);
    });

    test("validates against Zod schema", () => {
      const event = gsdWaveStarted(BASE, {
        wave_number: 1,
        task_count: 3,
        parallel_workers: 2,
      });
      expect(() => GsdWaveStartedEventSchema.parse(event)).not.toThrow();
    });
  });

  // =========================================================================
  // gsdWaveCompleted
  // =========================================================================
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
        tasks_failed: 1,
        duration_ms: 5000,
        epic_id: "epic-1",
      });
      expect(event).toMatchObject({
        tasks_failed: 1,
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

    test("validates against Zod schema", () => {
      const event = gsdWaveCompleted(BASE, {
        wave_number: 1,
        tasks_completed: 3,
      });
      expect(() => GsdWaveCompletedEventSchema.parse(event)).not.toThrow();
    });
  });

  // =========================================================================
  // gsdTaskExecuted
  // =========================================================================
  describe("gsdTaskExecuted", () => {
    test("returns correct type", () => {
      const event = gsdTaskExecuted(BASE, {
        task_name: "implement-auth",
        success: true,
      });
      expect(event.type).toBe("gsd_task_executed");
    });

    test("includes all required fields", () => {
      const event = gsdTaskExecuted(BASE, {
        task_name: "implement-auth",
        success: true,
      });
      expect(event).toMatchObject({
        project_key: BASE.project_key,
        timestamp: BASE.timestamp,
        task_name: "implement-auth",
        success: true,
      });
    });

    test("includes optional fields when provided", () => {
      const event = gsdTaskExecuted(BASE, {
        task_name: "implement-auth",
        success: true,
        bead_id: "bead-1",
        epic_id: "epic-1",
        wave_number: 1,
        files_modified: ["src/auth.ts"],
        commit_sha: "abc123",
      });
      expect(event).toMatchObject({
        bead_id: "bead-1",
        epic_id: "epic-1",
        wave_number: 1,
        files_modified: ["src/auth.ts"],
        commit_sha: "abc123",
      });
    });

    test("omits optional fields when not provided", () => {
      const event = gsdTaskExecuted(BASE, {
        task_name: "implement-auth",
        success: true,
      });
      expect("bead_id" in event).toBe(false);
      expect("epic_id" in event).toBe(false);
      expect("wave_number" in event).toBe(false);
      expect("files_modified" in event).toBe(false);
      expect("commit_sha" in event).toBe(false);
    });

    test("validates against Zod schema", () => {
      const event = gsdTaskExecuted(BASE, {
        task_name: "implement-auth",
        success: true,
      });
      expect(() => GsdTaskExecutedEventSchema.parse(event)).not.toThrow();
    });
  });

  // =========================================================================
  // gsdVerificationRun
  // =========================================================================
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
        phase_num: 2,
        must_haves_checked: 5,
        artifacts_checked: 3,
        key_links_checked: 2,
      });
      expect(event).toMatchObject({
        epic_id: "epic-1",
        phase_num: 2,
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
      expect("artifacts_checked" in event).toBe(false);
      expect("key_links_checked" in event).toBe(false);
    });

    test("validates against Zod schema", () => {
      const event = gsdVerificationRun(BASE, {
        verification_type: "task",
      });
      expect(() => GsdVerificationRunEventSchema.parse(event)).not.toThrow();
    });
  });

  // =========================================================================
  // gsdVerificationPassed
  // =========================================================================
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
      expect(event).toMatchObject({
        epic_id: "epic-1",
        phase_num: 2,
      });
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

    test("validates against Zod schema", () => {
      const event = gsdVerificationPassed(BASE, {
        must_haves_passed: 5,
        artifacts_passed: 3,
        key_links_passed: 2,
        total_checks: 10,
      });
      expect(() => GsdVerificationPassedEventSchema.parse(event)).not.toThrow();
    });
  });

  // =========================================================================
  // gsdVerificationFailed
  // =========================================================================
  describe("gsdVerificationFailed", () => {
    test("returns correct type", () => {
      const event = gsdVerificationFailed(BASE, {
        failures: ["Missing auth module", "No tests"],
      });
      expect(event.type).toBe("gsd_verification_failed");
    });

    test("includes all required fields", () => {
      const event = gsdVerificationFailed(BASE, {
        failures: ["Missing auth module"],
      });
      expect(event).toMatchObject({
        project_key: BASE.project_key,
        timestamp: BASE.timestamp,
        failures: ["Missing auth module"],
      });
    });

    test("includes optional fields when provided", () => {
      const event = gsdVerificationFailed(BASE, {
        failures: ["Missing auth module"],
        epic_id: "epic-1",
        phase_num: 2,
        fix_tasks_created: 3,
        retry_count: 1,
      });
      expect(event).toMatchObject({
        epic_id: "epic-1",
        phase_num: 2,
        fix_tasks_created: 3,
        retry_count: 1,
      });
    });

    test("omits optional fields when not provided", () => {
      const event = gsdVerificationFailed(BASE, {
        failures: ["Missing auth module"],
      });
      expect("epic_id" in event).toBe(false);
      expect("phase_num" in event).toBe(false);
      expect("fix_tasks_created" in event).toBe(false);
      expect("retry_count" in event).toBe(false);
    });

    test("validates against Zod schema", () => {
      const event = gsdVerificationFailed(BASE, {
        failures: ["Missing auth module"],
      });
      expect(() => GsdVerificationFailedEventSchema.parse(event)).not.toThrow();
    });
  });

  // =========================================================================
  // gsdStateUpdated
  // =========================================================================
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

    test("validates against Zod schema", () => {
      const event = gsdStateUpdated(BASE, {});
      expect(() => GsdStateUpdatedEventSchema.parse(event)).not.toThrow();
    });
  });

  // =========================================================================
  // gsdCheckpointGate
  // =========================================================================
  describe("gsdCheckpointGate", () => {
    test("returns correct type", () => {
      const event = gsdCheckpointGate(BASE, {
        gate_type: "human-verify",
        description: "Verify auth implementation",
      });
      expect(event.type).toBe("gsd_checkpoint_gate");
    });

    test("includes all required fields", () => {
      const event = gsdCheckpointGate(BASE, {
        gate_type: "decision",
        description: "Choose auth provider",
      });
      expect(event).toMatchObject({
        project_key: BASE.project_key,
        timestamp: BASE.timestamp,
        gate_type: "decision",
        description: "Choose auth provider",
      });
    });

    test("includes optional fields when provided", () => {
      const event = gsdCheckpointGate(BASE, {
        gate_type: "human-action",
        description: "Deploy to staging",
        epic_id: "epic-1",
        response: "Approved",
      });
      expect(event).toMatchObject({
        epic_id: "epic-1",
        response: "Approved",
      });
    });

    test("omits optional fields when not provided", () => {
      const event = gsdCheckpointGate(BASE, {
        gate_type: "human-verify",
        description: "Verify",
      });
      expect("epic_id" in event).toBe(false);
      expect("response" in event).toBe(false);
    });

    test("validates against Zod schema", () => {
      const event = gsdCheckpointGate(BASE, {
        gate_type: "human-verify",
        description: "Verify auth implementation",
      });
      expect(() => GsdCheckpointGateEventSchema.parse(event)).not.toThrow();
    });
  });

  // =========================================================================
  // gsdRoadmapPhaseStarted
  // =========================================================================
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
        phase_num: 1,
        phase_name: "Foundation",
      });
      expect(event).toMatchObject({
        project_key: BASE.project_key,
        timestamp: BASE.timestamp,
        phase_num: 1,
        phase_name: "Foundation",
      });
    });

    test("includes optional fields when provided", () => {
      const event = gsdRoadmapPhaseStarted(BASE, {
        phase_num: 2,
        phase_name: "Implementation",
        epic_id: "epic-1",
        acceptance_criteria: ["All tests pass", "Docs updated"],
      });
      expect(event).toMatchObject({
        epic_id: "epic-1",
        acceptance_criteria: ["All tests pass", "Docs updated"],
      });
    });

    test("omits optional fields when not provided", () => {
      const event = gsdRoadmapPhaseStarted(BASE, {
        phase_num: 1,
        phase_name: "Foundation",
      });
      expect("epic_id" in event).toBe(false);
      expect("acceptance_criteria" in event).toBe(false);
    });

    test("validates against Zod schema", () => {
      const event = gsdRoadmapPhaseStarted(BASE, {
        phase_num: 1,
        phase_name: "Foundation",
      });
      expect(() =>
        GsdRoadmapPhaseStartedEventSchema.parse(event),
      ).not.toThrow();
    });
  });
});
