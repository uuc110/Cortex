# Verification Model

## Philosophy: Goal-Backward Verification

Traditional verification asks: *"Did each task complete successfully?"*

Goal-backward verification asks: *"Does the collective result achieve the original goal?"*

The difference is critical. Individual tasks can all pass their unit tests while the system as a whole fails to meet the user's intent. A dark mode toggle might have passing tests for the toggle component, the CSS variables, and the persistence layer — but if the toggle isn't wired into the app layout, dark mode doesn't actually work.

Goal-backward verification starts from the **desired outcome** and works backward to verify each precondition.

---

## must_haves Format

Every plan's `<verification>` section includes `must_haves` — criteria derived from the original goal. These are the contract between what was requested and what was delivered.

### Three Categories

#### 1. Truths (Observable Invariants)

Things that must be observably true in the running system.

```yaml
truths:
  - "Dark mode toggle switches theme when clicked"
  - "User's theme preference persists across browser sessions"
  - "System respects OS-level dark mode preference on first visit"
  - "All UI components render correctly in both light and dark themes"
```

**How to verify:** Run the application, execute the described behavior, check the result. For automated verification: integration tests, E2E tests, or scripted checks.

**Verification command pattern:**
```bash
# Run truth-checking tests
bun test --grep "dark mode"
# Or custom verification script
bun run verify:truths
```

#### 2. Artifacts (Files That Must Exist)

Files that must exist and meet specific quality criteria.

```yaml
artifacts:
  - path: "src/components/ThemeToggle.tsx"
    check: "exists"          # File exists on disk

  - path: "src/hooks/useTheme.ts"
    check: "substantive"     # Exists + non-trivial (>10 lines of logic, not just re-exports)

  - path: "src/styles/themes.css"
    check: "wired"           # Exists + substantive + imported by at least one other file
```

**Three check levels:**

| Level | Criteria | How to Verify |
|---|---|---|
| `exists` | File is present on disk | `fs.existsSync(path)` |
| `substantive` | File exists + has meaningful content (>10 non-blank, non-comment lines) | Line count after stripping blanks/comments |
| `wired` | File exists + substantive + imported/required by at least one other file | Grep codebase for import/require of this path |

**Verification algorithm for `wired`:**
```
function checkWired(artifactPath: string, projectPath: string): boolean
  // 1. Exists?
  if not fileExists(artifactPath): return false

  // 2. Substantive?
  let lines = readFile(artifactPath).split('\n')
  let meaningfulLines = lines.filter(line =>
    line.trim().length > 0 &&
    !line.trim().startsWith('//') &&
    !line.trim().startsWith('/*') &&
    !line.trim().startsWith('*')
  )
  if meaningfulLines.length < 10: return false

  // 3. Wired? (imported by at least one other file)
  let importPattern = artifactPath
    .replace(projectPath, '')
    .replace(/\.(ts|tsx|js|jsx)$/, '')  // Strip extension
    .replace(/\/index$/, '')             // Strip /index
  let grepResult = grep(projectPath, `from ['"].*${importPattern}`)
  return grepResult.matchCount > 0       // At least one import found
```

#### 3. Key Links (Cross-Component Connections)

Connections between components that must be functional.

```yaml
key_links:
  - from: "ThemeToggle"
    to: "ThemeProvider"
    type: "renders-within"
    verify: "ThemeToggle is rendered inside ThemeProvider's component tree"

  - from: "useTheme"
    to: "ThemeProvider"
    type: "consumes-context"
    verify: "useTheme hook reads from ThemeProvider's context"

  - from: "themes.css"
    to: "App.tsx"
    type: "imported-by"
    verify: "themes.css is imported (directly or transitively) by App.tsx"

  - from: "ThemeToggle"
    to: "localStorage"
    type: "persists-to"
    verify: "ThemeToggle writes theme preference to localStorage"
```

**Link types:**

| Type | Description | Automated Check |
|---|---|---|
| `renders-within` | Component A renders inside component B's tree | AST analysis of JSX |
| `consumes-context` | Hook/component reads from a context provider | Import + usage check |
| `imported-by` | Module A is imported by module B | Grep for import statement |
| `persists-to` | Component writes to a storage mechanism | Grep for storage API calls |
| `calls-api` | Component makes API calls to endpoint | Grep for fetch/axios to URL |
| `routes-to` | Router maps path to component | Route config analysis |
| `extends` | Class/interface extends another | TypeScript AST check |
| `configures` | Config file controls behavior of module | Config reference check |

---

## Verification Phases

### Level 1: Per-Task Verification (Worker)

**When:** After each task completes, before the worker reports [DONE].

**Who:** The worker (self-verification).

**What:**
```bash
# Build check
bun run build 2>&1 | tail -5

# Test check (focused on changed files)
bun test --grep "{task_keywords}" 2>&1

# Type check
bunx tsc --noEmit 2>&1

# Lint check (if configured)
bun run lint 2>&1
```

**Pass criteria:** All commands exit 0.

**Fail action:** Worker fixes issues and re-verifies. If stuck after 2 attempts, mails Queen with `[BLOCKED]`.

**Integration with swarm:** This is the existing `swarm_complete()` verification gate. No changes needed — workers already do this.

### Level 2: Per-Wave Verification (Queen)

**When:** After all tasks in a wave complete.

**Who:** The Queen (coordinator).

**What:**
```bash
# Full build (not just incremental)
bun run build

# Full test suite (not just per-task)
bun test

# Type check (entire project)
bunx tsc --noEmit

# Cross-task consistency check
# (Queen reads all wave summaries, checks for contradictions)
```

**Additional checks:**
- No file conflicts between wave outputs (shouldn't happen if file reservations worked)
- No duplicate implementations (two tasks implementing the same thing differently)
- API contracts between tasks are consistent (types match)

**Pass criteria:** Full build + test + type-check pass. No cross-task issues.

**Fail action:** Queen creates fix tasks as a "fix wave" — new beads under the epic with `priority: 0` (critical). Fix wave runs before proceeding to the next wave.

### Level 3: Per-Plan Verification (Queen)

**When:** After all waves in a plan complete.

**Who:** The Queen (coordinator).

**What:** Goal-backward `must_haves` verification.

```
for each truth in must_haves.truths:
  run verification command or test
  check: does the truth hold?

for each artifact in must_haves.artifacts:
  check exists/substantive/wired based on artifact.check level

for each link in must_haves.key_links:
  check: does the connection exist and function?
```

**Output:** Verification report.

```typescript
interface VerificationReport {
  scope: "plan";
  planId: string;
  status: "passed" | "failed";
  truths: Array<{ statement: string; passed: boolean; evidence?: string }>;
  artifacts: Array<{ path: string; check: string; passed: boolean; reason?: string }>;
  keyLinks: Array<{ from: string; to: string; type: string; passed: boolean; reason?: string }>;
  gaps: Gap[];
  timestamp: string;
}

interface Gap {
  category: "truth" | "artifact" | "key_link";
  description: string;
  severity: "critical" | "major" | "minor";
  suggestedFix?: string;
}
```

**Pass criteria:** All truths hold, all artifacts exist at required level, all key links verified.

**Fail action:** Generate fix plan (see Fix Plan Generation below).

### Level 4: Per-Phase Verification (Queen — Project Mode Only)

**When:** After all plans in a phase complete (milestone gate).

**Who:** The Queen (coordinator), potentially with human checkpoint.

**What:** Everything from Level 3, PLUS:
- Milestone definition-of-done check (from ROADMAP.md)
- Integration with previous phases (nothing broken)
- User acceptance criteria (from PROJECT.md)

```
phase_milestone = ROADMAP.phases[current_phase].milestone
for each criterion in phase_milestone.definition_of_done:
  verify criterion is met

// Regression check against previous phases
for each previous_phase in completed_phases:
  verify previous_phase.must_haves still hold
```

**Pass criteria:** All milestone DoD criteria met. No regressions.

**Fail action:** Same as Level 3 — generate fix plan. If fix plan fails 3 times, escalate to user with full gap report.

---

## Fix Plan Generation

When verification fails, the Queen automatically generates a fix plan:

### Algorithm

```
function generateFixPlan(report: VerificationReport): FixPlan
  let fixTasks: FixTask[] = []

  // 1. Failed truths → investigation + implementation tasks
  for each truth in report.truths where !truth.passed:
    fixTasks.push({
      title: "Fix: " + truth.statement,
      type: "auto",
      priority: "critical",
      action: "Truth '${truth.statement}' is not met.\n" +
              "Evidence: ${truth.evidence}\n" +
              "Investigate why and fix the implementation.",
      verify: "Truth holds after fix"
    })

  // 2. Failed artifacts → create or fix file
  for each artifact in report.artifacts where !artifact.passed:
    if artifact.check == "exists":
      fixTasks.push({
        title: "Create missing file: " + artifact.path,
        priority: "critical",
        action: "File ${artifact.path} does not exist. Create it with appropriate content."
      })
    else if artifact.check == "substantive":
      fixTasks.push({
        title: "Flesh out stub: " + artifact.path,
        priority: "high",
        action: "File ${artifact.path} exists but is a stub (<10 meaningful lines). " +
                "Implement the real logic."
      })
    else if artifact.check == "wired":
      fixTasks.push({
        title: "Wire up: " + artifact.path,
        priority: "high",
        action: "File ${artifact.path} exists and has content, but nothing imports it. " +
                "Wire it into the appropriate consumer."
      })

  // 3. Failed key links → connect components
  for each link in report.keyLinks where !link.passed:
    fixTasks.push({
      title: "Connect: " + link.from + " → " + link.to,
      priority: "high",
      action: "Key link '${link.from} ${link.type} ${link.to}' is broken.\n" +
              "Reason: ${link.reason}\n" +
              "Establish the connection."
    })

  // 4. Compute waves for fix tasks
  let fixWaves = computeWaves(fixTasks)

  return {
    planNumber: "02",  // or "03" if second fix
    type: "fix",
    sourceVerification: report,
    tasks: fixTasks,
    waves: fixWaves
  }
```

### Iteration Limit

Fix plan generation has a **hard limit of 3 iterations** (configurable via `max_fix_iterations`):

```
Iteration 1: Original plan → verify → gaps found → fix plan 02
Iteration 2: Fix plan 02 → verify → gaps remain → fix plan 03
Iteration 3: Fix plan 03 → verify → gaps remain → ESCALATE TO USER
```

After 3 iterations, the Queen:
1. Produces a detailed gap report
2. Mails the user with `[ESCALATE]` subject
3. Marks the phase as `failed`
4. Records the failure pattern in short-term memory (so future goals avoid the same trap)

---

## Integration with Swarm's Existing Eval Pipeline

Swarm already has an evaluation mechanism via `swarm_complete()` which:
1. Runs `bunx tsc --noEmit` (type check)
2. Runs `bun test` (test suite)
3. Generates self-evaluation prompt

Cortex's verification model **extends** this, not replaces it:

| Swarm Existing | Cortex Extension |
|---|---|
| `swarm_complete()` typecheck | → Level 1 (per-task) |
| `swarm_complete()` test run | → Level 1 (per-task) |
| `swarm_review()` code review | → Level 2 (per-wave, broader scope) |
| `swarm_adversarial_review()` | → Level 3 (plan-level, hostile review) |
| *(none)* | → Level 3: must_haves verification |
| *(none)* | → Level 4: milestone + regression check |
| *(none)* | → Fix plan auto-generation |

The swarm eval pipeline becomes Level 1. Cortex adds Levels 2–4 on top.

---

## Failure Modes

### 1. Flaky Tests

**Symptom:** Verification passes sometimes, fails sometimes.

**Detection:** Same must_have passes on iteration 1 but fails on iteration 2 (or vice versa).

**Response:**
- Retry verification once
- If flaky, mark the truth as `flaky` in the report
- Do not generate fix tasks for flaky truths
- Log to short-term memory: "Test X is flaky — intermittent failure"

### 2. Wrong must_haves

**Symptom:** Verification fails but the implementation is actually correct.

**Detection:** Worker reports task complete with passing tests, but must_have check fails.

**Response:**
- Queen reviews the must_have against the original goal
- If the must_have was incorrectly derived → update it (not a code fix)
- If the must_have is correct but the check method is wrong → update the check
- Log: "must_have '{X}' was incorrectly formulated — revised"

### 3. Cascading Failures

**Symptom:** One wave failure causes all subsequent waves to fail.

**Detection:** Wave N fix plan requires changes in Wave N-1 output.

**Response:**
- Roll back to Wave N-1
- Re-execute Wave N-1 with the fix
- Re-execute Wave N
- This is expensive — Queen should assess if a full re-plan is cheaper

### 4. Environment Failures

**Symptom:** Build/test fails due to environment issues (missing deps, wrong version).

**Detection:** Error messages indicate tooling failure, not code failure.

**Response:**
- Do not generate fix plan (it's not a code problem)
- Mail user with `[BLOCKED]` and the environment error
- Pause execution until user resolves

### 5. Timeout During Verification

**Symptom:** Verification takes too long (tests hang, build hangs).

**Detection:** Verification command exceeds timeout (default: 60s per check).

**Response:**
- Kill the command
- Mark the specific check as `timeout`
- Log the timeout to short-term memory
- Proceed with partial verification results
- Flag the timeout in the report

---

## Verification Report Format

```markdown
# Verification Report

**Scope:** plan | phase
**Target:** bd-a3f8 (Dark mode toggle)
**Status:** PASSED | FAILED
**Timestamp:** 2026-02-01T10:30:00Z
**Iteration:** 1 of 3

## Truths

| # | Statement | Status | Evidence |
|---|---|---|---|
| 1 | Dark mode toggle switches theme | ✅ PASS | Test: theme-toggle.test.ts:L42 |
| 2 | Preference persists across sessions | ✅ PASS | Test: persistence.test.ts:L18 |
| 3 | Respects OS dark mode preference | ❌ FAIL | No prefers-color-scheme media query found |

## Artifacts

| # | Path | Check | Status | Reason |
|---|---|---|---|---|
| 1 | src/components/ThemeToggle.tsx | wired | ✅ PASS | Imported by App.tsx |
| 2 | src/hooks/useTheme.ts | substantive | ✅ PASS | 45 lines of logic |
| 3 | src/styles/themes.css | wired | ❌ FAIL | File exists but not imported |

## Key Links

| # | From | To | Type | Status | Reason |
|---|---|---|---|---|---|
| 1 | ThemeToggle | ThemeProvider | renders-within | ✅ PASS | Found in component tree |
| 2 | themes.css | App.tsx | imported-by | ❌ FAIL | No import statement found |

## Gaps

| # | Category | Severity | Description | Suggested Fix |
|---|---|---|---|---|
| 1 | truth | critical | OS dark mode preference not respected | Add prefers-color-scheme media query |
| 2 | artifact | major | themes.css not imported | Add import in App.tsx |
| 3 | key_link | major | themes.css → App.tsx link broken | Same as gap #2 |

## Summary
- Truths: 2/3 passed
- Artifacts: 2/3 passed
- Key Links: 1/2 passed
- **Overall: FAILED (3 gaps, 1 critical)**
- **Action:** Fix plan 02 generated with 2 tasks
```

---

## TypeScript Interfaces

```typescript
// src/verifier/types.ts

export interface MustHaves {
  truths: string[];
  artifacts: ArtifactSpec[];
  keyLinks: KeyLinkSpec[];
}

export interface ArtifactSpec {
  path: string;
  check: "exists" | "substantive" | "wired";
}

export interface KeyLinkSpec {
  from: string;
  to: string;
  type: string;
  verify?: string;  // Human-readable description
}

export interface TruthResult {
  statement: string;
  passed: boolean;
  evidence?: string;
}

export interface ArtifactResult {
  path: string;
  check: "exists" | "substantive" | "wired";
  passed: boolean;
  reason?: string;
}

export interface KeyLinkResult {
  from: string;
  to: string;
  type: string;
  passed: boolean;
  reason?: string;
}

export interface Gap {
  category: "truth" | "artifact" | "key_link";
  description: string;
  severity: "critical" | "major" | "minor";
  suggestedFix?: string;
}

export interface VerificationReport {
  scope: "task" | "wave" | "plan" | "phase";
  targetId: string;
  status: "passed" | "failed";
  truths: TruthResult[];
  artifacts: ArtifactResult[];
  keyLinks: KeyLinkResult[];
  gaps: Gap[];
  iteration: number;
  maxIterations: number;
  timestamp: string;
}

export type VerificationLevel = "task" | "wave" | "plan" | "phase";
```

---

## Configuration

```json
{
  "verification": {
    "run_after_each_wave": true,
    "run_after_plan": true,
    "run_after_phase": true,
    "max_fix_iterations": 3,
    "check_timeout_ms": 60000,
    "artifact_min_lines": 10,
    "truth_check_command": "bun test",
    "type_check_command": "bunx tsc --noEmit",
    "build_command": "bun run build",
    "lint_command": "bun run lint"
  }
}
```
