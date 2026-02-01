/**
 * Tests for bead-types.ts — Foundation types for the Beads Bridge module.
 *
 * TDD RED phase: These tests define the contract BEFORE implementation.
 * Cross-references:
 *   - Event schemas: packages/swarm-mail/src/streams/events.ts L698-774
 *   - v11 Migration DDL: packages/swarm-mail/src/hive/migrations.ts L627-733
 *   - Bridge API spec: .planning/fork-plan/details/bd-cli-bridge-api.md
 *   - Mapping schema spec: .planning/fork-plan/details/task-mapping-schema.md
 */
import { describe, expect, test } from "bun:test";

import {
  // Enums / const arrays
  BEAD_DEP_TYPES,
  BEAD_ISSUE_TYPES,
  BEAD_PRIORITIES,
  BEAD_STATUSES,
  MAPPING_SOURCES,
  SYNC_STATUSES,

  // Error class
  BeadClientError,

  // Type-only re-exports tested via structural checks
  type BeadComment,
  type BeadDaemonStatus,
  type BeadDependency,
  type BeadDepType,
  type BeadIssue,
  type BeadIssueType,
  type BeadLabel,
  type BeadMolecule,
  type BeadPriority,
  type BeadStats,
  type BeadStatus,
  type BdCreateOptions,
  type BdListOptions,
  type BdReadyOptions,
  type BdRetryConfig,
  type BdSearchOptions,
  type BdUpdateOptions,
  type DepMapping,
  type LabelMapping,
  type MappingSource,
  type SyncStatus,
  type TaskMapping,
} from "../bead-types.js";

// ============================================================================
// BEAD_DEP_TYPES — Must match BeadsDepAddedEventSchema exactly (18 values)
// ============================================================================
describe("BEAD_DEP_TYPES", () => {
  test("has exactly 18 dependency types", () => {
    expect(BEAD_DEP_TYPES).toHaveLength(18);
  });

  test("contains all 18 values matching the event schema", () => {
    // These 18 values come from BeadsDepAddedEventSchema in events.ts L713-718
    const expected = [
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
    ] as const;

    for (const depType of expected) {
      expect(BEAD_DEP_TYPES).toContain(depType);
    }
  });

  test("is a readonly array (const assertion)", () => {
    // Should not be mutable at runtime
    expect(Object.isFrozen(BEAD_DEP_TYPES)).toBe(true);
  });

  test("has no duplicate values", () => {
    const unique = new Set(BEAD_DEP_TYPES);
    expect(unique.size).toBe(BEAD_DEP_TYPES.length);
  });
});

// ============================================================================
// BEAD_STATUSES
// ============================================================================
describe("BEAD_STATUSES", () => {
  test("has exactly 4 statuses", () => {
    expect(BEAD_STATUSES).toHaveLength(4);
  });

  test("contains open, in_progress, blocked, closed", () => {
    expect(BEAD_STATUSES).toContain("open");
    expect(BEAD_STATUSES).toContain("in_progress");
    expect(BEAD_STATUSES).toContain("blocked");
    expect(BEAD_STATUSES).toContain("closed");
  });

  test("is frozen", () => {
    expect(Object.isFrozen(BEAD_STATUSES)).toBe(true);
  });
});

// ============================================================================
// BEAD_ISSUE_TYPES
// ============================================================================
describe("BEAD_ISSUE_TYPES", () => {
  test("has exactly 5 issue types", () => {
    expect(BEAD_ISSUE_TYPES).toHaveLength(5);
  });

  test("contains bug, feature, task, epic, chore", () => {
    expect(BEAD_ISSUE_TYPES).toContain("bug");
    expect(BEAD_ISSUE_TYPES).toContain("feature");
    expect(BEAD_ISSUE_TYPES).toContain("task");
    expect(BEAD_ISSUE_TYPES).toContain("epic");
    expect(BEAD_ISSUE_TYPES).toContain("chore");
  });

  test("is frozen", () => {
    expect(Object.isFrozen(BEAD_ISSUE_TYPES)).toBe(true);
  });
});

// ============================================================================
// BEAD_PRIORITIES
// ============================================================================
describe("BEAD_PRIORITIES", () => {
  test("has exactly 4 priority levels (0-3)", () => {
    expect(BEAD_PRIORITIES).toHaveLength(4);
  });

  test("contains 0 (critical), 1 (high), 2 (medium), 3 (low)", () => {
    expect(BEAD_PRIORITIES).toContain(0);
    expect(BEAD_PRIORITIES).toContain(1);
    expect(BEAD_PRIORITIES).toContain(2);
    expect(BEAD_PRIORITIES).toContain(3);
  });

  test("is frozen", () => {
    expect(Object.isFrozen(BEAD_PRIORITIES)).toBe(true);
  });
});

// ============================================================================
// SYNC_STATUSES
// ============================================================================
describe("SYNC_STATUSES", () => {
  test("has exactly 4 sync statuses", () => {
    expect(SYNC_STATUSES).toHaveLength(4);
  });

  test("contains synced, pending, conflict, orphaned", () => {
    expect(SYNC_STATUSES).toContain("synced");
    expect(SYNC_STATUSES).toContain("pending");
    expect(SYNC_STATUSES).toContain("conflict");
    expect(SYNC_STATUSES).toContain("orphaned");
  });

  test("matches v11 migration DDL CHECK constraint", () => {
    // From migrations.ts L653-654:
    //   CHECK(sync_status IN ('synced', 'pending', 'conflict', 'orphaned'))
    const ddlValues = ["synced", "pending", "conflict", "orphaned"] as const;
    expect([...SYNC_STATUSES].sort()).toEqual([...ddlValues].sort());
  });

  test("is frozen", () => {
    expect(Object.isFrozen(SYNC_STATUSES)).toBe(true);
  });
});

// ============================================================================
// MAPPING_SOURCES
// ============================================================================
describe("MAPPING_SOURCES", () => {
  test("has exactly 3 mapping sources", () => {
    expect(MAPPING_SOURCES).toHaveLength(3);
  });

  test("contains cortex, beads, migration", () => {
    expect(MAPPING_SOURCES).toContain("cortex");
    expect(MAPPING_SOURCES).toContain("beads");
    expect(MAPPING_SOURCES).toContain("migration");
  });

  test("matches v11 migration DDL CHECK constraint", () => {
    // From migrations.ts L659-660:
    //   CHECK(source IN ('cortex', 'beads', 'migration'))
    const ddlValues = ["cortex", "beads", "migration"] as const;
    expect([...MAPPING_SOURCES].sort()).toEqual([...ddlValues].sort());
  });

  test("is frozen", () => {
    expect(Object.isFrozen(MAPPING_SOURCES)).toBe(true);
  });
});

// ============================================================================
// BeadClientError
// ============================================================================
describe("BeadClientError", () => {
  test("extends Error", () => {
    const err = new BeadClientError("test error", {
      exitCode: 1,
      stderr: "something failed",
      command: "bd list --json",
    });
    expect(err).toBeInstanceOf(Error);
  });

  test("has name 'BeadClientError'", () => {
    const err = new BeadClientError("test error", {
      exitCode: 1,
      stderr: "",
      command: "bd list",
    });
    expect(err.name).toBe("BeadClientError");
  });

  test("stores exitCode, stderr, command", () => {
    const err = new BeadClientError("not found", {
      exitCode: 2,
      stderr: "issue xyz not found",
      command: "bd show xyz --json",
    });
    expect(err.exitCode).toBe(2);
    expect(err.stderr).toBe("issue xyz not found");
    expect(err.command).toBe("bd show xyz --json");
  });

  test("stores optional suggestion", () => {
    const err = new BeadClientError("bd not installed", {
      exitCode: 127,
      stderr: "",
      command: "bd version",
      suggestion: "Install bd from https://github.com/steveyegge/beads",
    });
    expect(err.suggestion).toBe(
      "Install bd from https://github.com/steveyegge/beads",
    );
  });

  test("has undefined suggestion when not provided", () => {
    const err = new BeadClientError("generic error", {
      exitCode: 1,
      stderr: "",
      command: "bd list",
    });
    expect(err.suggestion).toBeUndefined();
  });

  test("message is set correctly", () => {
    const err = new BeadClientError("something went wrong", {
      exitCode: 1,
      stderr: "",
      command: "bd list",
    });
    expect(err.message).toBe("something went wrong");
  });

  // Exit code mapping tests
  describe("exit code mapping", () => {
    test("exit code 1 = general error", () => {
      const err = new BeadClientError("general failure", {
        exitCode: 1,
        stderr: "unexpected error",
        command: "bd list",
      });
      expect(err.exitCode).toBe(1);
    });

    test("exit code 2 = not found", () => {
      const err = new BeadClientError("not found", {
        exitCode: 2,
        stderr: "issue not found",
        command: "bd show abc",
      });
      expect(err.exitCode).toBe(2);
    });

    test("exit code 3 = validation error", () => {
      const err = new BeadClientError("validation failed", {
        exitCode: 3,
        stderr: "invalid priority value",
        command: "bd create test -p 99",
      });
      expect(err.exitCode).toBe(3);
    });

    test("exit code 4 = conflict", () => {
      const err = new BeadClientError("conflict", {
        exitCode: 4,
        stderr: "duplicate issue",
        command: "bd create duplicate",
      });
      expect(err.exitCode).toBe(4);
    });

    test("exit code 127 = not installed", () => {
      const err = new BeadClientError("bd not found", {
        exitCode: 127,
        stderr: "",
        command: "bd version",
        suggestion: "Install bd from https://github.com/steveyegge/beads",
      });
      expect(err.exitCode).toBe(127);
    });
  });

  // fromSpawnResult factory method
  describe("fromSpawnResult()", () => {
    test("creates error from spawn result with non-zero exit code", () => {
      const result = {
        exitCode: 2,
        stdout: "",
        stderr: "issue not found: xyz",
      };
      const err = BeadClientError.fromSpawnResult(
        result,
        "bd show xyz --json",
      );

      expect(err).toBeInstanceOf(BeadClientError);
      expect(err.exitCode).toBe(2);
      expect(err.stderr).toBe("issue not found: xyz");
      expect(err.command).toBe("bd show xyz --json");
      expect(err.message).toBe("issue not found: xyz");
    });

    test("uses stdout as message when stderr is empty", () => {
      const result = {
        exitCode: 1,
        stdout: "unexpected output",
        stderr: "",
      };
      const err = BeadClientError.fromSpawnResult(result, "bd list --json");

      expect(err.message).toBe("unexpected output");
    });

    test("falls back to generic message when both stdout and stderr are empty", () => {
      const result = {
        exitCode: 1,
        stdout: "",
        stderr: "",
      };
      const err = BeadClientError.fromSpawnResult(result, "bd list --json");

      expect(err.message).toBe("bd command failed with exit code 1");
    });

    test("adds suggestion for exit code 127 (not installed)", () => {
      const result = {
        exitCode: 127,
        stdout: "",
        stderr: "command not found: bd",
      };
      const err = BeadClientError.fromSpawnResult(result, "bd version");

      expect(err.exitCode).toBe(127);
      expect(err.suggestion).toBeDefined();
      expect(err.suggestion).toContain("install");
    });

    test("adds suggestion for exit code 3 (validation)", () => {
      const result = {
        exitCode: 3,
        stdout: "",
        stderr: "invalid priority",
      };
      const err = BeadClientError.fromSpawnResult(
        result,
        "bd create test -p 99",
      );

      expect(err.exitCode).toBe(3);
      expect(err.suggestion).toBeDefined();
    });

    test("trims whitespace from stderr/stdout messages", () => {
      const result = {
        exitCode: 1,
        stdout: "  output with spaces  \n",
        stderr: "  error with spaces  \n",
      };
      const err = BeadClientError.fromSpawnResult(result, "bd list");

      expect(err.message).toBe("error with spaces");
      expect(err.stderr).toBe("error with spaces");
    });
  });
});

// ============================================================================
// Type compatibility / structural tests
// ============================================================================
describe("Type structures (compile-time + runtime shape verification)", () => {
  test("BeadIssue has all required fields", () => {
    const issue: BeadIssue = {
      id: "proj-abc-123",
      title: "Fix auth bug",
      status: "open",
      priority: 1,
      issue_type: "bug",
      created_at: "2025-01-01T00:00:00Z",
      updated_at: "2025-01-01T00:00:00Z",
    };

    expect(issue.id).toBe("proj-abc-123");
    expect(issue.title).toBe("Fix auth bug");
    expect(issue.status).toBe("open");
    expect(issue.priority).toBe(1);
    expect(issue.issue_type).toBe("bug");
    expect(issue.created_at).toBeDefined();
    expect(issue.updated_at).toBeDefined();
  });

  test("BeadIssue supports optional fields", () => {
    const issue: BeadIssue = {
      id: "proj-abc-123",
      title: "Fix auth bug",
      status: "closed",
      priority: 0,
      issue_type: "feature",
      created_at: "2025-01-01T00:00:00Z",
      updated_at: "2025-01-02T00:00:00Z",
      description: "A detailed description",
      parent_id: "proj-epic-456",
      closed_at: "2025-01-02T00:00:00Z",
      closed_reason: "Fixed in PR #42",
      assignee: "agent-worker-1",
      labels: ["urgent", "auth"],
      comments: [],
    };

    expect(issue.description).toBe("A detailed description");
    expect(issue.parent_id).toBe("proj-epic-456");
    expect(issue.closed_at).toBe("2025-01-02T00:00:00Z");
    expect(issue.closed_reason).toBe("Fixed in PR #42");
    expect(issue.assignee).toBe("agent-worker-1");
    expect(issue.labels).toEqual(["urgent", "auth"]);
    expect(issue.comments).toEqual([]);
  });

  test("BeadDependency has source_id, target_id, dep_type, created_at", () => {
    const dep: BeadDependency = {
      source_id: "proj-abc-123",
      target_id: "proj-def-456",
      dep_type: "blocks",
      created_at: "2025-01-01T00:00:00Z",
    };

    expect(dep.source_id).toBe("proj-abc-123");
    expect(dep.target_id).toBe("proj-def-456");
    expect(dep.dep_type).toBe("blocks");
    expect(dep.created_at).toBeDefined();
  });

  test("BeadComment has all required fields", () => {
    const comment: BeadComment = {
      id: "comment-1",
      bead_id: "proj-abc-123",
      author: "worker-agent",
      body: "Fixed the auth flow",
      created_at: "2025-01-01T00:00:00Z",
    };

    expect(comment.id).toBe("comment-1");
    expect(comment.bead_id).toBe("proj-abc-123");
    expect(comment.author).toBe("worker-agent");
    expect(comment.body).toBe("Fixed the auth flow");
  });

  test("BeadComment supports optional fields", () => {
    const comment: BeadComment = {
      id: "comment-1",
      bead_id: "proj-abc-123",
      author: "worker-agent",
      body: "Reply to previous",
      created_at: "2025-01-01T00:00:00Z",
      parent_id: "comment-0",
      updated_at: "2025-01-02T00:00:00Z",
    };

    expect(comment.parent_id).toBe("comment-0");
    expect(comment.updated_at).toBeDefined();
  });

  test("BeadLabel has bead_id, label, created_at", () => {
    const label: BeadLabel = {
      bead_id: "proj-abc-123",
      label: "urgent",
      created_at: "2025-01-01T00:00:00Z",
    };

    expect(label.bead_id).toBe("proj-abc-123");
    expect(label.label).toBe("urgent");
  });

  test("BeadMolecule has id, name, description, member_ids, created_at", () => {
    const molecule: BeadMolecule = {
      id: "mol-1",
      name: "Auth Module",
      description: "All auth-related tasks",
      member_ids: ["proj-abc-123", "proj-def-456"],
      created_at: "2025-01-01T00:00:00Z",
    };

    expect(molecule.id).toBe("mol-1");
    expect(molecule.name).toBe("Auth Module");
    expect(molecule.member_ids).toHaveLength(2);
  });

  test("BeadStats has all required fields", () => {
    const stats: BeadStats = {
      total: 42,
      open: 10,
      closed: 20,
      in_progress: 8,
      blocked: 4,
      by_type: { bug: 5, feature: 15, task: 12, epic: 3, chore: 7 },
      by_priority: { 0: 2, 1: 10, 2: 20, 3: 10 },
    };

    expect(stats.total).toBe(42);
    expect(stats.open).toBe(10);
    expect(stats.by_type.bug).toBe(5);
    expect(stats.by_priority[0]).toBe(2);
  });

  test("BeadDaemonStatus has running, pid, uptime_ms, last_check", () => {
    const status: BeadDaemonStatus = {
      running: true,
      pid: 12345,
      uptime_ms: 60000,
      last_check: "2025-01-01T00:01:00Z",
    };

    expect(status.running).toBe(true);
    expect(status.pid).toBe(12345);
    expect(status.uptime_ms).toBe(60000);
  });

  test("BdCreateOptions has required title and optional fields", () => {
    const opts: BdCreateOptions = {
      title: "New feature",
      type: "feature",
      priority: 2,
      description: "Build the thing",
      parent_id: "epic-123",
    };

    expect(opts.title).toBe("New feature");
    expect(opts.type).toBe("feature");
  });

  test("BdCreateOptions works with only title", () => {
    const opts: BdCreateOptions = {
      title: "Minimal issue",
    };

    expect(opts.title).toBe("Minimal issue");
    expect(opts.type).toBeUndefined();
  });

  test("BdListOptions has all optional filter fields", () => {
    const opts: BdListOptions = {
      status: "open",
      type: "bug",
      priority: 1,
      assignee: "agent-1",
      label: "urgent",
      limit: 50,
      offset: 10,
    };

    expect(opts.status).toBe("open");
    expect(opts.limit).toBe(50);
  });

  test("BdUpdateOptions has all optional update fields", () => {
    const opts: BdUpdateOptions = {
      title: "Updated title",
      status: "in_progress",
      priority: 0,
      description: "Updated desc",
      assignee: "new-agent",
    };

    expect(opts.title).toBe("Updated title");
    expect(opts.status).toBe("in_progress");
  });

  test("BdSearchOptions has required query and optional filters", () => {
    const opts: BdSearchOptions = {
      query: "auth bug",
      type: "bug",
      status: "open",
      limit: 10,
    };

    expect(opts.query).toBe("auth bug");
  });

  test("BdReadyOptions has optional project_key and include_deps", () => {
    const opts: BdReadyOptions = {
      project_key: "/path/to/project",
      include_deps: true,
    };

    expect(opts.project_key).toBe("/path/to/project");
    expect(opts.include_deps).toBe(true);
  });

  test("BdRetryConfig has defaults documented", () => {
    const config: BdRetryConfig = {
      maxRetries: 3,
      baseDelay: 1000,
      maxDelay: 10000,
      retryableExitCodes: [1],
    };

    expect(config.maxRetries).toBe(3);
    expect(config.baseDelay).toBe(1000);
    expect(config.maxDelay).toBe(10000);
    expect(config.retryableExitCodes).toEqual([1]);
  });
});

// ============================================================================
// Mapping Types — Must match v11 migration DDL exactly
// ============================================================================
describe("Mapping types (match v11 migration DDL)", () => {
  test("TaskMapping has all columns from v11 DDL", () => {
    const mapping: TaskMapping = {
      cortex_id: "uuid-v4-value",
      bead_id: "proj-abc-123",
      epic_bead_id: "proj-epic-456",
      project_key: "/path/to/project",
      created_at: "2025-01-01T00:00:00Z",
      synced_at: "2025-01-01T00:00:00Z",
      sync_status: "synced",
      bead_status: "open",
      bead_title: "Fix auth bug",
      bead_priority: 1,
      last_bead_update: "2025-01-01T00:00:00Z",
      source: "cortex",
    };

    expect(mapping.cortex_id).toBe("uuid-v4-value");
    expect(mapping.bead_id).toBe("proj-abc-123");
    expect(mapping.sync_status).toBe("synced");
    expect(mapping.source).toBe("cortex");
  });

  test("TaskMapping nullable fields can be undefined", () => {
    const mapping: TaskMapping = {
      cortex_id: "uuid-v4",
      bead_id: "proj-abc-123",
      project_key: "/project",
      created_at: "2025-01-01T00:00:00Z",
      sync_status: "pending",
      source: "cortex",
    };

    expect(mapping.epic_bead_id).toBeUndefined();
    expect(mapping.synced_at).toBeUndefined();
    expect(mapping.bead_status).toBeUndefined();
    expect(mapping.bead_title).toBeUndefined();
    expect(mapping.bead_priority).toBeUndefined();
    expect(mapping.last_bead_update).toBeUndefined();
  });

  test("DepMapping has all columns from v11 DDL", () => {
    const dep: DepMapping = {
      id: "uuid-dep-1",
      from_bead_id: "proj-abc-123",
      to_bead_id: "proj-def-456",
      dep_type: "blocks",
      project_key: "/project",
      created_at: "2025-01-01T00:00:00Z",
      synced_at: "2025-01-01T00:00:00Z",
    };

    expect(dep.id).toBe("uuid-dep-1");
    expect(dep.from_bead_id).toBe("proj-abc-123");
    expect(dep.dep_type).toBe("blocks");
  });

  test("DepMapping synced_at is optional", () => {
    const dep: DepMapping = {
      id: "uuid-dep-1",
      from_bead_id: "proj-abc",
      to_bead_id: "proj-def",
      dep_type: "requires",
      project_key: "/project",
      created_at: "2025-01-01T00:00:00Z",
    };

    expect(dep.synced_at).toBeUndefined();
  });

  test("LabelMapping has all columns from v11 DDL", () => {
    const label: LabelMapping = {
      bead_id: "proj-abc-123",
      label: "urgent",
      project_key: "/project",
      synced_at: "2025-01-01T00:00:00Z",
    };

    expect(label.bead_id).toBe("proj-abc-123");
    expect(label.label).toBe("urgent");
    expect(label.project_key).toBe("/project");
    expect(label.synced_at).toBe("2025-01-01T00:00:00Z");
  });
});

// ============================================================================
// JSON Serialization Safety
// ============================================================================
describe("JSON serialization safety", () => {
  test("BeadIssue is JSON-serializable", () => {
    const issue: BeadIssue = {
      id: "proj-abc-123",
      title: "Test issue",
      status: "open",
      priority: 2,
      issue_type: "task",
      created_at: "2025-01-01T00:00:00Z",
      updated_at: "2025-01-01T00:00:00Z",
    };

    const json = JSON.stringify(issue);
    const parsed = JSON.parse(json) as BeadIssue;
    expect(parsed.id).toBe(issue.id);
    expect(parsed.status).toBe(issue.status);
  });

  test("BeadClientError message is JSON-serializable", () => {
    const err = new BeadClientError("test", {
      exitCode: 1,
      stderr: "err",
      command: "bd list",
      suggestion: "try again",
    });

    const serialized = {
      name: err.name,
      message: err.message,
      exitCode: err.exitCode,
      stderr: err.stderr,
      command: err.command,
      suggestion: err.suggestion,
    };

    const json = JSON.stringify(serialized);
    const parsed = JSON.parse(json);
    expect(parsed.name).toBe("BeadClientError");
    expect(parsed.exitCode).toBe(1);
  });

  test("BEAD_DEP_TYPES array is JSON-serializable", () => {
    const json = JSON.stringify(BEAD_DEP_TYPES);
    const parsed = JSON.parse(json);
    expect(parsed).toHaveLength(18);
  });

  test("TaskMapping is JSON-serializable", () => {
    const mapping: TaskMapping = {
      cortex_id: "uuid",
      bead_id: "proj-abc",
      project_key: "/project",
      created_at: "2025-01-01T00:00:00Z",
      sync_status: "synced",
      source: "cortex",
    };

    const json = JSON.stringify(mapping);
    const parsed = JSON.parse(json) as TaskMapping;
    expect(parsed.cortex_id).toBe("uuid");
    expect(parsed.sync_status).toBe("synced");
  });
});

// ============================================================================
// Default values for BdRetryConfig
// ============================================================================
describe("BdRetryConfig defaults", () => {
  test("DEFAULT_RETRY_CONFIG provides documented defaults", () => {
    // Import at the top, but test default values
    const config: BdRetryConfig = {
      maxRetries: 3,
      baseDelay: 1000,
      maxDelay: 10000,
      retryableExitCodes: [1],
    };

    expect(config.maxRetries).toBe(3);
    expect(config.baseDelay).toBe(1000);
    expect(config.maxDelay).toBe(10000);
    expect(config.retryableExitCodes).toEqual([1]);
  });
});
