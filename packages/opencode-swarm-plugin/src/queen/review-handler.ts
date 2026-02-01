import { createMailEnvelope } from "./message-types.js";

export interface ReviewDeps {
  sendMail: (params: any) => Promise<void>;
  beadClient: {
    update: (id: string, data: any) => Promise<void>;
  };
  eventStore: { emit: (type: string, data: any) => void };
  verificationRunner: {
    runVerificationGate: (
      files: string[],
      verbose: boolean,
    ) => Promise<{ passed: boolean; errors: string[] }>;
  };
}

export interface ReviewIssue {
  file: string;
  line?: number;
  issue: string;
  suggestion?: string;
}

export interface ReviewResult {
  status: "approved" | "needs_changes" | "blocked";
  issues?: ReviewIssue[];
  remainingAttempts?: number;
}

export interface ReviewHandler {
  handleCompleted(msg: any): Promise<ReviewResult>;
  getAttemptCount(beadId: string): number;
  getRemainingAttempts(beadId: string): number;
}

const MAX_ATTEMPTS = 3;

const parseIssues = (errors: string[]): ReviewIssue[] =>
  errors.map((error) => {
    const [filePart, linePart, ...rest] = error.split(":");
    const lineNumber = Number(linePart);
    if (!Number.isNaN(lineNumber) && rest.length > 0) {
      return {
        file: filePart,
        line: lineNumber,
        issue: rest.join(":").trim(),
      };
    }
    return { file: "unknown", issue: error };
  });

const sendReviewReply = async (deps: ReviewDeps, msg: any, reply: any) => {
  const meta = msg.__meta;
  if (!meta?.from) return;
  const envelope = createMailEnvelope(
    reply,
    "queen",
    [meta.from],
    meta.threadId ?? `thread-${msg.beadId ?? "unknown"}`,
  );
  await deps.sendMail(envelope);
};

export function createReviewHandler(deps: ReviewDeps): ReviewHandler {
  const reviewAttempts = new Map<string, number>();

  const clearAttempts = (beadId: string) => {
    reviewAttempts.delete(beadId);
  };

  const incrementAttempts = (beadId: string) => {
    const current = reviewAttempts.get(beadId) ?? 0;
    const next = current + 1;
    reviewAttempts.set(beadId, next);
    return next;
  };

  const handleCompleted = async (msg: any): Promise<ReviewResult> => {
    const result = await deps.verificationRunner.runVerificationGate(
      msg.files ?? [],
      true,
    );

    if (result.passed) {
      const replyMessage = {
        tag: "REVIEW",
        beadId: msg.beadId,
        status: "approved",
        summary: "Verification passed",
      };

      clearAttempts(msg.beadId);

      deps.eventStore.emit("task_completed", {
        beadId: msg.beadId,
        files: msg.files ?? [],
      });

      await sendReviewReply(deps, msg, replyMessage);

      return { status: "approved" };
    }

    const attempts = incrementAttempts(msg.beadId);
    const issues = parseIssues(result.errors);
    const remainingAttempts = Math.max(0, MAX_ATTEMPTS - attempts);

    if (attempts >= MAX_ATTEMPTS) {
      const replyMessage = {
        tag: "REVIEW",
        beadId: msg.beadId,
        status: "needs_changes",
        issues,
        remainingAttempts: 0,
        summary: "Verification failed too many times",
      };

      await deps.beadClient.update(msg.beadId, {
        status: "blocked",
        reason: "Verification failed 3 times",
      });

      deps.eventStore.emit("task_blocked", {
        beadId: msg.beadId,
        attempts,
      });

      await sendReviewReply(deps, msg, replyMessage);

      return { status: "blocked", issues, remainingAttempts };
    }

    const replyMessage = {
      tag: "REVIEW",
      beadId: msg.beadId,
      status: "needs_changes",
      issues,
      remainingAttempts,
      summary: "Verification failed",
    };

    await sendReviewReply(deps, msg, replyMessage);

    return { status: "needs_changes", issues, remainingAttempts };
  };

  const getAttemptCount = (beadId: string) => reviewAttempts.get(beadId) ?? 0;

  const getRemainingAttempts = (beadId: string) =>
    Math.max(0, MAX_ATTEMPTS - getAttemptCount(beadId));

  return {
    handleCompleted,
    getAttemptCount,
    getRemainingAttempts,
  };
}
