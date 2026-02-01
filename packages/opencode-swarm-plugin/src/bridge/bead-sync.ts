import type { BeadClient } from "./bead-client.js";
import type { MappingStore } from "./mapping-store.js";
import type { BeadIssue, TaskMapping } from "./bead-types.js";
import { BdCache } from "./bead-cache.js";

export interface BeadSyncOptions {
  client: BeadClient;
  cache: BdCache;
  mappingStore: MappingStore;
  projectKey: string;
  pollIntervalMs?: number;
}

export interface CortexTask {
  id: string;
  title: string;
  status: string;
  priority: number;
  issue_type: string;
  description?: string;
  parent_id?: string;
}

export interface SyncResult {
  success: boolean;
  cortexId: string;
  beadId: string;
  action: "created" | "updated" | "skipped" | "conflict";
  details?: string;
}

export interface SyncAllResult {
  total: number;
  synced: number;
  conflicts: number;
  errors: string[];
}

export interface ReadyTask {
  cortexId: string;
  beadId: string;
  title: string;
  priority: number;
  source: "beads" | "cortex";
}

export interface PollHandle {
  stop(): void;
  isRunning(): boolean;
}

export interface BeadSync {
  syncCortexToBeads(cortexTask: CortexTask): Promise<SyncResult>;
  syncBeadsToCortex(beadId: string): Promise<SyncResult>;
  syncAll(): Promise<SyncAllResult>;
  getReadyTasks(): Promise<ReadyTask[]>;
  pollReady(callback: (tasks: ReadyTask[]) => void): PollHandle;
  isBeadsAvailable(): Promise<boolean>;
  getTasksWithFallback(projectKey: string): Promise<ReadyTask[]>;
  resolveConflict(
    cortexId: string,
    resolution: "cortex" | "beads",
  ): Promise<SyncResult>;
}

const DEFAULT_POLL_INTERVAL_MS = 5000;
const BEADS_AVAILABILITY_TTL_MS = 60_000;
type BeadPriorityValue = 0 | 1 | 2 | 3;

function nowIso(): string {
  return new Date().toISOString();
}

function toBeadPriority(value: number | undefined): BeadPriorityValue | undefined {
  if (value === undefined) return undefined;
  if (value <= 0) return 0;
  if (value === 1) return 1;
  if (value === 2) return 2;
  return 3;
}

function cortexFallbackFromMapping(mapping: TaskMapping): CortexTask {
  return {
    id: mapping.cortex_id,
    title: mapping.bead_title ?? mapping.cortex_id,
    status: mapping.bead_status ?? "open",
    priority: mapping.bead_priority ?? 0,
    issue_type: "task",
  };
}

function toReadyTask(
  bead: BeadIssue,
  mapping: TaskMapping | null,
): ReadyTask {
  return {
    cortexId: mapping?.cortex_id ?? bead.id,
    beadId: bead.id,
    title: bead.title,
    priority: bead.priority,
    source: mapping?.source === "cortex" ? "cortex" : "beads",
  };
}

export function createBeadSync(options: BeadSyncOptions): BeadSync {
  const {
    client,
    cache,
    mappingStore,
    projectKey,
    pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
  } = options;

  let api: BeadSync;

  let availabilityCache:
    | { value: boolean; expiresAt: number }
    | null = null;

  async function syncCortexToBeads(cortexTask: CortexTask): Promise<SyncResult> {
    const mapping = await mappingStore.getByCortexId(cortexTask.id);

    try {
      if (!mapping) {
        const bead = await client.bdCreate({
          title: cortexTask.title,
          type: cortexTask.issue_type as BeadIssue["issue_type"],
          priority: toBeadPriority(cortexTask.priority),
          description: cortexTask.description,
          parent_id: cortexTask.parent_id,
        });

        await mappingStore.createMapping({
          cortex_id: cortexTask.id,
          bead_id: bead.id,
          project_key: projectKey,
          created_at: nowIso(),
          sync_status: "synced",
          bead_status: bead.status,
          bead_title: bead.title,
          bead_priority: bead.priority,
          last_bead_update: bead.updated_at,
          source: "cortex",
        });

        cache.invalidateByOperation("update", { id: bead.id });

        return {
          success: true,
          cortexId: cortexTask.id,
          beadId: bead.id,
          action: "created",
        };
      }

      const bead = await client.bdUpdate(mapping.bead_id, {
        title: cortexTask.title,
        status: cortexTask.status as BeadIssue["status"],
        priority: toBeadPriority(cortexTask.priority),
        description: cortexTask.description,
      });

      await mappingStore.updateSyncStatus(mapping.cortex_id, "synced", {
        bead_status: bead.status,
        bead_title: bead.title,
        bead_priority: bead.priority,
        last_bead_update: bead.updated_at,
      });

      cache.invalidateByOperation("update", { id: bead.id });

      return {
        success: true,
        cortexId: cortexTask.id,
        beadId: bead.id,
        action: "updated",
      };
    } catch (error) {
      return {
        success: false,
        cortexId: cortexTask.id,
        beadId: mapping?.bead_id ?? cortexTask.id,
        action: "skipped",
        details: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async function syncBeadsToCortex(beadId: string): Promise<SyncResult> {
    try {
      const bead = await client.bdShow(beadId);
      const mapping = await mappingStore.getByBeadId(bead.id);

      if (!mapping) {
        await mappingStore.createMapping({
          cortex_id: bead.id,
          bead_id: bead.id,
          project_key: projectKey,
          created_at: nowIso(),
          sync_status: "synced",
          bead_status: bead.status,
          bead_title: bead.title,
          bead_priority: bead.priority,
          last_bead_update: bead.updated_at,
          source: "beads",
        });

        cache.invalidateByOperation("update", { id: bead.id });

        return {
          success: true,
          cortexId: bead.id,
          beadId,
          action: "created",
        };
      }

      await mappingStore.updateSyncStatus(mapping.cortex_id, "synced", {
        bead_status: bead.status,
        bead_title: bead.title,
        bead_priority: bead.priority,
        last_bead_update: bead.updated_at,
      });

      cache.invalidateByOperation("update", { id: bead.id });

      return {
        success: true,
        cortexId: mapping.cortex_id,
        beadId,
        action: "updated",
      };
    } catch (error) {
      return {
        success: false,
        cortexId: beadId,
        beadId,
        action: "skipped",
        details: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async function syncAll(): Promise<SyncAllResult> {
    const pending = await mappingStore.listBySyncStatus("pending");
    const scoped = pending.filter((mapping) => mapping.project_key === projectKey);

    let synced = 0;
    let conflicts = 0;
    const errors: string[] = [];

    for (const mapping of scoped) {
      const result =
        mapping.source === "beads"
          ? await syncBeadsToCortex(mapping.bead_id)
          : await syncCortexToBeads(cortexFallbackFromMapping(mapping));

      if (result.success) {
        synced += 1;
        if (result.action === "conflict") {
          conflicts += 1;
        }
      } else if (result.details) {
        errors.push(result.details);
      }
    }

    return {
      total: scoped.length,
      synced,
      conflicts,
      errors,
    };
  }

  async function getReadyTasks(): Promise<ReadyTask[]> {
    const beads = await client.bdReady({ project_key: projectKey });
    const tasks: ReadyTask[] = [];

    for (const bead of beads) {
      const mapping = await mappingStore.getByBeadId(bead.id);
      tasks.push(toReadyTask(bead, mapping));
    }

    return tasks;
  }

  function pollReady(callback: (tasks: ReadyTask[]) => void): PollHandle {
    let running = true;
    const intervalId = setInterval(async () => {
      if (!running) return;
      try {
        const tasks = await getReadyTasks();
        callback(tasks);
      } catch {
        // swallow polling errors
      }
    }, pollIntervalMs);

    return {
      stop() {
        if (running) {
          clearInterval(intervalId);
          running = false;
        }
      },
      isRunning() {
        return running;
      },
    };
  }

  async function isBeadsAvailable(): Promise<boolean> {
    const now = Date.now();
    if (availabilityCache && now < availabilityCache.expiresAt) {
      return availabilityCache.value;
    }

    const installed = await client.isBdInstalled();
    availabilityCache = {
      value: installed,
      expiresAt: now + BEADS_AVAILABILITY_TTL_MS,
    };
    return installed;
  }

  async function getTasksWithFallback(
    fallbackProjectKey: string,
  ): Promise<ReadyTask[]> {
    const available = await api.isBeadsAvailable();
    if (available) {
      return api.getReadyTasks();
    }

    const mappings = await mappingStore.listByProject(fallbackProjectKey);
    return mappings
      .filter((mapping) => mapping.bead_status !== "closed")
      .map((mapping) => ({
        cortexId: mapping.cortex_id,
        beadId: mapping.bead_id,
        title: mapping.bead_title ?? mapping.cortex_id,
        priority: mapping.bead_priority ?? 0,
        source: "cortex",
      }));
  }

  async function resolveConflict(
    cortexId: string,
    resolution: "cortex" | "beads",
  ): Promise<SyncResult> {
    const mapping = await mappingStore.getByCortexId(cortexId);
    if (!mapping) {
      return {
        success: false,
        cortexId,
        beadId: cortexId,
        action: "skipped",
        details: "Mapping not found",
      };
    }

    try {
      if (resolution === "cortex") {
        const bead = await client.bdUpdate(mapping.bead_id, {
          title: mapping.bead_title ?? mapping.cortex_id,
          priority: toBeadPriority(mapping.bead_priority ?? 0),
          status: (mapping.bead_status ?? "open") as BeadIssue["status"],
        });

        await mappingStore.updateSyncStatus(mapping.cortex_id, "synced", {
          bead_status: bead.status,
          bead_title: bead.title,
          bead_priority: bead.priority,
          last_bead_update: bead.updated_at,
        });

        cache.invalidateByOperation("update", { id: bead.id });

        return {
          success: true,
          cortexId,
          beadId: bead.id,
          action: "updated",
        };
      }

      const bead = await client.bdShow(mapping.bead_id);
      await mappingStore.updateSyncStatus(mapping.cortex_id, "synced", {
        bead_status: bead.status,
        bead_title: bead.title,
        bead_priority: bead.priority,
        last_bead_update: bead.updated_at,
      });

      cache.invalidateByOperation("update", { id: bead.id });

      return {
        success: true,
        cortexId,
        beadId: bead.id,
        action: "updated",
      };
    } catch (error) {
      return {
        success: false,
        cortexId,
        beadId: mapping.bead_id,
        action: "skipped",
        details: error instanceof Error ? error.message : String(error),
      };
    }
  }

  api = {
    syncCortexToBeads,
    syncBeadsToCortex,
    syncAll,
    getReadyTasks,
    pollReady,
    isBeadsAvailable,
    getTasksWithFallback,
    resolveConflict,
  };

  return api;
}
