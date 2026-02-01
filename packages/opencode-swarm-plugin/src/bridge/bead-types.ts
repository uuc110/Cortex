// Const arrays (frozen for immutability, serialization-safe)

export const BEAD_DEP_TYPES = Object.freeze([
  "blocks",
  "blocked-by",
  "depends-on",
  "dependency-of",
  "parent",
  "child",
  "relates-to",
  "duplicates",
  "duplicated-by",
  "causes",
  "caused-by",
  "requires",
  "required-by",
  "tests",
  "tested-by",
  "implements",
  "implemented-by",
  "references",
] as const);

export const BEAD_STATUSES = Object.freeze([
  "open",
  "in_progress",
  "blocked",
  "closed",
] as const);

export const BEAD_ISSUE_TYPES = Object.freeze([
  "bug",
  "feature",
  "task",
  "epic",
  "chore",
] as const);

export const BEAD_PRIORITIES = Object.freeze([0, 1, 2, 3] as const);

export const SYNC_STATUSES = Object.freeze([
  "synced",
  "pending",
  "conflict",
  "orphaned",
] as const);

export const MAPPING_SOURCES = Object.freeze([
  "cortex",
  "beads",
  "migration",
] as const);

// Union types derived from const arrays

export type BeadDepType = (typeof BEAD_DEP_TYPES)[number];

export type BeadStatus = (typeof BEAD_STATUSES)[number];

export type BeadIssueType = (typeof BEAD_ISSUE_TYPES)[number];

export type BeadPriority = (typeof BEAD_PRIORITIES)[number];

export type SyncStatus = (typeof SYNC_STATUSES)[number];

export type MappingSource = (typeof MAPPING_SOURCES)[number];

// Core interfaces

export interface BeadIssue {
  id: string;
  title: string;
  status: BeadStatus;
  priority: number;
  issue_type: BeadIssueType;
  created_at: string;
  updated_at: string;
  description?: string;
  parent_id?: string;
  closed_at?: string;
  closed_reason?: string;
  assignee?: string;
  labels?: string[];
  comments?: BeadComment[];
}

export interface BeadDependency {
  source_id: string;
  target_id: string;
  dep_type: BeadDepType;
  created_at: string;
}

export interface BeadComment {
  id: string;
  bead_id: string;
  author: string;
  body: string;
  created_at: string;
  parent_id?: string;
  updated_at?: string;
}

export interface BeadLabel {
  bead_id: string;
  label: string;
  created_at: string;
}

export interface BeadMolecule {
  id: string;
  name: string;
  description: string;
  member_ids: string[];
  created_at: string;
}

export interface BeadStats {
  total: number;
  open: number;
  closed: number;
  in_progress: number;
  blocked: number;
  by_type: Record<BeadIssueType, number>;
  by_priority: Record<number, number>;
}

export interface BeadDaemonStatus {
  running: boolean;
  pid?: number;
  uptime_ms?: number;
  last_check: string;
}

// Options interfaces

export interface BdCreateOptions {
  title: string;
  type?: BeadIssueType;
  priority?: BeadPriority;
  description?: string;
  parent_id?: string;
}

export interface BdListOptions {
  status?: BeadStatus;
  type?: BeadIssueType;
  priority?: BeadPriority;
  assignee?: string;
  label?: string;
  limit?: number;
  offset?: number;
}

export interface BdUpdateOptions {
  title?: string;
  status?: BeadStatus;
  priority?: BeadPriority;
  description?: string;
  assignee?: string;
}

export interface BdSearchOptions {
  query: string;
  type?: BeadIssueType;
  status?: BeadStatus;
  limit?: number;
}

export interface BdReadyOptions {
  project_key?: string;
  include_deps?: boolean;
}

export interface BdRetryConfig {
  maxRetries: number;
  baseDelay: number;
  maxDelay: number;
  retryableExitCodes: number[];
}

// Mapping types (match v11 migration DDL in migrations.ts L627-733)

export interface TaskMapping {
  cortex_id: string;
  bead_id: string;
  epic_bead_id?: string;
  project_key: string;
  created_at: string;
  synced_at?: string;
  sync_status: SyncStatus;
  bead_status?: string;
  bead_title?: string;
  bead_priority?: number;
  last_bead_update?: string;
  source: MappingSource;
}

export interface DepMapping {
  id: string;
  from_bead_id: string;
  to_bead_id: string;
  dep_type: BeadDepType;
  project_key: string;
  created_at: string;
  synced_at?: string;
}

export interface LabelMapping {
  bead_id: string;
  label: string;
  project_key: string;
  synced_at: string;
}

// Error class

interface BeadClientErrorOptions {
  exitCode: number;
  stderr: string;
  command: string;
  suggestion?: string;
}

interface SpawnResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

const EXIT_CODE_SUGGESTIONS: Record<number, string> = {
  127: "bd is not installed. Install from https://github.com/steveyegge/beads",
  3: "Validation error — check the command arguments and try again",
};

export class BeadClientError extends Error {
  readonly exitCode: number;
  readonly stderr: string;
  readonly command: string;
  readonly suggestion?: string;

  constructor(message: string, options: BeadClientErrorOptions) {
    super(message);
    this.name = "BeadClientError";
    this.exitCode = options.exitCode;
    this.stderr = options.stderr;
    this.command = options.command;
    this.suggestion = options.suggestion;
  }

  static fromSpawnResult(result: SpawnResult, command: string): BeadClientError {
    const stderr = result.stderr.trim();
    const stdout = result.stdout.trim();
    const message =
      stderr || stdout || `bd command failed with exit code ${result.exitCode}`;

    return new BeadClientError(message, {
      exitCode: result.exitCode,
      stderr,
      command,
      suggestion: EXIT_CODE_SUGGESTIONS[result.exitCode],
    });
  }
}
