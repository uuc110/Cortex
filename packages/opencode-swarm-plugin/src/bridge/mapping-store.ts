import type { DatabaseAdapter } from "swarm-mail";

import type {
  TaskMapping,
  DepMapping,
  LabelMapping,
  SyncStatus,
  BeadDepType,
} from "./bead-types.js";

export interface MappingStore {
  createMapping(mapping: Omit<TaskMapping, "synced_at">): Promise<TaskMapping>;
  getByBeadId(beadId: string): Promise<TaskMapping | null>;
  getByCortexId(cortexId: string): Promise<TaskMapping | null>;
  updateSyncStatus(
    cortexId: string,
    status: SyncStatus,
    beadData?: Partial<TaskMapping>,
  ): Promise<TaskMapping>;
  listByEpic(epicBeadId: string): Promise<TaskMapping[]>;
  listByProject(projectKey: string): Promise<TaskMapping[]>;
  listBySyncStatus(status: SyncStatus): Promise<TaskMapping[]>;
  deleteMapping(cortexId: string): Promise<void>;

  createDepMapping(dep: Omit<DepMapping, "synced_at">): Promise<DepMapping>;
  getDepsByBead(
    beadId: string,
    direction?: "from" | "to" | "both",
  ): Promise<DepMapping[]>;
  getDepsByType(
    depType: BeadDepType,
    projectKey: string,
  ): Promise<DepMapping[]>;
  removeDepMapping(
    fromBeadId: string,
    toBeadId: string,
    depType: BeadDepType,
  ): Promise<void>;

  createLabelMapping(label: LabelMapping): Promise<LabelMapping>;
  getLabelsByBead(beadId: string): Promise<LabelMapping[]>;
  getBeadsByLabel(
    label: string,
    projectKey: string,
  ): Promise<LabelMapping[]>;
  removeLabelMapping(beadId: string, label: string): Promise<void>;

  findOrphanedMappings(projectKey: string): Promise<TaskMapping[]>;
  findStaleMappings(olderThanMs: number): Promise<TaskMapping[]>;
  countByStatus(projectKey: string): Promise<Record<SyncStatus, number>>;
}

function nowISO(): string {
  return new Date().toISOString();
}

function rowToTaskMapping(row: Record<string, unknown>): TaskMapping {
  return {
    cortex_id: row.cortex_id as string,
    bead_id: row.bead_id as string,
    epic_bead_id: (row.epic_bead_id as string) ?? undefined,
    project_key: row.project_key as string,
    created_at: row.created_at as string,
    synced_at: (row.synced_at as string) ?? undefined,
    sync_status: (row.sync_status as SyncStatus) ?? "synced",
    bead_status: (row.bead_status as string) ?? undefined,
    bead_title: (row.bead_title as string) ?? undefined,
    bead_priority:
      row.bead_priority != null ? Number(row.bead_priority) : undefined,
    last_bead_update: (row.last_bead_update as string) ?? undefined,
    source: (row.source as TaskMapping["source"]) ?? "cortex",
  };
}

function rowToDepMapping(row: Record<string, unknown>): DepMapping {
  return {
    id: row.id as string,
    from_bead_id: row.from_bead_id as string,
    to_bead_id: row.to_bead_id as string,
    dep_type: row.dep_type as BeadDepType,
    project_key: row.project_key as string,
    created_at: row.created_at as string,
    synced_at: (row.synced_at as string) ?? undefined,
  };
}

function rowToLabelMapping(row: Record<string, unknown>): LabelMapping {
  return {
    bead_id: row.bead_id as string,
    label: row.label as string,
    project_key: row.project_key as string,
    synced_at: row.synced_at as string,
  };
}

export function createMappingStore(db: DatabaseAdapter): MappingStore {
  return {
    // ========================================================================
    // Task Mappings
    // ========================================================================

    async createMapping(mapping) {
      const syncedAt = nowISO();
      await db.query(
        `INSERT INTO task_mapping
          (cortex_id, bead_id, epic_bead_id, project_key, created_at,
           synced_at, sync_status, bead_status, bead_title, bead_priority,
           last_bead_update, source)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [
          mapping.cortex_id,
          mapping.bead_id,
          mapping.epic_bead_id ?? null,
          mapping.project_key,
          mapping.created_at,
          syncedAt,
          mapping.sync_status,
          mapping.bead_status ?? null,
          mapping.bead_title ?? null,
          mapping.bead_priority ?? null,
          mapping.last_bead_update ?? null,
          mapping.source,
        ],
      );

      const result = await db.query<Record<string, unknown>>(
        `SELECT * FROM task_mapping WHERE cortex_id = $1`,
        [mapping.cortex_id],
      );
      return rowToTaskMapping(result.rows[0]!);
    },

    async getByBeadId(beadId) {
      const result = await db.query<Record<string, unknown>>(
        `SELECT * FROM task_mapping WHERE bead_id = $1`,
        [beadId],
      );
      if (result.rows.length === 0) return null;
      return rowToTaskMapping(result.rows[0]!);
    },

    async getByCortexId(cortexId) {
      const result = await db.query<Record<string, unknown>>(
        `SELECT * FROM task_mapping WHERE cortex_id = $1`,
        [cortexId],
      );
      if (result.rows.length === 0) return null;
      return rowToTaskMapping(result.rows[0]!);
    },

    async updateSyncStatus(cortexId, status, beadData) {
      const syncedAt = nowISO();

      if (beadData) {
        await db.query(
          `UPDATE task_mapping SET
            sync_status = $1,
            synced_at = $2,
            bead_status = COALESCE($3, bead_status),
            bead_title = COALESCE($4, bead_title),
            bead_priority = COALESCE($5, bead_priority),
            last_bead_update = COALESCE($6, last_bead_update)
           WHERE cortex_id = $7`,
          [
            status,
            syncedAt,
            beadData.bead_status ?? null,
            beadData.bead_title ?? null,
            beadData.bead_priority ?? null,
            beadData.last_bead_update ?? null,
            cortexId,
          ],
        );
      } else {
        await db.query(
          `UPDATE task_mapping SET sync_status = $1, synced_at = $2 WHERE cortex_id = $3`,
          [status, syncedAt, cortexId],
        );
      }

      const result = await db.query<Record<string, unknown>>(
        `SELECT * FROM task_mapping WHERE cortex_id = $1`,
        [cortexId],
      );
      if (result.rows.length === 0) {
        throw new Error(`TaskMapping not found: cortex_id=${cortexId}`);
      }
      return rowToTaskMapping(result.rows[0]!);
    },

    async listByEpic(epicBeadId) {
      const result = await db.query<Record<string, unknown>>(
        `SELECT * FROM task_mapping WHERE epic_bead_id = $1 ORDER BY created_at ASC`,
        [epicBeadId],
      );
      return result.rows.map(rowToTaskMapping);
    },

    async listByProject(projectKey) {
      const result = await db.query<Record<string, unknown>>(
        `SELECT * FROM task_mapping WHERE project_key = $1 ORDER BY created_at ASC`,
        [projectKey],
      );
      return result.rows.map(rowToTaskMapping);
    },

    async listBySyncStatus(status) {
      const result = await db.query<Record<string, unknown>>(
        `SELECT * FROM task_mapping WHERE sync_status = $1 ORDER BY created_at ASC`,
        [status],
      );
      return result.rows.map(rowToTaskMapping);
    },

    async deleteMapping(cortexId) {
      await db.query(`DELETE FROM task_mapping WHERE cortex_id = $1`, [
        cortexId,
      ]);
    },

    // ========================================================================
    // Dep Mappings
    // ========================================================================

    async createDepMapping(dep) {
      const syncedAt = nowISO();
      await db.query(
        `INSERT INTO dep_mapping
          (id, from_bead_id, to_bead_id, dep_type, project_key, created_at, synced_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          dep.id,
          dep.from_bead_id,
          dep.to_bead_id,
          dep.dep_type,
          dep.project_key,
          dep.created_at,
          syncedAt,
        ],
      );

      const result = await db.query<Record<string, unknown>>(
        `SELECT * FROM dep_mapping WHERE id = $1`,
        [dep.id],
      );
      return rowToDepMapping(result.rows[0]!);
    },

    async getDepsByBead(beadId, direction = "both") {
      let sql: string;
      let params: unknown[];

      if (direction === "from") {
        sql = `SELECT * FROM dep_mapping WHERE from_bead_id = $1 ORDER BY created_at ASC`;
        params = [beadId];
      } else if (direction === "to") {
        sql = `SELECT * FROM dep_mapping WHERE to_bead_id = $1 ORDER BY created_at ASC`;
        params = [beadId];
      } else {
        sql = `SELECT * FROM dep_mapping WHERE from_bead_id = $1 OR to_bead_id = $1 ORDER BY created_at ASC`;
        params = [beadId];
      }

      const result = await db.query<Record<string, unknown>>(sql, params);
      return result.rows.map(rowToDepMapping);
    },

    async getDepsByType(depType, projectKey) {
      const result = await db.query<Record<string, unknown>>(
        `SELECT * FROM dep_mapping WHERE dep_type = $1 AND project_key = $2 ORDER BY created_at ASC`,
        [depType, projectKey],
      );
      return result.rows.map(rowToDepMapping);
    },

    async removeDepMapping(fromBeadId, toBeadId, depType) {
      await db.query(
        `DELETE FROM dep_mapping WHERE from_bead_id = $1 AND to_bead_id = $2 AND dep_type = $3`,
        [fromBeadId, toBeadId, depType],
      );
    },

    // ========================================================================
    // Label Mappings
    // ========================================================================

    async createLabelMapping(label) {
      await db.query(
        `INSERT INTO label_mapping (bead_id, label, project_key, synced_at)
         VALUES ($1, $2, $3, $4)`,
        [label.bead_id, label.label, label.project_key, label.synced_at],
      );

      const result = await db.query<Record<string, unknown>>(
        `SELECT * FROM label_mapping WHERE bead_id = $1 AND label = $2`,
        [label.bead_id, label.label],
      );
      return rowToLabelMapping(result.rows[0]!);
    },

    async getLabelsByBead(beadId) {
      const result = await db.query<Record<string, unknown>>(
        `SELECT * FROM label_mapping WHERE bead_id = $1 ORDER BY label ASC`,
        [beadId],
      );
      return result.rows.map(rowToLabelMapping);
    },

    async getBeadsByLabel(label, projectKey) {
      const result = await db.query<Record<string, unknown>>(
        `SELECT * FROM label_mapping WHERE label = $1 AND project_key = $2 ORDER BY bead_id ASC`,
        [label, projectKey],
      );
      return result.rows.map(rowToLabelMapping);
    },

    async removeLabelMapping(beadId, label) {
      await db.query(
        `DELETE FROM label_mapping WHERE bead_id = $1 AND label = $2`,
        [beadId, label],
      );
    },

    // ========================================================================
    // Diagnostics
    // ========================================================================

    async findOrphanedMappings(projectKey) {
      const result = await db.query<Record<string, unknown>>(
        `SELECT * FROM task_mapping
         WHERE project_key = $1 AND sync_status = 'orphaned'
         ORDER BY created_at ASC`,
        [projectKey],
      );
      return result.rows.map(rowToTaskMapping);
    },

    async findStaleMappings(olderThanMs) {
      const cutoff = new Date(Date.now() - olderThanMs).toISOString();
      const result = await db.query<Record<string, unknown>>(
        `SELECT * FROM task_mapping
         WHERE synced_at IS NOT NULL AND synced_at < $1
         ORDER BY synced_at ASC`,
        [cutoff],
      );
      return result.rows.map(rowToTaskMapping);
    },

    async countByStatus(projectKey) {
      const result = await db.query<{ sync_status: string; count: number }>(
        `SELECT sync_status, COUNT(*) as count
         FROM task_mapping
         WHERE project_key = $1
         GROUP BY sync_status`,
        [projectKey],
      );

      const counts: Record<SyncStatus, number> = {
        synced: 0,
        pending: 0,
        conflict: 0,
        orphaned: 0,
      };

      for (const row of result.rows) {
        const status = row.sync_status as SyncStatus;
        counts[status] = Number(row.count);
      }

      return counts;
    },
  };
}
