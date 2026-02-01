import { describe, expect, test, beforeEach, mock } from "bun:test";

import type { WorkerContext } from "../context-loader.js";
import type { ExecutionResult, VerificationResult, WorkerStep } from "../lifecycle.js";

import { createWorkerLifecycle } from "../lifecycle.js";

const baseContext: WorkerContext = {
  bead: {
    id: "bead-1",
    title: "Implement worker lifecycle",
    description: "",
    status: "open",
    priority: 1,
    parentId: "epic-1",
  },
  epic: {
    id: "epic-1",
    title: "Worker epic",
    description: "",
    status: "open",
    priority: 2,
  },
  siblings: [
    {
      id: "bead-2",
      title: "Sibling task",
      description: "",
      status: "open",
      priority: 1,
    },
  ],
  dependencies: [
    {
      id: "bead-3",
      title: "Dependency task",
      description: "",
      status: "blocked",
      priority: 1,
    },
  ],
  memoryContext: [{ info: "Remember to mock", tags: "tests" }],
  projectPath: "/tmp/project",
  projectKey: "proj-key",
};

const successExecution: ExecutionResult = {
  success: true,
  files: ["src/worker/lifecycle.ts"],
  commit: "abc123",
  learnings: [{ info: "Use mocks", tags: "testing" }],
};

const successVerification: VerificationResult = {
  passed: true,
  buildOk: true,
  testsOk: true,
  typeCheckOk: true,
  errors: [],
};

describe("createWorkerLifecycle", () => {
  let beadClient: {
    show: ReturnType<typeof mock>;
    update: ReturnType<typeof mock>;
    close: ReturnType<typeof mock>;
  };
  let eventStore: { emit: ReturnType<typeof mock> };
  let memoryStore: ReturnType<typeof mock>;
  let contextLoader: { loadWorkerContext: ReturnType<typeof mock> };
  let selfVerifier: { verify: ReturnType<typeof mock> };
  let mailSender: {
    sendStatus: ReturnType<typeof mock>;
    sendCompleted: ReturnType<typeof mock>;
    sendBlocked: ReturnType<typeof mock>;
  };

  beforeEach(() => {
    beadClient = {
      show: mock(async () => baseContext.bead),
      update: mock(async () => {}),
      close: mock(async () => {}),
    };
    eventStore = { emit: mock(() => {}) };
    memoryStore = mock(async () => {});
    contextLoader = { loadWorkerContext: mock(async () => baseContext) };
    selfVerifier = { verify: mock(async () => successVerification) };
    mailSender = {
      sendStatus: mock(async () => {}),
      sendCompleted: mock(async () => {}),
      sendBlocked: mock(async () => {}),
    };
  });

  function createLifecycle() {
    return createWorkerLifecycle(
      {
        beadId: "bead-1",
        projectPath: "/tmp/project",
        projectKey: "proj-key",
        workerName: "worker-1",
      },
      {
        beadClient,
        eventStore,
        memoryStore,
        contextLoader,
        selfVerifier,
        mailSender: {
          ...mailSender,
          sendDiscovery: mock(async () => {}),
          sendDecisionNeeded: mock(async () => {}),
          sendHelpRequest: mock(async () => {}),
          sendFileHeadsUp: mock(async () => {}),
          sendDependencyReady: mock(async () => {}),
        },
      },
    );
  }

  test("runs full lifecycle successfully", async () => {
    const lifecycle = createLifecycle();
    const result = await lifecycle.run(async () => successExecution);
    expect(result.status).toBe("completed");
    expect(result.executionResult?.success).toBe(true);
  });

  test("PICKUP updates bead status to in_progress", async () => {
    const lifecycle = createLifecycle();
    await lifecycle.run(async () => successExecution);
    expect(beadClient.update).toHaveBeenCalledWith("bead-1", {
      status: "in_progress",
    });
  });

  test("PICKUP emits task_started", async () => {
    const lifecycle = createLifecycle();
    await lifecycle.run(async () => successExecution);
    expect(eventStore.emit).toHaveBeenCalledWith(
      "task_started",
      expect.objectContaining({ beadId: "bead-1" }),
    );
  });

  test("PICKUP sends planning status at 5%", async () => {
    const lifecycle = createLifecycle();
    await lifecycle.run(async () => successExecution);
    expect(mailSender.sendStatus).toHaveBeenCalledWith(
      "bead-1",
      "planning",
      5,
    );
  });

  test("ORIENT loads worker context", async () => {
    const lifecycle = createLifecycle();
    await lifecycle.run(async () => successExecution);
    expect(contextLoader.loadWorkerContext).toHaveBeenCalledWith("bead-1");
  });

  test("PLAN includes bead title", async () => {
    const lifecycle = createLifecycle();
    let plan = "";
    await lifecycle.run(async (_context, planString) => {
      plan = planString;
      return successExecution;
    });
    expect(plan).toContain(`Task: ${baseContext.bead.title}`);
  });

  test("PLAN includes epic title", async () => {
    const lifecycle = createLifecycle();
    let plan = "";
    await lifecycle.run(async (_context, planString) => {
      plan = planString;
      return successExecution;
    });
    expect(plan).toContain(`Epic: ${baseContext.epic?.title}`);
  });

  test("EXECUTE calls taskExecutor with context", async () => {
    const lifecycle = createLifecycle();
    let passedContext: WorkerContext | undefined;
    await lifecycle.run(async (context) => {
      passedContext = context;
      return successExecution;
    });
    expect(passedContext?.bead.id).toBe("bead-1");
  });

  test("EXECUTE sends executing status at 50%", async () => {
    const lifecycle = createLifecycle();
    await lifecycle.run(async () => successExecution);
    expect(mailSender.sendStatus).toHaveBeenCalledWith(
      "bead-1",
      "executing",
      50,
    );
  });

  test("VERIFY runs self verifier on success", async () => {
    const lifecycle = createLifecycle();
    await lifecycle.run(async () => successExecution);
    expect(selfVerifier.verify).toHaveBeenCalledWith(
      "/tmp/project",
      successExecution.files,
    );
  });

  test("VERIFY failure returns blocked", async () => {
    selfVerifier.verify = mock(async () => ({
      ...successVerification,
      passed: false,
      errors: ["Typecheck failed"],
    }));
    const lifecycle = createLifecycle();
    const result = await lifecycle.run(async () => successExecution);
    expect(result.status).toBe("blocked");
  });

  test("VERIFY failure sends blocked mail", async () => {
    selfVerifier.verify = mock(async () => ({
      ...successVerification,
      passed: false,
      errors: ["Typecheck failed"],
    }));
    const lifecycle = createLifecycle();
    await lifecycle.run(async () => successExecution);
    expect(mailSender.sendBlocked).toHaveBeenCalled();
  });

  test("EXECUTE failure returns failed", async () => {
    const lifecycle = createLifecycle();
    const result = await lifecycle.run(async () => ({
      success: false,
      files: [],
      errors: ["Failed to run"],
    }));
    expect(result.status).toBe("failed");
  });

  test("EXECUTE failure sends blocked mail", async () => {
    const lifecycle = createLifecycle();
    await lifecycle.run(async () => ({
      success: false,
      files: [],
      errors: ["Failed to run"],
    }));
    expect(mailSender.sendBlocked).toHaveBeenCalled();
  });

  test("LEARN stores learnings", async () => {
    const lifecycle = createLifecycle();
    await lifecycle.run(async () => successExecution);
    expect(memoryStore).toHaveBeenCalledWith("Use mocks", "testing");
  });

  test("LEARN emits learning_stored", async () => {
    const lifecycle = createLifecycle();
    await lifecycle.run(async () => successExecution);
    expect(eventStore.emit).toHaveBeenCalledWith(
      "learning_stored",
      expect.objectContaining({ beadId: "bead-1" }),
    );
  });

  test("LEARN sends learning status", async () => {
    const lifecycle = createLifecycle();
    await lifecycle.run(async () => successExecution);
    expect(mailSender.sendStatus).toHaveBeenCalledWith(
      "bead-1",
      "learning",
      90,
    );
  });

  test("REPORT sends completed message", async () => {
    const lifecycle = createLifecycle();
    await lifecycle.run(async () => successExecution);
    expect(mailSender.sendCompleted).toHaveBeenCalled();
  });

  test("CLOSE closes bead and emits task_completed", async () => {
    const lifecycle = createLifecycle();
    await lifecycle.run(async () => successExecution);
    expect(beadClient.close).toHaveBeenCalled();
    expect(eventStore.emit).toHaveBeenCalledWith(
      "task_completed",
      expect.objectContaining({ beadId: "bead-1" }),
    );
  });

  test("getCurrentStep reports execute during task execution", async () => {
    const lifecycle = createLifecycle();
    const steps: WorkerStep[] = [];
    await lifecycle.run(async () => {
      steps.push(lifecycle.getCurrentStep());
      return successExecution;
    });
    expect(steps[0]).toBe("execute");
  });

  test("no learnings skips memory store", async () => {
    const lifecycle = createLifecycle();
    await lifecycle.run(async () => ({
      success: true,
      files: ["src/worker/lifecycle.ts"],
    }));
    expect(memoryStore).not.toHaveBeenCalled();
  });

  test("no learnings skips learning status", async () => {
    const lifecycle = createLifecycle();
    await lifecycle.run(async () => ({
      success: true,
      files: ["src/worker/lifecycle.ts"],
    }));
    const learningCalls = mailSender.sendStatus.mock.calls.filter(
      (call) => call[1] === "learning",
    );
    expect(learningCalls.length).toBe(0);
  });
});
