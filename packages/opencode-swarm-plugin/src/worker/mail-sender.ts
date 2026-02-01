import type { CortexMessage } from "../queen/message-types.js";
import { createMailEnvelope } from "../queen/message-types.js";

export interface WorkerMailSender {
  sendStatus(
    beadId: string,
    status: "planning" | "executing" | "verifying" | "learning",
    percent: number,
    opts?: { files?: string[]; blockers?: string[] },
  ): Promise<void>;
  sendCompleted(
    beadId: string,
    summary: string,
    files: string[],
    commit?: string,
    learnings?: Array<{ info: string; tags: string }>,
  ): Promise<void>;
  sendBlocked(
    beadId: string,
    blocker: string,
    attempts?: number,
    suggestion?: string,
  ): Promise<void>;
  sendDiscovery(
    beadId: string,
    childBeadId: string,
    title: string,
    priority: number,
    rationale: string,
  ): Promise<void>;
  sendDecisionNeeded(
    beadId: string,
    question: string,
    options: Array<{ label: string; description: string }>,
    recommendation?: string,
  ): Promise<void>;
  sendHelpRequest(
    beadId: string,
    question: string,
    context: string,
    recommendation?: string,
  ): Promise<void>;
  sendFileHeadsUp(
    beadId: string,
    files: string[],
    changeType: "created" | "modified" | "deleted" | "renamed",
  ): Promise<void>;
  sendDependencyReady(beadId: string, dependentBeadIds: string[]): Promise<void>;
}

export function createWorkerMailSender(
  sendMail: (params: any) => Promise<void>,
  workerName: string,
  threadId: string,
): WorkerMailSender {
  async function sendMessage(msg: CortexMessage, toAgents: string[]): Promise<void> {
    const envelope = createMailEnvelope(msg, workerName, toAgents, threadId);
    await sendMail(envelope);
  }

  return {
    async sendStatus(beadId, status, percent, opts) {
      const msg: CortexMessage = {
        tag: "STATUS",
        beadId,
        status,
        percentComplete: percent,
        files: opts?.files,
        blockers: opts?.blockers,
      };
      await sendMessage(msg, ["queen"]);
    },
    async sendCompleted(beadId, summary, files, commit, learnings) {
      const msg: CortexMessage = {
        tag: "DONE",
        beadId,
        summary,
        files,
        commit,
        learnings,
      };
      await sendMessage(msg, ["queen"]);
    },
    async sendBlocked(beadId, blocker, attempts, suggestion) {
      const msg: CortexMessage = {
        tag: "BLOCKED",
        beadId,
        blocker,
        attempts,
        suggestion,
      };
      await sendMessage(msg, ["queen"]);
    },
    async sendDiscovery(beadId, childBeadId, title, priority, rationale) {
      const msg: CortexMessage = {
        tag: "DISCOVERY",
        beadId,
        childBeadId,
        title,
        priority,
        rationale,
      };
      await sendMessage(msg, ["queen"]);
    },
    async sendDecisionNeeded(beadId, question, options, recommendation) {
      const msg: CortexMessage = {
        tag: "DECISION",
        beadId,
        question,
        options,
        recommendation,
      };
      await sendMessage(msg, ["queen"]);
    },
    async sendHelpRequest(beadId, question, context, recommendation) {
      const msg: CortexMessage = {
        tag: "HELP",
        beadId,
        question,
        context,
        recommendation,
      };
      await sendMessage(msg, ["queen"]);
    },
    async sendFileHeadsUp(beadId, files, changeType) {
      const msg: CortexMessage = {
        tag: "FILE",
        beadId,
        files,
        changeType,
      };
      await sendMessage(msg, ["*"]);
    },
    async sendDependencyReady(beadId, dependentBeadIds) {
      const msg: CortexMessage = {
        tag: "READY",
        beadId,
        dependentBeadIds,
      };
      await sendMessage(msg, ["*"]);
    },
  };
}
