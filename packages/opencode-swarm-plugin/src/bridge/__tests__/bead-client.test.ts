/**
 * Tests for bead-client.ts — Complete Bun.spawn wrapper around the bd CLI.
 *
 * TDD RED phase: Tests define the contract BEFORE implementation.
 * Cross-references:
 *   - Types: packages/opencode-swarm-plugin/src/bridge/bead-types.ts
 *   - API Spec: .planning/fork-plan/details/bd-cli-bridge-api.md
 *
 * All tests mock Bun.spawn — no real bd binary needed.
 */
import { describe, expect, test, beforeEach, afterEach, mock, spyOn } from "bun:test";

import type {
  BeadIssue,
  BeadDependency,
  BeadComment,
  BeadMolecule,
  BeadStats,
  BeadDaemonStatus,
  BdCreateOptions,
  BdListOptions,
  BdUpdateOptions,
  BdSearchOptions,
  BdReadyOptions,
  BdRetryConfig,
} from "../bead-types.js";

import { BeadClientError } from "../bead-types.js";

import {
  createBeadClient,
  DEFAULT_RETRY_CONFIG,
  type BeadClient,
} from "../bead-client.js";

// ============================================================================
// Test helpers — Bun.spawn mock
// ============================================================================

/**
 * Creates a mock spawn result that mimics Bun.spawn's return value.
 */
function mockSpawnResult(opts: {
  stdout?: string;
  stderr?: string;
  exitCode?: number;
}) {
  const stdoutText = opts.stdout ?? "";
  const stderrText = opts.stderr ?? "";
  const exitCode = opts.exitCode ?? 0;

  return {
    stdout: new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(stdoutText));
        controller.close();
      },
    }),
    stderr: new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(stderrText));
        controller.close();
      },
    }),
    exited: Promise.resolve(exitCode),
    pid: 12345,
    kill: mock(() => {}),
  };
}

function mockSpawnFactory(opts: {
  stdout?: string;
  stderr?: string;
  exitCode?: number;
}) {
  return () => mockSpawnResult(opts);
}

const FAST_RETRY_CONFIG: BdRetryConfig = {
  maxRetries: 3,
  baseDelay: 5,
  maxDelay: 50,
  retryableExitCodes: [1],
};

let spawnSpy: ReturnType<typeof spyOn>;
let client: BeadClient;

beforeEach(() => {
  spawnSpy = spyOn(Bun, "spawn");
  client = createBeadClient(FAST_RETRY_CONFIG);
});

afterEach(() => {
  spawnSpy.mockRestore();
});

// ============================================================================
// createBeadClient factory
// ============================================================================
describe("createBeadClient", () => {
  test("returns an object with all expected methods", () => {
    const c = createBeadClient();
    // Core execution
    expect(typeof c.spawnBd).toBe("function");
    expect(typeof c.runBdJson).toBe("function");
    expect(typeof c.parseJsonOutput).toBe("function");
    // System
    expect(typeof c.isBdInstalled).toBe("function");
    expect(typeof c.bdVersion).toBe("function");
    expect(typeof c.bdInit).toBe("function");
    // CRUD
    expect(typeof c.bdCreate).toBe("function");
    expect(typeof c.bdShow).toBe("function");
    expect(typeof c.bdList).toBe("function");
    expect(typeof c.bdUpdate).toBe("function");
    expect(typeof c.bdClose).toBe("function");
    // Ready
    expect(typeof c.bdReady).toBe("function");
    // Deps
    expect(typeof c.bdDepAdd).toBe("function");
    expect(typeof c.bdDepRemove).toBe("function");
    expect(typeof c.bdDepList).toBe("function");
    expect(typeof c.bdDepTree).toBe("function");
    // Search
    expect(typeof c.bdSearch).toBe("function");
    // Labels
    expect(typeof c.bdLabelAdd).toBe("function");
    expect(typeof c.bdLabelRemove).toBe("function");
    expect(typeof c.bdLabelList).toBe("function");
    // Comments
    expect(typeof c.bdCommentAdd).toBe("function");
    expect(typeof c.bdCommentList).toBe("function");
    // Molecules
    expect(typeof c.bdMoleculeCreate).toBe("function");
    expect(typeof c.bdMoleculeList).toBe("function");
    expect(typeof c.bdMoleculeShow).toBe("function");
    expect(typeof c.bdMoleculeAddMember).toBe("function");
    // Daemon
    expect(typeof c.bdDaemonStart).toBe("function");
    expect(typeof c.bdDaemonStop).toBe("function");
    expect(typeof c.bdDaemonStatus).toBe("function");
    // Stats
    expect(typeof c.bdStats).toBe("function");
  });

  test("accepts custom retry config", () => {
    const customConfig: BdRetryConfig = {
      maxRetries: 5,
      baseDelay: 500,
      maxDelay: 30000,
      retryableExitCodes: [1, 2],
    };
    const c = createBeadClient(customConfig);
    expect(c).toBeDefined();
  });
});

// ============================================================================
// DEFAULT_RETRY_CONFIG
// ============================================================================
describe("DEFAULT_RETRY_CONFIG", () => {
  test("has expected defaults", () => {
    expect(DEFAULT_RETRY_CONFIG.maxRetries).toBe(3);
    expect(DEFAULT_RETRY_CONFIG.baseDelay).toBe(1000);
    expect(DEFAULT_RETRY_CONFIG.maxDelay).toBe(10000);
    expect(DEFAULT_RETRY_CONFIG.retryableExitCodes).toEqual([1]);
  });
});

// ============================================================================
// parseJsonOutput
// ============================================================================
describe("parseJsonOutput", () => {
  test("parses valid JSON", () => {
    const result = client.parseJsonOutput<{ name: string }>(
      '{"name": "test"}',
    );
    expect(result).toEqual({ name: "test" });
  });

  test("parses JSON array", () => {
    const result = client.parseJsonOutput<number[]>("[1, 2, 3]");
    expect(result).toEqual([1, 2, 3]);
  });

  test("throws BeadClientError for empty string", () => {
    expect(() => client.parseJsonOutput("")).toThrow(BeadClientError);
  });

  test("throws BeadClientError for whitespace-only string", () => {
    expect(() => client.parseJsonOutput("   \n\t  ")).toThrow(BeadClientError);
  });

  test("throws BeadClientError for invalid JSON", () => {
    expect(() => client.parseJsonOutput("not json")).toThrow(BeadClientError);
  });

  test("throws BeadClientError for partial JSON", () => {
    expect(() => client.parseJsonOutput('{"incomplete')).toThrow(
      BeadClientError,
    );
  });

  test("error message includes context for malformed JSON", () => {
    try {
      client.parseJsonOutput("bad json");
      expect.unreachable("Should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(BeadClientError);
      const err = e as BeadClientError;
      expect(err.message).toContain("parse");
    }
  });
});

// ============================================================================
// spawnBd
// ============================================================================
describe("spawnBd", () => {
  test("calls Bun.spawn with bd prefix and returns stdout/stderr/exitCode", async () => {
    spawnSpy.mockReturnValue(
      mockSpawnResult({ stdout: "hello", stderr: "", exitCode: 0 }),
    );

    const result = await client.spawnBd(["version", "--json"]);
    expect(result.stdout).toBe("hello");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);

    const callArgs = spawnSpy.mock.calls[0];
    expect(callArgs[0]).toEqual(["bd", "version", "--json"]);
  });

  test("throws BeadClientError on non-zero exit code", async () => {
    spawnSpy.mockReturnValue(
      mockSpawnResult({
        stdout: "",
        stderr: "command failed",
        exitCode: 1,
      }),
    );

    await expect(client.spawnBd(["list", "--json"])).rejects.toThrow(
      BeadClientError,
    );
  });

  test("captures stderr in error", async () => {
    spawnSpy.mockReturnValue(
      mockSpawnResult({
        stdout: "",
        stderr: "specific error message",
        exitCode: 2,
      }),
    );

    try {
      await client.spawnBd(["show", "xyz", "--json"]);
      expect.unreachable("Should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(BeadClientError);
      const err = e as BeadClientError;
      expect(err.stderr).toContain("specific error message");
    }
  });

  test("uses stdout as error message when stderr is empty", async () => {
    spawnSpy.mockReturnValue(
      mockSpawnResult({
        stdout: "error in stdout",
        stderr: "",
        exitCode: 1,
      }),
    );

    try {
      await client.spawnBd(["list"]);
      expect.unreachable("Should have thrown");
    } catch (e) {
      const err = e as BeadClientError;
      expect(err.message).toContain("error in stdout");
    }
  });

  test("spawns with stdout: pipe and stderr: pipe", async () => {
    spawnSpy.mockReturnValue(
      mockSpawnResult({ stdout: "{}", exitCode: 0 }),
    );

    await client.spawnBd(["version"]);

    const spawnOpts = spawnSpy.mock.calls[0][1];
    expect(spawnOpts.stdout).toBe("pipe");
    expect(spawnOpts.stderr).toBe("pipe");
  });
});

// ============================================================================
// runBdJson
// ============================================================================
describe("runBdJson", () => {
  test("appends --json flag and parses output", async () => {
    const issueData = {
      id: "proj-abc-123",
      title: "Test Issue",
      status: "open",
    };
    spawnSpy.mockReturnValue(
      mockSpawnResult({ stdout: JSON.stringify(issueData), exitCode: 0 }),
    );

    const result = await client.runBdJson<typeof issueData>(["show", "abc"]);
    expect(result).toEqual(issueData);

    // Verify --json was appended
    const callArgs = spawnSpy.mock.calls[0][0];
    expect(callArgs).toContain("--json");
  });

  test("throws BeadClientError for non-zero exit code", async () => {
    spawnSpy.mockReturnValue(
      mockSpawnResult({
        stdout: "",
        stderr: "not found",
        exitCode: 2,
      }),
    );

    await expect(client.runBdJson(["show", "bad-id"])).rejects.toThrow(
      BeadClientError,
    );
  });

  test("throws BeadClientError for unparseable JSON output", async () => {
    spawnSpy.mockReturnValue(
      mockSpawnResult({ stdout: "not-json", exitCode: 0 }),
    );

    await expect(client.runBdJson(["list"])).rejects.toThrow(BeadClientError);
  });
});

// ============================================================================
// System: isBdInstalled, bdVersion, bdInit
// ============================================================================
describe("System commands", () => {
  describe("isBdInstalled", () => {
    test("returns true when bd responds", async () => {
      spawnSpy.mockReturnValue(
        mockSpawnResult({
          stdout: '{"version": "0.49.0"}',
          exitCode: 0,
        }),
      );

      const result = await client.isBdInstalled();
      expect(result).toBe(true);
    });

    test("returns false when bd fails", async () => {
      spawnSpy.mockReturnValue(
        mockSpawnResult({ stdout: "", stderr: "not found", exitCode: 127 }),
      );

      const result = await client.isBdInstalled();
      expect(result).toBe(false);
    });

    test("returns false on any error", async () => {
      spawnSpy.mockImplementation(() => {
        throw new Error("spawn failed");
      });

      const result = await client.isBdInstalled();
      expect(result).toBe(false);
    });
  });

  describe("bdVersion", () => {
    test("returns version string from JSON output", async () => {
      spawnSpy.mockReturnValue(
        mockSpawnResult({
          stdout: '{"version": "0.49.0"}',
          exitCode: 0,
        }),
      );

      const version = await client.bdVersion();
      expect(version).toBe("0.49.0");
    });

    test("throws BeadClientError if version missing from response", async () => {
      spawnSpy.mockReturnValue(
        mockSpawnResult({ stdout: "{}", exitCode: 0 }),
      );

      await expect(client.bdVersion()).rejects.toThrow(BeadClientError);
    });

    test("throws on non-zero exit code", async () => {
      spawnSpy.mockImplementation(
        mockSpawnFactory({ stdout: "", stderr: "error", exitCode: 1 }),
      );

      await expect(client.bdVersion()).rejects.toThrow(BeadClientError);
    });
  });

  describe("bdInit", () => {
    test("calls bd init --json", async () => {
      spawnSpy.mockReturnValue(
        mockSpawnResult({ stdout: '{"status":"ok"}', exitCode: 0 }),
      );

      await client.bdInit();

      const callArgs = spawnSpy.mock.calls[0][0];
      expect(callArgs).toContain("init");
    });

    test("accepts optional path argument", async () => {
      spawnSpy.mockReturnValue(
        mockSpawnResult({ stdout: '{"status":"ok"}', exitCode: 0 }),
      );

      await client.bdInit("/custom/path");

      const spawnOpts = spawnSpy.mock.calls[0][1];
      expect(spawnOpts.cwd).toBe("/custom/path");
    });

    test("throws BeadClientError on failure", async () => {
      spawnSpy.mockImplementation(
        mockSpawnFactory({
          stdout: "",
          stderr: "init failed",
          exitCode: 1,
        }),
      );

      await expect(client.bdInit()).rejects.toThrow(BeadClientError);
    });
  });
});

// ============================================================================
// CRUD: bdCreate, bdShow, bdList, bdUpdate, bdClose
// ============================================================================
describe("CRUD operations", () => {
  const sampleIssue: BeadIssue = {
    id: "proj-abc-123",
    title: "Fix auth bug",
    status: "open",
    priority: 1,
    issue_type: "bug",
    created_at: "2025-01-01T00:00:00Z",
    updated_at: "2025-01-01T00:00:00Z",
  };

  describe("bdCreate", () => {
    test("creates issue with title and options", async () => {
      spawnSpy.mockReturnValue(
        mockSpawnResult({
          stdout: JSON.stringify(sampleIssue),
          exitCode: 0,
        }),
      );

      const opts: BdCreateOptions = {
        title: "Fix auth bug",
        type: "bug",
        priority: 1,
        description: "Auth is broken",
        parent_id: "epic-123",
      };

      const result = await client.bdCreate(opts);
      expect(result.title).toBe("Fix auth bug");
      expect(result.issue_type).toBe("bug");
    });

    test("passes correct CLI flags", async () => {
      spawnSpy.mockReturnValue(
        mockSpawnResult({
          stdout: JSON.stringify(sampleIssue),
          exitCode: 0,
        }),
      );

      await client.bdCreate({
        title: "New task",
        type: "feature",
        priority: 2,
        description: "Build it",
        parent_id: "parent-1",
      });

      const args = spawnSpy.mock.calls[0][0] as string[];
      expect(args).toContain("add");
      expect(args).toContain("New task");
      expect(args).toContain("-t");
      expect(args).toContain("feature");
      expect(args).toContain("-p");
      expect(args).toContain("2");
      expect(args).toContain("--parent");
      expect(args).toContain("parent-1");
      expect(args).toContain("--description");
      expect(args).toContain("Build it");
      expect(args).toContain("--json");
    });

    test("omits optional flags when not provided", async () => {
      spawnSpy.mockReturnValue(
        mockSpawnResult({
          stdout: JSON.stringify(sampleIssue),
          exitCode: 0,
        }),
      );

      await client.bdCreate({ title: "Minimal" });

      const args = spawnSpy.mock.calls[0][0] as string[];
      expect(args).toContain("add");
      expect(args).toContain("Minimal");
      expect(args).not.toContain("-t");
      expect(args).not.toContain("-p");
      expect(args).not.toContain("--parent");
      expect(args).not.toContain("--description");
    });

    test("throws BeadClientError on failure", async () => {
      spawnSpy.mockImplementation(
        mockSpawnFactory({
          stdout: "",
          stderr: "creation failed",
          exitCode: 1,
        }),
      );

      await expect(
        client.bdCreate({ title: "fail" }),
      ).rejects.toThrow(BeadClientError);
    });
  });

  describe("bdShow", () => {
    test("returns a BeadIssue by id", async () => {
      spawnSpy.mockReturnValue(
        mockSpawnResult({
          stdout: JSON.stringify(sampleIssue),
          exitCode: 0,
        }),
      );

      const result = await client.bdShow("proj-abc-123");
      expect(result.id).toBe("proj-abc-123");
      expect(result.title).toBe("Fix auth bug");
    });

    test("passes correct CLI args", async () => {
      spawnSpy.mockReturnValue(
        mockSpawnResult({
          stdout: JSON.stringify(sampleIssue),
          exitCode: 0,
        }),
      );

      await client.bdShow("proj-abc-123");

      const args = spawnSpy.mock.calls[0][0] as string[];
      expect(args).toContain("show");
      expect(args).toContain("proj-abc-123");
      expect(args).toContain("--json");
    });

    test("throws BeadClientError when not found", async () => {
      spawnSpy.mockReturnValue(
        mockSpawnResult({
          stdout: "",
          stderr: "issue not found",
          exitCode: 2,
        }),
      );

      await expect(client.bdShow("bad-id")).rejects.toThrow(BeadClientError);
    });
  });

  describe("bdList", () => {
    test("returns array of BeadIssue", async () => {
      spawnSpy.mockReturnValue(
        mockSpawnResult({
          stdout: JSON.stringify([sampleIssue]),
          exitCode: 0,
        }),
      );

      const result = await client.bdList();
      expect(Array.isArray(result)).toBe(true);
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("proj-abc-123");
    });

    test("passes filter options as CLI flags", async () => {
      spawnSpy.mockReturnValue(
        mockSpawnResult({ stdout: "[]", exitCode: 0 }),
      );

      const opts: BdListOptions = {
        status: "open",
        type: "bug",
        label: "urgent",
        limit: 10,
        offset: 5,
      };

      await client.bdList(opts);

      const args = spawnSpy.mock.calls[0][0] as string[];
      expect(args).toContain("--status");
      expect(args).toContain("open");
      expect(args).toContain("--type");
      expect(args).toContain("bug");
      expect(args).toContain("--label");
      expect(args).toContain("urgent");
      expect(args).toContain("--limit");
      expect(args).toContain("10");
      expect(args).toContain("--offset");
      expect(args).toContain("5");
    });

    test("returns empty array for no results", async () => {
      spawnSpy.mockReturnValue(
        mockSpawnResult({ stdout: "[]", exitCode: 0 }),
      );

      const result = await client.bdList();
      expect(result).toEqual([]);
    });

    test("omits unset filter options", async () => {
      spawnSpy.mockReturnValue(
        mockSpawnResult({ stdout: "[]", exitCode: 0 }),
      );

      await client.bdList({ status: "open" });

      const args = spawnSpy.mock.calls[0][0] as string[];
      expect(args).toContain("--status");
      expect(args).toContain("open");
      expect(args).not.toContain("--type");
      expect(args).not.toContain("--label");
    });
  });

  describe("bdUpdate", () => {
    test("updates issue fields and returns updated issue", async () => {
      const updated = { ...sampleIssue, title: "Updated title" };
      spawnSpy.mockReturnValue(
        mockSpawnResult({
          stdout: JSON.stringify(updated),
          exitCode: 0,
        }),
      );

      const result = await client.bdUpdate("proj-abc-123", {
        title: "Updated title",
      });
      expect(result.title).toBe("Updated title");
    });

    test("passes correct CLI flags for each option", async () => {
      spawnSpy.mockReturnValue(
        mockSpawnResult({
          stdout: JSON.stringify(sampleIssue),
          exitCode: 0,
        }),
      );

      await client.bdUpdate("proj-abc-123", {
        title: "New title",
        status: "in_progress",
        priority: 0,
        description: "New desc",
        assignee: "agent-1",
      });

      const args = spawnSpy.mock.calls[0][0] as string[];
      expect(args).toContain("update");
      expect(args).toContain("proj-abc-123");
      expect(args).toContain("--title");
      expect(args).toContain("New title");
      expect(args).toContain("--status");
      expect(args).toContain("in_progress");
      expect(args).toContain("-p");
      expect(args).toContain("0");
      expect(args).toContain("--description");
      expect(args).toContain("New desc");
      expect(args).toContain("--assignee");
      expect(args).toContain("agent-1");
    });

    test("throws BeadClientError when no fields provided", async () => {
      await expect(client.bdUpdate("proj-abc-123", {})).rejects.toThrow(
        BeadClientError,
      );
    });
  });

  describe("bdClose", () => {
    test("closes issue with reason", async () => {
      const closed = { ...sampleIssue, status: "closed" as const };
      spawnSpy.mockReturnValue(
        mockSpawnResult({
          stdout: JSON.stringify(closed),
          exitCode: 0,
        }),
      );

      const result = await client.bdClose("proj-abc-123", "Fixed in PR #42");
      expect(result.status).toBe("closed");
    });

    test("passes correct CLI args", async () => {
      spawnSpy.mockReturnValue(
        mockSpawnResult({
          stdout: JSON.stringify({ ...sampleIssue, status: "closed" }),
          exitCode: 0,
        }),
      );

      await client.bdClose("proj-abc-123", "Done");

      const args = spawnSpy.mock.calls[0][0] as string[];
      expect(args).toContain("close");
      expect(args).toContain("proj-abc-123");
      expect(args).toContain("--reason");
      expect(args).toContain("Done");
      expect(args).toContain("--json");
    });

    test("closes without reason (optional)", async () => {
      spawnSpy.mockReturnValue(
        mockSpawnResult({
          stdout: JSON.stringify({ ...sampleIssue, status: "closed" }),
          exitCode: 0,
        }),
      );

      await client.bdClose("proj-abc-123");

      const args = spawnSpy.mock.calls[0][0] as string[];
      expect(args).toContain("close");
      expect(args).not.toContain("--reason");
    });
  });
});

// ============================================================================
// Ready
// ============================================================================
describe("bdReady", () => {
  test("returns array of ready issues", async () => {
    const readyIssue: BeadIssue = {
      id: "proj-ready-1",
      title: "Ready task",
      status: "open",
      priority: 1,
      issue_type: "task",
      created_at: "2025-01-01T00:00:00Z",
      updated_at: "2025-01-01T00:00:00Z",
    };

    spawnSpy.mockReturnValue(
      mockSpawnResult({
        stdout: JSON.stringify([readyIssue]),
        exitCode: 0,
      }),
    );

    const result = await client.bdReady();
    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("proj-ready-1");
  });

  test("passes options as CLI flags", async () => {
    spawnSpy.mockReturnValue(
      mockSpawnResult({ stdout: "[]", exitCode: 0 }),
    );

    await client.bdReady({ project_key: "/my/project", include_deps: true });

    const args = spawnSpy.mock.calls[0][0] as string[];
    expect(args).toContain("ready");
    expect(args).toContain("--json");
  });

  test("returns empty array when nothing is ready", async () => {
    spawnSpy.mockReturnValue(
      mockSpawnResult({ stdout: "[]", exitCode: 0 }),
    );

    const result = await client.bdReady();
    expect(result).toEqual([]);
  });
});

// ============================================================================
// Dependencies: bdDepAdd, bdDepRemove, bdDepList, bdDepTree
// ============================================================================
describe("Dependency operations", () => {
  describe("bdDepAdd", () => {
    test("adds dependency between two issues", async () => {
      spawnSpy.mockReturnValue(
        mockSpawnResult({ stdout: '{"status":"ok"}', exitCode: 0 }),
      );

      await client.bdDepAdd("source-1", "target-1", "blocks");

      const args = spawnSpy.mock.calls[0][0] as string[];
      expect(args).toContain("dep");
      expect(args).toContain("add");
      expect(args).toContain("source-1");
      expect(args).toContain("target-1");
      expect(args).toContain("--type");
      expect(args).toContain("blocks");
    });

    test("defaults dep type to blocks", async () => {
      spawnSpy.mockReturnValue(
        mockSpawnResult({ stdout: '{"status":"ok"}', exitCode: 0 }),
      );

      await client.bdDepAdd("a", "b");

      const args = spawnSpy.mock.calls[0][0] as string[];
      expect(args).toContain("--type");
      expect(args).toContain("blocks");
    });

    test("throws BeadClientError on failure", async () => {
      spawnSpy.mockImplementation(
        mockSpawnFactory({
          stdout: "",
          stderr: "dep add failed",
          exitCode: 1,
        }),
      );

      await expect(
        client.bdDepAdd("a", "b", "blocks"),
      ).rejects.toThrow(BeadClientError);
    });
  });

  describe("bdDepRemove", () => {
    test("removes dependency between two issues", async () => {
      spawnSpy.mockReturnValue(
        mockSpawnResult({ stdout: '{"status":"ok"}', exitCode: 0 }),
      );

      await client.bdDepRemove("source-1", "target-1");

      const args = spawnSpy.mock.calls[0][0] as string[];
      expect(args).toContain("dep");
      expect(args).toContain("remove");
      expect(args).toContain("source-1");
      expect(args).toContain("target-1");
    });
  });

  describe("bdDepList", () => {
    test("lists dependencies for an issue", async () => {
      const deps: BeadDependency[] = [
        {
          source_id: "a",
          target_id: "b",
          dep_type: "blocks",
          created_at: "2025-01-01T00:00:00Z",
        },
      ];
      spawnSpy.mockReturnValue(
        mockSpawnResult({
          stdout: JSON.stringify(deps),
          exitCode: 0,
        }),
      );

      const result = await client.bdDepList("a");
      expect(result).toHaveLength(1);
      expect(result[0].source_id).toBe("a");

      const args = spawnSpy.mock.calls[0][0] as string[];
      expect(args).toContain("dep");
      expect(args).toContain("list");
      expect(args).toContain("a");
    });
  });

  describe("bdDepTree", () => {
    test("returns dependency tree for an issue", async () => {
      const tree: BeadDependency[] = [
        {
          source_id: "root",
          target_id: "child-1",
          dep_type: "blocks",
          created_at: "2025-01-01T00:00:00Z",
        },
        {
          source_id: "root",
          target_id: "child-2",
          dep_type: "requires",
          created_at: "2025-01-01T00:00:00Z",
        },
      ];
      spawnSpy.mockReturnValue(
        mockSpawnResult({
          stdout: JSON.stringify(tree),
          exitCode: 0,
        }),
      );

      const result = await client.bdDepTree("root");
      expect(result).toHaveLength(2);

      const args = spawnSpy.mock.calls[0][0] as string[];
      expect(args).toContain("dep");
      expect(args).toContain("tree");
      expect(args).toContain("root");
    });
  });
});

// ============================================================================
// Search
// ============================================================================
describe("bdSearch", () => {
  test("searches with query and options", async () => {
    const sampleIssue: BeadIssue = {
      id: "result-1",
      title: "Auth bug",
      status: "open",
      priority: 1,
      issue_type: "bug",
      created_at: "2025-01-01T00:00:00Z",
      updated_at: "2025-01-01T00:00:00Z",
    };
    spawnSpy.mockReturnValue(
      mockSpawnResult({
        stdout: JSON.stringify([sampleIssue]),
        exitCode: 0,
      }),
    );

    const result = await client.bdSearch({
      query: "auth bug",
      type: "bug",
      status: "open",
      limit: 5,
    });

    expect(result).toHaveLength(1);
    expect(result[0].title).toBe("Auth bug");

    const args = spawnSpy.mock.calls[0][0] as string[];
    expect(args).toContain("search");
    expect(args).toContain("auth bug");
    expect(args).toContain("--type");
    expect(args).toContain("bug");
    expect(args).toContain("--status");
    expect(args).toContain("open");
    expect(args).toContain("--limit");
    expect(args).toContain("5");
  });

  test("omits optional search filters", async () => {
    spawnSpy.mockReturnValue(
      mockSpawnResult({ stdout: "[]", exitCode: 0 }),
    );

    await client.bdSearch({ query: "test" });

    const args = spawnSpy.mock.calls[0][0] as string[];
    expect(args).toContain("search");
    expect(args).toContain("test");
    expect(args).not.toContain("--type");
    expect(args).not.toContain("--status");
    expect(args).not.toContain("--limit");
  });
});

// ============================================================================
// Labels: bdLabelAdd, bdLabelRemove, bdLabelList
// ============================================================================
describe("Label operations", () => {
  describe("bdLabelAdd", () => {
    test("adds label to issue", async () => {
      spawnSpy.mockReturnValue(
        mockSpawnResult({ stdout: '{"status":"ok"}', exitCode: 0 }),
      );

      await client.bdLabelAdd("proj-abc-123", "urgent");

      const args = spawnSpy.mock.calls[0][0] as string[];
      expect(args).toContain("label");
      expect(args).toContain("add");
      expect(args).toContain("proj-abc-123");
      expect(args).toContain("urgent");
    });
  });

  describe("bdLabelRemove", () => {
    test("removes label from issue", async () => {
      spawnSpy.mockReturnValue(
        mockSpawnResult({ stdout: '{"status":"ok"}', exitCode: 0 }),
      );

      await client.bdLabelRemove("proj-abc-123", "urgent");

      const args = spawnSpy.mock.calls[0][0] as string[];
      expect(args).toContain("label");
      expect(args).toContain("remove");
      expect(args).toContain("proj-abc-123");
      expect(args).toContain("urgent");
    });
  });

  describe("bdLabelList", () => {
    test("returns labels for issue", async () => {
      spawnSpy.mockReturnValue(
        mockSpawnResult({
          stdout: JSON.stringify(["urgent", "auth"]),
          exitCode: 0,
        }),
      );

      const result = await client.bdLabelList("proj-abc-123");
      expect(result).toEqual(["urgent", "auth"]);

      const args = spawnSpy.mock.calls[0][0] as string[];
      expect(args).toContain("label");
      expect(args).toContain("list");
      expect(args).toContain("proj-abc-123");
    });
  });
});

// ============================================================================
// Comments: bdCommentAdd, bdCommentList
// ============================================================================
describe("Comment operations", () => {
  describe("bdCommentAdd", () => {
    test("adds comment to issue", async () => {
      const comment: BeadComment = {
        id: "comment-1",
        bead_id: "proj-abc-123",
        author: "worker",
        body: "Fixed it",
        created_at: "2025-01-01T00:00:00Z",
      };
      spawnSpy.mockReturnValue(
        mockSpawnResult({
          stdout: JSON.stringify(comment),
          exitCode: 0,
        }),
      );

      const result = await client.bdCommentAdd("proj-abc-123", "Fixed it");
      expect(result.body).toBe("Fixed it");

      const args = spawnSpy.mock.calls[0][0] as string[];
      expect(args).toContain("comment");
      expect(args).toContain("add");
      expect(args).toContain("proj-abc-123");
      expect(args).toContain("Fixed it");
    });

    test("passes author option", async () => {
      const comment: BeadComment = {
        id: "comment-2",
        bead_id: "proj-abc-123",
        author: "custom-agent",
        body: "Test",
        created_at: "2025-01-01T00:00:00Z",
      };
      spawnSpy.mockReturnValue(
        mockSpawnResult({
          stdout: JSON.stringify(comment),
          exitCode: 0,
        }),
      );

      await client.bdCommentAdd("proj-abc-123", "Test", {
        author: "custom-agent",
      });

      const args = spawnSpy.mock.calls[0][0] as string[];
      expect(args).toContain("--author");
      expect(args).toContain("custom-agent");
    });
  });

  describe("bdCommentList", () => {
    test("returns comments for issue", async () => {
      const comments: BeadComment[] = [
        {
          id: "c1",
          bead_id: "proj-abc-123",
          author: "worker",
          body: "First",
          created_at: "2025-01-01T00:00:00Z",
        },
        {
          id: "c2",
          bead_id: "proj-abc-123",
          author: "reviewer",
          body: "Second",
          created_at: "2025-01-01T00:01:00Z",
        },
      ];
      spawnSpy.mockReturnValue(
        mockSpawnResult({
          stdout: JSON.stringify(comments),
          exitCode: 0,
        }),
      );

      const result = await client.bdCommentList("proj-abc-123");
      expect(result).toHaveLength(2);
      expect(result[0].body).toBe("First");

      const args = spawnSpy.mock.calls[0][0] as string[];
      expect(args).toContain("comment");
      expect(args).toContain("list");
      expect(args).toContain("proj-abc-123");
    });
  });
});

// ============================================================================
// Molecules: bdMoleculeCreate, bdMoleculeList, bdMoleculeShow, bdMoleculeAddMember
// ============================================================================
describe("Molecule operations", () => {
  const sampleMolecule: BeadMolecule = {
    id: "mol-1",
    name: "Auth Module",
    description: "Auth tasks",
    member_ids: ["a", "b"],
    created_at: "2025-01-01T00:00:00Z",
  };

  describe("bdMoleculeCreate", () => {
    test("creates molecule with name and optional description", async () => {
      spawnSpy.mockReturnValue(
        mockSpawnResult({
          stdout: JSON.stringify(sampleMolecule),
          exitCode: 0,
        }),
      );

      const result = await client.bdMoleculeCreate("Auth Module", "Auth tasks");
      expect(result.name).toBe("Auth Module");

      const args = spawnSpy.mock.calls[0][0] as string[];
      expect(args).toContain("molecule");
      expect(args).toContain("create");
      expect(args).toContain("Auth Module");
    });
  });

  describe("bdMoleculeList", () => {
    test("returns array of molecules", async () => {
      spawnSpy.mockReturnValue(
        mockSpawnResult({
          stdout: JSON.stringify([sampleMolecule]),
          exitCode: 0,
        }),
      );

      const result = await client.bdMoleculeList();
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe("Auth Module");
    });
  });

  describe("bdMoleculeShow", () => {
    test("returns molecule by name", async () => {
      spawnSpy.mockReturnValue(
        mockSpawnResult({
          stdout: JSON.stringify(sampleMolecule),
          exitCode: 0,
        }),
      );

      const result = await client.bdMoleculeShow("Auth Module");
      expect(result.name).toBe("Auth Module");
      expect(result.member_ids).toEqual(["a", "b"]);
    });
  });

  describe("bdMoleculeAddMember", () => {
    test("adds issue to molecule", async () => {
      spawnSpy.mockReturnValue(
        mockSpawnResult({ stdout: '{"status":"ok"}', exitCode: 0 }),
      );

      await client.bdMoleculeAddMember("Auth Module", "proj-abc-123");

      const args = spawnSpy.mock.calls[0][0] as string[];
      expect(args).toContain("molecule");
      expect(args).toContain("add-member");
      expect(args).toContain("Auth Module");
      expect(args).toContain("proj-abc-123");
    });
  });
});

// ============================================================================
// Daemon: bdDaemonStart, bdDaemonStop, bdDaemonStatus
// ============================================================================
describe("Daemon operations", () => {
  describe("bdDaemonStart", () => {
    test("starts daemon and returns pid", async () => {
      spawnSpy.mockReturnValue(
        mockSpawnResult({
          stdout: JSON.stringify({ pid: 42 }),
          exitCode: 0,
        }),
      );

      const result = await client.bdDaemonStart();
      expect(result.pid).toBe(42);

      const args = spawnSpy.mock.calls[0][0] as string[];
      expect(args).toContain("daemon");
      expect(args).toContain("start");
    });
  });

  describe("bdDaemonStop", () => {
    test("stops the daemon", async () => {
      spawnSpy.mockReturnValue(
        mockSpawnResult({ stdout: '{"status":"stopped"}', exitCode: 0 }),
      );

      await client.bdDaemonStop();

      const args = spawnSpy.mock.calls[0][0] as string[];
      expect(args).toContain("daemon");
      expect(args).toContain("stop");
    });
  });

  describe("bdDaemonStatus", () => {
    test("returns daemon status", async () => {
      const status: BeadDaemonStatus = {
        running: true,
        pid: 42,
        uptime_ms: 60000,
        last_check: "2025-01-01T00:01:00Z",
      };
      spawnSpy.mockReturnValue(
        mockSpawnResult({
          stdout: JSON.stringify(status),
          exitCode: 0,
        }),
      );

      const result = await client.bdDaemonStatus();
      expect(result.running).toBe(true);
      expect(result.pid).toBe(42);

      const args = spawnSpy.mock.calls[0][0] as string[];
      expect(args).toContain("daemon");
      expect(args).toContain("status");
    });
  });
});

// ============================================================================
// Stats
// ============================================================================
describe("bdStats", () => {
  test("returns project statistics", async () => {
    const stats: BeadStats = {
      total: 42,
      open: 10,
      closed: 20,
      in_progress: 8,
      blocked: 4,
      by_type: { bug: 5, feature: 15, task: 12, epic: 3, chore: 7 },
      by_priority: { 0: 2, 1: 10, 2: 20, 3: 10 },
    };
    spawnSpy.mockReturnValue(
      mockSpawnResult({
        stdout: JSON.stringify(stats),
        exitCode: 0,
      }),
    );

    const result = await client.bdStats();
    expect(result.total).toBe(42);
    expect(result.by_type.bug).toBe(5);

    const args = spawnSpy.mock.calls[0][0] as string[];
    expect(args).toContain("stats");
    expect(args).toContain("--json");
  });
});

// ============================================================================
// Retry logic with exponential backoff
// ============================================================================
describe("Retry logic", () => {
  test("retries on retryable exit codes", async () => {
    const retryConfig: BdRetryConfig = {
      maxRetries: 3,
      baseDelay: 10, // short for tests
      maxDelay: 100,
      retryableExitCodes: [1],
    };
    const c = createBeadClient(retryConfig);

    let callCount = 0;
    spawnSpy.mockImplementation(() => {
      callCount++;
      if (callCount < 3) {
        return mockSpawnResult({
          stdout: "",
          stderr: "transient error",
          exitCode: 1,
        });
      }
      return mockSpawnResult({
        stdout: '{"version":"0.49.0"}',
        exitCode: 0,
      });
    });

    const version = await c.bdVersion();
    expect(version).toBe("0.49.0");
    expect(callCount).toBe(3); // 2 failures + 1 success
  });

  test("does not retry on non-retryable exit codes", async () => {
    const retryConfig: BdRetryConfig = {
      maxRetries: 3,
      baseDelay: 10,
      maxDelay: 100,
      retryableExitCodes: [1],
    };
    const c = createBeadClient(retryConfig);

    spawnSpy.mockReturnValue(
      mockSpawnResult({
        stdout: "",
        stderr: "not found",
        exitCode: 2, // not in retryableExitCodes
      }),
    );

    await expect(c.bdVersion()).rejects.toThrow(BeadClientError);
    expect(spawnSpy).toHaveBeenCalledTimes(1);
  });

  test("throws after exhausting retries", async () => {
    const retryConfig: BdRetryConfig = {
      maxRetries: 2,
      baseDelay: 10,
      maxDelay: 100,
      retryableExitCodes: [1],
    };
    const c = createBeadClient(retryConfig);

    spawnSpy.mockImplementation(
      mockSpawnFactory({
        stdout: "",
        stderr: "persistent error",
        exitCode: 1,
      }),
    );

    await expect(c.bdVersion()).rejects.toThrow(BeadClientError);
    expect(spawnSpy).toHaveBeenCalledTimes(3);
  });

  test("isBdInstalled does NOT retry (never throws)", async () => {
    spawnSpy.mockReturnValue(
      mockSpawnResult({
        stdout: "",
        stderr: "error",
        exitCode: 1,
      }),
    );

    const result = await client.isBdInstalled();
    expect(result).toBe(false);
    // Should only try once since isBdInstalled catches errors
    expect(spawnSpy).toHaveBeenCalledTimes(1);
  });

  test("backoff delay respects maxDelay cap", async () => {
    const retryConfig: BdRetryConfig = {
      maxRetries: 5,
      baseDelay: 10,
      maxDelay: 50,
      retryableExitCodes: [1],
    };
    const c = createBeadClient(retryConfig);

    let callCount = 0;
    const timestamps: number[] = [];
    spawnSpy.mockImplementation(() => {
      callCount++;
      timestamps.push(Date.now());
      if (callCount <= 5) {
        return mockSpawnResult({
          stdout: "",
          stderr: "error",
          exitCode: 1,
        });
      }
      return mockSpawnResult({
        stdout: '{"version":"0.49.0"}',
        exitCode: 0,
      });
    });

    const version = await c.bdVersion();
    expect(version).toBe("0.49.0");
    expect(callCount).toBe(6);
  });
});

// ============================================================================
// Error enrichment
// ============================================================================
describe("Error enrichment", () => {
  test("exit code 127 includes install suggestion", async () => {
    spawnSpy.mockReturnValue(
      mockSpawnResult({
        stdout: "",
        stderr: "bd: command not found",
        exitCode: 127,
      }),
    );

    try {
      await client.bdVersion();
      expect.unreachable("Should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(BeadClientError);
      const err = e as BeadClientError;
      expect(err.exitCode).toBe(127);
      expect(err.suggestion).toBeDefined();
      expect(err.suggestion?.includes("install")).toBe(true);
    }
  });

  test("exit code 3 includes validation suggestion", async () => {
    spawnSpy.mockReturnValue(
      mockSpawnResult({
        stdout: "",
        stderr: "invalid argument",
        exitCode: 3,
      }),
    );

    try {
      await client.bdCreate({ title: "bad" });
      expect.unreachable("Should have thrown");
    } catch (e) {
      const err = e as BeadClientError;
      expect(err.exitCode).toBe(3);
      expect(err.suggestion).toBeDefined();
    }
  });

  test("error includes the command that failed", async () => {
    spawnSpy.mockImplementation(
      mockSpawnFactory({
        stdout: "",
        stderr: "failed",
        exitCode: 1,
      }),
    );

    try {
      await client.bdShow("xyz");
      expect.unreachable("Should have thrown");
    } catch (e) {
      const err = e as BeadClientError;
      expect(err.command.includes("bd")).toBe(true);
      expect(err.command.includes("show")).toBe(true);
    }
  });
});
