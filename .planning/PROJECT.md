# Cortex: Swarm-Tools Fork with Upgrades

## What This Is

A fork of [joelhooks/swarm-tools](https://github.com/joelhooks/swarm-tools) (multi-agent coordination framework) incrementally upgraded with 4 capabilities the original lacks: enhanced memory ranking, a proper task dependency graph (beads), structured execution with verification (GSD), and a formal Queen/Worker coordination protocol.

## Core Value

**Skip months of rebuild work by forking the working system (~70% of what we need already exists) and surgically upgrading the ~30% that's weak or missing.**

## Requirements

### Validated

- R1: Fork swarm-tools monorepo, rename `opencode-swarm-plugin` to `cortex-plugin`, verify all existing tests pass
- R2: Enhance hivemind memory with tag 80/20 boost, 3-tier decay (hot/warm/cold), access tracking, and privacy XML filter
- R3: Bridge beads (`bd` CLI) into swarm orchestration for 18 dependency types, recursive CTE ready-work, and hierarchical IDs
- R4: Integrate GSD structured execution: PLAN.md generation, wave-based parallel execution, goal-backward verification with must_haves
- R5: Port Queen/Worker protocol from Cortex HLD: structured mail message types, decision boundaries, worker lifecycle (PICKUP->CLOSE), learning promotion
- R6: All existing swarm-tools tests must continue passing (zero regression)
- R7: Event sourcing extended with new event types for beads, GSD, and Queen/Worker (see `details/event-type-mapping.md`)

### Active

- R8: Performance targets: memory recall <50ms for 1K entries, mail send <10ms
- R9: Upstream sync strategy: monthly cherry-picks from joelhooks/swarm-tools
- R10: `bd` CLI graceful degradation — fall back to hive table if `bd` unavailable

### Out of Scope

- NOT rebuilding swarm-tools from scratch (that was old Cortex approach, abandoned)
- NOT replacing swarm-mail messaging (it already works at 100% fidelity)
- NOT replacing hivemind's core (smart upsert, entity extraction, auto-linking) — only enhancing ranking/decay
- NOT supporting non-Bun runtimes (Bun-only)
- NOT building a GUI (CLI + MCP tools only for now)
- NOT publishing under the `opencode-swarm-plugin` package name (we rename to `cortex-plugin`)

## Context

### Tech Stack
- **Runtime:** Bun 1.3.4
- **Build:** Turborepo
- **Database:** libSQL (SQLite-compatible), single global DB at `~/.config/swarm-tools/swarm.db`
- **Embeddings:** Ollama (local, with FTS5 fallback)
- **External:** `bd` CLI (Go binary) for beads task graph
- **Testing:** `bun test`
- **Publishing:** Changesets + `bun publish`

### Monorepo Structure
```
packages/
  opencode-swarm-plugin/  -- Main plugin (rename to cortex-plugin)
  swarm-mail/             -- Event sourcing + mail + hivemind
  swarm-tools/            -- CLI (swarm command)
  swarm-dashboard/        -- Terminal UI
  swarm-evals/            -- Evalite test suites
  shared-types/           -- Shared TypeScript types
  claude-code-swarm-plugin/ -- Claude Code adapter
apps/
  web/                    -- Docs site
```

### Reference Repos (at cortex-refs/ in parent project)
- `cortex-refs/swarm-tools/` -- Original upstream
- `cortex-refs/beads/` -- steveyegge/beads Go binary
- `cortex-refs/get-shit-done/` -- GSD framework
- `cortex-refs/opencode-mem/` -- Legacy memory system (superseded by hivemind)

### Existing Cortex Code (at parent project)
- `src/bridge/` -- bd CLI wrapper (port to new `cortex-bridge` package)
- `src/queen/` -- Queen protocol (port to `opencode-swarm-plugin/src/queen/`)
- `src/worker/` -- Worker lifecycle (enhance existing swarm worker)
- `src/executor/` -- GSD plan-writer (port to `opencode-swarm-plugin/src/executor/`)
- `src/memory/` -- Memory enhancements (backport to `swarm-mail` hivemind)
- `HLD.md` -- Architecture spec (canonical reference)

## Constraints

- **Zero regression:** All existing swarm-tools tests must pass after every phase
- **Single global DB:** Must use `~/.config/swarm-tools/swarm.db`, no project-local DBs
- **No `bd` CLI in code:** Use HiveAdapter from swarm-mail (per AGENTS.md). The beads bridge is for MCP tool layer only.
- **Plugin wrapper must be self-contained:** No imports from plugin packages in the wrapper file
- **TDD mandatory:** Red -> Green -> Refactor for all changes
- **Bun only:** No Node.js, npm, vite, webpack

## Key Decisions

| Decision | Rationale | Date |
|----------|-----------|------|
| Fork swarm-tools instead of continuing Cortex rebuild | ~70% already exists, saves months of work | 2026-02-01 |
| Keep hivemind, enhance with Cortex improvements | Hivemind is more advanced than opencode-mem (smart upsert, entity extraction, CASS) | 2026-02-01 |
| Bridge beads via CLI, keep hive as projection layer | bd has 18 dep types vs hive's 3-4, but hive is tightly integrated with events | 2026-02-01 |
| Integrate GSD for structured execution | Swarm lacks plans, waves, verification discipline | 2026-02-01 |
| Port Queen/Worker from Cortex HLD | Swarm's coordinator/worker is informal; needs formal protocols | 2026-02-01 |
| Depth is task-adaptive | quick for bugs, standard for most work, comprehensive for features | 2026-02-01 |

## Phases

| Phase | Name | Goal | Effort |
|-------|------|------|--------|
| 1 | Fork & Stabilize | Fork, rename, verify builds, add event types, schema migration | Week 1 |
| 2 | Memory Enhancement | Backport Cortex memory improvements into hivemind | Week 1-2 |
| 3 | Beads Bridge | Bridge `bd` CLI into swarm orchestration | Week 2-3 |
| 4 | GSD Integration | Add structured execution (plans, waves, verification) | Week 3-4 |
| 5 | Queen/Worker Protocol | Port Cortex's formal coordination protocol | Week 4-5 |

## Planning Docs

Detailed specs in `.planning/fork-plan/`:
- `00-FORK-MASTER-PLAN.md` -- Overall strategy
- `01-INTEGRATION-SWARM-BEADS.md` -- Beads bridge
- `02-INTEGRATION-SWARM-GSD.md` -- GSD execution
- `03-INTEGRATION-SWARM-QUEEN-WORKER.md` -- Queen/Worker protocol
- `details/` -- 9 detailed specs (event mapping, memory spec, wave algorithm, etc.)
