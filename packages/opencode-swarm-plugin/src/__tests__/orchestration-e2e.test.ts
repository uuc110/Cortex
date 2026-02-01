import { describe, expect, test, beforeEach, mock } from "bun:test";

import {
  CortexMessageSchema,
  parseCortexMessage,
  formatMessageBody,
  createMailEnvelope,
  classifyMessage,
  type CortexMessage,
  type MessageTag,
} from "../queen/message-types.js";
import { createQueenMonitor } from "../queen/monitor.js";
import { createDecisionHandler } from "../queen/decision-handler.js";
import { createReviewHandler } from "../queen/review-handler.js";
import { createLearningPromoter } from "../queen/learning-promoter.js";
import { createWaveDispatcher } from "../queen/wave-dispatcher.js";
import { createPhaseVerifier } from "../queen/phase-verifier.js";
import { createWorkerLifecycle } from "../worker/lifecycle.js";
import { createContextLoader } from "../worker/context-loader.js";
import { createWorkerMailSender } from "../worker/mail-sender.js";
import { createDiscoveryHandler } from "../worker/discovery-handler.js";

type SentMail = {
  fromAgent: string;
  toAgents: string[];
  subject: string;
  body: string;
  threadId: string;
  importance: string;
  ackRequired: boolean;
};

const buildInboxMessage = (
  id: number,
  envelope: SentMail,
  from: string,
): {
  id: number;
  from: string;
  subject: string;
  body: string;
  thread_id: string;
} => ({
  id,
  from,
  subject: envelope.subject,
  body: envelope.body,
  thread_id: envelope.threadId,
});

const readSentMessage = (sent: SentMail, expectedTag: MessageTag) => {
  const tag = classifyMessage(sent.subject);
  expect(tag).toBe(expectedTag);
  const parsed = parseCortexMessage(sent.subject, sent.body);
  expect(parsed).not.toBeNull();
  return parsed;
};

describe("Orchestration E2E", () => {
  describe("Queen DONE → Review flow", () => {
    test("approved when verification passes", async () => {
      const sent: SentMail[] = [];
      const sendMail = mock(async (params: SentMail) => {
        sent.push(params);
      });
      const eventStore = { emit: mock() };
      const beadClient = { update: mock(async () => {}) };

      const reviewHandler = createReviewHandler({
        sendMail,
        beadClient,
        eventStore,
        verificationRunner: {
          runVerificationGate: mock(async () => ({ passed: true, errors: [] })),
        },
      });

      const handleCompletedSpy = mock(async (msg: unknown) =>
        reviewHandler.handleCompleted(msg),
      );

      const monitor = createQueenMonitor(
        { projectKey: "proj", epicBeadId: "epic" },
        {
          getInbox: mock(async () => ({ messages: [] })),
          sendMail,
          beadClient: {
            show: mock(),
            list: mock(async () => []),
            update: mock(async () => {}),
            close: mock(async () => {}),
          },
          eventStore,
          decisionHandler: {
            handleDiscovery: mock(),
            handleDecisionRequest: mock(),
            handleHelpRequest: mock(),
          },
          reviewHandler: { handleCompleted: handleCompletedSpy },
        },
      );

      const doneMessage = {
        tag: "DONE",
        beadId: "bd-1",
        summary: "Completed task",
        files: ["src/a.ts"],
      } satisfies CortexMessage;

      const envelope = createMailEnvelope(doneMessage, "worker-a", ["queen"], "t1");
      const inboxMessage = buildInboxMessage(1, envelope, "worker-a");

      const getInbox = mock(async () => ({ messages: [inboxMessage] }));
      const monitorWithInbox = createQueenMonitor(
        { projectKey: "proj", epicBeadId: "epic" },
        {
          getInbox,
          sendMail,
          beadClient: {
            show: mock(),
            list: mock(async () => []),
            update: mock(async () => {}),
            close: mock(async () => {}),
          },
          eventStore,
          decisionHandler: {
            handleDiscovery: mock(),
            handleDecisionRequest: mock(),
            handleHelpRequest: mock(),
          },
          reviewHandler: { handleCompleted: handleCompletedSpy },
        },
      );

      await monitorWithInbox.processOnce();

      expect(handleCompletedSpy).toHaveBeenCalledTimes(1);
      expect(sent.length).toBe(1);
      const parsed = readSentMessage(sent[0], "REVIEW");
      expect(parsed?.tag).toBe("REVIEW");
      if (parsed?.tag === "REVIEW") {
        expect(parsed.status).toBe("approved");
      }
      expect(monitor.isRunning()).toBe(false);
    });

    test("needs changes with remaining attempts on first failure", async () => {
      const sent: SentMail[] = [];
      const sendMail = mock(async (params: SentMail) => {
        sent.push(params);
      });
      const eventStore = { emit: mock() };
      const beadClient = { update: mock(async () => {}) };

      const reviewHandler = createReviewHandler({
        sendMail,
        beadClient,
        eventStore,
        verificationRunner: {
          runVerificationGate: mock(async () => ({
            passed: false,
            errors: ["src/a.ts:10:Missing test"],
          })),
        },
      });

      const handleCompletedSpy = mock(async (msg: unknown) =>
        reviewHandler.handleCompleted(msg),
      );

      const monitor = createQueenMonitor(
        { projectKey: "proj", epicBeadId: "epic" },
        {
          getInbox: mock(async () => ({
            messages: [
              buildInboxMessage(
                1,
                createMailEnvelope(
                  {
                    tag: "DONE",
                    beadId: "bd-2",
                    summary: "done",
                    files: ["src/a.ts"],
                  },
                  "worker-a",
                  ["queen"],
                  "t2",
                ),
                "worker-a",
              ),
            ],
          })),
          sendMail,
          beadClient: {
            show: mock(),
            list: mock(async () => []),
            update: mock(async () => {}),
            close: mock(async () => {}),
          },
          eventStore,
          decisionHandler: {
            handleDiscovery: mock(),
            handleDecisionRequest: mock(),
            handleHelpRequest: mock(),
          },
          reviewHandler: { handleCompleted: handleCompletedSpy },
        },
      );

      await monitor.processOnce();

      expect(handleCompletedSpy).toHaveBeenCalledTimes(1);
      const parsed = readSentMessage(sent[0], "REVIEW");
      if (parsed?.tag === "REVIEW") {
        expect(parsed.status).toBe("needs_changes");
        expect(parsed.remainingAttempts).toBe(2);
        expect(parsed.issues?.length).toBe(1);
      }
    });

    test("blocks bead after three failed verifications", async () => {
      const sent: SentMail[] = [];
      const sendMail = mock(async (params: SentMail) => {
        sent.push(params);
      });
      const eventStore = { emit: mock() };
      const beadClient = { update: mock(async () => {}) };

      const reviewHandler = createReviewHandler({
        sendMail,
        beadClient,
        eventStore,
        verificationRunner: {
          runVerificationGate: mock(async () => ({
            passed: false,
            errors: ["src/a.ts:10:Missing test"],
          })),
        },
      });

      const handleCompletedSpy = mock(async (msg: unknown) =>
        reviewHandler.handleCompleted(msg),
      );

      const getInbox = mock(async () => ({
        messages: [
          buildInboxMessage(
            1,
            createMailEnvelope(
              {
                tag: "DONE",
                beadId: "bd-3",
                summary: "done",
                files: ["src/a.ts"],
              },
              "worker-a",
              ["queen"],
              "t3",
            ),
            "worker-a",
          ),
          buildInboxMessage(
            2,
            createMailEnvelope(
              {
                tag: "DONE",
                beadId: "bd-3",
                summary: "done",
                files: ["src/a.ts"],
              },
              "worker-a",
              ["queen"],
              "t3",
            ),
            "worker-a",
          ),
          buildInboxMessage(
            3,
            createMailEnvelope(
              {
                tag: "DONE",
                beadId: "bd-3",
                summary: "done",
                files: ["src/a.ts"],
              },
              "worker-a",
              ["queen"],
              "t3",
            ),
            "worker-a",
          ),
        ],
      }));

      const monitor = createQueenMonitor(
        { projectKey: "proj", epicBeadId: "epic" },
        {
          getInbox,
          sendMail,
          beadClient: {
            show: mock(),
            list: mock(async () => []),
            update: mock(async () => {}),
            close: mock(async () => {}),
          },
          eventStore,
          decisionHandler: {
            handleDiscovery: mock(),
            handleDecisionRequest: mock(),
            handleHelpRequest: mock(),
          },
          reviewHandler: { handleCompleted: handleCompletedSpy },
        },
      );

      await monitor.processOnce();

      expect(handleCompletedSpy).toHaveBeenCalledTimes(3);
      expect(beadClient.update).toHaveBeenCalledTimes(1);
      const parsed = readSentMessage(sent[2], "REVIEW");
      if (parsed?.tag === "REVIEW") {
        expect(parsed.status).toBe("needs_changes");
        expect(parsed.remainingAttempts).toBe(0);
      }
    });
  });

  describe("Queen DISCOVERY → priority gate", () => {
    test("priority 2 returns APPROVED", async () => {
      const sent: SentMail[] = [];
      const sendMail = mock(async (params: SentMail) => {
        sent.push(params);
      });
      const eventStore = { emit: mock() };
      const decisionHandler = createDecisionHandler({
        sendMail,
        eventStore,
        memoryRecall: mock(async () => []),
      });

      const discoveryMessage = createMailEnvelope(
        {
          tag: "DISCOVERY",
          beadId: "bd-4",
          childBeadId: "bd-4.1",
          title: "Add tests",
          priority: 2,
          rationale: "Needed",
        },
        "worker-a",
        ["queen"],
        "t4",
      );

      const monitor = createQueenMonitor(
        { projectKey: "proj", epicBeadId: "epic" },
        {
          getInbox: mock(async () => ({
            messages: [buildInboxMessage(1, discoveryMessage, "worker-a")],
          })),
          sendMail,
          beadClient: {
            show: mock(),
            list: mock(async () => []),
            update: mock(async () => {}),
            close: mock(async () => {}),
          },
          eventStore,
          decisionHandler,
          reviewHandler: { handleCompleted: mock() },
        },
      );

      await monitor.processOnce();

      const parsed = readSentMessage(sent[0], "APPROVED");
      if (parsed?.tag === "APPROVED") {
        expect(parsed.decision).toBe("Add tests");
      }
    });

    test("priority 4 returns REJECTED", async () => {
      const sent: SentMail[] = [];
      const sendMail = mock(async (params: SentMail) => {
        sent.push(params);
      });
      const eventStore = { emit: mock() };
      const decisionHandler = createDecisionHandler({
        sendMail,
        eventStore,
        memoryRecall: mock(async () => []),
      });

      const discoveryMessage = createMailEnvelope(
        {
          tag: "DISCOVERY",
          beadId: "bd-5",
          childBeadId: "bd-5.1",
          title: "Refactor",
          priority: 4,
          rationale: "Nice to have",
        },
        "worker-a",
        ["queen"],
        "t5",
      );

      const monitor = createQueenMonitor(
        { projectKey: "proj", epicBeadId: "epic" },
        {
          getInbox: mock(async () => ({
            messages: [buildInboxMessage(1, discoveryMessage, "worker-a")],
          })),
          sendMail,
          beadClient: {
            show: mock(),
            list: mock(async () => []),
            update: mock(async () => {}),
            close: mock(async () => {}),
          },
          eventStore,
          decisionHandler,
          reviewHandler: { handleCompleted: mock() },
        },
      );

      await monitor.processOnce();

      const parsed = readSentMessage(sent[0], "REJECTED");
      if (parsed?.tag === "REJECTED") {
        expect(parsed.reason).toBe("Priority too low for scope");
      }
    });
  });

  describe("Queen HELP → memory query", () => {
    test("memories found returns CONTEXT", async () => {
      const sent: SentMail[] = [];
      const sendMail = mock(async (params: SentMail) => {
        sent.push(params);
      });
      const eventStore = { emit: mock() };
      const decisionHandler = createDecisionHandler({
        sendMail,
        eventStore,
        memoryRecall: mock(async () => [{ info: "Use caching" }]),
      });

      const helpMessage = createMailEnvelope(
        {
          tag: "HELP",
          beadId: "bd-6",
          question: "How to cache?",
          context: "We need speed",
        },
        "worker-a",
        ["queen"],
        "t6",
      );

      const monitor = createQueenMonitor(
        { projectKey: "proj", epicBeadId: "epic" },
        {
          getInbox: mock(async () => ({
            messages: [buildInboxMessage(1, helpMessage, "worker-a")],
          })),
          sendMail,
          beadClient: {
            show: mock(),
            list: mock(async () => []),
            update: mock(async () => {}),
            close: mock(async () => {}),
          },
          eventStore,
          decisionHandler,
          reviewHandler: { handleCompleted: mock() },
        },
      );

      await monitor.processOnce();

      const parsed = readSentMessage(sent[0], "CONTEXT");
      if (parsed?.tag === "CONTEXT") {
        expect(parsed.update).toContain("Use caching");
      }
    });

    test("no memories returns DEFERRED", async () => {
      const sent: SentMail[] = [];
      const sendMail = mock(async (params: SentMail) => {
        sent.push(params);
      });
      const eventStore = { emit: mock() };
      const decisionHandler = createDecisionHandler({
        sendMail,
        eventStore,
        memoryRecall: mock(async () => []),
      });

      const helpMessage = createMailEnvelope(
        {
          tag: "HELP",
          beadId: "bd-7",
          question: "Need help",
          context: "Missing docs",
        },
        "worker-a",
        ["queen"],
        "t7",
      );

      const monitor = createQueenMonitor(
        { projectKey: "proj", epicBeadId: "epic" },
        {
          getInbox: mock(async () => ({
            messages: [buildInboxMessage(1, helpMessage, "worker-a")],
          })),
          sendMail,
          beadClient: {
            show: mock(),
            list: mock(async () => []),
            update: mock(async () => {}),
            close: mock(async () => {}),
          },
          eventStore,
          decisionHandler,
          reviewHandler: { handleCompleted: mock() },
        },
      );

      await monitor.processOnce();

      const parsed = readSentMessage(sent[0], "DEFERRED");
      if (parsed?.tag === "DEFERRED") {
        expect(parsed.waitingFor).toBe("additional_context");
      }
    });
  });

  describe("Worker lifecycle end-to-end", () => {
    let sendMail: ReturnType<typeof mock>;
    let sent: SentMail[];

    beforeEach(() => {
      sent = [];
      sendMail = mock(async (params: SentMail) => {
        sent.push(params);
      });
    });

    test("successful lifecycle runs all steps", async () => {
      const beadClient = {
        show: mock(async () => ({
          id: "bd-8",
          title: "Build feature",
          description: "",
          status: "open",
          priority: 1,
          parentId: "epic-1",
        })),
        list: mock(async () => [{ id: "bd-9", title: "Sibling" }]),
        listDeps: mock(async () => [{ id: "bd-dep", title: "Dep" }]),
        update: mock(async () => {}),
        close: mock(async () => {}),
      };

      const contextLoader = createContextLoader({
        beadClient,
        memoryRecall: mock(async () => [{ info: "remember" }]),
        projectPath: "/tmp/project",
        projectKey: "proj",
      });

      const mailSender = createWorkerMailSender(sendMail, "worker-a", "thread-8");
      const eventStore = { emit: mock() };

      const lifecycle = createWorkerLifecycle(
        {
          beadId: "bd-8",
          projectKey: "proj",
          projectPath: "/tmp/project",
          workerName: "worker-a",
        },
        {
          beadClient,
          eventStore,
          memoryStore: mock(async () => {}),
          contextLoader,
          selfVerifier: {
            verify: mock(async () => ({
              passed: true,
              buildOk: true,
              testsOk: true,
              typeCheckOk: true,
              errors: [],
            })),
          },
          mailSender,
        },
      );

      const taskExecutor = mock(async (_context, plan) => {
        expect(plan).toContain("Task: Build feature");
        return {
          success: true,
          files: ["src/feature.ts"],
          commit: "abc123",
          learnings: [{ info: "Learned", tags: "tag" }],
        };
      });

      const result = await lifecycle.run(taskExecutor);

      expect(result.status).toBe("completed");
      expect(beadClient.update).toHaveBeenCalledWith("bd-8", { status: "in_progress" });
      expect(taskExecutor).toHaveBeenCalledTimes(1);
      expect(beadClient.close).toHaveBeenCalledTimes(1);
      expect(lifecycle.getCurrentStep()).toBe("close");

      const done = sent.find((message) => classifyMessage(message.subject) === "DONE");
      expect(done).toBeDefined();
    });

    test("failed task executor sends BLOCKED", async () => {
      const beadClient = {
        show: mock(async () => ({
          id: "bd-9",
          title: "Bug fix",
          description: "",
          status: "open",
          priority: 1,
        })),
        list: mock(async () => []),
        update: mock(async () => {}),
        close: mock(async () => {}),
      };

      const contextLoader = createContextLoader({
        beadClient,
        memoryRecall: mock(async () => []),
        projectPath: "/tmp/project",
        projectKey: "proj",
      });

      const lifecycle = createWorkerLifecycle(
        {
          beadId: "bd-9",
          projectKey: "proj",
          projectPath: "/tmp/project",
          workerName: "worker-a",
        },
        {
          beadClient,
          eventStore: { emit: mock() },
          memoryStore: mock(async () => {}),
          contextLoader,
          selfVerifier: {
            verify: mock(async () => ({
              passed: true,
              buildOk: true,
              testsOk: true,
              typeCheckOk: true,
              errors: [],
            })),
          },
          mailSender: createWorkerMailSender(sendMail, "worker-a", "thread-9"),
        },
      );

      const result = await lifecycle.run(async () => ({
        success: false,
        files: [],
        errors: ["Exploded"],
      }));

      expect(result.status).toBe("failed");
      expect(beadClient.close).not.toHaveBeenCalled();
      const blocked = sent.find(
        (message) => classifyMessage(message.subject) === "BLOCKED",
      );
      expect(blocked).toBeDefined();
    });

    test("verification failure returns blocked", async () => {
      const beadClient = {
        show: mock(async () => ({
          id: "bd-10",
          title: "Audit",
          description: "",
          status: "open",
          priority: 1,
        })),
        list: mock(async () => []),
        update: mock(async () => {}),
        close: mock(async () => {}),
      };

      const contextLoader = createContextLoader({
        beadClient,
        memoryRecall: mock(async () => []),
        projectPath: "/tmp/project",
        projectKey: "proj",
      });

      const lifecycle = createWorkerLifecycle(
        {
          beadId: "bd-10",
          projectKey: "proj",
          projectPath: "/tmp/project",
          workerName: "worker-a",
        },
        {
          beadClient,
          eventStore: { emit: mock() },
          memoryStore: mock(async () => {}),
          contextLoader,
          selfVerifier: {
            verify: mock(async () => ({
              passed: false,
              buildOk: false,
              testsOk: false,
              typeCheckOk: false,
              errors: ["Test failure"],
            })),
          },
          mailSender: createWorkerMailSender(sendMail, "worker-a", "thread-10"),
        },
      );

      const result = await lifecycle.run(async () => ({
        success: true,
        files: ["src/a.ts"],
      }));

      expect(result.status).toBe("blocked");
      const blocked = sent.find(
        (message) => classifyMessage(message.subject) === "BLOCKED",
      );
      expect(blocked).toBeDefined();
    });
  });

  describe("Wave dispatcher end-to-end", () => {
    test("single wave with two tasks completes and saves state", async () => {
      const tasks = [
        { id: "t1", name: "Task 1", files: ["src/a.ts"], dependencies: [] },
        { id: "t2", name: "Task 2", files: ["src/b.ts"], dependencies: [] },
      ];

      const spawnOrder: string[] = [];

      const dispatcher = createWaveDispatcher(
        {
          projectKey: "proj",
          projectPath: "/tmp/project",
          epicBeadId: "epic",
          planningDir: "/tmp/plans",
          parallelWorkersPerWave: 2,
        },
        {
          calculateWaves: mock(() => ({
            waves: [
              {
                wave_number: 1,
                task_ids: tasks.map((task) => task.id),
                status: "pending" as const,
                parallel: true,
              },
            ],
            totalTasks: tasks.length,
            maxParallelism: 2,
            sequentialWaves: 1,
          })),
          saveState: mock(async () => {}),
          loadState: mock(async () => null),
          spawnWorker: mock(async (beadId: string) => {
            spawnOrder.push(beadId);
            return { status: "completed" as const };
          }),
          verifyWave: mock(async () => ({ passed: true, errors: [] })),
          createFixBead: mock(async () => "fix-1"),
          eventEmit: mock(),
        },
      );

      const result = await dispatcher.executeEpic(tasks);

      expect(result.success).toBe(true);
      expect(result.totalWaves).toBe(1);
      expect(spawnOrder).toEqual(["t1", "t2"]);
    });

    test("dependency creates two waves and orders execution", async () => {
      const tasks = [
        { id: "t1", name: "Task 1", files: ["src/a.ts"], dependencies: [] },
        { id: "t2", name: "Task 2", files: ["src/b.ts"], dependencies: ["t1"] },
      ];

      const spawnOrder: string[] = [];

      const dispatcher = createWaveDispatcher(
        {
          projectKey: "proj",
          projectPath: "/tmp/project",
          epicBeadId: "epic",
          planningDir: "/tmp/plans",
          parallelWorkersPerWave: 1,
        },
        {
          calculateWaves: mock(() => ({
            waves: [
              {
                wave_number: 1,
                task_ids: ["t1"],
                status: "pending" as const,
                parallel: false,
              },
              {
                wave_number: 2,
                task_ids: ["t2"],
                status: "pending" as const,
                parallel: false,
              },
            ],
            totalTasks: tasks.length,
            maxParallelism: 1,
            sequentialWaves: 2,
          })),
          saveState: mock(async () => {}),
          loadState: mock(async () => null),
          spawnWorker: mock(async (beadId: string) => {
            spawnOrder.push(beadId);
            return { status: "completed" as const };
          }),
          verifyWave: mock(async () => ({ passed: true, errors: [] })),
          createFixBead: mock(async () => "fix-2"),
          eventEmit: mock(),
        },
      );

      const result = await dispatcher.executeEpic(tasks);

      expect(result.success).toBe(true);
      expect(result.totalWaves).toBe(2);
      expect(spawnOrder).toEqual(["t1", "t2"]);
    });
  });

  describe("Phase verification end-to-end", () => {
    test("all beads closed and must-haves pass emits goal completed", async () => {
      const eventEmit = mock();
      const promoteLearnings = mock(async () => ({
        promoted: 0,
        skipped: 0,
        errors: [],
      }));

      const verifier = createPhaseVerifier(
        {
          projectKey: "proj",
          projectPath: "/tmp/project",
          epicBeadId: "epic",
        },
        {
          verifyTruths: mock(async () => [{ truth: "ok", passed: true }]),
          verifyArtifacts: mock(async () => [{
            path: "src/a.ts",
            check: "exists",
            passed: true,
          }]),
          verifyKeyLinks: mock(async () => [{
            from: "a",
            to: "b",
            type: "calls",
            passed: true,
          }]),
          beadClient: {
            list: mock(async () => [{ id: "bd-1", status: "closed" }]),
            create: mock(async () => "fix-1"),
          },
          eventEmit,
          promoteLearnings,
        },
      );

      const result = await verifier.verifyPhase({
        truths: ["ok"],
        artifacts: [{ path: "src/a.ts", check: "exists" }],
        keyLinks: [{ from: "a", to: "b", type: "calls" }],
      });

      expect(result.passed).toBe(true);
      expect(eventEmit).toHaveBeenCalledWith("goal_completed", { epicId: "epic" });
      expect(promoteLearnings).toHaveBeenCalledTimes(1);
    });

    test("failed truth verification creates fix bead and passes on second iteration", async () => {
      const truthCalls: Array<{ truth: string; passed: boolean }> = [];
      const verifyTruths = mock(async () => {
        if (truthCalls.length === 0) {
          truthCalls.push({ truth: "gap", passed: false });
          return [{ truth: "gap", passed: false, evidence: "missing" }];
        }
        truthCalls.push({ truth: "gap", passed: true });
        return [{ truth: "gap", passed: true, evidence: "fixed" }];
      });

      const beadClientCreate = mock(async () => "fix-truth");

      const verifier = createPhaseVerifier(
        {
          projectKey: "proj",
          projectPath: "/tmp/project",
          epicBeadId: "epic",
          maxVerifyIterations: 2,
        },
        {
          verifyTruths,
          verifyArtifacts: mock(async () => []),
          verifyKeyLinks: mock(async () => []),
          beadClient: {
            list: mock(async () => [{ id: "bd-1", status: "closed" }]),
            create: beadClientCreate,
          },
          eventEmit: mock(),
        },
      );

      const result = await verifier.verifyPhase({
        truths: ["gap"],
        artifacts: [],
        keyLinks: [],
      });

      expect(result.passed).toBe(true);
      expect(result.iterations).toBe(2);
      expect(beadClientCreate).toHaveBeenCalledTimes(1);
    });
  });

  describe("Message round-trip", () => {
    test("sendCompleted → parse → classify → review handler", async () => {
      const sent: SentMail[] = [];
      const sendMail = mock(async (params: SentMail) => {
        sent.push(params);
      });

      const workerSender = createWorkerMailSender(sendMail, "worker-a", "thread-rt1");
      await workerSender.sendCompleted(
        "bd-11",
        "Done",
        ["src/a.ts"],
        "abc",
      );

      const envelope = sent[0];
      const parsed = parseCortexMessage(envelope.subject, envelope.body);
      expect(parsed).not.toBeNull();
      expect(classifyMessage(envelope.subject)).toBe("DONE");
      if (parsed?.tag !== "DONE") return;

      const reviewHandler = createReviewHandler({
        sendMail,
        beadClient: { update: mock(async () => {}) },
        eventStore: { emit: mock() },
        verificationRunner: {
          runVerificationGate: mock(async () => ({ passed: true, errors: [] })),
        },
      });

      const handleCompletedSpy = mock(async (msg: unknown) =>
        reviewHandler.handleCompleted(msg),
      );

      const monitor = createQueenMonitor(
        { projectKey: "proj", epicBeadId: "epic" },
        {
          getInbox: mock(async () => ({
            messages: [buildInboxMessage(1, envelope, "worker-a")],
          })),
          sendMail,
          beadClient: {
            show: mock(),
            list: mock(async () => []),
            update: mock(async () => {}),
            close: mock(async () => {}),
          },
          eventStore: { emit: mock() },
          decisionHandler: {
            handleDiscovery: mock(),
            handleDecisionRequest: mock(),
            handleHelpRequest: mock(),
          },
          reviewHandler: { handleCompleted: handleCompletedSpy },
        },
      );

      await monitor.processOnce();

      expect(handleCompletedSpy).toHaveBeenCalledTimes(1);
    });

    test("sendDiscovery → parse → classify → decision handler", async () => {
      const sent: SentMail[] = [];
      const sendMail = mock(async (params: SentMail) => {
        sent.push(params);
      });

      const workerSender = createWorkerMailSender(sendMail, "worker-a", "thread-rt2");
      const discoveryHandler = createDiscoveryHandler({
        beadClient: { create: mock(async () => "bd-12") },
        mailSender: workerSender,
        eventStore: { emit: mock() },
      });

      await discoveryHandler({
        title: "New task",
        description: "Need this",
        priority: 2,
        parentBeadId: "epic",
      });

      const envelope = sent[0];
      const parsed = parseCortexMessage(envelope.subject, envelope.body);
      expect(parsed).not.toBeNull();
      expect(classifyMessage(envelope.subject)).toBe("DISCOVERY");
      if (parsed?.tag !== "DISCOVERY") return;

      const decisionHandler = createDecisionHandler({
        sendMail,
        eventStore: { emit: mock() },
        memoryRecall: mock(async () => []),
      });

      const monitor = createQueenMonitor(
        { projectKey: "proj", epicBeadId: "epic" },
        {
          getInbox: mock(async () => ({
            messages: [buildInboxMessage(1, envelope, "worker-a")],
          })),
          sendMail,
          beadClient: {
            show: mock(),
            list: mock(async () => []),
            update: mock(async () => {}),
            close: mock(async () => {}),
          },
          eventStore: { emit: mock() },
          decisionHandler,
          reviewHandler: { handleCompleted: mock() },
        },
      );

      await monitor.processOnce();

      const reply = sent.find((message) => classifyMessage(message.subject) === "APPROVED");
      expect(reply).toBeDefined();
    });
  });

  describe("Message schema wiring", () => {
    test("formatMessageBody and parseCortexMessage round-trip", () => {
      const msg = {
        tag: "STATUS",
        beadId: "bd-13",
        status: "executing",
        percentComplete: 50,
        files: ["src/a.ts"],
      } satisfies CortexMessage;

      const body = formatMessageBody(msg);
      const subject = `[STATUS] ${msg.beadId}: executing 50%`;
      const parsed = parseCortexMessage(subject, body);
      expect(parsed).not.toBeNull();
      const result = CortexMessageSchema.safeParse(parsed);
      expect(result.success).toBe(true);
    });
  });

  describe("Learning promotion wiring", () => {
    test("promotes non-duplicate high-confidence learning", async () => {
      const memoryStore = mock(async () => {});
      const promoter = createLearningPromoter({
        memoryRecall: mock(async () => []),
        memoryStore,
        eventStore: { emit: mock() },
      });

      const result = await promoter.promoteLearnings([
        { info: "Cache responses", tags: "perf", confidence: 0.9, age: 1 },
      ]);

      expect(result.promoted).toBe(1);
      expect(memoryStore).toHaveBeenCalledTimes(1);
    });
  });
});
