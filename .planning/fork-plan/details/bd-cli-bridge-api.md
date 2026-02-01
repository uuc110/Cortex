# bd CLI Bridge API — Complete TypeScript Wrapper Specification

> Full API for every `bd` CLI command wrapped by `src/bridge/bead-client.ts`.
> Existing functions are marked ✅. Planned additions for the fork are marked 🔜.

---

## Table of Contents

1. [Core Architecture](#1-core-architecture)
2. [Existing API (✅ Built)](#2-existing-api--built)
3. [Planned API (🔜 Fork)](#3-planned-api--fork)
4. [Error Handling](#4-error-handling)
5. [Caching Strategy](#5-caching-strategy)
6. [Type Definitions](#6-type-definitions)

---

## 1. Core Architecture

### Shell Execution Layer

All `bd` commands are executed via `Bun.spawn()` in `src/bridge/bead-client.ts`:

```typescript
// The core execution function (already built)
async function spawnBd(
  args: string[],
  options?: { cwd?: string; allowFailure?: boolean }
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const cwd = options?.cwd ?? resolveProjectRoot();
  const processHandle = Bun.spawn(["bd", ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env },
  });

  const [exitCode, stdout, stderr] = await Promise.all([
    processHandle.exited,
    processHandle.stdout ? new Response(processHandle.stdout).text() : "",
    processHandle.stderr ? new Response(processHandle.stderr).text() : "",
  ]);

  if (!options?.allowFailure && exitCode !== 0) {
    throw new BeadClientError(stderr.trim() || stdout.trim() || `exit ${exitCode}`);
  }
  return { exitCode, stdout, stderr };
}
```

### JSON Parsing Layer

```typescript
// All bd commands use --json flag, output parsed via:
async function runBdJson<T>(args: string[], context: string): Promise<T> {
  ensureBdInstalled();
  const { stdout } = await spawnBd([...args, "--json"]);
  return parseJsonOutput<T>(stdout, context);
}
```

### Project Root Resolution

```typescript
// Priority: CORTEX_PROJECT_PATH env var > module-relative default
function resolveProjectRoot(): string {
  const override = process.env.CORTEX_PROJECT_PATH;
  if (override?.trim().length) return resolve(override);
  return DEFAULT_PROJECT_ROOT; // resolve(MODULE_DIR, "..", "..", "..")
}
```

---

## 2. Existing API (✅ Built)

### `isBdInstalled()`

Check if `bd` binary is available and functional.

```typescript
export async function isBdInstalled(): Promise<boolean>;
```

| Property | Value |
|---|---|
| CLI Command | `bd version --json` |
| Returns | `true` if bd is installed and responds |
| Throws | Never (catches all errors) |

---

### `bdVersion()`

Get the installed `bd` version string.

```typescript
export async function bdVersion(): Promise<string>;
```

| Property | Value |
|---|---|
| CLI Command | `bd version --json` |
| Returns | Version string, e.g. `"0.49.0"` |
| Throws | `BeadClientError` if version missing |
| Constant | `BD_MIN_VERSION = "0.49.0"` |

---

### `bdInit()`

Initialize a beads project in the current directory.

```typescript
export async function bdInit(): Promise<void>;
```

| Property | Value |
|---|---|
| CLI Command | `bd init --json` |
| Returns | `void` |
| Throws | `BeadClientError` if bd not installed or init fails |

---

### `bdCreate(title, opts)`

Create a new beads issue.

```typescript
export async function bdCreate(
  title: string,
  opts: {
    type?: string;        // "bug" | "feature" | "task" | "epic" | "chore"
    priority?: number;    // 0-4 (0=critical, 4=lowest)
    parent?: string;      // parent bead ID
    description?: string; // issue description
  }
): Promise<BeadIssue>;
```

| Property | Value |
|---|---|
| CLI Command | `bd create <title> [-t type] [-p priority] [--parent id] [--description text] --json` |
| Returns | Normalized `BeadIssue` object |
| Throws | `BeadClientError` if creation fails or no issue returned |

**CLI Argument Mapping:**

| Option | Flag | Example |
|---|---|---|
| `opts.type` | `-t` | `-t bug` |
| `opts.priority` | `-p` | `-p 1` |
| `opts.parent` | `--parent` | `--parent proj-abc-123` |
| `opts.description` | `--description` | `--description "Fix the login bug"` |

---

### `bdShow(id)`

Get a single issue by ID.

```typescript
export async function bdShow(id: string): Promise<BeadIssue>;
```

| Property | Value |
|---|---|
| CLI Command | `bd show <id> --json` |
| Returns | Normalized `BeadIssue` |
| Throws | `BeadClientError` if not found |

---

### `bdList(opts?)`

List issues with optional filters.

```typescript
export async function bdList(opts?: {
  parent?: string;  // filter by parent ID
  status?: string;  // "open" | "in_progress" | "blocked" | "closed"
  type?: string;    // "bug" | "feature" | "task" | "epic" | "chore"
}): Promise<BeadIssue[]>;
```

| Property | Value |
|---|---|
| CLI Command | `bd list [--parent id] [--status s] [--type t] --json` |
| Returns | Array of normalized `BeadIssue` objects |
| Throws | `BeadClientError` on parse failure |

---

### `bdUpdate(id, opts)`

Update an existing issue's fields.

```typescript
export async function bdUpdate(
  id: string,
  opts: {
    status?: string;   // new status
    title?: string;    // new title
    priority?: number; // new priority (0-4)
  }
): Promise<BeadIssue>;
```

| Property | Value |
|---|---|
| CLI Command | `bd update <id> [--status s] [--title t] [-p n] --json` |
| Returns | Updated `BeadIssue` |
| Throws | `BeadClientError` if no fields provided or update fails |
| Validation | At least one field must be specified |

---

### `bdClose(id, reason)`

Close an issue with a reason.

```typescript
export async function bdClose(id: string, reason: string): Promise<BeadIssue>;
```

| Property | Value |
|---|---|
| CLI Command | `bd close <id> --reason <reason> --json` |
| Returns | Closed `BeadIssue` (status = "closed") |
| Throws | `BeadClientError` if close fails |

---

### `bdReady()`

Get all tasks that are ready to work on (no unresolved blocking dependencies).

```typescript
export async function bdReady(): Promise<BeadIssue[]>;
```

| Property | Value |
|---|---|
| CLI Command | `bd ready --json` |
| Returns | Array of `BeadIssue` with no blocking deps |
| Algorithm | Recursive CTE walks `blocks`, `requires`, `blocked-by` edges |
| Note | This is the primary advantage over hive's linear scan |

---

### `bdDepAdd(from, to, type?)`

Add a dependency between two issues.

```typescript
export async function bdDepAdd(
  from: string,
  to: string,
  type?: string  // default: "blocks"
): Promise<void>;
```

| Property | Value |
|---|---|
| CLI Command | `bd dep add <from> <to> --type <type> --json` |
| Default Type | `"blocks"` |
| Valid Types | All 18 beads dep types (see main plan §1) |

---

### `bdDepTree(id)`

Get the dependency tree for an issue.

```typescript
export async function bdDepTree(id: string): Promise<BeadDependency[]>;
```

| Property | Value |
|---|---|
| CLI Command | `bd dep tree <id> --json` |
| Returns | Array of `BeadDependency` edges extracted from tree nodes |
| Parsing | Walks tree nodes, extracts `{ from, to, type }` from dependencies array |

---

## 3. Planned API (🔜 Fork)

### `bdSearch(query, opts?)` 🔜

Full-text search across issues.

```typescript
export async function bdSearch(
  query: string,
  opts?: {
    status?: string;
    type?: string;
    label?: string;
    limit?: number;
  }
): Promise<BeadIssue[]>;
```

| Property | Value |
|---|---|
| CLI Command | `bd search <query> [--status s] [--type t] [--label l] [--limit n] --json` |
| Returns | Array of matching `BeadIssue` |
| Search Scope | Title, description, comments |

---

### `bdLabelAdd(id, label)` 🔜

Add a label to an issue.

```typescript
export async function bdLabelAdd(id: string, label: string): Promise<void>;
```

| Property | Value |
|---|---|
| CLI Command | `bd label add <id> <label> --json` |
| Returns | `void` |

---

### `bdLabelRemove(id, label)` 🔜

Remove a label from an issue.

```typescript
export async function bdLabelRemove(id: string, label: string): Promise<void>;
```

| Property | Value |
|---|---|
| CLI Command | `bd label remove <id> <label> --json` |
| Returns | `void` |

---

### `bdLabelList(id)` 🔜

List all labels on an issue.

```typescript
export async function bdLabelList(id: string): Promise<string[]>;
```

| Property | Value |
|---|---|
| CLI Command | `bd label list <id> --json` |
| Returns | Array of label strings |

---

### `bdCommentAdd(id, text, opts?)` 🔜

Add a comment to an issue.

```typescript
export async function bdCommentAdd(
  id: string,
  text: string,
  opts?: {
    author?: string;  // defaults to current agent name
  }
): Promise<BeadComment>;
```

| Property | Value |
|---|---|
| CLI Command | `bd comment add <id> <text> [--author name] --json` |
| Returns | `BeadComment` with id, text, author, created_at |

---

### `bdCommentList(id)` 🔜

List all comments on an issue.

```typescript
export async function bdCommentList(id: string): Promise<BeadComment[]>;
```

| Property | Value |
|---|---|
| CLI Command | `bd comment list <id> --json` |
| Returns | Array of `BeadComment` sorted by created_at ASC |

---

### `bdStats(opts?)` 🔜

Get project statistics.

```typescript
export async function bdStats(opts?: {
  projectKey?: string;
}): Promise<BeadStats>;
```

| Property | Value |
|---|---|
| CLI Command | `bd stats [--project key] --json` |
| Returns | `BeadStats` with counts by status, type, priority |

---

### `bdMoleculeCreate(name, memberIds)` 🔜

Create a molecule (named task group).

```typescript
export async function bdMoleculeCreate(
  name: string,
  memberIds: string[]
): Promise<BeadMolecule>;
```

| Property | Value |
|---|---|
| CLI Command | `bd molecule create <name> --members <id1,id2,...> --json` |
| Returns | `BeadMolecule` with name and member list |

---

### `bdMoleculeList()` 🔜

List all molecules.

```typescript
export async function bdMoleculeList(): Promise<BeadMolecule[]>;
```

| Property | Value |
|---|---|
| CLI Command | `bd molecule list --json` |
| Returns | Array of `BeadMolecule` |

---

### `bdMoleculeShow(name)` 🔜

Show details of a specific molecule.

```typescript
export async function bdMoleculeShow(name: string): Promise<BeadMolecule>;
```

| Property | Value |
|---|---|
| CLI Command | `bd molecule show <name> --json` |
| Returns | `BeadMolecule` with member issues expanded |

---

### `bdMoleculeAddMember(name, id)` 🔜

Add an issue to a molecule.

```typescript
export async function bdMoleculeAddMember(
  name: string,
  id: string
): Promise<void>;
```

| Property | Value |
|---|---|
| CLI Command | `bd molecule add-member <name> <id> --json` |

---

### `bdDaemonStart()` 🔜

Start the beads daemon for event-driven updates.

```typescript
export async function bdDaemonStart(): Promise<{ pid: number }>;
```

| Property | Value |
|---|---|
| CLI Command | `bd daemon start` |
| Returns | PID of the daemon process |
| Side Effects | Daemon watches beads.db and pushes events over Unix socket |

---

### `bdDaemonStop()` 🔜

Stop the running beads daemon.

```typescript
export async function bdDaemonStop(): Promise<void>;
```

| Property | Value |
|---|---|
| CLI Command | `bd daemon stop` |

---

### `bdDaemonStatus()` 🔜

Check if the daemon is running.

```typescript
export async function bdDaemonStatus(): Promise<{
  running: boolean;
  pid?: number;
  uptime_seconds?: number;
}>;
```

| Property | Value |
|---|---|
| CLI Command | `bd daemon status --json` |

---

### `bdDepRemove(from, to)` 🔜

Remove a dependency between two issues.

```typescript
export async function bdDepRemove(from: string, to: string): Promise<void>;
```

| Property | Value |
|---|---|
| CLI Command | `bd dep remove <from> <to> --json` |

---

### `bdDepList(id)` 🔜

List all direct dependencies of an issue.

```typescript
export async function bdDepList(id: string): Promise<BeadDependency[]>;
```

| Property | Value |
|---|---|
| CLI Command | `bd dep list <id> --json` |
| Returns | Array of `BeadDependency` (direct deps only, no tree walk) |

---

## 4. Error Handling

### Error Class

```typescript
// Already built in src/bridge/bead-client.ts
export class BeadClientError extends Error {
  cause?: Error;

  constructor(message: string, cause?: Error) {
    super(message);
    this.name = "BeadClientError";
    this.cause = cause;
  }
}
```

### Exit Code Mapping

| Exit Code | Meaning | Bridge Behavior |
|---|---|---|
| `0` | Success | Parse JSON output |
| `1` | General error | Throw `BeadClientError` with stderr |
| `2` | Invalid arguments | Throw `BeadClientError` with usage hint |
| `127` | `bd` not found | Throw `BeadClientError` with install URL |

### Error Handling Strategy

```
┌──────────────────────────────────────────────────────┐
│                  Error Decision Tree                  │
├──────────────────────────────────────────────────────┤
│                                                      │
│  1. bd not installed?                                │
│     → isBdInstalled() returns false                  │
│     → Throw with install URL                         │
│     → URL: https://github.com/steveyegge/beads      │
│                                                      │
│  2. bd version too old?                              │
│     → Compare against BD_MIN_VERSION ("0.49.0")      │
│     → Throw with upgrade instructions                │
│                                                      │
│  3. Non-zero exit code?                              │
│     → Parse stderr first, fall back to stdout        │
│     → Wrap in BeadClientError with original message  │
│     → If allowFailure=true, return exit code         │
│                                                      │
│  4. Empty stdout?                                    │
│     → Throw "returned empty JSON output"             │
│                                                      │
│  5. Malformed JSON?                                  │
│     → Throw "Failed to parse JSON output"            │
│     → Include original parse error as .cause         │
│     → Include raw output for debugging               │
│                                                      │
│  6. Unexpected shape?                                │
│     → normalizeIssue() provides safe defaults:       │
│       - Missing id → ""                              │
│       - Missing title → ""                           │
│       - Unknown status → "open"                      │
│       - Unknown type → "task"                        │
│       - Missing priority → 2                         │
│       - Priority clamped to 0-4 range                │
│                                                      │
└──────────────────────────────────────────────────────┘
```

### Planned: Retry with Backoff 🔜

```typescript
export async function withRetry<T>(
  fn: () => Promise<T>,
  opts?: {
    maxRetries?: number;   // default: 3
    backoffMs?: number;    // default: 100
    retryOn?: (error: Error) => boolean; // default: all errors
  }
): Promise<T> {
  const maxRetries = opts?.maxRetries ?? 3;
  const backoffMs = opts?.backoffMs ?? 100;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      const isRetryable = opts?.retryOn
        ? opts.retryOn(error as Error)
        : true;

      if (!isRetryable || attempt === maxRetries - 1) {
        throw error;
      }
      await Bun.sleep(backoffMs * Math.pow(2, attempt));
    }
  }
  throw new Error("unreachable");
}
```

---

## 5. Caching Strategy

### Problem

Each `bd` CLI call takes ~10ms (Go binary startup + SQLite query). For hot
paths like `hive_ready` (called every few seconds by coordinators), this adds up.

### Solution: Tiered Cache

```typescript
interface CacheEntry<T> {
  data: T;
  expiresAt: number;
  etag?: string;  // for conditional refresh
}

class BdCache {
  private store = new Map<string, CacheEntry<unknown>>();

  // TTLs by operation type
  private static readonly TTL = {
    show:    5_000,   // 5s — single issue rarely changes between calls
    list:    3_000,   // 3s — list can change when tasks are created
    ready:   0,       // NEVER cache — must always be fresh
    search:  10_000,  // 10s — search results change slowly
    stats:   30_000,  // 30s — aggregate stats change slowly
    labels:  5_000,   // 5s
    deps:    5_000,   // 5s — dep tree is stable between mutations
  } as const;

  get<T>(key: string): T | null {
    const entry = this.store.get(key);
    if (!entry || Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return null;
    }
    return entry.data as T;
  }

  set<T>(key: string, data: T, category: keyof typeof BdCache.TTL): void {
    const ttl = BdCache.TTL[category];
    if (ttl === 0) return; // never cache
    this.store.set(key, {
      data,
      expiresAt: Date.now() + ttl,
    });
  }

  invalidate(pattern: string): void {
    for (const key of this.store.keys()) {
      if (key.startsWith(pattern)) {
        this.store.delete(key);
      }
    }
  }

  invalidateAll(): void {
    this.store.clear();
  }
}
```

### Cache Key Format

```
show:<bead_id>
list:<parent>:<status>:<type>
ready:all
search:<query_hash>
stats:<project_key>
labels:<bead_id>
deps:<bead_id>
comments:<bead_id>
```

### Invalidation Rules

| Mutation | Invalidates |
|---|---|
| `bdCreate()` | `list:*` for the parent |
| `bdUpdate()` | `show:<id>`, `list:*`, `ready:all` |
| `bdClose()` | `show:<id>`, `list:*`, `ready:all`, `stats:*` |
| `bdDepAdd()` | `ready:all`, `deps:<from>`, `deps:<to>` |
| `bdDepRemove()` | `ready:all`, `deps:<from>`, `deps:<to>` |
| `bdLabelAdd/Remove()` | `labels:<id>`, `search:*` |
| `bdCommentAdd()` | `comments:<id>` |

### Daemon-Driven Invalidation (Future)

When `bd daemon` is running, the cache subscribes to its event stream and
invalidates entries reactively — eliminating TTL-based expiry entirely:

```typescript
// Future: Replace TTL cache with daemon event subscription
daemonEvents.on("issue_updated", (id: string) => {
  cache.invalidate(`show:${id}`);
  cache.invalidate("list:");
  cache.invalidate("ready:");
});
```

---

## 6. Type Definitions

### Core Types (✅ Built)

```typescript
export interface BeadIssue {
  id: string;
  title: string;
  description?: string;
  status: "open" | "in_progress" | "blocked" | "closed";
  priority: number;          // 0-4 (clamped)
  issue_type: "bug" | "feature" | "task" | "epic" | "chore";
  parent_id?: string;
  created_at: string;        // ISO 8601
  updated_at: string;        // ISO 8601
  closed_at?: string;
  closed_reason?: string;
}

export interface BeadDependency {
  from: string;   // source issue ID
  to: string;     // target issue ID
  type: string;   // one of 18 dep types
}

export class BeadClientError extends Error {
  cause?: Error;
}
```

### Normalization Functions (✅ Built)

The bridge normalizes raw `bd` JSON output to typed objects:

| Function | Purpose |
|---|---|
| `normalizeStatus(value)` | Maps unknown → `"open"`, `"deferred"` → `"blocked"` |
| `normalizeIssueType(value)` | Maps `"enhancement"` → `"feature"`, unknown → `"task"` |
| `normalizeIssue(raw)` | Full normalization: id, title, status, type, priority (clamped 0-4) |
| `parseIssuePayload(payload)` | Handles both array and single-object responses |
| `extractDependencies(tree)` | Walks dep tree nodes → flat `BeadDependency[]` |

### New Types (🔜 Fork)

```typescript
export interface BeadComment {
  id: string;
  bead_id: string;
  text: string;
  author: string;
  created_at: string;   // ISO 8601
}

export interface BeadLabel {
  bead_id: string;
  label: string;
  added_at: string;     // ISO 8601
}

export interface BeadMolecule {
  name: string;
  member_ids: string[];
  created_at: string;   // ISO 8601
}

export interface BeadStats {
  total_issues: number;
  by_status: {
    open: number;
    in_progress: number;
    blocked: number;
    closed: number;
  };
  by_type: {
    bug: number;
    feature: number;
    task: number;
    epic: number;
    chore: number;
  };
  by_priority: Record<number, number>;  // 0-4 → count
  total_dependencies: number;
  total_molecules: number;
  total_labels: number;
  total_comments: number;
}

export type BeadDepType =
  | "blocks"
  | "blocked-by"
  | "enables"
  | "enabled-by"
  | "parent"
  | "child"
  | "relates-to"
  | "duplicates"
  | "duplicated-by"
  | "precedes"
  | "follows"
  | "causes"
  | "caused-by"
  | "includes"
  | "included-in"
  | "requires"
  | "required-by"
  | "tests";
```

---

## Appendix: bd CLI Command Reference

Quick reference for all `bd` commands and their flags:

```
bd add <title> [-t type] [-p priority] [--parent id] [--description text] [--json]
bd show <id> [--json]
bd list [--parent id] [--status s] [--type t] [--json]
bd update <id> [--status s] [--title t] [-p n] [--json]
bd close <id> --reason <text> [--json]
bd ready [--verbose] [--json]
bd dep add <from> <to> [--type t] [--json]
bd dep remove <from> <to> [--json]
bd dep tree <id> [--json]
bd dep list <id> [--json]
bd search <query> [--status s] [--type t] [--label l] [--limit n] [--json]
bd label add <id> <label> [--json]
bd label remove <id> <label> [--json]
bd label list <id> [--json]
bd comment add <id> <text> [--author name] [--json]
bd comment list <id> [--json]
bd stats [--project key] [--json]
bd molecule create <name> --members <ids> [--json]
bd molecule list [--json]
bd molecule show <name> [--json]
bd molecule add-member <name> <id> [--json]
bd daemon start
bd daemon stop
bd daemon status [--json]
bd init [--json]
bd version [--json]
```

> Note: The `bd` binary uses `bd add` for creation, but cortex's existing wrapper
> maps this to `bd create`. The fork should use whichever command the actual
> Go binary supports — verify via `bd --help`.
