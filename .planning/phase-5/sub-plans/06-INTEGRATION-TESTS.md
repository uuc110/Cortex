# Sub-Plan 06: Integration Tests

**Parent:** Phase 5 Task 7
**Wave:** 5 (Final)
**Depends On:** All previous sub-plans (01-05)
**Output:** `packages/opencode-swarm-plugin/src/{queen,worker,__tests__}/**/*.test.ts`
**Goal:** Verify the entire orchestration upgrade works end-to-end

---

## Problem

Unit tests verify individual modules. But the orchestration upgrade involves 14+ new modules that must work TOGETHER. Without integration tests, we can't be sure that:
- Queen processes typed messages that workers actually send
- Wave dispatcher correctly drives worker lifecycles
- Verification results correctly trigger fix bead creation
- STATE.md correctly tracks real execution progress
- The whole flow works from decomposition to goal_completed

## Solution

10 integration test scenarios that test complete flows, plus regression checks against existing swarm tests.

---

## Test File Locations

| File | Scope |
|------|-------|
| `src/queen/__tests__/integration.test.ts` | Queen processing real message flows |
| `src/worker/__tests__/integration.test.ts` | Worker lifecycle with real context loading |
| `src/__tests__/orchestration-e2e.test.ts` | Full epic execution: decompose → waves → verify |

---

## Scenario 1: Queen Processes Worker Completion

```typescript
test("Queen receives [DONE], verifies, sends [APPROVED]", async () => {
  // Setup: Worker sends DONE message with files
  const doneMsg = formatMessageBody({
    tag: "DONE",
    beadId: "bd-test.1",
    summary: "Implemented auth routes",
    files: ["src/auth/routes.ts", "src/auth/routes.test.ts"],
    commit: "abc123",
  });

  // Mock inbox returns this message
  mockInbox.push({ subject: "[DONE] bd-test.1: completed", body: doneMsg });

  // Mock verification passes
  mockVerification.mockReturnValue({ passed: true, steps: [], summary: "ok", blockers: [] });

  // Queen processes one cycle
  await queen.processOnce();

  // Verify: Queen sent APPROVED reply
  expect(mockSendMail).toHaveBeenCalledWith(expect.objectContaining({
    subject: expect.stringContaining("[REVIEW]"),
  }));
  const sentBody = parseCortexMessage(
    mockSendMail.mock.calls[0][0].subject,
    mockSendMail.mock.calls[0][0].body,
  );
  expect(sentBody.tag).toBe("REVIEW");
  expect(sentBody.status).toBe("approved");
});
```

## Scenario 2: Queen Handles Discovery with Priority Gate

```typescript
test("Queen approves P2 discovery, rejects P4 discovery", async () => {
  // P2 discovery → APPROVED
  await queen.processMessage(discoveryMsg({ priority: 2, title: "Add refresh tokens" }));
  expect(lastReply().tag).toBe("APPROVED");

  // P4 discovery → REJECTED
  await queen.processMessage(discoveryMsg({ priority: 4, title: "Add logging" }));
  expect(lastReply().tag).toBe("REJECTED");
  expect(lastReply().reason).toContain("Priority too low");
});
```

## Scenario 3: Queen Handles Help Request with Memory

```typescript
test("Queen responds to HELP with relevant memory context", async () => {
  // Setup: Memory has relevant learning
  mockMemoryRecall.mockReturnValue([
    { info: "Use 5min buffer for token refresh", tags: "auth,tokens", score: 0.9 },
  ]);

  // Worker sends HELP
  await queen.processMessage({
    tag: "HELP",
    beadId: "bd-test.1",
    question: "How should I handle token refresh?",
    context: "Building OAuth integration",
  });

  // Queen sends CONTEXT with memory
  expect(lastReply().tag).toBe("CONTEXT");
  expect(lastReply().update).toContain("5min buffer");
});
```

## Scenario 4: Worker Full Lifecycle

```typescript
test("Worker executes 8-step lifecycle successfully", async () => {
  // Setup: Mock all dependencies
  const lifecycle = createWorkerLifecycle(workerConfig, mockDeps);

  // Execute with a simple task executor
  const result = await lifecycle.run(async (context, plan) => ({
    success: true,
    files: ["src/auth.ts"],
    commit: "abc123",
    learnings: [{ info: "OAuth needs refresh buffer", tags: "auth" }],
  }));

  // Verify all 8 steps executed
  expect(mockDeps.beadClient.update).toHaveBeenCalledWith("bd-test.1", { status: "in_progress" }); // PICKUP
  expect(mockDeps.contextLoader.loadWorkerContext).toHaveBeenCalled(); // ORIENT
  expect(mockDeps.selfVerifier.verify).toHaveBeenCalled(); // VERIFY
  expect(mockDeps.memoryStore).toHaveBeenCalledWith("OAuth needs refresh buffer", "auth"); // LEARN
  expect(mockDeps.mailSender.sendCompleted).toHaveBeenCalled(); // REPORT
  expect(mockDeps.beadClient.close).toHaveBeenCalledWith("bd-test.1", expect.any(String)); // CLOSE
  expect(result.status).toBe("completed");
});
```

## Scenario 5: Worker Guardrails

```typescript
test("Worker cannot create epic (only child tasks)", async () => {
  const handler = createDiscoveryHandler(mockDeps);

  // Discovery creates a TASK, not an epic
  const childId = await handler({
    title: "New sub-task",
    priority: 2,
    parentBeadId: "bd-test.1",
  });

  expect(mockDeps.beadClient.create).toHaveBeenCalledWith(expect.objectContaining({
    type: "task",           // NOT "epic"
    parentId: "bd-test.1",  // Always under parent
  }));
});
```

## Scenario 6: 3-Strike Review Block

```typescript
test("3 failed reviews → bead blocked", async () => {
  const reviewer = createReviewHandler(mockDeps);
  mockVerification.mockReturnValue({ passed: false, blockers: ["type error"] });

  // 3 failed attempts
  const r1 = await reviewer.handleCompleted(doneMsg);
  expect(r1.status).toBe("needs_changes");
  expect(r1.remainingAttempts).toBe(2);

  const r2 = await reviewer.handleCompleted(doneMsg);
  expect(r2.remainingAttempts).toBe(1);

  const r3 = await reviewer.handleCompleted(doneMsg);
  expect(r3.status).toBe("blocked");

  // Bead marked blocked
  expect(mockDeps.beadClient.update).toHaveBeenCalledWith("bd-test.1", { status: "blocked" });
});
```

## Scenario 7: Wave Execution with 2 Waves

```typescript
test("Wave dispatcher executes 2 waves in order", async () => {
  const tasks = [
    { beadId: "bd-1.1", title: "CSS vars", files: ["styles.css"], dependencies: [] },
    { beadId: "bd-1.2", title: "Theme ctx", files: ["theme.ts"], dependencies: [] },
    { beadId: "bd-1.3", title: "Toggle", files: ["toggle.tsx"], dependencies: ["bd-1.1", "bd-1.2"] },
  ];

  // Wave calculator should produce:
  // Wave 1: [bd-1.1, bd-1.2] (no deps)
  // Wave 2: [bd-1.3] (depends on wave 1)

  mockSpawnWorker.mockResolvedValue({ status: "completed" });
  mockVerification.mockReturnValue({ passed: true });

  const result = await dispatcher.executeEpic(tasks);

  // Wave 1 tasks spawned first
  expect(mockSpawnWorker).toHaveBeenNthCalledWith(1, "bd-1.1", ["styles.css"]);
  expect(mockSpawnWorker).toHaveBeenNthCalledWith(2, "bd-1.2", ["theme.ts"]);
  // Wave 2 task spawned after wave 1 completes
  expect(mockSpawnWorker).toHaveBeenNthCalledWith(3, "bd-1.3", ["toggle.tsx"]);

  expect(result.wavesCompleted).toBe(2);
  expect(result.success).toBe(true);
});
```

## Scenario 8: Phase Verification with must_haves

```typescript
test("Phase verifier checks truths, artifacts, key_links", async () => {
  const verifier = createPhaseVerifier(config, mockDeps);

  // All beads closed
  mockDeps.beadClient.list.mockReturnValue([
    { id: "bd-1.1", status: "closed" },
    { id: "bd-1.2", status: "closed" },
  ]);

  // Verification engine passes
  mockDeps.verificationEngine.verifyTruths.mockReturnValue([{ truth: "Dark mode works", passed: true }]);
  mockDeps.verificationEngine.verifyArtifacts.mockReturnValue([{ path: "toggle.tsx", passed: true }]);
  mockDeps.verificationEngine.verifyKeyLinks.mockReturnValue([{ from: "Toggle", to: "Provider", passed: true }]);

  const result = await verifier.verifyPhase({
    truths: ["Dark mode works"],
    artifacts: [{ path: "toggle.tsx", check: "wired" }],
    keyLinks: [{ from: "Toggle", to: "Provider", type: "renders-within" }],
  });

  expect(result.passed).toBe(true);
  expect(mockDeps.learningPromoter.promoteLearnings).toHaveBeenCalled();
});
```

## Scenario 9: Fix Plan Auto-Generation

```typescript
test("Verification fails → fix beads created → re-verify", async () => {
  // First verification: artifact fails
  mockVerificationEngine.verifyArtifacts
    .mockReturnValueOnce([{ path: "toggle.tsx", check: "wired", passed: false, reason: "file not imported" }])
    .mockReturnValueOnce([{ path: "toggle.tsx", check: "wired", passed: true }]); // passes after fix

  const result = await verifier.verifyPhase(mustHaves);

  expect(result.passed).toBe(true);
  expect(result.iterations).toBe(2);
  expect(result.fixBeadsCreated.length).toBe(1);
  expect(mockDeps.beadClient.create).toHaveBeenCalledWith(expect.objectContaining({
    type: "bug",
    priority: 0,
  }));
});
```

## Scenario 10: Resume from STATE.md

```typescript
test("Resume continues from last completed wave", async () => {
  // STATE.md shows wave 1 complete, wave 2 in progress
  mockStateManager.loadState.mockReturnValue({
    currentWave: 2,
    waves: [
      { number: 1, status: "completed" },
      { number: 2, status: "in_progress", tasks: [
        { beadId: "bd-1.3", status: "in_progress" },
      ]},
    ],
  });

  mockSpawnWorker.mockResolvedValue({ status: "completed" });

  const result = await dispatcher.resume(".planning/STATE.md");

  // Should NOT re-execute wave 1
  expect(mockSpawnWorker).toHaveBeenCalledTimes(1); // Only wave 2 task
  expect(mockSpawnWorker).toHaveBeenCalledWith("bd-1.3", expect.any(Array));
  expect(result.success).toBe(true);
});
```

---

## Regression Checks

After all new tests pass, verify no regressions:

```bash
# Existing swarm tests
bun test packages/opencode-swarm-plugin/src/swarm-orchestrate.test.ts
bun test packages/opencode-swarm-plugin/src/swarm-validation.test.ts
bun test packages/opencode-swarm-plugin/src/swarm-prompts.test.ts
bun test packages/opencode-swarm-plugin/src/coordinator-guard.test.ts

# Phase 4 GSD tests
bun test packages/opencode-swarm-plugin/src/gsd/

# Full package test
bun test packages/opencode-swarm-plugin/
```

---

## Final Verification Checklist

Before marking Phase 5 complete, ALL of these must be true:

- [ ] `bun test packages/opencode-swarm-plugin/src/queen/` — all pass
- [ ] `bun test packages/opencode-swarm-plugin/src/worker/` — all pass
- [ ] `bun test packages/opencode-swarm-plugin/src/__tests__/orchestration-e2e.test.ts` — all pass
- [ ] `bun test packages/opencode-swarm-plugin/src/gsd/` — all pass (no regression)
- [ ] `bun test packages/opencode-swarm-plugin/` — no new failures beyond pre-existing ones
- [ ] `bunx tsc --noEmit` — zero typecheck errors
- [ ] Total new tests ≥ 200
- [ ] No circular dependencies between queen/ and worker/
- [ ] All event emissions use existing swarm-mail event store (not a new store)
- [ ] All message validation uses Sub-Plan 01's CortexMessageSchema
