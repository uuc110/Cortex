import { describe, expect, mock, test } from "bun:test";

import { createReviewHandler } from "../review-handler.js";

const buildDeps = () => ({
  sendMail: mock(async () => undefined) as any,
  beadClient: {
    update: mock(async () => undefined) as any,
  },
  eventStore: { emit: mock((..._args: any[]) => undefined) as any },
  verificationRunner: {
    runVerificationGate: mock(async () => ({ passed: true, errors: [] })) as any,
  },
});

const buildCompletedMsg = (beadId: string, files: string[]) => ({
  tag: "DONE",
  beadId,
  summary: "Done",
  files,
  __meta: { from: "worker-1", threadId: `thread-${beadId}` },
});

describe("Review handler", () => {
  test("Verification passes approved", async () => {
    const deps = buildDeps();
    const handler = createReviewHandler(deps);
    const result = await handler.handleCompleted(buildCompletedMsg("bead-1", [
      "src/a.ts",
    ]));
    expect(result.status).toBe("approved");
  });

  test("Verification pass clears attempts", async () => {
    const deps = buildDeps();
    deps.verificationRunner.runVerificationGate.mockImplementation(async () => ({
      passed: false,
      errors: ["src/a.ts:1: fail"],
    }));
    const handler = createReviewHandler(deps);
    await handler.handleCompleted(buildCompletedMsg("bead-2", ["src/a.ts"]));
    deps.verificationRunner.runVerificationGate.mockImplementation(async () => ({
      passed: true,
      errors: [],
    }));
    await handler.handleCompleted(buildCompletedMsg("bead-2", ["src/a.ts"]));
    expect(handler.getAttemptCount("bead-2")).toBe(0);
  });

  test("Fails 1st time needs_changes 2 remaining", async () => {
    const deps = buildDeps();
    deps.verificationRunner.runVerificationGate.mockImplementation(async () => ({
      passed: false,
      errors: ["src/a.ts:1: fail"],
    }));
    const handler = createReviewHandler(deps);
    const result = await handler.handleCompleted(buildCompletedMsg("bead-3", [
      "src/a.ts",
    ]));
    expect(result.status).toBe("needs_changes");
    expect(result.remainingAttempts).toBe(2);
  });

  test("Fails 2nd time needs_changes 1 remaining", async () => {
    const deps = buildDeps();
    deps.verificationRunner.runVerificationGate.mockImplementation(async () => ({
      passed: false,
      errors: ["src/a.ts:1: fail"],
    }));
    const handler = createReviewHandler(deps);
    await handler.handleCompleted(buildCompletedMsg("bead-4", ["src/a.ts"]));
    const result = await handler.handleCompleted(buildCompletedMsg("bead-4", [
      "src/a.ts",
    ]));
    expect(result.remainingAttempts).toBe(1);
  });

  test("Fails 3rd time blocked", async () => {
    const deps = buildDeps();
    deps.verificationRunner.runVerificationGate.mockImplementation(async () => ({
      passed: false,
      errors: ["src/a.ts:1: fail"],
    }));
    const handler = createReviewHandler(deps);
    await handler.handleCompleted(buildCompletedMsg("bead-5", ["src/a.ts"]));
    await handler.handleCompleted(buildCompletedMsg("bead-5", ["src/a.ts"]));
    const result = await handler.handleCompleted(buildCompletedMsg("bead-5", [
      "src/a.ts",
    ]));
    expect(result.status).toBe("blocked");
    expect(deps.beadClient.update.mock.calls.length).toBe(1);
  });

  test("Events emitted on approval", async () => {
    const deps = buildDeps();
    const handler = createReviewHandler(deps);
    await handler.handleCompleted(buildCompletedMsg("bead-6", ["src/a.ts"]));
    expect(deps.eventStore.emit.mock.calls[0][0]).toBe("task_completed");
  });

  test("Events emitted on block", async () => {
    const deps = buildDeps();
    deps.verificationRunner.runVerificationGate.mockImplementation(async () => ({
      passed: false,
      errors: ["src/a.ts:1: fail"],
    }));
    const handler = createReviewHandler(deps);
    await handler.handleCompleted(buildCompletedMsg("bead-7", ["src/a.ts"]));
    await handler.handleCompleted(buildCompletedMsg("bead-7", ["src/a.ts"]));
    await handler.handleCompleted(buildCompletedMsg("bead-7", ["src/a.ts"]));
    const [lastCall] = deps.eventStore.emit.mock.calls.slice(-1);
    expect(lastCall?.[0]).toBe("task_blocked");
  });

  test("Attempt count getter returns value", async () => {
    const deps = buildDeps();
    deps.verificationRunner.runVerificationGate.mockImplementation(async () => ({
      passed: false,
      errors: ["src/a.ts:1: fail"],
    }));
    const handler = createReviewHandler(deps);
    await handler.handleCompleted(buildCompletedMsg("bead-8", ["src/a.ts"]));
    expect(handler.getAttemptCount("bead-8")).toBe(1);
  });

  test("Remaining attempts getter returns value", async () => {
    const deps = buildDeps();
    deps.verificationRunner.runVerificationGate.mockImplementation(async () => ({
      passed: false,
      errors: ["src/a.ts:1: fail"],
    }));
    const handler = createReviewHandler(deps);
    await handler.handleCompleted(buildCompletedMsg("bead-9", ["src/a.ts"]));
    expect(handler.getRemainingAttempts("bead-9")).toBe(2);
  });

  test("SendMail called on approval", async () => {
    const deps = buildDeps();
    const handler = createReviewHandler(deps);
    await handler.handleCompleted(buildCompletedMsg("bead-10", ["src/a.ts"]));
    expect(deps.sendMail.mock.calls.length).toBe(1);
  });

  test("SendMail called on needs_changes", async () => {
    const deps = buildDeps();
    deps.verificationRunner.runVerificationGate.mockImplementation(async () => ({
      passed: false,
      errors: ["src/a.ts:1: fail"],
    }));
    const handler = createReviewHandler(deps);
    await handler.handleCompleted(buildCompletedMsg("bead-11", ["src/a.ts"]));
    expect(deps.sendMail.mock.calls.length).toBe(1);
  });

  test("Issues parsed with file/line", async () => {
    const deps = buildDeps();
    deps.verificationRunner.runVerificationGate.mockImplementation(async () => ({
      passed: false,
      errors: ["src/a.ts:12: Missing semicolon"],
    }));
    const handler = createReviewHandler(deps);
    const result = await handler.handleCompleted(buildCompletedMsg("bead-12", [
      "src/a.ts",
    ]));
    expect(result.issues?.[0].file).toBe("src/a.ts");
    expect(result.issues?.[0].line).toBe(12);
  });

  test("Issues parsed with fallback unknown", async () => {
    const deps = buildDeps();
    deps.verificationRunner.runVerificationGate.mockImplementation(async () => ({
      passed: false,
      errors: ["Random failure"],
    }));
    const handler = createReviewHandler(deps);
    const result = await handler.handleCompleted(buildCompletedMsg("bead-13", [
      "src/a.ts",
    ]));
    expect(result.issues?.[0].file).toBe("unknown");
  });

  test("Blocked response remaining attempts 0", async () => {
    const deps = buildDeps();
    deps.verificationRunner.runVerificationGate.mockImplementation(async () => ({
      passed: false,
      errors: ["src/a.ts:1: fail"],
    }));
    const handler = createReviewHandler(deps);
    await handler.handleCompleted(buildCompletedMsg("bead-14", ["src/a.ts"]));
    await handler.handleCompleted(buildCompletedMsg("bead-14", ["src/a.ts"]));
    const result = await handler.handleCompleted(buildCompletedMsg("bead-14", [
      "src/a.ts",
    ]));
    expect(result.remainingAttempts).toBe(0);
  });

  test("Approved response has no remaining attempts", async () => {
    const deps = buildDeps();
    const handler = createReviewHandler(deps);
    const result = await handler.handleCompleted(buildCompletedMsg("bead-15", [
      "src/a.ts",
    ]));
    expect(result.remainingAttempts).toBeUndefined();
  });
});
