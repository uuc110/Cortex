# 01 — Beads Integration: Swarm → Beads Task Management Bridge

> Replace hive's flat task table with steveyegge/beads — a Go-powered issue tracker
> with 18 dependency types, recursive CTE ready-work, hierarchical IDs, molecules,
> and a daemon mode. Cortex already has the bridge code (`src/bridge/`); this plan
> connects it to the forked swarm plugin.

---

## 1. Why Beads Over Hive

| Capability | Hive (current) | Beads (`bd` CLI) |
|---|---|---|
| **Dependency types** | 3–4 implicit (parent-child, manual blocks) | 18 explicit types (see §5) |
| **Ready-work query** | Linear scan + JS filter | Recursive CTE in SQLite — O(log n) |
| **ID scheme** | UUID v4 (opaque) | Hierarchical: `project-random-timestamp` |
| **CLI speed** | Node.js MCP roundtrip (~200 ms) | Go binary, <10 ms per command |
| **Task groups** | None (flat list with `parent_id`) | Molecules — named groups with shared deps |
| **Background sync** | Manual polling | `bd daemon` — file-watch + event push |
| **Search** | FTS5 on hive columns | FTS5 + label index + comment search |
| **Labels** | Not supported | First-class `bd label` system |
| **Comments** | Not supported | `bd comment` with timestamps + author |
| **Stats** | Custom SQL queries | `bd stats` with built-in analytics |

### 18 Dependency Types

Beads supports the following relationship types between tasks:

| # | Type | Direction | Swarm Use-Case |
|---|---|---|---|
| 1 | `blocks` | A blocks B | B cannot start until A completes |
| 2 | `blocked-by` | A is blocked by B | Inverse of blocks |
| 3 | `enables` | A enables B | Soft dependency — B can start but A accelerates it |
| 4 | `enabled-by` | A is enabled by B | Inverse of enables |
| 5 | `parent` | A is parent of B | Epic → subtask hierarchy |
| 6 | `child` | A is child of B | Subtask → epic hierarchy |
| 7 | `relates-to` | A relates to B | Informational link |
| 8 | `duplicates` | A duplicates B | Dedup — closing A auto-references B |
| 9 | `duplicated-by` | A is duplicated by B | Inverse of duplicates |
| 10 | `precedes` | A precedes B | Ordering without hard block |
| 11 | `follows` | A follows B | Inverse of precedes |
| 12 | `causes` | A causes B | Root-cause tracking (bug chains) |
| 13 | `caused-by` | A is caused by B | Inverse of causes |
| 14 | `includes` | A includes B | Molecule membership |
| 15 | `included-in` | A is included in B | Inverse of includes |
| 16 | `requires` | A requires B | Hard prerequisite (stricter than blocks) |
| 17 | `required-by` | A is required by B | Inverse of requires |
| 18 | `tests` | A tests B | Test-task relationship |

> The recursive CTE in beads walks `blocks`, `requires`, and `blocked-by` edges
> to compute the ready-work set. `enables` and `precedes` are advisory — they
> appear in `bd ready --verbose` but don't gate execution.

---

## 2. Bridge Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      Cortex Swarm Plugin                    │
│  (forked from opencode-swarm-plugin, runs in OpenCode)      │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│   MCP Tool Handlers                                         │
│   ┌──────────┐  ┌──────────┐  ┌──────────────┐             │
│   │hive_create│  │hive_query│  │hive_ready    │  ...        │
│   └─────┬────┘  └─────┬────┘  └──────┬───────┘             │
│         │              │              │                      │
│         ▼              ▼              ▼                      │
│   ┌──────────────────────────────────────────┐              │
│   │        Bridge Layer (src/bridge/)         │              │
│   │                                           │              │
│   │  bead-client.ts    — Bun.spawn("bd ...")  │              │
│   │  mapping-store.ts  — cortex_id ↔ bead_id  │              │
│   │  plan-generator.ts — PLAN.md from beads   │              │
│   └──────────────┬───────────────────────────┘              │
│                  │                                           │
│                  ▼                                           │
│   ┌──────────────────────────────────────────┐              │
│   │          Event Bus (src/events/)          │              │
│   │  emitEvent("tasks_created", ...)          │              │
│   │  emitEvent("task_started", ...)           │              │
│   └──────────────────────────────────────────┘              │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│   ┌──────────────────┐    ┌───────────────────────┐         │
│   │  bd CLI (Go bin)  │    │  cortex.db (bun:sqlite) │       │
│   │  beads.db (SQLite) │    │  task_mapping table     │       │
│   │  Source of truth   │    │  Event projection       │       │
│   └──────────────────┘    └───────────────────────┘         │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### Design Principles

1. **`bd` is source of truth** — All task state lives in beads.db. Cortex's
   `task_mapping` table is a lightweight index mapping `cortex_id ↔ bead_id`.

2. **Hive table becomes an event projection** — The existing hive MCP tools
   (`hive_create`, `hive_query`, `hive_ready`, etc.) continue to work, but
   they delegate to the bridge layer which calls `bd` under the hood.

3. **`Bun.spawn()` for CLI calls** — The existing `src/bridge/bead-client.ts`
   already wraps `bd` commands via `Bun.spawn()` with:
   - JSON output parsing (`--json` flag)
   - Exit code error handling
   - Configurable working directory (`CORTEX_PROJECT_PATH` env var)
   - Type-safe normalization of raw JSON to `BeadIssue` / `BeadDependency`

4. **Events for side-effects** — Every bridge operation emits a cortex event
   through `src/events/index.ts`. This powers the activity timeline, progress
   tracking, and downstream hooks.

---

## 3. Key Bridge Operations

The bridge translates swarm's task vocabulary into `bd` CLI calls.

| Swarm Operation | Bridge Function | `bd` CLI Command |
|---|---|---|
| Create task | `bdCreate(title, opts)` | `bd create <title> -t <type> -p <priority> --parent <id>` |
| Show task | `bdShow(id)` | `bd show <id> --json` |
| List tasks | `bdList(opts)` | `bd list --status <s> --type <t> --parent <p> --json` |
| Update task | `bdUpdate(id, opts)` | `bd update <id> --status <s> --title <t> -p <n> --json` |
| Close task | `bdClose(id, reason)` | `bd close <id> --reason <r> --json` |
| Get ready work | `bdReady()` | `bd ready --json` |
| Add dependency | `bdDepAdd(from, to, type)` | `bd dep add <from> <to> --type <type> --json` |
| Dependency tree | `bdDepTree(id)` | `bd dep tree <id> --json` |
| Initialize | `bdInit()` | `bd init --json` |
| Check installed | `isBdInstalled()` | `bd version --json` |

### Operations to Add (Fork Phase)

| Operation | `bd` CLI Command | Bridge Function (planned) |
|---|---|---|
| Search tasks | `bd search <query> --json` | `bdSearch(query, opts)` |
| Add label | `bd label add <id> <label> --json` | `bdLabelAdd(id, label)` |
| Remove label | `bd label remove <id> <label> --json` | `bdLabelRemove(id, label)` |
| List labels | `bd label list <id> --json` | `bdLabelList(id)` |
| Add comment | `bd comment add <id> <text> --json` | `bdCommentAdd(id, text)` |
| List comments | `bd comment list <id> --json` | `bdCommentList(id)` |
| Get stats | `bd stats --json` | `bdStats()` |
| Create molecule | `bd molecule create <name> --json` | `bdMoleculeCreate(name, ids)` |
| List molecules | `bd molecule list --json` | `bdMoleculeList()` |
| Start daemon | `bd daemon start` | `bdDaemonStart()` |
| Stop daemon | `bd daemon stop` | `bdDaemonStop()` |

> See [details/bd-cli-bridge-api.md](details/bd-cli-bridge-api.md) for full TypeScript API.

---

## 4. Event Integration

Every bridge operation emits a cortex event. The existing event types in
`src/events/types.ts` already cover the core task lifecycle. New beads-specific
events extend the `EventType` union:

### Existing Events (Already Wired)

| Event Type | Emitted When | Data Shape |
|---|---|---|
| `tasks_created` | `bdCreate()` completes | `{ task_ids, epic_id, count }` |
| `task_started` | `bdUpdate(id, { status: "in_progress" })` | `{ bead_id, worker_id, title }` |
| `task_completed` | `bdClose(id, reason)` | `{ bead_id, worker_id, title, summary }` |
| `task_blocked` | `bdUpdate(id, { status: "blocked" })` | `{ bead_id, worker_id, reason }` |
| `task_progress` | Worker reports progress | `{ bead_id, worker_id, progress_percent }` |

### New Events (To Add in Fork)

| Event Type | Emitted When | Data Shape |
|---|---|---|
| `beads_dep_added` | `bdDepAdd()` completes | `{ from_id, to_id, dep_type }` |
| `beads_dep_removed` | `bdDepRemove()` completes | `{ from_id, to_id, dep_type }` |
| `beads_label_changed` | `bdLabelAdd/Remove()` | `{ bead_id, label, action: "add"│"remove" }` |
| `beads_comment_added` | `bdCommentAdd()` | `{ bead_id, author, text }` |
| `beads_molecule_created` | `bdMoleculeCreate()` | `{ molecule_name, member_ids }` |
| `beads_search_performed` | `bdSearch()` | `{ query, result_count, duration_ms }` |
| `beads_daemon_status` | Daemon start/stop | `{ running: boolean, pid?: number }` |

### Event Flow

```
1. MCP tool call (e.g., hive_create)
       │
       ▼
2. Bridge function (bdCreate)
       │
       ├── Bun.spawn("bd create ... --json")
       │       │
       │       ▼
       │   bd CLI writes to beads.db
       │
       ├── mapping-store: createMapping(beadId, { projectKey })
       │       │
       │       ▼
       │   cortex.db task_mapping row
       │
       └── emitEvent("tasks_created", projectKey, { ... })
               │
               ▼
           cortex.db events row → triggers projections/hooks
```

---

## 5. Migration Strategy: Hive Cells → Beads Tasks

### Mapping Hive Concepts to Beads

| Hive Concept | Beads Equivalent | Notes |
|---|---|---|
| Cell ID (UUID) | Bead ID (`project-random-ts`) | Mapped via `task_mapping` table |
| `parent_id` | `bd dep add child --type parent` | Explicit parent dep |
| `status: open` | `status: open` | 1:1 |
| `status: in_progress` | `status: in_progress` | 1:1 |
| `status: blocked` | `status: blocked` | 1:1 (beads also supports `deferred`) |
| `status: closed` | `status: closed` | 1:1 (beads adds `close_reason`) |
| `type: epic` | `issue_type: epic` | 1:1 |
| `type: task` | `issue_type: task` | 1:1 |
| `type: bug` | `issue_type: bug` | 1:1 |
| `type: feature` | `issue_type: feature` | 1:1 (beads also has `enhancement`) |
| `type: chore` | `issue_type: chore` | 1:1 |
| `priority: 0-3` | `priority: 0-4` | Beads supports 0-4 range |
| Hive `ready` query | `bd ready --json` | Recursive CTE replaces JS filter |

### Migration Steps

1. **Phase 0: Dual-Write (Current State)**
   - Cortex already writes to beads via `src/bridge/bead-client.ts`
   - `task_mapping` table links `cortex_id ↔ bead_id`
   - Hive MCP tools still work (they read from mapping table)

2. **Phase 1: Bridge All Hive Tools**
   - Each `hive_*` MCP tool delegates to bridge layer
   - `hive_create` → `bdCreate()` + `createMapping()`
   - `hive_query` → `bdList()` with mapping resolution
   - `hive_ready` → `bdReady()` (uses recursive CTE)
   - `hive_update` → `bdUpdate()` + event emission
   - `hive_close` → `bdClose()` + event emission

3. **Phase 2: Expose Beads-Native Features**
   - New MCP tools: `beads_dep_add`, `beads_search`, `beads_label`, etc.
   - These bypass hive vocabulary entirely
   - Agents can use 18 dep types directly

4. **Phase 3: Deprecate Hive Table**
   - Remove hive cell storage from swarm-mail plugin
   - `task_mapping` becomes the only cortex-side table
   - All task state lives in beads.db

### Data Migration Script

```typescript
import { bdCreate, bdDepAdd, bdUpdate } from "../bridge/bead-client";
import { createMapping } from "../bridge/mapping-store";

async function migrateHiveCells(
  cells: HiveCell[],
  projectKey: string
): Promise<Map<string, string>> {
  const idMap = new Map<string, string>(); // hive_id → bead_id

  // Pass 1: Create all tasks
  for (const cell of cells) {
    const bead = await bdCreate(cell.title, {
      type: cell.type,
      priority: cell.priority,
      description: cell.description,
    });
    idMap.set(cell.id, bead.id);
    createMapping(bead.id, { projectKey });
  }

  // Pass 2: Wire parent-child relationships
  for (const cell of cells) {
    if (cell.parent_id && idMap.has(cell.parent_id)) {
      const childBeadId = idMap.get(cell.id)!;
      const parentBeadId = idMap.get(cell.parent_id)!;
      await bdDepAdd(childBeadId, parentBeadId, "parent");
    }
  }

  // Pass 3: Restore statuses
  for (const cell of cells) {
    if (cell.status !== "open") {
      const beadId = idMap.get(cell.id)!;
      await bdUpdate(beadId, { status: cell.status });
    }
  }

  return idMap;
}
```

> See [details/task-mapping-schema.md](details/task-mapping-schema.md) for the
> full SQL schema and sync protocol.

---

## 6. Caching Strategy

Calling `bd` for every query adds ~10 ms overhead per invocation. For hot paths:

### In-Memory Cache

```typescript
const cache = new Map<string, { data: BeadIssue; expiresAt: number }>();
const CACHE_TTL_MS = 5_000; // 5 seconds

function getCached(id: string): BeadIssue | null {
  const entry = cache.get(id);
  if (!entry || Date.now() > entry.expiresAt) {
    cache.delete(id);
    return null;
  }
  return entry.data;
}
```

### Cache Invalidation Rules

| Operation | Invalidates |
|---|---|
| `bdCreate()` | List cache for parent |
| `bdUpdate()` | Single-issue cache + list caches |
| `bdClose()` | Single-issue cache + ready cache |
| `bdDepAdd()` | Ready cache + dep tree cache |
| `bdReady()` | Never cached (always fresh) |

### Daemon Mode (Future)

When `bd daemon` is running, it pushes events over a Unix socket. The bridge
can subscribe to these events and update the cache reactively instead of
polling. This eliminates the TTL-based approach entirely.

---

## 7. Error Handling

The existing `BeadClientError` class in `src/bridge/bead-client.ts` handles:

| Error Scenario | Handling |
|---|---|
| `bd` not installed | `isBdInstalled()` check → install instructions |
| `bd` version too old | Version check against `BD_MIN_VERSION` ("0.49.0") |
| Non-zero exit code | Stderr parsed → `BeadClientError` with message |
| Empty JSON output | `BeadClientError("bd <cmd> returned empty JSON output")` |
| Malformed JSON | `BeadClientError("Failed to parse JSON output...")` |
| Task not found | bd returns exit 1 → error propagated |

### Retry Strategy (Planned)

```typescript
async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries = 3,
  backoffMs = 100
): Promise<T> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (attempt === maxRetries - 1) throw error;
      await Bun.sleep(backoffMs * Math.pow(2, attempt));
    }
  }
  throw new Error("unreachable");
}
```

---

## 8. Reference: Existing Code

| File | Purpose | Status |
|---|---|---|
| `src/bridge/bead-client.ts` | `bd` CLI wrapper via `Bun.spawn()` | ✅ Built (405 lines) |
| `src/bridge/mapping-store.ts` | `task_mapping` CRUD operations | ✅ Built (150 lines) |
| `src/bridge/plan-generator.ts` | Generate PLAN.md from beads context | ✅ Built (198 lines) |
| `src/bridge/index.ts` | Barrel export | ✅ Built |
| `src/db/schema.ts` | `task_mapping` table DDL | ✅ Built (schema v5) |
| `src/events/types.ts` | Event type definitions | ✅ Built (32 event types) |
| `src/events/index.ts` | Event emission + querying | ✅ Built |

### What the Fork Adds

| File (planned) | Purpose |
|---|---|
| `src/bridge/bead-search.ts` | `bd search` wrapper + FTS integration |
| `src/bridge/bead-labels.ts` | `bd label` CRUD wrapper |
| `src/bridge/bead-comments.ts` | `bd comment` wrapper |
| `src/bridge/bead-molecules.ts` | `bd molecule` group management |
| `src/bridge/bead-stats.ts` | `bd stats` analytics wrapper |
| `src/bridge/bead-daemon.ts` | `bd daemon` lifecycle + event stream |
| `src/bridge/cache.ts` | In-memory cache with TTL + daemon invalidation |

---

## 9. Open Questions

1. **Beads DB location** — Should `beads.db` live alongside `cortex.db` in the
   project root, or in a separate `.beads/` directory? Currently bd uses its
   own default location.

2. **Daemon socket protocol** — What events does `bd daemon` push? Need to
   reverse-engineer or read the Go source for the exact wire format.

3. **Molecule ↔ Swarm epic mapping** — Should each swarm epic automatically
   become a beads molecule, or are they orthogonal concepts?

4. **Multi-project** — The `task_mapping` table has a `project_key` column.
   Does beads support multiple projects in one DB, or do we need one beads.db
   per project?

5. **bd version compatibility** — `BD_MIN_VERSION` is currently "0.49.0".
   Which version introduced molecules and daemon mode?
