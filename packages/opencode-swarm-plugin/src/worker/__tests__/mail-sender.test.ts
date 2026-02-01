import { describe, expect, test, mock } from "bun:test";

import {
  CortexMessageSchema,
  parseCortexMessage,
} from "../../queen/message-types.js";
import { createWorkerMailSender } from "../mail-sender.js";

function getMessageFromEnvelope(envelope: {
  subject: string;
  body: string;
}) {
  const parsed = parseCortexMessage(envelope.subject, envelope.body);
  if (!parsed) throw new Error("Failed to parse message");
  const result = CortexMessageSchema.safeParse(parsed);
  expect(result.success).toBe(true);
  return parsed;
}

function getEnvelope<T>(sendMail: ReturnType<typeof mock>, index = 0): T {
  const calls = sendMail.mock.calls as unknown as Array<unknown[]>;
  const call = calls[index];
  if (!call) throw new Error("Missing sendMail call");
  return call[0] as T;
}

describe("createWorkerMailSender", () => {
  test("sendStatus creates STATUS message", async () => {
    const sendMail = mock(async () => {});
    const sender = createWorkerMailSender(sendMail, "worker-1", "thread-1");
    await sender.sendStatus("bead-1", "planning", 5);
    const envelope = getEnvelope<{
      subject: string;
      body: string;
      toAgents: string[];
    }>(sendMail);
    const message = getMessageFromEnvelope(envelope);
    expect(message.tag).toBe("STATUS");
    expect(envelope.toAgents).toEqual(["queen"]);
  });

  test("sendCompleted creates DONE message", async () => {
    const sendMail = mock(async () => {});
    const sender = createWorkerMailSender(sendMail, "worker-1", "thread-1");
    await sender.sendCompleted("bead-1", "Done", ["a.ts"], "c1");
    const envelope = getEnvelope<{
      subject: string;
      body: string;
      toAgents: string[];
    }>(sendMail);
    const message = getMessageFromEnvelope(envelope);
    expect(message.tag).toBe("DONE");
    expect(envelope.toAgents).toEqual(["queen"]);
  });

  test("sendBlocked creates BLOCKED message", async () => {
    const sendMail = mock(async () => {});
    const sender = createWorkerMailSender(sendMail, "worker-1", "thread-1");
    await sender.sendBlocked("bead-1", "Blocked");
    const envelope = getEnvelope<{
      subject: string;
      body: string;
      importance: string;
      ackRequired: boolean;
    }>(sendMail);
    const message = getMessageFromEnvelope(envelope);
    expect(message.tag).toBe("BLOCKED");
    expect(envelope.importance).toBe("high");
    expect(envelope.ackRequired).toBe(true);
  });

  test("sendDiscovery creates DISCOVERY message", async () => {
    const sendMail = mock(async () => {});
    const sender = createWorkerMailSender(sendMail, "worker-1", "thread-1");
    await sender.sendDiscovery("bead-1", "child-1", "Title", 2, "Why");
    const envelope = getEnvelope<{ subject: string; body: string }>(sendMail);
    const message = getMessageFromEnvelope(envelope);
    expect(message.tag).toBe("DISCOVERY");
  });

  test("sendDecisionNeeded creates DECISION message", async () => {
    const sendMail = mock(async () => {});
    const sender = createWorkerMailSender(sendMail, "worker-1", "thread-1");
    await sender.sendDecisionNeeded("bead-1", "Question", [
      { label: "A", description: "Option A" },
      { label: "B", description: "Option B" },
    ]);
    const envelope = getEnvelope<{ subject: string; body: string }>(sendMail);
    const message = getMessageFromEnvelope(envelope);
    expect(message.tag).toBe("DECISION");
  });

  test("sendHelpRequest creates HELP message", async () => {
    const sendMail = mock(async () => {});
    const sender = createWorkerMailSender(sendMail, "worker-1", "thread-1");
    await sender.sendHelpRequest("bead-1", "Help?", "Context");
    const envelope = getEnvelope<{ subject: string; body: string }>(sendMail);
    const message = getMessageFromEnvelope(envelope);
    expect(message.tag).toBe("HELP");
  });

  test("sendFileHeadsUp creates FILE message", async () => {
    const sendMail = mock(async () => {});
    const sender = createWorkerMailSender(sendMail, "worker-1", "thread-1");
    await sender.sendFileHeadsUp("bead-1", ["a.ts"], "modified");
    const envelope = getEnvelope<{
      subject: string;
      body: string;
      toAgents: string[];
      importance: string;
    }>(sendMail);
    const message = getMessageFromEnvelope(envelope);
    expect(message.tag).toBe("FILE");
    expect(envelope.toAgents).toEqual(["*"]);
    expect(envelope.importance).toBe("low");
  });

  test("sendDependencyReady creates READY message", async () => {
    const sendMail = mock(async () => {});
    const sender = createWorkerMailSender(sendMail, "worker-1", "thread-1");
    await sender.sendDependencyReady("bead-1", ["dep-1"]);
    const envelope = getEnvelope<{
      subject: string;
      body: string;
      toAgents: string[];
    }>(sendMail);
    const message = getMessageFromEnvelope(envelope);
    expect(message.tag).toBe("READY");
    expect(envelope.toAgents).toEqual(["*"]);
  });

  test("messages validate against CortexMessageSchema", async () => {
    const sendMail = mock(async () => {});
    const sender = createWorkerMailSender(sendMail, "worker-1", "thread-1");
    await sender.sendStatus("bead-1", "planning", 10);
    await sender.sendCompleted("bead-1", "Done", ["a.ts"]);
    await sender.sendBlocked("bead-1", "Blocked");
    const calls = sendMail.mock.calls as unknown as Array<unknown[]>;
    const envelopes = calls.map(
      (call) => call[0] as { subject: string; body: string },
    );
    for (const envelope of envelopes) {
      const message = parseCortexMessage(envelope.subject, envelope.body);
      const parsed = CortexMessageSchema.safeParse(message);
      expect(parsed.success).toBe(true);
    }
  });

  test("DONE importance is high and ackRequired false", async () => {
    const sendMail = mock(async () => {});
    const sender = createWorkerMailSender(sendMail, "worker-1", "thread-1");
    await sender.sendCompleted("bead-1", "Done", ["a.ts"]);
    const envelope = getEnvelope<{
      importance: string;
      ackRequired: boolean;
    }>(sendMail);
    expect(envelope.importance).toBe("high");
    expect(envelope.ackRequired).toBe(false);
  });
});
