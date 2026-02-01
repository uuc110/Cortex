import type { BeadDepType, BeadIssueType } from "./bead-types.js";

export interface BeadEventBase {
  project_key: string;
  timestamp: number;
}

export function beadsTaskCreated(
  base: BeadEventBase,
  data: {
    bead_id: string;
    cell_id: string;
    title: string;
    issue_type?: BeadIssueType;
    priority?: number;
    parent_bead_id?: string;
    epic_id?: string;
  },
): { type: "beads_task_created" } & BeadEventBase & typeof data {
  return {
    type: "beads_task_created" as const,
    ...base,
    ...data,
  };
}

export function beadsDepAdded(
  base: BeadEventBase,
  data: {
    source_bead_id: string;
    target_bead_id: string;
    dep_type: BeadDepType;
    epic_id?: string;
  },
): { type: "beads_dep_added" } & BeadEventBase & typeof data {
  return {
    type: "beads_dep_added" as const,
    ...base,
    ...data,
  };
}

export function beadsDepRemoved(
  base: BeadEventBase,
  data: {
    source_bead_id: string;
    target_bead_id: string;
    dep_type: BeadDepType;
    epic_id?: string;
  },
): { type: "beads_dep_removed" } & BeadEventBase & typeof data {
  return {
    type: "beads_dep_removed" as const,
    ...base,
    ...data,
  };
}

export function beadsStatusChanged(
  base: BeadEventBase,
  data: {
    bead_id: string;
    old_status: string;
    new_status: string;
    reason?: string;
    changed_by?: string;
  },
): { type: "beads_status_changed" } & BeadEventBase & typeof data {
  return {
    type: "beads_status_changed" as const,
    ...base,
    ...data,
  };
}

export function beadsReadyChanged(
  base: BeadEventBase,
  data: {
    bead_ids: string[];
    ready_count: number;
    blocked_count: number;
    epic_id?: string;
  },
): { type: "beads_ready_changed" } & BeadEventBase & typeof data {
  return {
    type: "beads_ready_changed" as const,
    ...base,
    ...data,
  };
}

export function beadsClosed(
  base: BeadEventBase,
  data: {
    bead_id: string;
    reason?: string;
    commit_sha?: string;
    duration_ms?: number;
    epic_id?: string;
  },
): { type: "beads_closed" } & BeadEventBase & typeof data {
  return {
    type: "beads_closed" as const,
    ...base,
    ...data,
  };
}

export function beadsSyncCompleted(
  base: BeadEventBase,
  data: {
    beads_synced: number;
    conflicts?: number;
    duration_ms?: number;
  },
): { type: "beads_sync_completed" } & BeadEventBase & typeof data {
  return {
    type: "beads_sync_completed" as const,
    ...base,
    ...data,
  };
}

export function beadsMappingCreated(
  base: BeadEventBase,
  data: {
    cell_id: string;
    bead_id: string;
    epic_bead_id?: string;
    mapping_type?: "auto" | "manual";
  },
): { type: "beads_mapping_created" } & BeadEventBase & typeof data {
  return {
    type: "beads_mapping_created" as const,
    ...base,
    ...data,
  };
}
