/**
 * Tests for bead-events.ts — Beads bridge event payload factories.
 *
 * TDD RED phase: Tests define the contract BEFORE implementation.
 */
import { describe, expect, test } from "bun:test";

import {
  beadsTaskCreated,
  beadsDepAdded,
  beadsDepRemoved,
  beadsStatusChanged,
  beadsReadyChanged,
  beadsClosed,
  beadsSyncCompleted,
  beadsMappingCreated,
} from "../bead-events.js";

const BASE = {
  project_key: "/test/project",
  timestamp: 1_700_000_000_000,
};

describe("BeadEvents", () => {
  describe("beadsTaskCreated", () => {
    test("returns correct type", () => {
      const event = beadsTaskCreated(BASE, {
        bead_id: "bead-1",
        cell_id: "cell-1",
        title: "Task",
      });
      expect(event.type).toBe("beads_task_created");
    });

    test("includes all required fields", () => {
      const event = beadsTaskCreated(BASE, {
        bead_id: "bead-1",
        cell_id: "cell-1",
        title: "Task",
      });
      expect(event).toMatchObject({
        project_key: BASE.project_key,
        timestamp: BASE.timestamp,
        bead_id: "bead-1",
        cell_id: "cell-1",
        title: "Task",
      });
    });

    test("includes optional fields when provided", () => {
      const event = beadsTaskCreated(BASE, {
        bead_id: "bead-1",
        cell_id: "cell-1",
        title: "Task",
        issue_type: "feature",
        priority: 2,
        parent_bead_id: "parent-1",
        epic_id: "epic-1",
      });
      expect(event).toMatchObject({
        issue_type: "feature",
        priority: 2,
        parent_bead_id: "parent-1",
        epic_id: "epic-1",
      });
    });

    test("omits optional fields when not provided", () => {
      const event = beadsTaskCreated(BASE, {
        bead_id: "bead-1",
        cell_id: "cell-1",
        title: "Task",
      });
      expect("issue_type" in event).toBe(false);
      expect("priority" in event).toBe(false);
      expect("parent_bead_id" in event).toBe(false);
      expect("epic_id" in event).toBe(false);
    });
  });

  describe("beadsDepAdded", () => {
    test("returns correct type", () => {
      const event = beadsDepAdded(BASE, {
        source_bead_id: "a",
        target_bead_id: "b",
        dep_type: "blocks",
      });
      expect(event.type).toBe("beads_dep_added");
    });

    test("includes all required fields", () => {
      const event = beadsDepAdded(BASE, {
        source_bead_id: "a",
        target_bead_id: "b",
        dep_type: "blocks",
      });
      expect(event).toMatchObject({
        project_key: BASE.project_key,
        timestamp: BASE.timestamp,
        source_bead_id: "a",
        target_bead_id: "b",
        dep_type: "blocks",
      });
    });

    test("includes optional fields when provided", () => {
      const event = beadsDepAdded(BASE, {
        source_bead_id: "a",
        target_bead_id: "b",
        dep_type: "blocks",
        epic_id: "epic-1",
      });
      expect(event.epic_id).toBe("epic-1");
    });

    test("omits optional fields when not provided", () => {
      const event = beadsDepAdded(BASE, {
        source_bead_id: "a",
        target_bead_id: "b",
        dep_type: "blocks",
      });
      expect("epic_id" in event).toBe(false);
    });
  });

  describe("beadsDepRemoved", () => {
    test("returns correct type", () => {
      const event = beadsDepRemoved(BASE, {
        source_bead_id: "a",
        target_bead_id: "b",
        dep_type: "requires",
      });
      expect(event.type).toBe("beads_dep_removed");
    });

    test("includes all required fields", () => {
      const event = beadsDepRemoved(BASE, {
        source_bead_id: "a",
        target_bead_id: "b",
        dep_type: "requires",
      });
      expect(event).toMatchObject({
        project_key: BASE.project_key,
        timestamp: BASE.timestamp,
        source_bead_id: "a",
        target_bead_id: "b",
        dep_type: "requires",
      });
    });

    test("includes optional fields when provided", () => {
      const event = beadsDepRemoved(BASE, {
        source_bead_id: "a",
        target_bead_id: "b",
        dep_type: "requires",
        epic_id: "epic-2",
      });
      expect(event.epic_id).toBe("epic-2");
    });

    test("omits optional fields when not provided", () => {
      const event = beadsDepRemoved(BASE, {
        source_bead_id: "a",
        target_bead_id: "b",
        dep_type: "requires",
      });
      expect("epic_id" in event).toBe(false);
    });
  });

  describe("beadsStatusChanged", () => {
    test("returns correct type", () => {
      const event = beadsStatusChanged(BASE, {
        bead_id: "bead-1",
        old_status: "open",
        new_status: "closed",
      });
      expect(event.type).toBe("beads_status_changed");
    });

    test("includes all required fields", () => {
      const event = beadsStatusChanged(BASE, {
        bead_id: "bead-1",
        old_status: "open",
        new_status: "closed",
      });
      expect(event).toMatchObject({
        project_key: BASE.project_key,
        timestamp: BASE.timestamp,
        bead_id: "bead-1",
        old_status: "open",
        new_status: "closed",
      });
    });

    test("includes optional fields when provided", () => {
      const event = beadsStatusChanged(BASE, {
        bead_id: "bead-1",
        old_status: "open",
        new_status: "closed",
        reason: "done",
        changed_by: "tester",
      });
      expect(event).toMatchObject({ reason: "done", changed_by: "tester" });
    });

    test("omits optional fields when not provided", () => {
      const event = beadsStatusChanged(BASE, {
        bead_id: "bead-1",
        old_status: "open",
        new_status: "closed",
      });
      expect("reason" in event).toBe(false);
      expect("changed_by" in event).toBe(false);
    });
  });

  describe("beadsReadyChanged", () => {
    test("returns correct type", () => {
      const event = beadsReadyChanged(BASE, {
        bead_ids: ["a", "b"],
        ready_count: 2,
        blocked_count: 0,
      });
      expect(event.type).toBe("beads_ready_changed");
    });

    test("includes all required fields", () => {
      const event = beadsReadyChanged(BASE, {
        bead_ids: ["a", "b"],
        ready_count: 2,
        blocked_count: 0,
      });
      expect(event).toMatchObject({
        project_key: BASE.project_key,
        timestamp: BASE.timestamp,
        bead_ids: ["a", "b"],
        ready_count: 2,
        blocked_count: 0,
      });
    });

    test("includes optional fields when provided", () => {
      const event = beadsReadyChanged(BASE, {
        bead_ids: ["a"],
        ready_count: 1,
        blocked_count: 0,
        epic_id: "epic-3",
      });
      expect(event.epic_id).toBe("epic-3");
    });

    test("omits optional fields when not provided", () => {
      const event = beadsReadyChanged(BASE, {
        bead_ids: ["a"],
        ready_count: 1,
        blocked_count: 0,
      });
      expect("epic_id" in event).toBe(false);
    });
  });

  describe("beadsClosed", () => {
    test("returns correct type", () => {
      const event = beadsClosed(BASE, { bead_id: "bead-1" });
      expect(event.type).toBe("beads_closed");
    });

    test("includes all required fields", () => {
      const event = beadsClosed(BASE, { bead_id: "bead-1" });
      expect(event).toMatchObject({
        project_key: BASE.project_key,
        timestamp: BASE.timestamp,
        bead_id: "bead-1",
      });
    });

    test("includes optional fields when provided", () => {
      const event = beadsClosed(BASE, {
        bead_id: "bead-1",
        reason: "done",
        commit_sha: "abc123",
        duration_ms: 1500,
        epic_id: "epic-4",
      });
      expect(event).toMatchObject({
        reason: "done",
        commit_sha: "abc123",
        duration_ms: 1500,
        epic_id: "epic-4",
      });
    });

    test("omits optional fields when not provided", () => {
      const event = beadsClosed(BASE, { bead_id: "bead-1" });
      expect("reason" in event).toBe(false);
      expect("commit_sha" in event).toBe(false);
      expect("duration_ms" in event).toBe(false);
      expect("epic_id" in event).toBe(false);
    });
  });

  describe("beadsSyncCompleted", () => {
    test("returns correct type", () => {
      const event = beadsSyncCompleted(BASE, { beads_synced: 3 });
      expect(event.type).toBe("beads_sync_completed");
    });

    test("includes all required fields", () => {
      const event = beadsSyncCompleted(BASE, { beads_synced: 3 });
      expect(event).toMatchObject({
        project_key: BASE.project_key,
        timestamp: BASE.timestamp,
        beads_synced: 3,
      });
    });

    test("includes optional fields when provided", () => {
      const event = beadsSyncCompleted(BASE, {
        beads_synced: 3,
        conflicts: 1,
        duration_ms: 2000,
      });
      expect(event).toMatchObject({ conflicts: 1, duration_ms: 2000 });
    });

    test("omits optional fields when not provided", () => {
      const event = beadsSyncCompleted(BASE, { beads_synced: 3 });
      expect("conflicts" in event).toBe(false);
      expect("duration_ms" in event).toBe(false);
    });
  });

  describe("beadsMappingCreated", () => {
    test("returns correct type", () => {
      const event = beadsMappingCreated(BASE, {
        cell_id: "cell-1",
        bead_id: "bead-1",
      });
      expect(event.type).toBe("beads_mapping_created");
    });

    test("includes all required fields", () => {
      const event = beadsMappingCreated(BASE, {
        cell_id: "cell-1",
        bead_id: "bead-1",
      });
      expect(event).toMatchObject({
        project_key: BASE.project_key,
        timestamp: BASE.timestamp,
        cell_id: "cell-1",
        bead_id: "bead-1",
      });
    });

    test("includes optional fields when provided", () => {
      const event = beadsMappingCreated(BASE, {
        cell_id: "cell-1",
        bead_id: "bead-1",
        epic_bead_id: "epic-bead-1",
        mapping_type: "manual",
      });
      expect(event).toMatchObject({
        epic_bead_id: "epic-bead-1",
        mapping_type: "manual",
      });
    });

    test("omits optional fields when not provided", () => {
      const event = beadsMappingCreated(BASE, {
        cell_id: "cell-1",
        bead_id: "bead-1",
      });
      expect("epic_bead_id" in event).toBe(false);
      expect("mapping_type" in event).toBe(false);
    });
  });
});
