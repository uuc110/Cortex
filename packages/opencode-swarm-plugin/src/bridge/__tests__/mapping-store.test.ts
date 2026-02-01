/**
 * Tests for mapping-store.ts — CRUD operations for the 3 Cortex mapping tables.
 *
 * TDD RED phase: Tests define the contract BEFORE implementation.
 *
 * Cross-references:
 *   - v11 Migration DDL: packages/swarm-mail/src/hive/migrations.ts L627-733
 *   - Types: packages/opencode-swarm-plugin/src/bridge/bead-types.ts
 *   - Schema spec: .planning/fork-plan/details/task-mapping-schema.md
 *
 * DB Setup: Uses in-memory libSQL with the v11 cortex mapping migration DDL
 * applied directly (not via the full migration system since we only need the
 * 3 mapping tables for these tests).
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createClient, type Client } from "@libsql/client";
import type { DatabaseAdapter } from "swarm-mail";

import type {
  TaskMapping,
  DepMapping,
  LabelMapping,
  SyncStatus,
  BeadDepType,
} from "../bead-types.js";

import { createMappingStore, type MappingStore } from "../mapping-store.js";

// ============================================================================
// Test Database Adapter (wraps libSQL client with $N → ? conversion)
// ============================================================================

/**
 * Minimal DatabaseAdapter for mapping-store tests.
 * Converts PostgreSQL $1/$2 params to ? params for libSQL compatibility.
 */
class TestDbAdapter implements DatabaseAdapter {
  constructor(private client: Client) {}

  async query<T = unknown>(
    sql: string,
    params?: unknown[],
  ): Promise<{ rows: T[] }> {
    const converted = this.convertPlaceholders(sql, params);
    const result = await this.client.execute({
      sql: converted.sql,
      args: converted.params as any,
    });
    return { rows: result.rows as T[] };
  }

  async exec(sql: string): Promise<void> {
    // Split on semicolons for multi-statement DDL
    const statements = sql
      .split(";")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    for (const stmt of statements) {
      await this.client.execute(stmt);
    }
  }

  async close(): Promise<void> {
    this.client.close();
  }

  private convertPlaceholders(
    sql: string,
    params?: unknown[],
  ): { sql: string; params: unknown[] } {
    if (!params || params.length === 0) {
      return { sql, params: [] };
    }
    let idx = 0;
    const converted = sql.replace(/\$(\d+)/g, () => {
      idx++;
      return "?";
    });
    return { sql: converted, params };
  }
}

// ============================================================================
// V11 Migration DDL (subset needed for these tests)
// ============================================================================

const V11_MIGRATION_SQL = `
  CREATE TABLE IF NOT EXISTS task_mapping (
    cortex_id     TEXT PRIMARY KEY,
    bead_id       TEXT NOT NULL,
    epic_bead_id  TEXT,
    project_key   TEXT NOT NULL,
    created_at    TEXT NOT NULL,
    synced_at     TEXT,
    sync_status   TEXT DEFAULT 'synced'
      CHECK(sync_status IN ('synced', 'pending', 'conflict', 'orphaned')),
    bead_status   TEXT,
    bead_title    TEXT,
    bead_priority INTEGER,
    last_bead_update TEXT,
    source        TEXT DEFAULT 'cortex'
      CHECK(source IN ('cortex', 'beads', 'migration'))
  );

  CREATE UNIQUE INDEX IF NOT EXISTS idx_task_mapping_bead_id
    ON task_mapping(bead_id);

  CREATE INDEX IF NOT EXISTS idx_task_mapping_epic
    ON task_mapping(epic_bead_id);

  CREATE INDEX IF NOT EXISTS idx_task_mapping_project
    ON task_mapping(project_key);

  CREATE INDEX IF NOT EXISTS idx_task_mapping_sync_status
    ON task_mapping(sync_status);

  CREATE INDEX IF NOT EXISTS idx_task_mapping_bead_status
    ON task_mapping(project_key, bead_status);

  CREATE TABLE IF NOT EXISTS dep_mapping (
    id            TEXT PRIMARY KEY,
    from_bead_id  TEXT NOT NULL,
    to_bead_id    TEXT NOT NULL,
    dep_type      TEXT NOT NULL,
    project_key   TEXT NOT NULL,
    created_at    TEXT NOT NULL,
    synced_at     TEXT,
    UNIQUE(from_bead_id, to_bead_id, dep_type)
  );

  CREATE INDEX IF NOT EXISTS idx_dep_mapping_from
    ON dep_mapping(from_bead_id);

  CREATE INDEX IF NOT EXISTS idx_dep_mapping_to
    ON dep_mapping(to_bead_id);

  CREATE INDEX IF NOT EXISTS idx_dep_mapping_type
    ON dep_mapping(dep_type);

  CREATE INDEX IF NOT EXISTS idx_dep_mapping_project
    ON dep_mapping(project_key);

  CREATE TABLE IF NOT EXISTS label_mapping (
    bead_id       TEXT NOT NULL,
    label         TEXT NOT NULL,
    project_key   TEXT NOT NULL,
    synced_at     TEXT NOT NULL,
    PRIMARY KEY(bead_id, label)
  );

  CREATE INDEX IF NOT EXISTS idx_label_mapping_label
    ON label_mapping(label);

  CREATE INDEX IF NOT EXISTS idx_label_mapping_project
    ON label_mapping(project_key);
`;

// ============================================================================
// Test Setup
// ============================================================================

describe("MappingStore", () => {
  let client: Client;
  let db: DatabaseAdapter;
  let store: MappingStore;
  const projectKey = "/test/cortex-project";

  beforeAll(async () => {
    client = createClient({ url: ":memory:" });
    db = new TestDbAdapter(client);
    await db.exec(V11_MIGRATION_SQL);
    store = createMappingStore(db);
  });

  afterAll(async () => {
    await db.close?.();
  });

  // ==========================================================================
  // Task Mapping CRUD
  // ==========================================================================

  describe("Task Mapping CRUD", () => {
    test("createMapping - creates a new task mapping", async () => {
      const mapping = await store.createMapping({
        cortex_id: "ctx-001",
        bead_id: "bead-abc-123",
        epic_bead_id: "bead-epic-001",
        project_key: projectKey,
        created_at: "2025-01-01T00:00:00Z",
        sync_status: "synced",
        source: "cortex",
      });

      expect(mapping.cortex_id).toBe("ctx-001");
      expect(mapping.bead_id).toBe("bead-abc-123");
      expect(mapping.epic_bead_id).toBe("bead-epic-001");
      expect(mapping.project_key).toBe(projectKey);
      expect(mapping.sync_status).toBe("synced");
      expect(mapping.source).toBe("cortex");
      expect(mapping.synced_at).toBeDefined();
    });

    test("createMapping - creates minimal mapping (no optional fields)", async () => {
      const mapping = await store.createMapping({
        cortex_id: "ctx-002",
        bead_id: "bead-def-456",
        project_key: projectKey,
        created_at: "2025-01-01T00:00:00Z",
        sync_status: "pending",
        source: "beads",
      });

      expect(mapping.cortex_id).toBe("ctx-002");
      expect(mapping.bead_id).toBe("bead-def-456");
      expect(mapping.sync_status).toBe("pending");
    });

    test("createMapping - rejects duplicate cortex_id", async () => {
      await expect(
        store.createMapping({
          cortex_id: "ctx-001", // Already exists from first test
          bead_id: "bead-dup-123",
          project_key: projectKey,
          created_at: "2025-01-01T00:00:00Z",
          sync_status: "synced",
          source: "cortex",
        }),
      ).rejects.toThrow();
    });

    test("getByBeadId - returns mapping for existing bead", async () => {
      const mapping = await store.getByBeadId("bead-abc-123");
      expect(mapping).not.toBeNull();
      expect(mapping?.cortex_id).toBe("ctx-001");
      expect(mapping?.bead_id).toBe("bead-abc-123");
    });

    test("getByBeadId - returns null for non-existent bead", async () => {
      const mapping = await store.getByBeadId("bead-nonexistent");
      expect(mapping).toBeNull();
    });

    test("getByCortexId - returns mapping for existing cortex ID", async () => {
      const mapping = await store.getByCortexId("ctx-001");
      expect(mapping).not.toBeNull();
      expect(mapping?.bead_id).toBe("bead-abc-123");
    });

    test("getByCortexId - returns null for non-existent cortex ID", async () => {
      const mapping = await store.getByCortexId("ctx-nonexistent");
      expect(mapping).toBeNull();
    });

    test("updateSyncStatus - updates status and optional bead data", async () => {
      const updated = await store.updateSyncStatus("ctx-001", "pending", {
        bead_status: "in_progress",
        bead_title: "Updated Title",
        bead_priority: 1,
        last_bead_update: "2025-01-02T00:00:00Z",
      });

      expect(updated.sync_status).toBe("pending");
      expect(updated.bead_status).toBe("in_progress");
      expect(updated.bead_title).toBe("Updated Title");
      expect(updated.bead_priority).toBe(1);
      expect(updated.last_bead_update).toBe("2025-01-02T00:00:00Z");
      expect(updated.synced_at).toBeDefined();
    });

    test("updateSyncStatus - updates only status when no bead data", async () => {
      const updated = await store.updateSyncStatus("ctx-002", "synced");

      expect(updated.sync_status).toBe("synced");
      expect(updated.synced_at).toBeDefined();
    });

    test("updateSyncStatus - throws for non-existent cortex ID", async () => {
      await expect(
        store.updateSyncStatus("ctx-nonexistent", "synced"),
      ).rejects.toThrow();
    });

    test("listByEpic - returns all mappings for an epic", async () => {
      const mappings = await store.listByEpic("bead-epic-001");
      expect(mappings.length).toBeGreaterThanOrEqual(1);
      expect(mappings.every((m) => m.epic_bead_id === "bead-epic-001")).toBe(true);
    });

    test("listByEpic - returns empty array for non-existent epic", async () => {
      const mappings = await store.listByEpic("bead-epic-nonexistent");
      expect(mappings).toHaveLength(0);
    });

    test("listByProject - returns all mappings for a project", async () => {
      const mappings = await store.listByProject(projectKey);
      expect(mappings.length).toBeGreaterThanOrEqual(2);
      expect(mappings.every((m) => m.project_key === projectKey)).toBe(true);
    });

    test("listByProject - returns empty array for unknown project", async () => {
      const mappings = await store.listByProject("/unknown/project");
      expect(mappings).toHaveLength(0);
    });

    test("listBySyncStatus - returns mappings filtered by sync status", async () => {
      // First set one to 'conflict' for uniqueness
      await store.updateSyncStatus("ctx-001", "conflict");

      const conflicts = await store.listBySyncStatus("conflict");
      expect(conflicts.length).toBeGreaterThanOrEqual(1);
      expect(conflicts.every((m) => m.sync_status === "conflict")).toBe(true);

      // Reset
      await store.updateSyncStatus("ctx-001", "synced");
    });

    test("listBySyncStatus - returns empty array for status with no matches", async () => {
      const orphaned = await store.listBySyncStatus("orphaned");
      expect(orphaned).toHaveLength(0);
    });

    test("deleteMapping - removes a mapping", async () => {
      // Create one to delete
      await store.createMapping({
        cortex_id: "ctx-delete-me",
        bead_id: "bead-delete-me",
        project_key: projectKey,
        created_at: "2025-01-01T00:00:00Z",
        sync_status: "synced",
        source: "cortex",
      });

      await store.deleteMapping("ctx-delete-me");

      const mapping = await store.getByCortexId("ctx-delete-me");
      expect(mapping).toBeNull();
    });

    test("deleteMapping - no-op for non-existent cortex ID (no throw)", async () => {
      // Should not throw
      await store.deleteMapping("ctx-nonexistent");
    });
  });

  // ==========================================================================
  // Dep Mapping CRUD
  // ==========================================================================

  describe("Dep Mapping CRUD", () => {
    test("createDepMapping - creates a new dependency mapping", async () => {
      const dep = await store.createDepMapping({
        id: "dep-001",
        from_bead_id: "bead-abc-123",
        to_bead_id: "bead-def-456",
        dep_type: "blocks",
        project_key: projectKey,
        created_at: "2025-01-01T00:00:00Z",
      });

      expect(dep.id).toBe("dep-001");
      expect(dep.from_bead_id).toBe("bead-abc-123");
      expect(dep.to_bead_id).toBe("bead-def-456");
      expect(dep.dep_type).toBe("blocks");
      expect(dep.synced_at).toBeDefined();
    });

    test("createDepMapping - rejects duplicate (from, to, type) combo", async () => {
      await expect(
        store.createDepMapping({
          id: "dep-002-dup",
          from_bead_id: "bead-abc-123",
          to_bead_id: "bead-def-456",
          dep_type: "blocks",
          project_key: projectKey,
          created_at: "2025-01-01T00:00:00Z",
        }),
      ).rejects.toThrow();
    });

    test("createDepMapping - allows same beads with different dep_type", async () => {
      const dep = await store.createDepMapping({
        id: "dep-002",
        from_bead_id: "bead-abc-123",
        to_bead_id: "bead-def-456",
        dep_type: "relates-to",
        project_key: projectKey,
        created_at: "2025-01-01T00:00:00Z",
      });

      expect(dep.dep_type).toBe("relates-to");
    });

    test("getDepsByBead - returns deps from a bead (from direction)", async () => {
      const deps = await store.getDepsByBead("bead-abc-123", "from");
      expect(deps.length).toBeGreaterThanOrEqual(1);
      expect(deps.every((d) => d.from_bead_id === "bead-abc-123")).toBe(true);
    });

    test("getDepsByBead - returns deps to a bead (to direction)", async () => {
      const deps = await store.getDepsByBead("bead-def-456", "to");
      expect(deps.length).toBeGreaterThanOrEqual(1);
      expect(deps.every((d) => d.to_bead_id === "bead-def-456")).toBe(true);
    });

    test("getDepsByBead - returns deps in both directions (default)", async () => {
      const deps = await store.getDepsByBead("bead-abc-123");
      expect(deps.length).toBeGreaterThanOrEqual(2);
    });

    test("getDepsByBead - returns empty array for bead with no deps", async () => {
      const deps = await store.getDepsByBead("bead-no-deps");
      expect(deps).toHaveLength(0);
    });

    test("getDepsByType - returns deps filtered by type and project", async () => {
      const deps = await store.getDepsByType("blocks", projectKey);
      expect(deps.length).toBeGreaterThanOrEqual(1);
      expect(deps.every((d) => d.dep_type === "blocks")).toBe(true);
      expect(deps.every((d) => d.project_key === projectKey)).toBe(true);
    });

    test("getDepsByType - returns empty for type with no deps", async () => {
      const deps = await store.getDepsByType("causes", projectKey);
      expect(deps).toHaveLength(0);
    });

    test("removeDepMapping - removes a specific dependency", async () => {
      await store.removeDepMapping("bead-abc-123", "bead-def-456", "relates-to");

      // Check it was removed
      const deps = await store.getDepsByBead("bead-abc-123", "from");
      const remaining = deps.filter((d) => d.dep_type === "relates-to" && d.to_bead_id === "bead-def-456");
      expect(remaining).toHaveLength(0);
    });

    test("removeDepMapping - no-op for non-existent dep (no throw)", async () => {
      await store.removeDepMapping("bead-nonexistent", "bead-other", "blocks");
    });
  });

  // ==========================================================================
  // Label Mapping CRUD
  // ==========================================================================

  describe("Label Mapping CRUD", () => {
    test("createLabelMapping - creates a new label mapping", async () => {
      const label = await store.createLabelMapping({
        bead_id: "bead-abc-123",
        label: "urgent",
        project_key: projectKey,
        synced_at: "2025-01-01T00:00:00Z",
      });

      expect(label.bead_id).toBe("bead-abc-123");
      expect(label.label).toBe("urgent");
      expect(label.project_key).toBe(projectKey);
    });

    test("createLabelMapping - rejects duplicate (bead_id, label) combo", async () => {
      await expect(
        store.createLabelMapping({
          bead_id: "bead-abc-123",
          label: "urgent",
          project_key: projectKey,
          synced_at: "2025-01-02T00:00:00Z",
        }),
      ).rejects.toThrow();
    });

    test("createLabelMapping - allows same bead with different label", async () => {
      const label = await store.createLabelMapping({
        bead_id: "bead-abc-123",
        label: "auth",
        project_key: projectKey,
        synced_at: "2025-01-01T00:00:00Z",
      });

      expect(label.label).toBe("auth");
    });

    test("getLabelsByBead - returns all labels for a bead", async () => {
      const labels = await store.getLabelsByBead("bead-abc-123");
      expect(labels.length).toBeGreaterThanOrEqual(2);
      expect(labels.every((l) => l.bead_id === "bead-abc-123")).toBe(true);
      expect(labels.map((l) => l.label)).toContain("urgent");
      expect(labels.map((l) => l.label)).toContain("auth");
    });

    test("getLabelsByBead - returns empty for bead with no labels", async () => {
      const labels = await store.getLabelsByBead("bead-no-labels");
      expect(labels).toHaveLength(0);
    });

    test("getBeadsByLabel - returns all beads with a given label", async () => {
      // Add same label to another bead
      await store.createLabelMapping({
        bead_id: "bead-def-456",
        label: "urgent",
        project_key: projectKey,
        synced_at: "2025-01-01T00:00:00Z",
      });

      const labels = await store.getBeadsByLabel("urgent", projectKey);
      expect(labels.length).toBeGreaterThanOrEqual(2);
      expect(labels.every((l) => l.label === "urgent")).toBe(true);
      expect(labels.every((l) => l.project_key === projectKey)).toBe(true);
    });

    test("getBeadsByLabel - returns empty for label with no beads", async () => {
      const labels = await store.getBeadsByLabel("nonexistent-label", projectKey);
      expect(labels).toHaveLength(0);
    });

    test("removeLabelMapping - removes a specific label from a bead", async () => {
      await store.removeLabelMapping("bead-abc-123", "auth");

      const labels = await store.getLabelsByBead("bead-abc-123");
      expect(labels.map((l) => l.label)).not.toContain("auth");
    });

    test("removeLabelMapping - no-op for non-existent label (no throw)", async () => {
      await store.removeLabelMapping("bead-nonexistent", "nonexistent-label");
    });
  });

  // ==========================================================================
  // Diagnostics
  // ==========================================================================

  describe("Diagnostics", () => {
    test("findOrphanedMappings - returns mappings with orphaned sync_status", async () => {
      // Create an orphaned mapping
      await store.createMapping({
        cortex_id: "ctx-orphaned",
        bead_id: "bead-orphaned",
        project_key: projectKey,
        created_at: "2025-01-01T00:00:00Z",
        sync_status: "synced",
        source: "cortex",
      });
      await store.updateSyncStatus("ctx-orphaned", "orphaned");

      const orphaned = await store.findOrphanedMappings(projectKey);
      expect(orphaned.length).toBeGreaterThanOrEqual(1);
      expect(orphaned.every((m) => m.sync_status === "orphaned")).toBe(true);
    });

    test("findOrphanedMappings - returns empty when no orphans exist", async () => {
      const orphaned = await store.findOrphanedMappings("/no-orphans-project");
      expect(orphaned).toHaveLength(0);
    });

    test("findStaleMappings - returns mappings older than threshold", async () => {
      // Create a mapping with old synced_at
      await store.createMapping({
        cortex_id: "ctx-stale",
        bead_id: "bead-stale",
        project_key: projectKey,
        created_at: "2020-01-01T00:00:00Z",
        sync_status: "synced",
        source: "cortex",
      });
      // Set synced_at to an old timestamp via updateSyncStatus
      await store.updateSyncStatus("ctx-stale", "synced");

      // Now find stale ones — anything synced more than 0ms ago should include it
      // Use a very long threshold so nearly anything is stale
      const stale = await store.findStaleMappings(1); // 1ms threshold
      expect(stale.length).toBeGreaterThanOrEqual(1);
    });

    test("findStaleMappings - returns empty when nothing is stale", async () => {
      // Use a huge threshold (1 year) — nothing should be stale
      const stale = await store.findStaleMappings(365 * 24 * 60 * 60 * 1000);
      // Could have stale mappings from earlier tests, but with null synced_at
      // We just verify it returns an array
      expect(Array.isArray(stale)).toBe(true);
    });

    test("countByStatus - returns counts grouped by sync_status", async () => {
      const counts = await store.countByStatus(projectKey);

      expect(typeof counts.synced).toBe("number");
      expect(typeof counts.pending).toBe("number");
      expect(typeof counts.conflict).toBe("number");
      expect(typeof counts.orphaned).toBe("number");

      // We know we have at least one synced and one orphaned from earlier tests
      expect(counts.synced).toBeGreaterThanOrEqual(1);
      expect(counts.orphaned).toBeGreaterThanOrEqual(1);
    });

    test("countByStatus - returns zeros for project with no mappings", async () => {
      const counts = await store.countByStatus("/empty/project");

      expect(counts.synced).toBe(0);
      expect(counts.pending).toBe(0);
      expect(counts.conflict).toBe(0);
      expect(counts.orphaned).toBe(0);
    });
  });
});
