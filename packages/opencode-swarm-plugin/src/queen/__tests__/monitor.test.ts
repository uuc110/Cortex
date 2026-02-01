import {
  afterEach,
  beforeEach,
  describe,
  expect,
  mock,
  spyOn,
  test,
} from "bun:test";

import { createQueenMonitor } from "../monitor.js";
import { formatMessageBody } from "../message-types.js";

const buildInboxMessage = (id: number, from: string, msg: any) => ({
  id,
  from,
  subject: `[${msg.tag}] ${msg.beadId ?? "bead"}: subject`,
  body: formatMessageBody(msg),
  thread_id: `thread-${id}`,
});

const buildDeps = () => {
  const getInbox = mock(async () => ({ messages: [] as any[] })) as any;
  const sendMail = mock(async () => undefined) as any;
  const eventStore = {
    emit: mock((..._args: any[]) => undefined) as any,
  };
  const decisionHandler = {
    handleDiscovery: mock(async () => ({
      action: "approved",
      reason: "ok",
      replyMessage: { tag: "APPROVED", beadId: "bead-1", decision: "Ok" },
    })),
    handleDecisionRequest: mock(async () => ({
      action: "approved",
      reason: "ok",
      replyMessage: { tag: "APPROVED", beadId: "bead-1", decision: "Ok" },
    })),
    handleHelpRequest: mock(async () => ({
      action: "approved",
      reason: "ok",
      replyMessage: { tag: "APPROVED", beadId: "bead-1", decision: "Ok" },
    })),
  };
  const reviewHandler = {
    handleCompleted: mock(async () => ({ status: "approved" })),
  };

  return {
    getInbox,
    sendMail,
    beadClient: {
      show: mock(async () => ({})),
      list: mock(async () => []),
      update: mock(async () => undefined),
      close: mock(async () => undefined),
    },
    eventStore,
    decisionHandler,
    reviewHandler,
  };
};

describe("Queen monitor", () => {
  let consoleSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    consoleSpy = spyOn(console, "info").mockImplementation(() => undefined);
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  test("processOnce with no messages increments idle", async () => {
    const deps = buildDeps();
    const monitor = createQueenMonitor(
      { projectKey: "proj", epicBeadId: "epic", maxIdlePolls: 5 },
      deps,
    );

    await monitor.processOnce();

    expect(monitor.getStats().idlePolls).toBe(1);
  });

  test("processOnce with STATUS emits event", async () => {
    const deps = buildDeps();
    deps.getInbox.mockImplementation(async () => ({
      messages: [
        buildInboxMessage(1, "worker-1", {
          tag: "STATUS",
          beadId: "bead-1",
          status: "executing",
          percentComplete: 50,
        }),
      ],
    }));

    const monitor = createQueenMonitor(
      { projectKey: "proj", epicBeadId: "epic" },
      deps,
    );

    await monitor.processOnce();

    expect(deps.eventStore.emit.mock.calls.length).toBe(1);
    const [firstCall] = deps.eventStore.emit.mock.calls;
    expect(firstCall?.[0]).toBe("task_status");
  });

  test("processOnce routes DONE to reviewHandler", async () => {
    const deps = buildDeps();
    deps.getInbox.mockImplementation(async () => ({
      messages: [
        buildInboxMessage(1, "worker-1", {
          tag: "DONE",
          beadId: "bead-2",
          summary: "Done",
          files: ["src/a.ts"],
        }),
      ],
    }));
    const monitor = createQueenMonitor(
      { projectKey: "proj", epicBeadId: "epic" },
      deps,
    );

    await monitor.processOnce();

    expect(deps.reviewHandler.handleCompleted.mock.calls.length).toBe(1);
  });

  test("processOnce routes DISCOVERY to decisionHandler", async () => {
    const deps = buildDeps();
    deps.getInbox.mockImplementation(async () => ({
      messages: [
        buildInboxMessage(1, "worker-1", {
          tag: "DISCOVERY",
          beadId: "bead-3",
          childBeadId: "bead-4",
          title: "New task",
          priority: 1,
          rationale: "Need it",
        }),
      ],
    }));
    const monitor = createQueenMonitor(
      { projectKey: "proj", epicBeadId: "epic" },
      deps,
    );

    await monitor.processOnce();

    expect(deps.decisionHandler.handleDiscovery.mock.calls.length).toBe(1);
  });

  test("processOnce routes HELP to decisionHandler", async () => {
    const deps = buildDeps();
    deps.getInbox.mockImplementation(async () => ({
      messages: [
        buildInboxMessage(2, "worker-1", {
          tag: "HELP",
          beadId: "bead-5",
          question: "How?",
          context: "Context",
        }),
      ],
    }));
    const monitor = createQueenMonitor(
      { projectKey: "proj", epicBeadId: "epic" },
      deps,
    );

    await monitor.processOnce();

    expect(deps.decisionHandler.handleHelpRequest.mock.calls.length).toBe(1);
  });

  test("processOnce emits event for BLOCKED", async () => {
    const deps = buildDeps();
    deps.getInbox.mockImplementation(async () => ({
      messages: [
        buildInboxMessage(3, "worker-1", {
          tag: "BLOCKED",
          beadId: "bead-6",
          blocker: "Waiting",
        }),
      ],
    }));
    const monitor = createQueenMonitor(
      { projectKey: "proj", epicBeadId: "epic" },
      deps,
    );

    await monitor.processOnce();

    const [firstCall] = deps.eventStore.emit.mock.calls;
    expect(firstCall?.[0]).toBe("task_blocked");
  });

  test("processOnce skips unknown subjects", async () => {
    const deps = buildDeps();
    deps.getInbox.mockImplementation(async () => ({
      messages: [
        {
          id: 4,
          from: "worker-1",
          subject: "Random",
          body: "beadId: bead-1",
        },
      ],
    }));
    const monitor = createQueenMonitor(
      { projectKey: "proj", epicBeadId: "epic" },
      deps,
    );

    await monitor.processOnce();

    expect(monitor.getStats().messagesProcessed).toBe(0);
  });

  test("processOnce skips malformed body", async () => {
    const deps = buildDeps();
    deps.getInbox.mockImplementation(async () => ({
      messages: [
        {
          id: 5,
          from: "worker-1",
          subject: "[STATUS] bead-1: update",
          body: "invalid body",
        },
      ],
    }));
    const monitor = createQueenMonitor(
      { projectKey: "proj", epicBeadId: "epic" },
      deps,
    );

    await monitor.processOnce();

    expect(monitor.getStats().messagesProcessed).toBe(0);
  });

  test("same message not processed twice", async () => {
    const deps = buildDeps();
    const message = buildInboxMessage(6, "worker-1", {
      tag: "STATUS",
      beadId: "bead-7",
      status: "planning",
      percentComplete: 10,
    });
    deps.getInbox.mockImplementation(async () => ({ messages: [message] }));

    const monitor = createQueenMonitor(
      { projectKey: "proj", epicBeadId: "epic" },
      deps,
    );

    await monitor.processOnce();
    await monitor.processOnce();

    expect(monitor.getStats().messagesProcessed).toBe(1);
  });

  test("auto-stops after maxIdlePolls", async () => {
    const deps = buildDeps();
    const monitor = createQueenMonitor(
      { projectKey: "proj", epicBeadId: "epic", maxIdlePolls: 1 },
      deps,
    );

    await monitor.processOnce();

    expect(monitor.isRunning()).toBe(false);
  });

  test("start/stop toggles running state", async () => {
    const deps = buildDeps();
    const monitor = createQueenMonitor(
      { projectKey: "proj", epicBeadId: "epic", maxIdlePolls: 1 },
      deps,
    );

    const startPromise = monitor.start();
    expect(monitor.isRunning()).toBe(true);
    await startPromise;
    expect(monitor.isRunning()).toBe(false);
  });

  test("getStats returns correct counts", async () => {
    const deps = buildDeps();
    deps.getInbox.mockImplementation(async () => ({
      messages: [
        buildInboxMessage(7, "worker-1", {
          tag: "STATUS",
          beadId: "bead-8",
          status: "executing",
          percentComplete: 75,
        }),
        buildInboxMessage(8, "worker-1", {
          tag: "DISCOVERY",
          beadId: "bead-9",
          childBeadId: "bead-9a",
          title: "Task",
          priority: 2,
          rationale: "Need",
        }),
      ],
    }));
    const monitor = createQueenMonitor(
      { projectKey: "proj", epicBeadId: "epic" },
      deps,
    );

    await monitor.processOnce();

    const stats = monitor.getStats();
    expect(stats.messagesProcessed).toBe(2);
    expect(stats.decisionsRouted).toBe(1);
  });

  test("idle counter resets after processing", async () => {
    const deps = buildDeps();
    const monitor = createQueenMonitor(
      { projectKey: "proj", epicBeadId: "epic" },
      deps,
    );

    await monitor.processOnce();

    deps.getInbox.mockImplementation(async () => ({
      messages: [
        buildInboxMessage(9, "worker-1", {
          tag: "STATUS",
          beadId: "bead-10",
          status: "planning",
          percentComplete: 10,
        }),
      ],
    }));

    await monitor.processOnce();

    expect(monitor.getStats().idlePolls).toBe(0);
  });

  test("routes DECISION to decisionHandler", async () => {
    const deps = buildDeps();
    deps.getInbox.mockImplementation(async () => ({
      messages: [
        buildInboxMessage(10, "worker-1", {
          tag: "DECISION",
          beadId: "bead-11",
          question: "Pick?",
          options: [
            { label: "A", description: "A" },
            { label: "B", description: "B" },
          ],
        }),
      ],
    }));
    const monitor = createQueenMonitor(
      { projectKey: "proj", epicBeadId: "epic" },
      deps,
    );

    await monitor.processOnce();

    expect(deps.decisionHandler.handleDecisionRequest.mock.calls.length).toBe(1);
  });

  test("logs FILE updates", async () => {
    const deps = buildDeps();
    deps.getInbox.mockImplementation(async () => ({
      messages: [
        buildInboxMessage(11, "worker-1", {
          tag: "FILE",
          beadId: "bead-12",
          files: ["src/a.ts"],
          changeType: "modified",
        }),
      ],
    }));
    const monitor = createQueenMonitor(
      { projectKey: "proj", epicBeadId: "epic" },
      deps,
    );

    await monitor.processOnce();

    expect(consoleSpy.mock.calls.length).toBe(1);
  });

  test("logs READY updates", async () => {
    const deps = buildDeps();
    deps.getInbox.mockImplementation(async () => ({
      messages: [
        buildInboxMessage(12, "worker-1", {
          tag: "READY",
          beadId: "bead-13",
          dependentBeadIds: ["bead-1"],
        }),
      ],
    }));
    const monitor = createQueenMonitor(
      { projectKey: "proj", epicBeadId: "epic" },
      deps,
    );

    await monitor.processOnce();

    expect(consoleSpy.mock.calls.length).toBe(1);
  });

  test("decisions routed increments count", async () => {
    const deps = buildDeps();
    deps.getInbox.mockImplementation(async () => ({
      messages: [
        buildInboxMessage(13, "worker-1", {
          tag: "DISCOVERY",
          beadId: "bead-14",
          childBeadId: "bead-14a",
          title: "Task",
          priority: 1,
          rationale: "Need",
        }),
        buildInboxMessage(14, "worker-1", {
          tag: "DECISION",
          beadId: "bead-15",
          question: "Pick?",
          options: [
            { label: "A", description: "A" },
            { label: "B", description: "B" },
          ],
        }),
      ],
    }));
    const monitor = createQueenMonitor(
      { projectKey: "proj", epicBeadId: "epic" },
      deps,
    );

    await monitor.processOnce();

    expect(monitor.getStats().decisionsRouted).toBe(2);
  });

  test("reviews routed increments count", async () => {
    const deps = buildDeps();
    deps.getInbox.mockImplementation(async () => ({
      messages: [
        buildInboxMessage(15, "worker-1", {
          tag: "DONE",
          beadId: "bead-16",
          summary: "Done",
          files: ["src/a.ts"],
        }),
      ],
    }));
    const monitor = createQueenMonitor(
      { projectKey: "proj", epicBeadId: "epic" },
      deps,
    );

    await monitor.processOnce();

    expect(monitor.getStats().reviewsRouted).toBe(1);
  });

  test("sendMail is called for decision replies", async () => {
    const deps = buildDeps();
    deps.getInbox.mockImplementation(async () => ({
      messages: [
        buildInboxMessage(16, "worker-1", {
          tag: "DISCOVERY",
          beadId: "bead-17",
          childBeadId: "bead-17a",
          title: "Task",
          priority: 1,
          rationale: "Need",
        }),
      ],
    }));

    const monitor = createQueenMonitor(
      { projectKey: "proj", epicBeadId: "epic" },
      deps,
    );

    await monitor.processOnce();

    expect(deps.sendMail.mock.calls.length).toBe(1);
    const [firstCall] = deps.sendMail.mock.calls;
    expect(firstCall?.[0].subject).toContain("[APPROVED]");
  });

  test("processOnce handles mixed message set", async () => {
    const deps = buildDeps();
    deps.getInbox.mockImplementation(async () => ({
      messages: [
        buildInboxMessage(17, "worker-1", {
          tag: "STATUS",
          beadId: "bead-18",
          status: "planning",
          percentComplete: 20,
        }),
        buildInboxMessage(18, "worker-1", {
          tag: "DONE",
          beadId: "bead-19",
          summary: "Done",
          files: ["src/a.ts"],
        }),
        buildInboxMessage(19, "worker-1", {
          tag: "HELP",
          beadId: "bead-20",
          question: "Help?",
          context: "Context",
        }),
      ],
    }));
    const monitor = createQueenMonitor(
      { projectKey: "proj", epicBeadId: "epic" },
      deps,
    );

    await monitor.processOnce();

    expect(monitor.getStats().messagesProcessed).toBe(3);
    expect(monitor.getStats().decisionsRouted).toBe(1);
    expect(monitor.getStats().reviewsRouted).toBe(1);
  });

  test("processOnce respects processed ids even within same inbox", async () => {
    const deps = buildDeps();
    const message = buildInboxMessage(20, "worker-1", {
      tag: "STATUS",
      beadId: "bead-21",
      status: "planning",
      percentComplete: 10,
    });
    deps.getInbox.mockImplementation(async () => ({ messages: [message, message] }));
    const monitor = createQueenMonitor(
      { projectKey: "proj", epicBeadId: "epic" },
      deps,
    );
    await monitor.processOnce();

    expect(monitor.getStats().messagesProcessed).toBe(1);
  });
});
