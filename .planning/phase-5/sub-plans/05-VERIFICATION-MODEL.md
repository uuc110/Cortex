# Sub-Plan 05: 4-Level Verification Model

**Parent:** Phase 5 Task 5
**Wave:** 4
**Depends On:** Sub-Plans 02 (Queen), 04 (Wave Execution), Phase 4 verification engine
**Output:** `packages/opencode-swarm-plugin/src/queen/phase-verifier.ts`
**Tests:** `packages/opencode-swarm-plugin/src/queen/__tests__/phase-verifier.test.ts`

---

## Problem

Swarm's verification is **shallow** — it only checks per-task (typecheck + tests). It NEVER asks:
- "Did the collective result of all tasks actually achieve the original goal?"
- "Are the components properly wired together?"
- "Do the right files exist with the right content?"
- "Does the feature work end-to-end?"

See `ORCHESTRATION-ANALYSIS.md` section 2.5, `02-INTEGRATION-SWARM-GSD.md` lines 270-303, and `details/verification-model.md`.

## Solution

4-level verification that checks progressively broader scopes, culminating in goal-backward `must_haves` verification.

---

## The 4 Levels

| Level | Who | When | What | Module |
|-------|-----|------|------|--------|
| **Per-task** | Worker | After EXECUTE step | Build, tests, lint, typecheck on worker's files | `worker/self-verifier.ts` (Sub-Plan 03) |
| **Per-wave** | Queen | After all wave tasks complete | Integration tests, cross-task consistency | `queen/wave-dispatcher.ts` (Sub-Plan 04) |
| **Per-plan** | Queen | After all waves complete | Goal-backward must_haves check (truths + artifacts + key_links) | **`queen/phase-verifier.ts` (THIS SUB-PLAN)** |
| **Per-phase** | Queen | After phase milestone (Project Mode) | Full verification suite + milestone DoD + fix bead creation | **`queen/phase-verifier.ts` (THIS SUB-PLAN)** |

### Level 1: Per-Task (Already Handled)

Worker's `self-verifier.ts` runs:
- `bun run build` → buildOk
- `bun test <related-files>` → testsOk
- `bunx tsc --noEmit` → typeCheckOk

This gates individual task completion. If fails → worker reports BLOCKED.

### Level 2: Per-Wave (Handled by Wave Dispatcher)

After all tasks in a wave complete, wave dispatcher runs:
- Full test suite (not just per-file)
- Check for type errors introduced by combining changes
- Check that wave outputs don't conflict

If fails → create fix beads, execute fix wave.

### Level 3: Per-Plan (THIS MODULE)

After ALL waves complete, the phase verifier runs goal-backward verification using Phase 4's `verificationEngine`:

```yaml
must_haves:
  truths:
    - "Dark mode toggle persists user preference across sessions"
    - "CSS variables switch between light and dark themes"
  artifacts:
    - path: "src/components/ThemeToggle.tsx"
      check: "wired"   # exists + non-trivial + imported somewhere
    - path: "src/styles/themes.css"
      check: "substantive"  # exists + > 10 lines
  key_links:
    - from: "ThemeToggle"
      to: "ThemeProvider"
      type: "renders-within"
    - from: "themes.css"
      to: "index.html"
      type: "imported-by"
```

### Level 4: Per-Phase (Project Mode Only)

Same as Level 3 but broader:
- Checks milestone definition of done
- May include manual review checkpoint
- Creates fix beads for any remaining gaps

---

## Module: phase-verifier.ts

### Factory

```typescript
import { createVerificationEngine, type VerificationResult as GsdVerificationResult } from "../gsd/verification-engine";
import { gsdVerificationRun, gsdVerificationPassed, gsdVerificationFailed } from "../gsd/gsd-events";

export interface PhaseVerifierConfig {
  projectKey: string;
  projectPath: string;
  epicBeadId: string;
  maxVerifyIterations?: number;  // Default: 3
}

export interface PhaseVerifierDeps {
  verificationEngine: ReturnType<typeof createVerificationEngine>;
  beadClient: BeadClientInterface;
  eventStore: EventStoreInterface;
  learningPromoter: LearningPromoter;  // From Sub-Plan 02
}

export function createPhaseVerifier(config: PhaseVerifierConfig, deps: PhaseVerifierDeps): PhaseVerifier;

export interface PhaseVerifier {
  verifyPhase(mustHaves: MustHaves): Promise<PhaseVerificationResult>;
}

export interface MustHaves {
  truths: string[];
  artifacts: Array<{
    path: string;
    check: "exists" | "substantive" | "wired";
  }>;
  keyLinks: Array<{
    from: string;
    to: string;
    type: "imported-by" | "renders-within" | "calls" | "extends";
  }>;
}

export interface PhaseVerificationResult {
  passed: boolean;
  iterations: number;
  truthResults: Array<{ truth: string; passed: boolean; evidence?: string }>;
  artifactResults: Array<{ path: string; check: string; passed: boolean; reason?: string }>;
  keyLinkResults: Array<{ from: string; to: string; type: string; passed: boolean; reason?: string }>;
  fixBeadsCreated: string[];
  gapsRemaining: string[];
}
```

### Behavior

```
verifyPhase(mustHaves):
  iteration = 0
  while iteration < maxVerifyIterations:
    iteration++

    // Step 1: Check all beads in epic are closed
    beads = beadClient.list({ parentId: epicBeadId })
    openBeads = beads.filter(b => b.status !== "closed")
    IF openBeads.length > 0:
      → return { passed: false, gapsRemaining: ["Open beads: " + openBeads.map(b => b.id)] }

    // Step 2: Run GSD verification suite
    eventStore.emit(gsdVerificationRun({ scope: "plan", targetId: epicBeadId }))

    truthResults = verificationEngine.verifyTruths(mustHaves.truths)
    artifactResults = verificationEngine.verifyArtifacts(mustHaves.artifacts)
    keyLinkResults = verificationEngine.verifyKeyLinks(mustHaves.keyLinks)

    allPassed = truthResults.every(r => r.passed)
                && artifactResults.every(r => r.passed)
                && keyLinkResults.every(r => r.passed)

    IF allPassed:
      eventStore.emit(gsdVerificationPassed({ scope: "plan", targetId: epicBeadId }))
      // Promote learnings from all workers
      await deps.learningPromoter.promoteLearnings(config.projectKey)
      eventStore.emit("goal_completed", { epicId: epicBeadId })
      return { passed: true, iterations: iteration, fixBeadsCreated: [], gapsRemaining: [], ... }

    // Step 3: Verification failed — create fix beads
    eventStore.emit(gsdVerificationFailed({ scope: "plan", targetId: epicBeadId, gaps: [...] }))

    fixBeads = []
    failedTruths = truthResults.filter(r => !r.passed)
    failedArtifacts = artifactResults.filter(r => !r.passed)
    failedLinks = keyLinkResults.filter(r => !r.passed)

    IF failedTruths.length > 0:
      fixBead = beadClient.create({
        title: `Fix: ${failedTruths.length} truth verification failures`,
        type: "bug",
        priority: 0,
        parentId: epicBeadId,
        description: failedTruths.map(t => `- ${t.truth}`).join("\n"),
      })
      fixBeads.push(fixBead.id)

    IF failedArtifacts.length > 0:
      fixBead = beadClient.create({
        title: `Fix: ${failedArtifacts.length} missing/incomplete artifacts`,
        type: "bug",
        priority: 0,
        parentId: epicBeadId,
        description: failedArtifacts.map(a => `- ${a.path} (${a.check}): ${a.reason}`).join("\n"),
      })
      fixBeads.push(fixBead.id)

    IF failedLinks.length > 0:
      fixBead = beadClient.create({
        title: `Fix: ${failedLinks.length} broken component links`,
        type: "bug",
        priority: 0,
        parentId: epicBeadId,
        description: failedLinks.map(l => `- ${l.from} → ${l.to} (${l.type}): ${l.reason}`).join("\n"),
      })
      fixBeads.push(fixBead.id)

    // Step 4: Execute fix beads (delegate to wave dispatcher)
    // Fix beads are executed in a single "fix wave"
    // After execution, loop back to verify again

  // Max iterations exceeded
  return {
    passed: false,
    iterations: maxVerifyIterations,
    fixBeadsCreated: allFixBeads,
    gapsRemaining: [...remaining failures...],
    ...
  }
```

---

## Verification Checks Detail

### Truth Verification

Truths are observable behaviors. Phase 4's `verificationEngine.verifyTruths()` checks them by:
1. Running the truth as a test assertion (if a test command is provided)
2. Searching codebase for evidence of the behavior
3. Manual check: return "unverifiable" if automated check impossible

### Artifact Verification (3 levels)

| Level | Check | What It Means |
|-------|-------|--------------|
| `exists` | File exists at path | Minimum bar |
| `substantive` | File exists AND has > 10 non-empty lines | Not a stub |
| `wired` | File exists AND is imported/referenced by another file | Actually used in the codebase |

Phase 4's `verificationEngine.verifyArtifacts()` implements all 3 levels.

### Key-Link Verification

Key links verify that components are properly connected:

| Type | What It Checks |
|------|---------------|
| `imported-by` | File A imports file B (grep for import statement) |
| `renders-within` | Component A renders inside component B (grep JSX) |
| `calls` | Function A calls function B (grep for function call) |
| `extends` | Class A extends class B (grep for extends keyword) |

Phase 4's `verificationEngine.verifyKeyLinks()` implements these via AST grep or regex.

---

## Test Requirements (20+ tests)

### Phase Verification (10+ tests)
1. All beads closed + all must_haves pass → { passed: true }
2. Open beads → { passed: false, gapsRemaining: ["Open beads: ..."] }
3. Truth verification fails → fix bead created
4. Artifact verification fails (missing file) → fix bead created
5. Artifact verification fails (stub file) → fix bead created (substantive check)
6. Key-link verification fails → fix bead created
7. Multiple failures → multiple fix beads created
8. Fix beads have type: "bug", priority: 0
9. goal_completed event emitted on success
10. learning_promoted on success (learning promoter called)

### Fix Loop (5+ tests)
11. First iteration fails, fix executes, second iteration passes → { passed: true, iterations: 2 }
12. Three iterations all fail → { passed: false, iterations: 3 }
13. Fix beads created each iteration are tracked
14. gsdVerificationRun event emitted each iteration
15. gsdVerificationPassed/Failed events emitted correctly

### Edge Cases (5+ tests)
16. Empty must_haves → passes trivially
17. Only truths (no artifacts, no links) → checks truths only
18. Only artifacts (no truths, no links) → checks artifacts only
19. Verification engine throws → caught, reported as failure
20. No learning promoter available → graceful skip

---

## What To AVOID

- Do NOT rebuild verification engine → use Phase 4's `createVerificationEngine()`
- Do NOT rebuild event factories → use Phase 4's `gsdVerificationRun()` etc.
- Do NOT run fix beads directly → delegate to wave dispatcher's `executeWave()`
- Do NOT auto-approve fix beads → Queen reviews them like any other task
- Do NOT skip verification on "small" changes → all levels always run
- Do NOT mock the verification engine in integration tests → test the real thing
