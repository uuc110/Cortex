# PLAN.md Template Specification

## Purpose

PLAN.md is the structured task specification that workers consume. It defines *what* to build, *how* to verify, and *what context* to use — in a format that both humans and AI agents can parse.

Cortex generates PLAN.md files from bead data + wave assignments + memory context. The existing implementation is in `src/bridge/plan-generator.ts` (`generatePlanMd()` function).

---

## Template Structure

A PLAN.md has 6 sections in order:

1. **YAML Frontmatter** — Machine-readable metadata
2. **Objective** — What this plan accomplishes
3. **Context** — Background information for the worker
4. **Tasks** — XML-formatted task definitions
5. **Worker Protocol** — Communication rules
6. **Verification** — Success criteria (must_haves)

---

## Full Template

```markdown
---
# PLAN.md Frontmatter
phase: "{phase_id}"              # "quick-{bead_id}" or "phase-{N}"
plan: "01"                        # Plan number (01 = initial, 02+ = fix plans)
type: "execute"                   # "execute" | "fix" | "research"
mode: "quick"                     # "quick" | "project"
status: "pending"                 # "pending" | "in_progress" | "completed" | "failed"
created: "2026-02-01T09:00:00Z"
wave: 1                           # Wave number (from wave calculator)
depends_on: ["bd-a3f8.1"]        # Bead IDs this plan depends on
files_modified: ["src/foo.ts"]    # Expected files to be modified
autonomous: true                  # true = no human checkpoints needed
bead_id: "bd-a3f8.2"             # Bead this plan executes
epic_id: "bd-a3f8"               # Parent epic
worker_id: "worker-1"            # Assigned worker agent
---

<objective>
{Clear, single-paragraph description of what this plan accomplishes.}
{This maps directly to the bead title + description.}
</objective>

<context>
@.planning/PROJECT.md
@.planning/STATE.md

## Epic Context
{epic.title}: {epic.description}
Overall goal: {epic.must_haves — what the epic needs to achieve}

## Sibling Tasks
{For each sibling task in the same epic:}
- {id}: {title} ({status}) — {files}

## Memory Context
{Relevant memories from cortex_recall, formatted as bullet points:}
- {memory 1: past pattern or learning relevant to this task}
- {memory 2: ...}

## Research Context
{Only in Project Mode — findings from research phase:}
- {relevant finding from .planning/research/findings.md}

## Completed Dependencies
{For each dependency that's already done:}
- {id}: {title} — {what was done, key decisions, files changed}
</context>

<tasks>
<task id="1" status="pending" wave="1" priority="high" type="auto">
  <name>{Task title}</name>
  <files>{comma-separated list of files to modify}</files>
  <action>{Detailed description of what to implement.}

Requirements:
- Follow existing codebase patterns
- Write tests for new functionality
- Handle edge cases and errors
- If you discover new work, create a child bead and mail Queen
- If you need a decision, mail Queen with options
- Store any learnings in short-term memory</action>
  <verify>
- Build passes
- Tests pass for changed files
- No lint/type errors</verify>
  <done>{What "done" looks like for this task}</done>
</task>

<!-- Compound tasks can have subtasks -->
<task id="2" status="pending" wave="1" priority="medium" type="auto">
  <name>{Parent task title}</name>
  <files>{all files across subtasks}</files>
  <subtask id="2.1">
    <name>{Subtask title}</name>
    <files>{subtask-specific files}</files>
    <action>{What to do}</action>
  </subtask>
  <subtask id="2.2">
    <name>{Subtask title}</name>
    <files>{subtask-specific files}</files>
    <action>{What to do}</action>
  </subtask>
  <verify>
- All subtasks completed
- Integration between subtasks works</verify>
  <done>{What "done" looks like}</done>
</task>

<!-- Checkpoint task (human-in-loop) -->
<task id="3" status="pending" wave="2" priority="high" type="human-verify">
  <name>Verify OAuth redirect flow</name>
  <action>Manual verification required:
1. Open browser to /auth/login
2. Click "Sign in with Google"
3. Verify redirect to Google consent screen
4. Complete sign-in and verify redirect back</action>
  <done>Human has verified the OAuth flow works end-to-end</done>
</task>
</tasks>

<worker-protocol>
On start: mail Queen [STATUS] in_progress
On discovery: bd create child, mail Queen [DISCOVERY]
On stuck: mail Queen [HELP] with what you tried
On blocked: bd update --status blocked, mail Queen [BLOCKED]
On complete: mail Queen [DONE] with summary
</worker-protocol>

<verification>
## must_haves

### truths
{Observable behaviors that MUST be true after this plan completes:}
- [ ] {truth 1: user-observable behavior or invariant}
- [ ] {truth 2: ...}

### artifacts
{Files that MUST exist and meet criteria:}
- [ ] {path} — exists
- [ ] {path} — substantive (non-trivial content, >10 lines)
- [ ] {path} — wired (imported and used by other files)

### key_links
{Connections that MUST work between components:}
- [ ] {from} → {to}: {relationship type}
- [ ] {from} → {to}: {relationship type}

## Checklist
- [ ] Build passes
- [ ] Tests pass
- [ ] No type errors
- [ ] Atomic commit created
- [ ] Learnings stored in short-term memory
- [ ] Queen notified via [DONE] mail
</verification>
```

---

## Task XML Attributes

### `<task>` Attributes

| Attribute | Required | Values | Description |
|---|---|---|---|
| `id` | Yes | String (numeric or bead ID) | Unique within plan |
| `status` | Yes | `pending`, `in_progress`, `completed`, `failed`, `skipped` | Execution status |
| `wave` | Yes | Integer ≥ 1 | Which wave this task runs in |
| `priority` | Yes | `critical`, `high`, `medium`, `low` | Execution priority within wave |
| `type` | Yes | `auto`, `human-verify`, `human-action`, `decision` | Who executes |

### Task Type Definitions

| Type | Executor | Description |
|---|---|---|
| `auto` | Worker agent | Fully autonomous — worker implements and verifies |
| `human-verify` | Human (via checkpoint) | Worker implements, human verifies result |
| `human-action` | Human | Requires human action (e.g., create API key, configure service) |
| `decision` | Human/Queen | Decision point that blocks downstream tasks |

### `<subtask>` Attributes

| Attribute | Required | Values | Description |
|---|---|---|---|
| `id` | Yes | String (`{parent}.{n}`) | Hierarchical ID |

### Inner Elements

| Element | Required | Description |
|---|---|---|
| `<name>` | Yes | Task title |
| `<files>` | Yes | Comma-separated file paths |
| `<action>` | Yes | What to do (supports markdown) |
| `<verify>` | No | Per-task verification steps |
| `<done>` | No | Definition of done |

---

## Frontmatter Schema

```typescript
interface PlanFrontmatter {
  // Identity
  phase: string;        // "quick-{bead_id}" or "phase-{N}"
  plan: string;         // "01" (initial), "02"+ (fix plans)
  bead_id: string;      // Bead this plan executes
  epic_id: string;      // Parent epic bead

  // Execution
  type: "execute" | "fix" | "research";
  mode: "quick" | "project";
  status: "pending" | "in_progress" | "completed" | "failed";
  wave: number;         // Wave number
  autonomous: boolean;  // false if has human-verify/human-action tasks

  // Dependencies
  depends_on: string[]; // Bead IDs
  files_modified: string[];

  // Assignment
  worker_id: string;    // Assigned worker

  // Timestamps
  created: string;      // ISO 8601
}
```

---

## Quick Mode vs Project Mode Templates

### Quick Mode

- `phase: "quick-bd-a3f8.2"`
- `mode: "quick"`
- No research context section
- Placed in `.planning/quick/{bead_id}/01-PLAN.md`
- Typically 1 task per plan (one plan per bead)

### Project Mode

- `phase: "phase-1"` (or `"phase-2"`, etc.)
- `mode: "project"`
- Includes research context from `.planning/research/findings.md`
- Placed in `.planning/phases/{NN}-{name}/01-PLAN.md`
- May have multiple tasks per plan (grouped by wave)
- References ROADMAP.md milestones

---

## Fix Plan Convention

When verification fails, a fix plan is generated:

```yaml
---
phase: "quick-bd-a3f8.2"
plan: "02"                    # Fix plan (02 = first fix, 03 = second fix)
type: "fix"
mode: "quick"
status: "pending"
created: "2026-02-01T10:00:00Z"
wave: 1
depends_on: []
files_modified: ["src/foo.ts", "tests/foo.test.ts"]
autonomous: true
bead_id: "bd-a3f8.2"
epic_id: "bd-a3f8"
worker_id: "worker-1"
source_verification: "verification-001"  # Links to the failed verification
---
```

Fix plan tasks reference the specific failures:

```xml
<task id="1" status="pending" wave="1" priority="critical" type="auto">
  <name>Fix missing test for edge case</name>
  <files>tests/foo.test.ts</files>
  <action>Verification gap: truth "handles empty input gracefully" was NOT met.

The function throws on empty string input. Add:
1. Guard clause for empty input
2. Test case verifying empty input returns default value</action>
  <verify>
- bun test tests/foo.test.ts passes
- Empty input returns default value (not throw)</verify>
  <done>Edge case handled, test added, verification gap closed</done>
</task>
```

---

## Reference: Existing Implementation

The current `generatePlanMd()` in `src/bridge/plan-generator.ts` produces a PLAN.md that covers:
- ✅ YAML frontmatter (phase, plan, type, wave, depends_on, files_modified, autonomous, bead_id, epic_id, worker_id)
- ✅ Objective section (from bead title + description)
- ✅ Context section (epic context, siblings, memory, dependencies)
- ✅ Tasks section (single auto task with name, files, action, verify, done)
- ✅ Worker protocol section
- ✅ Verification checklist

**Gaps to fill for full GSD integration:**
- ❌ `mode` field in frontmatter (quick vs project)
- ❌ `status` field in frontmatter
- ❌ `created` timestamp
- ❌ Research context section (Project Mode)
- ❌ Multiple tasks per plan (compound plans)
- ❌ Subtask XML format
- ❌ `must_haves` section (truths, artifacts, key_links)
- ❌ Task type variants (`human-verify`, `human-action`, `decision`)
- ❌ Fix plan support (`type: "fix"`, `source_verification`)
- ❌ Task `id` and `priority` attributes in XML

These gaps will be addressed in Phase 3 (Execution Engine) and Phase 4 (Verification Engine).

---

## Reference: GSD Source Templates

The GSD skill (at `cortex-refs/get-shit-done/`) uses a similar template structure. Key differences between GSD's native format and Cortex's adaptation:

| GSD Native | Cortex Adaptation | Reason |
|---|---|---|
| Phase named by feature | Phase named by bead ID | Cortex uses beads as SSOT |
| Tasks numbered 1..N | Tasks have bead IDs | Traceability to dependency graph |
| No `depends_on` in frontmatter | `depends_on` lists bead IDs | Wave calculator needs this |
| No `worker_id` | `worker_id` in frontmatter | Queen assigns specific worker |
| `must_haves` in separate section | `must_haves` in `<verification>` | Keeps verification self-contained |
| `@context` file references | Same | Compatible |
| `<task type="auto">` | Same + new types | Extended for human-in-loop |
