import { describe, expect, mock, test } from "bun:test";

import { createDecisionHandler } from "../decision-handler.js";

const buildDeps = () => ({
  sendMail: mock(async () => undefined) as any,
  eventStore: { emit: mock((..._args: any[]) => undefined) as any },
  memoryRecall: mock(async () => []) as any,
});

describe("Decision handler", () => {
  test("Discovery P0 approved", async () => {
    const deps = buildDeps();
    const handler = createDecisionHandler(deps);
    const result = await handler.handleDiscovery({
      tag: "DISCOVERY",
      beadId: "bead-1",
      childBeadId: "bead-1a",
      title: "Task",
      priority: 0,
      rationale: "Need",
    });

    expect(result.action).toBe("approved");
    expect(result.replyMessage.tag).toBe("APPROVED");
  });

  test("Discovery P3 approved", async () => {
    const deps = buildDeps();
    const handler = createDecisionHandler(deps);
    const result = await handler.handleDiscovery({
      tag: "DISCOVERY",
      beadId: "bead-2",
      childBeadId: "bead-2a",
      title: "Task",
      priority: 3,
      rationale: "Need",
    });
    expect(result.action).toBe("approved");
  });

  test("Discovery P4 rejected", async () => {
    const deps = buildDeps();
    const handler = createDecisionHandler(deps);
    const result = await handler.handleDiscovery({
      tag: "DISCOVERY",
      beadId: "bead-3",
      childBeadId: "bead-3a",
      title: "Task",
      priority: 4,
      rationale: "Need",
    });
    expect(result.action).toBe("rejected");
    expect(result.replyMessage.tag).toBe("REJECTED");
  });

  test("Decision with recommendation approved", async () => {
    const deps = buildDeps();
    const handler = createDecisionHandler(deps);
    const result = await handler.handleDecisionRequest({
      tag: "DECISION",
      beadId: "bead-4",
      question: "Pick",
      options: [
        { label: "A", description: "A" },
        { label: "B", description: "B" },
      ],
      recommendation: "A",
    });
    expect(result.action).toBe("approved");
    expect(result.replyMessage.tag).toBe("APPROVED");
  });

  test("Decision without recommendation deferred", async () => {
    const deps = buildDeps();
    const handler = createDecisionHandler(deps);
    const result = await handler.handleDecisionRequest({
      tag: "DECISION",
      beadId: "bead-5",
      question: "Pick",
      options: [
        { label: "A", description: "A" },
        { label: "B", description: "B" },
      ],
    });
    expect(result.action).toBe("deferred");
    expect(result.replyMessage.tag).toBe("DEFERRED");
  });

  test("Help with recommendation approved", async () => {
    const deps = buildDeps();
    const handler = createDecisionHandler(deps);
    const result = await handler.handleHelpRequest({
      tag: "HELP",
      beadId: "bead-6",
      question: "Help?",
      context: "Context",
      recommendation: "Do X",
    });
    expect(result.action).toBe("approved");
    expect(result.replyMessage.tag).toBe("APPROVED");
  });

  test("Help without recommendation uses memory", async () => {
    const deps = buildDeps();
    deps.memoryRecall.mockImplementation(async () => [
      { info: "Remember this" },
    ]);
    const handler = createDecisionHandler(deps);
    const result = await handler.handleHelpRequest({
      tag: "HELP",
      beadId: "bead-7",
      question: "Help?",
      context: "Context",
    });
    expect(result.replyMessage.tag).toBe("CONTEXT");
    expect(result.action).toBe("approved");
  });

  test("Help without recommendation and no memory deferred", async () => {
    const deps = buildDeps();
    const handler = createDecisionHandler(deps);
    const result = await handler.handleHelpRequest({
      tag: "HELP",
      beadId: "bead-8",
      question: "Help?",
      context: "Context",
    });
    expect(result.action).toBe("deferred");
    expect(result.replyMessage.tag).toBe("DEFERRED");
  });

  test("Discovery emits queen_decision_made", async () => {
    const deps = buildDeps();
    const handler = createDecisionHandler(deps);
    await handler.handleDiscovery({
      tag: "DISCOVERY",
      beadId: "bead-9",
      childBeadId: "bead-9a",
      title: "Task",
      priority: 2,
      rationale: "Need",
    });
    expect(deps.eventStore.emit.mock.calls[0][0]).toBe("queen_decision_made");
  });

  test("Decision emits queen_decision_made", async () => {
    const deps = buildDeps();
    const handler = createDecisionHandler(deps);
    await handler.handleDecisionRequest({
      tag: "DECISION",
      beadId: "bead-10",
      question: "Pick",
      options: [
        { label: "A", description: "A" },
        { label: "B", description: "B" },
      ],
      recommendation: "A",
    });
    expect(deps.eventStore.emit.mock.calls[0][0]).toBe("queen_decision_made");
  });

  test("Help emits queen_decision_made", async () => {
    const deps = buildDeps();
    const handler = createDecisionHandler(deps);
    await handler.handleHelpRequest({
      tag: "HELP",
      beadId: "bead-11",
      question: "Help",
      context: "Context",
    });
    expect(deps.eventStore.emit.mock.calls[0][0]).toBe("queen_decision_made");
  });

  test("Decision reply includes recommendation", async () => {
    const deps = buildDeps();
    const handler = createDecisionHandler(deps);
    const result = await handler.handleDecisionRequest({
      tag: "DECISION",
      beadId: "bead-12",
      question: "Pick",
      options: [
        { label: "A", description: "A" },
        { label: "B", description: "B" },
      ],
      recommendation: "Option A",
    });
    expect(result.replyMessage.decision).toBe("Option A");
  });

  test("Help uses combined query for memory recall", async () => {
    const deps = buildDeps();
    const handler = createDecisionHandler(deps);
    await handler.handleHelpRequest({
      tag: "HELP",
      beadId: "bead-13",
      question: "Q",
      context: "C",
    });
    const [query] = deps.memoryRecall.mock.calls[0];
    expect(query).toContain("Q");
    expect(query).toContain("C");
  });

  test("Help context reply combines memory info", async () => {
    const deps = buildDeps();
    deps.memoryRecall.mockImplementation(async () => [
      { info: "First" },
      { text: "Second" },
    ]);
    const handler = createDecisionHandler(deps);
    const result = await handler.handleHelpRequest({
      tag: "HELP",
      beadId: "bead-14",
      question: "Q",
      context: "C",
    });
    expect(result.replyMessage.update).toContain("First");
    expect(result.replyMessage.update).toContain("Second");
  });

  test("Deferred decision includes waitingFor", async () => {
    const deps = buildDeps();
    const handler = createDecisionHandler(deps);
    const result = await handler.handleDecisionRequest({
      tag: "DECISION",
      beadId: "bead-15",
      question: "Pick",
      options: [
        { label: "A", description: "A" },
        { label: "B", description: "B" },
      ],
    });
    expect(result.replyMessage.waitingFor).toBe("recommendation");
  });
});
