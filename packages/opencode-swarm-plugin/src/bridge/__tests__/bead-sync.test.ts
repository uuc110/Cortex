/**
 * Tests for bead-sync.ts — Cortex ↔ Beads sync engine.
 *
 * TDD RED phase: Tests define the contract BEFORE implementation.
 */
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  mock,
  spyOn,
  test,
} from "bun:test";

import type { BeadIssue, TaskMapping } from "../bead-types.js";

import { BdCache } from "../bead-cache.js";
import type { BeadClient } from "../bead-client.js";
import type { MappingStore } from "../mapping-store.js";
import {
  createBeadSync,
  type BeadSync,
  type CortexTask,
  type ReadyTask,
} from "../bead-sync.js";

const PROJECT_KEY = "cortex-test";

function nowIso(): string {
  return new Date().toISOString();
}

function makeBeadIssue(partial?: Partial<BeadIssue>): BeadIssue {
  return {
    id: partial?.id ?? "bead-1",
    title: partial?.title ?? "Bead Task",
    status: partial?.status ?? "open",
    priority: partial?.priority ?? 2,
    issue_type: partial?.issue_type ?? "task",
    created_at: partial?.created_at ?? nowIso(),
    updated_at: partial?.updated_at ?? nowIso(),
    description: partial?.description,
    parent_id: partial?.parent_id,
  };
}

function makeCortexTask(partial?: Partial<CortexTask>): CortexTask {
  return {
    id: partial?.id ?? "cortex-1",
    title: partial?.title ?? "Cortex Task",
    status: partial?.status ?? "open",
    priority: partial?.priority ?? 1,
    issue_type: partial?.issue_type ?? "task",
    description: partial?.description,
    parent_id: partial?.parent_id,
  };
}

function makeMapping(partial?: Partial<TaskMapping>): TaskMapping {
  return {
    cortex_id: partial?.cortex_id ?? "cortex-1",
    bead_id: partial?.bead_id ?? "bead-1",
    epic_bead_id: partial?.epic_bead_id,
    project_key: partial?.project_key ?? PROJECT_KEY,
    created_at: partial?.created_at ?? nowIso(),
    synced_at: partial?.synced_at ?? nowIso(),
    sync_status: partial?.sync_status ?? "synced",
    bead_status: partial?.bead_status,
    bead_title: partial?.bead_title,
    bead_priority: partial?.bead_priority,
    last_bead_update: partial?.last_bead_update,
    source: partial?.source ?? "cortex",
  };
}

function createTestMappingStore(initial?: TaskMapping[]): {
  store: MappingStore;
  mappings: Map<string, TaskMapping>;
} {
  const mappings = new Map<string, TaskMapping>();
  const beadIndex = new Map<string, string>();

  for (const mapping of initial ?? []) {
    mappings.set(mapping.cortex_id, mapping);
    beadIndex.set(mapping.bead_id, mapping.cortex_id);
  }

  const store: MappingStore = {
    createMapping: mock(async (mapping) => {
      const created: TaskMapping = {
        ...mapping,
        synced_at: nowIso(),
      };
      mappings.set(created.cortex_id, created);
      beadIndex.set(created.bead_id, created.cortex_id);
      return created;
    }),
    getByBeadId: mock(async (beadId) => {
      const cortexId = beadIndex.get(beadId);
      return cortexId ? mappings.get(cortexId) ?? null : null;
    }),
    getByCortexId: mock(async (cortexId) => mappings.get(cortexId) ?? null),
    updateSyncStatus: mock(async (cortexId, status, beadData) => {
      const existing = mappings.get(cortexId);
      if (!existing) {
        throw new Error(`TaskMapping not found: cortex_id=${cortexId}`);
      }
      const updated: TaskMapping = {
        ...existing,
        sync_status: status,
        synced_at: nowIso(),
        bead_status: beadData?.bead_status ?? existing.bead_status,
        bead_title: beadData?.bead_title ?? existing.bead_title,
        bead_priority: beadData?.bead_priority ?? existing.bead_priority,
        last_bead_update: beadData?.last_bead_update ?? existing.last_bead_update,
      };
      mappings.set(cortexId, updated);
      beadIndex.set(updated.bead_id, updated.cortex_id);
      return updated;
    }),
    listByEpic: mock(async (epicBeadId) =>
      Array.from(mappings.values()).filter(
        (mapping) => mapping.epic_bead_id === epicBeadId,
      ),
    ),
    listByProject: mock(async (projectKey) =>
      Array.from(mappings.values()).filter(
        (mapping) => mapping.project_key === projectKey,
      ),
    ),
    listBySyncStatus: mock(async (status) =>
      Array.from(mappings.values()).filter(
        (mapping) => mapping.sync_status === status,
      ),
    ),
    deleteMapping: mock(async (cortexId) => {
      const mapping = mappings.get(cortexId);
      if (mapping) {
        beadIndex.delete(mapping.bead_id);
      }
      mappings.delete(cortexId);
    }),
    createDepMapping: mock(async (dep) => ({ ...dep, synced_at: nowIso() })),
    getDepsByBead: mock(async () => []),
    getDepsByType: mock(async () => []),
    removeDepMapping: mock(async () => {}),
    createLabelMapping: mock(async (label) => label),
    getLabelsByBead: mock(async () => []),
    getBeadsByLabel: mock(async () => []),
    removeLabelMapping: mock(async () => {}),
    findOrphanedMappings: mock(async () => []),
    findStaleMappings: mock(async () => []),
    countByStatus: mock(async () => ({
      synced: 0,
      pending: 0,
      conflict: 0,
      orphaned: 0,
    })),
  };

  return { store, mappings };
}

function createMockClient(): BeadClient {
  const spawnBd = mock<BeadClient["spawnBd"]>(async () => ({
    stdout: "",
    stderr: "",
    exitCode: 0,
  }));

  const runBdJson = mock(async () => {
    throw new Error("runBdJson should be mocked per-test");
  }) as BeadClient["runBdJson"];

  const parseJsonOutput = mock(() => {
    throw new Error("parseJsonOutput should be mocked per-test");
  }) as BeadClient["parseJsonOutput"];

  const isBdInstalled = mock<BeadClient["isBdInstalled"]>(async () => true);
  const bdVersion = mock<BeadClient["bdVersion"]>(async () => "1.0.0");
  const bdInit = mock<BeadClient["bdInit"]>(async () => {});

  const bdCreate = mock<BeadClient["bdCreate"]>(async () =>
    makeBeadIssue(),
  );
  const bdShow = mock<BeadClient["bdShow"]>(async () => makeBeadIssue());
  const bdList = mock<BeadClient["bdList"]>(async () => []);
  const bdUpdate = mock<BeadClient["bdUpdate"]>(async () =>
    makeBeadIssue(),
  );
  const bdClose = mock<BeadClient["bdClose"]>(async () => makeBeadIssue());

  const bdReady = mock<BeadClient["bdReady"]>(async () => []);

  const bdDepAdd = mock<BeadClient["bdDepAdd"]>(async () => {});
  const bdDepRemove = mock<BeadClient["bdDepRemove"]>(async () => {});
  const bdDepList = mock<BeadClient["bdDepList"]>(async () => []);
  const bdDepTree = mock<BeadClient["bdDepTree"]>(async () => []);

  const bdSearch = mock<BeadClient["bdSearch"]>(async () => []);

  const bdLabelAdd = mock<BeadClient["bdLabelAdd"]>(async () => {});
  const bdLabelRemove = mock<BeadClient["bdLabelRemove"]>(async () => {});
  const bdLabelList = mock<BeadClient["bdLabelList"]>(async () => []);

  const bdCommentAdd = mock<BeadClient["bdCommentAdd"]>(async () => ({
    id: "comment-1",
    bead_id: "bead-1",
    author: "tester",
    body: "comment",
    created_at: nowIso(),
  }));
  const bdCommentList = mock<BeadClient["bdCommentList"]>(async () => []);

  const bdMoleculeCreate = mock<BeadClient["bdMoleculeCreate"]>(async () => ({
    id: "molecule-1",
    name: "molecule",
    description: "",
    member_ids: [],
    created_at: nowIso(),
  }));
  const bdMoleculeList = mock<BeadClient["bdMoleculeList"]>(async () => []);
  const bdMoleculeShow = mock<BeadClient["bdMoleculeShow"]>(async () => ({
    id: "molecule-1",
    name: "molecule",
    description: "",
    member_ids: [],
    created_at: nowIso(),
  }));
  const bdMoleculeAddMember = mock<BeadClient["bdMoleculeAddMember"]>(
    async () => {},
  );

  const bdDaemonStart = mock<BeadClient["bdDaemonStart"]>(async () => ({
    pid: 123,
  }));
  const bdDaemonStop = mock<BeadClient["bdDaemonStop"]>(async () => {});
  const bdDaemonStatus = mock<BeadClient["bdDaemonStatus"]>(async () => ({
    running: true,
    last_check: nowIso(),
  }));

  const bdStats = mock<BeadClient["bdStats"]>(async () => ({
    total: 0,
    open: 0,
    closed: 0,
    in_progress: 0,
    blocked: 0,
    by_type: {
      bug: 0,
      feature: 0,
      task: 0,
      epic: 0,
      chore: 0,
    },
    by_priority: { 0: 0, 1: 0, 2: 0, 3: 0 },
  }));

  return {
    spawnBd,
    runBdJson,
    parseJsonOutput,
    isBdInstalled,
    bdVersion,
    bdInit,
    bdCreate,
    bdShow,
    bdList,
    bdUpdate,
    bdClose,
    bdReady,
    bdDepAdd,
    bdDepRemove,
    bdDepList,
    bdDepTree,
    bdSearch,
    bdLabelAdd,
    bdLabelRemove,
    bdLabelList,
    bdCommentAdd,
    bdCommentList,
    bdMoleculeCreate,
    bdMoleculeList,
    bdMoleculeShow,
    bdMoleculeAddMember,
    bdDaemonStart,
    bdDaemonStop,
    bdDaemonStatus,
    bdStats,
  };
}

function createSyncFixture(initial?: TaskMapping[]): {
  sync: BeadSync;
  client: BeadClient;
  cache: BdCache;
  store: MappingStore;
  mappings: Map<string, TaskMapping>;
} {
  const client = createMockClient();
  const cache = new BdCache({ enabled: false });
  const { store, mappings } = createTestMappingStore(initial);
  const sync = createBeadSync({
    client,
    cache,
    mappingStore: store,
    projectKey: PROJECT_KEY,
    pollIntervalMs: 10,
  });
  return { sync, client, cache, store, mappings };
}

describe("createBeadSync", () => {
  test("returns an object with expected methods", () => {
    const { sync } = createSyncFixture();
    expect(typeof sync.syncCortexToBeads).toBe("function");
    expect(typeof sync.syncBeadsToCortex).toBe("function");
    expect(typeof sync.syncAll).toBe("function");
    expect(typeof sync.getReadyTasks).toBe("function");
    expect(typeof sync.pollReady).toBe("function");
    expect(typeof sync.isBeadsAvailable).toBe("function");
    expect(typeof sync.getTasksWithFallback).toBe("function");
    expect(typeof sync.resolveConflict).toBe("function");
  });
});

describe("syncCortexToBeads", () => {
  test("creates bead + mapping when none exists", async () => {
    const { sync, client, store, cache } = createSyncFixture();
    const bead = makeBeadIssue({ id: "bead-new" });
    client.bdCreate = mock(async () => bead);
    const cacheSpy = spyOn(cache, "invalidateByOperation");

    const cortexTask = makeCortexTask({ id: "cortex-new" });
    const result = await sync.syncCortexToBeads(cortexTask);

    expect(client.bdCreate).toHaveBeenCalledWith({
      title: cortexTask.title,
      type: cortexTask.issue_type,
      priority: cortexTask.priority,
      description: cortexTask.description,
      parent_id: cortexTask.parent_id,
    });
    expect(store.createMapping).toHaveBeenCalled();
    expect(result).toEqual({
      success: true,
      cortexId: cortexTask.id,
      beadId: bead.id,
      action: "created",
    });
    expect(cacheSpy).toHaveBeenCalledWith("update", { id: bead.id });
  });

  test("persists cortex source on new mapping", async () => {
    const { sync, store } = createSyncFixture();
    await sync.syncCortexToBeads(makeCortexTask());
    const call = (store.createMapping as ReturnType<typeof mock>).mock.calls[0];
    expect(call?.[0].source).toBe("cortex");
  });

  test("updates bead when mapping exists", async () => {
    const mapping = makeMapping({ cortex_id: "cortex-1", bead_id: "bead-1" });
    const { sync, client, store, cache } = createSyncFixture([mapping]);
    const cacheSpy = spyOn(cache, "invalidateByOperation");

    const bead = makeBeadIssue({
      id: "bead-1",
      title: "Updated",
      status: "in_progress",
      priority: 3,
      updated_at: nowIso(),
    });
    client.bdUpdate = mock(async () => bead);

    const cortexTask = makeCortexTask({
      id: "cortex-1",
      title: "Updated",
      status: "in_progress",
      priority: 3,
    });
    const result = await sync.syncCortexToBeads(cortexTask);

    expect(client.bdUpdate).toHaveBeenCalledWith(mapping.bead_id, {
      title: cortexTask.title,
      status: cortexTask.status,
      priority: cortexTask.priority,
      description: cortexTask.description,
    });
    expect(store.updateSyncStatus).toHaveBeenCalledWith("cortex-1", "synced", {
      bead_status: bead.status,
      bead_title: bead.title,
      bead_priority: bead.priority,
      last_bead_update: bead.updated_at,
    });
    expect(result.action).toBe("updated");
    expect(cacheSpy).toHaveBeenCalledWith("update", { id: bead.id });
  });

  test("returns failure result on bead update error", async () => {
    const mapping = makeMapping({ cortex_id: "cortex-1", bead_id: "bead-1" });
    const { sync, client } = createSyncFixture([mapping]);

    client.bdUpdate = mock(async () => {
      throw new Error("bd failed");
    });

    const result = await sync.syncCortexToBeads(makeCortexTask());
    expect(result.success).toBe(false);
    expect(result.action).toBe("skipped");
    expect(result.details).toContain("bd failed");
  });
});

describe("syncBeadsToCortex", () => {
  test("creates mapping when bead not mapped", async () => {
    const { sync, client, store } = createSyncFixture();
    const bead = makeBeadIssue({ id: "bead-new", title: "Bead New" });
    client.bdShow = mock(async () => bead);

    const result = await sync.syncBeadsToCortex(bead.id);

    expect(client.bdShow).toHaveBeenCalledWith(bead.id);
    expect(store.createMapping).toHaveBeenCalled();
    expect(result.action).toBe("created");
    expect(result.success).toBe(true);
  });

  test("uses beads source for new mapping", async () => {
    const { sync, store } = createSyncFixture();
    const bead = makeBeadIssue({ id: "bead-new" });

    await sync.syncBeadsToCortex(bead.id);
    const call = (store.createMapping as ReturnType<typeof mock>).mock.calls[0];
    expect(call?.[0].source).toBe("beads");
  });

  test("updates existing mapping with bead data", async () => {
    const mapping = makeMapping({ cortex_id: "cortex-1", bead_id: "bead-1" });
    const { sync, client, store, cache } = createSyncFixture([mapping]);
    const cacheSpy = spyOn(cache, "invalidateByOperation");
    const bead = makeBeadIssue({
      id: "bead-1",
      title: "Bead Updated",
      status: "blocked",
      priority: 0,
      updated_at: nowIso(),
    });
    client.bdShow = mock(async () => bead);

    const result = await sync.syncBeadsToCortex(bead.id);

    expect(store.updateSyncStatus).toHaveBeenCalledWith("cortex-1", "synced", {
      bead_status: bead.status,
      bead_title: bead.title,
      bead_priority: bead.priority,
      last_bead_update: bead.updated_at,
    });
    expect(result.action).toBe("updated");
    expect(cacheSpy).toHaveBeenCalledWith("update", { id: bead.id });
  });

  test("returns failure when bd show throws", async () => {
    const { sync, client } = createSyncFixture();
    client.bdShow = mock(async () => {
      throw new Error("show failed");
    });

    const result = await sync.syncBeadsToCortex("bead-err");
    expect(result.success).toBe(false);
    expect(result.action).toBe("skipped");
    expect(result.details).toContain("show failed");
  });
});

describe("syncAll", () => {
  test("returns empty aggregate for no pending", async () => {
    const { sync } = createSyncFixture();
    const result = await sync.syncAll();
    expect(result.total).toBe(0);
    expect(result.synced).toBe(0);
    expect(result.conflicts).toBe(0);
    expect(result.errors).toEqual([]);
  });

  test("syncs cortex-sourced pending mappings", async () => {
    const pending = makeMapping({
      cortex_id: "cortex-1",
      bead_id: "bead-1",
      sync_status: "pending",
      source: "cortex",
    });
    const { sync, client } = createSyncFixture([pending]);

    client.bdUpdate = mock(async () => makeBeadIssue({ id: "bead-1" }));

    const result = await sync.syncAll();
    expect(result.synced).toBe(1);
    expect(client.bdUpdate).toHaveBeenCalled();
  });

  test("syncs beads-sourced pending mappings", async () => {
    const pending = makeMapping({
      cortex_id: "cortex-2",
      bead_id: "bead-2",
      sync_status: "pending",
      source: "beads",
    });
    const { sync, client } = createSyncFixture([pending]);

    client.bdShow = mock(async () => makeBeadIssue({ id: "bead-2" }));

    const result = await sync.syncAll();
    expect(result.synced).toBe(1);
    expect(client.bdShow).toHaveBeenCalledWith("bead-2");
  });

  test("counts conflicts and errors", async () => {
    const pendingA = makeMapping({
      cortex_id: "cortex-1",
      bead_id: "bead-1",
      sync_status: "pending",
      source: "cortex",
    });
    const pendingB = makeMapping({
      cortex_id: "cortex-2",
      bead_id: "bead-2",
      sync_status: "pending",
      source: "beads",
    });
    const { sync, client } = createSyncFixture([pendingA, pendingB]);

    client.bdUpdate = mock(async () => {
      throw new Error("update failed");
    });
    client.bdShow = mock(async () => makeBeadIssue({ id: "bead-2" }));

    const result = await sync.syncAll();
    expect(result.total).toBe(2);
    expect(result.errors.length).toBe(1);
  });
});

describe("getReadyTasks", () => {
  test("returns empty when bdReady empty", async () => {
    const { sync } = createSyncFixture();
    const result = await sync.getReadyTasks();
    expect(result).toEqual([]);
  });

  test("maps bead to cortex id when mapping exists", async () => {
    const mapping = makeMapping({
      cortex_id: "cortex-1",
      bead_id: "bead-1",
    });
    const { sync, client } = createSyncFixture([mapping]);
    client.bdReady = mock(async () => [
      makeBeadIssue({ id: "bead-1", title: "Ready" }),
    ]);

    const result = await sync.getReadyTasks();
    expect(result[0]).toMatchObject({
      cortexId: "cortex-1",
      beadId: "bead-1",
      title: "Ready",
    });
  });

  test("falls back to bead id when mapping missing", async () => {
    const { sync, client } = createSyncFixture();
    client.bdReady = mock(async () => [
      makeBeadIssue({ id: "bead-missing", title: "Missing" }),
    ]);

    const result = await sync.getReadyTasks();
    expect(result[0].cortexId).toBe("bead-missing");
  });

  test("preserves priority and source", async () => {
    const { sync, client } = createSyncFixture();
    client.bdReady = mock(async () => [
      makeBeadIssue({ id: "bead-1", title: "Ready", priority: 0 }),
    ]);

    const result = await sync.getReadyTasks();
    expect(result[0].priority).toBe(0);
    expect(result[0].source).toBe("beads");
  });
});

describe("pollReady", () => {
  test("starts and stops polling", async () => {
    const { sync } = createSyncFixture();
    const callback = mock((tasks: ReadyTask[]) => tasks);

    const handle = sync.pollReady(callback);
    expect(handle.isRunning()).toBe(true);

    await Bun.sleep(25);
    handle.stop();
    expect(handle.isRunning()).toBe(false);
  });

  test("invokes callback with ready tasks", async () => {
    const { sync, client } = createSyncFixture();
    client.bdReady = mock(async () => [
      makeBeadIssue({ id: "bead-1", title: "Ready" }),
    ]);
    const callback = mock((tasks: ReadyTask[]) => tasks);

    const handle = sync.pollReady(callback);
    await Bun.sleep(25);
    handle.stop();

    expect(callback).toHaveBeenCalled();
    const firstCall = (callback as ReturnType<typeof mock>).mock.calls[0];
    expect(firstCall?.[0][0]).toMatchObject({ title: "Ready" });
  });

  test("stop prevents further callbacks", async () => {
    const { sync } = createSyncFixture();
    const callback = mock(() => {});

    const handle = sync.pollReady(callback);
    await Bun.sleep(20);
    handle.stop();
    const callsAfterStop = (callback as ReturnType<typeof mock>).mock.calls
      .length;
    await Bun.sleep(20);
    expect((callback as ReturnType<typeof mock>).mock.calls.length).toBe(
      callsAfterStop,
    );
  });
});

describe("isBeadsAvailable", () => {
  afterEach(() => {
    mock.restore();
  });

  test("returns true when bd installed", async () => {
    const { sync, client } = createSyncFixture();
    client.isBdInstalled = mock(async () => true);
    const result = await sync.isBeadsAvailable();
    expect(result).toBe(true);
  });

  test("returns false when bd not installed", async () => {
    const { sync, client } = createSyncFixture();
    client.isBdInstalled = mock(async () => false);
    const result = await sync.isBeadsAvailable();
    expect(result).toBe(false);
  });

  test("caches availability for 60s", async () => {
    const { sync, client } = createSyncFixture();
    client.isBdInstalled = mock(async () => true);

    const nowSpy = spyOn(Date, "now");
    nowSpy.mockReturnValue(1000);

    await sync.isBeadsAvailable();
    await sync.isBeadsAvailable();

    expect(client.isBdInstalled).toHaveBeenCalledTimes(1);
  });

  test("refreshes cache after TTL", async () => {
    const { sync, client } = createSyncFixture();
    client.isBdInstalled = mock(async () => true);

    const nowSpy = spyOn(Date, "now");
    nowSpy.mockReturnValue(1000);
    await sync.isBeadsAvailable();

    nowSpy.mockReturnValue(61_500);
    await sync.isBeadsAvailable();

    expect(client.isBdInstalled).toHaveBeenCalledTimes(2);
  });
});

describe("getTasksWithFallback", () => {
  test("uses beads when available", async () => {
    const { sync } = createSyncFixture();
    const readySpy = spyOn(sync, "getReadyTasks");
    const availabilitySpy = spyOn(sync, "isBeadsAvailable");

    availabilitySpy.mockResolvedValue(true);
    await sync.getTasksWithFallback(PROJECT_KEY);

    expect(readySpy).toHaveBeenCalled();
  });

  test("falls back to mapping store when beads unavailable", async () => {
    const mapping = makeMapping({
      cortex_id: "cortex-1",
      bead_id: "bead-1",
      bead_title: "Fallback",
      bead_priority: 2,
      bead_status: "open",
      sync_status: "synced",
    });
    const { sync, store } = createSyncFixture([mapping]);
    const availabilitySpy = spyOn(sync, "isBeadsAvailable");
    availabilitySpy.mockResolvedValue(false);

    const result = await sync.getTasksWithFallback(PROJECT_KEY);
    expect(store.listByProject).toHaveBeenCalledWith(PROJECT_KEY);
    expect(result[0]).toMatchObject({
      title: "Fallback",
      priority: 2,
      source: "cortex",
    });
  });

  test("filters closed mappings in fallback", async () => {
    const open = makeMapping({
      cortex_id: "cortex-1",
      bead_id: "bead-1",
      bead_title: "Open",
      bead_status: "open",
    });
    const closed = makeMapping({
      cortex_id: "cortex-2",
      bead_id: "bead-2",
      bead_title: "Closed",
      bead_status: "closed",
    });
    const { sync } = createSyncFixture([open, closed]);
    const availabilitySpy = spyOn(sync, "isBeadsAvailable");
    availabilitySpy.mockResolvedValue(false);

    const result = await sync.getTasksWithFallback(PROJECT_KEY);
    expect(result.length).toBe(1);
    expect(result[0].title).toBe("Open");
  });
});

describe("resolveConflict", () => {
  test("beads wins by default", async () => {
    const mapping = makeMapping({
      cortex_id: "cortex-1",
      bead_id: "bead-1",
      sync_status: "conflict",
    });
    const { sync, client, store } = createSyncFixture([mapping]);

    const bead = makeBeadIssue({
      id: "bead-1",
      title: "Beads Title",
      status: "open",
      priority: 1,
      updated_at: nowIso(),
    });
    client.bdShow = mock(async () => bead);

    const result = await sync.resolveConflict("cortex-1", "beads");
    expect(client.bdShow).toHaveBeenCalledWith("bead-1");
    expect(store.updateSyncStatus).toHaveBeenCalledWith("cortex-1", "synced", {
      bead_status: bead.status,
      bead_title: bead.title,
      bead_priority: bead.priority,
      last_bead_update: bead.updated_at,
    });
    expect(result.action).toBe("updated");
  });

  test("cortex wins pushes update", async () => {
    const mapping = makeMapping({
      cortex_id: "cortex-1",
      bead_id: "bead-1",
      sync_status: "conflict",
      bead_title: "Cortex Title",
      bead_priority: 3,
      bead_status: "in_progress",
    });
    const { sync, client, store } = createSyncFixture([mapping]);
    const bead = makeBeadIssue({ id: "bead-1" });
    client.bdUpdate = mock(async () => bead);

    const result = await sync.resolveConflict("cortex-1", "cortex");
    expect(client.bdUpdate).toHaveBeenCalledWith("bead-1", {
      title: "Cortex Title",
      priority: 3,
      status: "in_progress",
    });
    expect(store.updateSyncStatus).toHaveBeenCalled();
    expect(result.action).toBe("updated");
  });

  test("returns error when mapping missing", async () => {
    const { sync } = createSyncFixture();
    const result = await sync.resolveConflict("cortex-missing", "beads");
    expect(result.success).toBe(false);
    expect(result.action).toBe("skipped");
  });
});

describe("syncAll error aggregation", () => {
  test("handles mixed success and failure", async () => {
    const pendingA = makeMapping({
      cortex_id: "cortex-1",
      bead_id: "bead-1",
      sync_status: "pending",
      source: "cortex",
    });
    const pendingB = makeMapping({
      cortex_id: "cortex-2",
      bead_id: "bead-2",
      sync_status: "pending",
      source: "beads",
    });
    const { sync, client } = createSyncFixture([pendingA, pendingB]);

    client.bdUpdate = mock(async () => makeBeadIssue({ id: "bead-1" }));
    client.bdShow = mock(async () => {
      throw new Error("show failed");
    });

    const result = await sync.syncAll();
    expect(result.synced).toBe(1);
    expect(result.errors.length).toBe(1);
  });
});

describe("getReadyTasks mapping details", () => {
  test("uses mapping cortex id when source is cortex", async () => {
    const mapping = makeMapping({
      cortex_id: "cortex-99",
      bead_id: "bead-99",
      source: "cortex",
    });
    const { sync, client } = createSyncFixture([mapping]);
    client.bdReady = mock(async () => [
      makeBeadIssue({ id: "bead-99", title: "Ready" }),
    ]);

    const result = await sync.getReadyTasks();
    expect(result[0].cortexId).toBe("cortex-99");
  });
});

describe("syncCortexToBeads cache invalidation", () => {
  test("invalidates cache after create", async () => {
    const { sync, cache, client } = createSyncFixture();
    const cacheSpy = spyOn(cache, "invalidateByOperation");
    client.bdCreate = mock(async () => makeBeadIssue({ id: "bead-10" }));

    await sync.syncCortexToBeads(makeCortexTask({ id: "cortex-10" }));
    expect(cacheSpy).toHaveBeenCalledWith("update", { id: "bead-10" });
  });
});

describe("syncBeadsToCortex cache invalidation", () => {
  test("invalidates cache after update", async () => {
    const mapping = makeMapping({
      cortex_id: "cortex-1",
      bead_id: "bead-1",
    });
    const { sync, cache, client } = createSyncFixture([mapping]);
    const cacheSpy = spyOn(cache, "invalidateByOperation");
    client.bdShow = mock(async () => makeBeadIssue({ id: "bead-1" }));

    await sync.syncBeadsToCortex("bead-1");
    expect(cacheSpy).toHaveBeenCalledWith("update", { id: "bead-1" });
  });
});

describe("getTasksWithFallback mapping defaults", () => {
  test("uses cortex id as title when bead_title missing", async () => {
    const mapping = makeMapping({
      cortex_id: "cortex-1",
      bead_id: "bead-1",
      bead_status: "open",
      bead_title: undefined,
    });
    const { sync } = createSyncFixture([mapping]);
    const availabilitySpy = spyOn(sync, "isBeadsAvailable");
    availabilitySpy.mockResolvedValue(false);

    const result = await sync.getTasksWithFallback(PROJECT_KEY);
    expect(result[0].title).toBe("cortex-1");
  });
});

describe("syncAll totals", () => {
  test("counts total pending mappings", async () => {
    const pendingA = makeMapping({
      cortex_id: "cortex-1",
      bead_id: "bead-1",
      sync_status: "pending",
      source: "cortex",
    });
    const pendingB = makeMapping({
      cortex_id: "cortex-2",
      bead_id: "bead-2",
      sync_status: "pending",
      source: "beads",
    });
    const { sync, client } = createSyncFixture([pendingA, pendingB]);
    client.bdUpdate = mock(async () => makeBeadIssue({ id: "bead-1" }));
    client.bdShow = mock(async () => makeBeadIssue({ id: "bead-2" }));

    const result = await sync.syncAll();
    expect(result.total).toBe(2);
  });
});

describe("syncBeadsToCortex mapping data", () => {
  test("creates mapping with bead data fields", async () => {
    const { sync, client, store } = createSyncFixture();
    const bead = makeBeadIssue({
      id: "bead-100",
      title: "New Bead",
      status: "open",
      priority: 2,
      updated_at: nowIso(),
    });
    client.bdShow = mock(async () => bead);

    await sync.syncBeadsToCortex(bead.id);
    const call = (store.createMapping as ReturnType<typeof mock>).mock.calls[0];
    expect(call?.[0].bead_title).toBe("New Bead");
    expect(call?.[0].bead_priority).toBe(2);
  });
});

describe("syncCortexToBeads mapping update data", () => {
  test("updates mapping with bead fields", async () => {
    const mapping = makeMapping({ cortex_id: "cortex-1", bead_id: "bead-1" });
    const { sync, client, store } = createSyncFixture([mapping]);
    const bead = makeBeadIssue({
      id: "bead-1",
      title: "Updated",
      status: "blocked",
      priority: 1,
      updated_at: nowIso(),
    });
    client.bdUpdate = mock(async () => bead);

    await sync.syncCortexToBeads(makeCortexTask({ id: "cortex-1" }));
    const call = (store.updateSyncStatus as ReturnType<typeof mock>).mock.calls[0];
    expect(call?.[2]).toMatchObject({
      bead_title: "Updated",
      bead_status: "blocked",
      bead_priority: 1,
    });
  });
});

describe("getReadyTasks mapping source", () => {
  test("uses beads source for ready items", async () => {
    const { sync, client } = createSyncFixture();
    client.bdReady = mock(async () => [
      makeBeadIssue({ id: "bead-1", title: "Ready" }),
    ]);
    const result = await sync.getReadyTasks();
    expect(result[0].source).toBe("beads");
  });
});

describe("getTasksWithFallback results", () => {
  test("returns empty when no mappings", async () => {
    const { sync } = createSyncFixture();
    const availabilitySpy = spyOn(sync, "isBeadsAvailable");
    availabilitySpy.mockResolvedValue(false);

    const result = await sync.getTasksWithFallback(PROJECT_KEY);
    expect(result).toEqual([]);
  });
});

describe("resolveConflict invalidation", () => {
  test("invalidates cache after beads resolution", async () => {
    const mapping = makeMapping({
      cortex_id: "cortex-1",
      bead_id: "bead-1",
      sync_status: "conflict",
    });
    const { sync, client, cache } = createSyncFixture([mapping]);
    const cacheSpy = spyOn(cache, "invalidateByOperation");
    client.bdShow = mock(async () => makeBeadIssue({ id: "bead-1" }));

    await sync.resolveConflict("cortex-1", "beads");
    expect(cacheSpy).toHaveBeenCalledWith("update", { id: "bead-1" });
  });
});

describe("syncAll conflict counting", () => {
  test("increments conflicts when action is conflict", async () => {
    const pending = makeMapping({
      cortex_id: "cortex-1",
      bead_id: "bead-1",
      sync_status: "pending",
      source: "cortex",
    });
    const { sync, client } = createSyncFixture([pending]);
    client.bdUpdate = mock(async () => {
      throw new Error("conflict");
    });

    const result = await sync.syncAll();
    expect(result.errors.length).toBe(1);
  });
});

describe("isBeadsAvailable caching", () => {
  test("caches false results too", async () => {
    const { sync, client } = createSyncFixture();
    client.isBdInstalled = mock(async () => false);
    const nowSpy = spyOn(Date, "now");
    nowSpy.mockReturnValue(1000);

    await sync.isBeadsAvailable();
    await sync.isBeadsAvailable();

    expect(client.isBdInstalled).toHaveBeenCalledTimes(1);
  });
});

describe("pollReady handle", () => {
  test("handle reflects running state", () => {
    const { sync } = createSyncFixture();
    const callback = mock(() => {});
    const handle = sync.pollReady(callback);
    expect(handle.isRunning()).toBe(true);
    handle.stop();
    expect(handle.isRunning()).toBe(false);
  });
});

describe("syncAll status behavior", () => {
  test("marks conflicts when mapping already conflict", async () => {
    const conflictMapping = makeMapping({
      cortex_id: "cortex-1",
      bead_id: "bead-1",
      sync_status: "conflict",
      source: "cortex",
    });
    const { sync } = createSyncFixture([conflictMapping]);
    const result = await sync.syncAll();
    expect(result.total).toBe(0);
  });
});

describe("getReadyTasks ordering", () => {
  test("returns tasks in bd order", async () => {
    const { sync, client } = createSyncFixture();
    client.bdReady = mock(async () => [
      makeBeadIssue({ id: "bead-1", title: "First" }),
      makeBeadIssue({ id: "bead-2", title: "Second" }),
    ]);

    const result = await sync.getReadyTasks();
    expect(result.map((task) => task.title)).toEqual(["First", "Second"]);
  });
});

describe("syncCortexToBeads status handling", () => {
  test("passes status when provided", async () => {
    const mapping = makeMapping({ cortex_id: "cortex-1", bead_id: "bead-1" });
    const { sync, client } = createSyncFixture([mapping]);
    client.bdUpdate = mock(async () => makeBeadIssue({ id: "bead-1" }));
    await sync.syncCortexToBeads(
      makeCortexTask({ id: "cortex-1", status: "blocked" }),
    );
    expect(client.bdUpdate).toHaveBeenCalledWith("bead-1", {
      title: "Cortex Task",
      status: "blocked",
      priority: 1,
      description: undefined,
    });
  });
});

describe("getTasksWithFallback priorities", () => {
  test("defaults priority to 0 when missing", async () => {
    const mapping = makeMapping({
      cortex_id: "cortex-1",
      bead_id: "bead-1",
      bead_status: "open",
      bead_priority: undefined,
    });
    const { sync } = createSyncFixture([mapping]);
    const availabilitySpy = spyOn(sync, "isBeadsAvailable");
    availabilitySpy.mockResolvedValue(false);

    const result = await sync.getTasksWithFallback(PROJECT_KEY);
    expect(result[0].priority).toBe(0);
  });
});

describe("resolveConflict cortex missing data", () => {
  test("returns error when cortex resolution has no mapping", async () => {
    const { sync } = createSyncFixture();
    const result = await sync.resolveConflict("missing", "cortex");
    expect(result.success).toBe(false);
  });
});

describe("syncAll with mixed statuses", () => {
  test("ignores non-pending mappings", async () => {
    const synced = makeMapping({
      cortex_id: "cortex-1",
      bead_id: "bead-1",
      sync_status: "synced",
    });
    const { sync } = createSyncFixture([synced]);
    const result = await sync.syncAll();
    expect(result.total).toBe(0);
  });
});

describe("getTasksWithFallback source", () => {
  test("marks fallback tasks as cortex source", async () => {
    const mapping = makeMapping({
      cortex_id: "cortex-1",
      bead_id: "bead-1",
      bead_status: "open",
    });
    const { sync } = createSyncFixture([mapping]);
    const availabilitySpy = spyOn(sync, "isBeadsAvailable");
    availabilitySpy.mockResolvedValue(false);

    const result = await sync.getTasksWithFallback(PROJECT_KEY);
    expect(result[0].source).toBe("cortex");
  });
});

describe("syncBeadsToCortex action results", () => {
  test("returns updated action for existing mapping", async () => {
    const mapping = makeMapping({ cortex_id: "cortex-1", bead_id: "bead-1" });
    const { sync } = createSyncFixture([mapping]);
    const result = await sync.syncBeadsToCortex("bead-1");
    expect(result.action).toBe("updated");
  });
});

describe("syncCortexToBeads action results", () => {
  test("returns created action for new mapping", async () => {
    const { sync } = createSyncFixture();
    const result = await sync.syncCortexToBeads(makeCortexTask());
    expect(result.action).toBe("created");
  });
});

describe("getReadyTasks project filtering", () => {
  test("returns ready tasks without project filtering", async () => {
    const { sync, client } = createSyncFixture();
    client.bdReady = mock(async () => [
      makeBeadIssue({ id: "bead-1", title: "Ready" }),
    ]);
    const result = await sync.getReadyTasks();
    expect(result.length).toBe(1);
  });
});

describe("syncAll errors array", () => {
  test("captures error messages", async () => {
    const pending = makeMapping({
      cortex_id: "cortex-1",
      bead_id: "bead-1",
      sync_status: "pending",
      source: "beads",
    });
    const { sync, client } = createSyncFixture([pending]);
    client.bdShow = mock(async () => {
      throw new Error("boom");
    });

    const result = await sync.syncAll();
    expect(result.errors[0]).toContain("boom");
  });
});

describe("resolveConflict default behavior", () => {
  test("defaults to beads resolution", async () => {
    const mapping = makeMapping({
      cortex_id: "cortex-1",
      bead_id: "bead-1",
      sync_status: "conflict",
    });
    const { sync, client } = createSyncFixture([mapping]);
    client.bdShow = mock(async () => makeBeadIssue({ id: "bead-1" }));

    const result = await sync.resolveConflict("cortex-1", "beads");
    expect(result.success).toBe(true);
  });
});

describe("syncBeadsToCortex id handling", () => {
  test("returns beadId in result", async () => {
    const { sync } = createSyncFixture();
    const result = await sync.syncBeadsToCortex("bead-777");
    expect(result.beadId).toBe("bead-777");
  });
});

describe("syncCortexToBeads id handling", () => {
  test("returns cortexId in result", async () => {
    const { sync } = createSyncFixture();
    const result = await sync.syncCortexToBeads(
      makeCortexTask({ id: "cortex-777" }),
    );
    expect(result.cortexId).toBe("cortex-777");
  });
});

describe("syncAll returns conflicts count", () => {
  test("conflicts stays zero on successful sync", async () => {
    const pending = makeMapping({
      cortex_id: "cortex-1",
      bead_id: "bead-1",
      sync_status: "pending",
      source: "cortex",
    });
    const { sync, client } = createSyncFixture([pending]);
    client.bdUpdate = mock(async () => makeBeadIssue({ id: "bead-1" }));
    const result = await sync.syncAll();
    expect(result.conflicts).toBe(0);
  });
});
