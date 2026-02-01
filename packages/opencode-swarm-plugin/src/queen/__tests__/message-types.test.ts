import { describe, expect, test } from "bun:test";

import {
  ApprovedSchema,
  BlockedSchema,
  CompletedSchema,
  ContextUpdateSchema,
  CortexMessageSchema,
  DecisionNeededSchema,
  DeferredSchema,
  DependencyReadySchema,
  DiscoverySchema,
  FileHeadsUpSchema,
  HelpRequestSchema,
  LearningReportSchema,
  PhaseGateSchema,
  RejectedSchema,
  ReviewFeedbackSchema,
  ScopeChangeRequestSchema,
  StatusUpdateSchema,
  UnblockedSchema,
  classifyMessage,
  createMailEnvelope,
  formatMessageBody,
  parseCortexMessage,
} from "../message-types.js";

// ============================================================================
// Validation Tests (17)
// ============================================================================

describe("Cortex Message Schemas — Validation", () => {
  test("StatusUpdateSchema accepts valid payload", () => {
    const result = StatusUpdateSchema.safeParse({
      tag: "STATUS",
      beadId: "bead-1",
      status: "planning",
      percentComplete: 10,
      files: ["src/foo.ts"],
      blockers: ["Waiting"],
      message: "Working",
    });
    expect(result.success).toBe(true);
  });

  test("CompletedSchema accepts valid payload", () => {
    const result = CompletedSchema.safeParse({
      tag: "DONE",
      beadId: "bead-2",
      summary: "Implemented feature",
      files: ["src/a.ts"],
      commit: "abc123",
      learnings: [{ info: "Learned", tags: "tag" }],
    });
    expect(result.success).toBe(true);
  });

  test("BlockedSchema accepts valid payload", () => {
    const result = BlockedSchema.safeParse({
      tag: "BLOCKED",
      beadId: "bead-3",
      blocker: "Dependency missing",
      attempts: 2,
      suggestion: "Ask owner",
    });
    expect(result.success).toBe(true);
  });

  test("DiscoverySchema accepts valid payload", () => {
    const result = DiscoverySchema.safeParse({
      tag: "DISCOVERY",
      beadId: "bead-4",
      childBeadId: "bead-4a",
      title: "Follow-up task",
      priority: 2,
      rationale: "Needed for completeness",
    });
    expect(result.success).toBe(true);
  });

  test("DecisionNeededSchema accepts valid payload", () => {
    const result = DecisionNeededSchema.safeParse({
      tag: "DECISION",
      beadId: "bead-5",
      question: "Choose approach",
      options: [
        { label: "A", description: "Option A" },
        { label: "B", description: "Option B", tradeoffs: "More work" },
      ],
      recommendation: "A",
    });
    expect(result.success).toBe(true);
  });

  test("HelpRequestSchema accepts valid payload", () => {
    const result = HelpRequestSchema.safeParse({
      tag: "HELP",
      beadId: "bead-6",
      question: "Need assistance",
      context: "Context here",
      recommendation: "Try X",
    });
    expect(result.success).toBe(true);
  });

  test("ApprovedSchema accepts valid payload", () => {
    const result = ApprovedSchema.safeParse({
      tag: "APPROVED",
      beadId: "bead-7",
      decision: "Proceed",
      reason: "Looks good",
    });
    expect(result.success).toBe(true);
  });

  test("RejectedSchema accepts valid payload", () => {
    const result = RejectedSchema.safeParse({
      tag: "REJECTED",
      beadId: "bead-8",
      decision: "Reject",
      reason: "Missing tests",
    });
    expect(result.success).toBe(true);
  });

  test("DeferredSchema accepts valid payload", () => {
    const result = DeferredSchema.safeParse({
      tag: "DEFERRED",
      beadId: "bead-9",
      reason: "Waiting on dependency",
      waitingFor: "task-1",
    });
    expect(result.success).toBe(true);
  });

  test("ReviewFeedbackSchema accepts valid payload", () => {
    const result = ReviewFeedbackSchema.safeParse({
      tag: "REVIEW",
      beadId: "bead-10",
      status: "needs_changes",
      issues: [
        {
          file: "src/file.ts",
          line: 10,
          issue: "Fix lint",
          suggestion: "Run formatter",
        },
      ],
      summary: "Please fix issues",
      remainingAttempts: 2,
    });
    expect(result.success).toBe(true);
  });

  test("ContextUpdateSchema accepts valid payload", () => {
    const result = ContextUpdateSchema.safeParse({
      tag: "CONTEXT",
      beadId: "bead-11",
      update: "New context",
      fromWorker: "worker-1",
    });
    expect(result.success).toBe(true);
  });

  test("UnblockedSchema accepts valid payload", () => {
    const result = UnblockedSchema.safeParse({
      tag: "UNBLOCKED",
      beadId: "bead-12",
      resolution: "Dependency resolved",
    });
    expect(result.success).toBe(true);
  });

  test("FileHeadsUpSchema accepts valid payload", () => {
    const result = FileHeadsUpSchema.safeParse({
      tag: "FILE",
      beadId: "bead-13",
      files: ["src/a.ts", "src/b.ts"],
      changeType: "modified",
    });
    expect(result.success).toBe(true);
  });

  test("DependencyReadySchema accepts valid payload", () => {
    const result = DependencyReadySchema.safeParse({
      tag: "READY",
      beadId: "bead-14",
      dependentBeadIds: ["bead-1", "bead-2"],
    });
    expect(result.success).toBe(true);
  });

  test("ScopeChangeRequestSchema accepts valid payload", () => {
    const result = ScopeChangeRequestSchema.safeParse({
      tag: "SCOPE_CHANGE",
      beadId: "bead-15",
      proposedChange: "Add optional field",
      impact: "moderate",
    });
    expect(result.success).toBe(true);
  });

  test("LearningReportSchema accepts valid payload", () => {
    const result = LearningReportSchema.safeParse({
      tag: "LEARNING",
      beadId: "bead-16",
      learnings: [{ info: "Use Zod", tags: "zod,types", confidence: 0.8 }],
    });
    expect(result.success).toBe(true);
  });

  test("PhaseGateSchema accepts valid payload", () => {
    const result = PhaseGateSchema.safeParse({
      tag: "PHASE_GATE",
      phaseId: "phase-1",
      status: "passed",
      results: {
        truthsPassed: 3,
        truthsFailed: 0,
        artifactsPassed: 2,
        artifactsFailed: 0,
        keyLinksPassed: 4,
        keyLinksFailed: 0,
      },
    });
    expect(result.success).toBe(true);
  });
});

// ============================================================================
// Rejection Tests (5+)
// ============================================================================

describe("Cortex Message Schemas — Rejection", () => {
  test("rejects missing required field", () => {
    const result = StatusUpdateSchema.safeParse({
      tag: "STATUS",
      beadId: "bead-1",
      status: "planning",
    });
    expect(result.success).toBe(false);
  });

  test("rejects wrong tag", () => {
    const result = CompletedSchema.safeParse({
      tag: "STATUS",
      beadId: "bead-2",
      summary: "Done",
      files: ["src/a.ts"],
    });
    expect(result.success).toBe(false);
  });

  test("rejects empty beadId when parsing", () => {
    const subject = "[STATUS] : empty bead";
    const body = "beadId: \nstatus: planning\npercentComplete: 25";
    expect(parseCortexMessage(subject, body)).toBe(null);
  });

  test("rejects DecisionNeeded with zero options", () => {
    const result = DecisionNeededSchema.safeParse({
      tag: "DECISION",
      beadId: "bead-3",
      question: "Pick",
      options: [],
    });
    expect(result.success).toBe(false);
  });

  test("rejects RejectedSchema with empty reason", () => {
    const result = RejectedSchema.safeParse({
      tag: "REJECTED",
      beadId: "bead-4",
      decision: "No",
      reason: "",
    });
    expect(result.success).toBe(false);
  });

  test("rejects PhaseGate with missing results", () => {
    const result = PhaseGateSchema.safeParse({
      tag: "PHASE_GATE",
      phaseId: "phase-2",
      status: "failed",
    });
    expect(result.success).toBe(false);
  });
});

// ============================================================================
// classifyMessage Tests (4+)
// ============================================================================

describe("classifyMessage", () => {
  test("returns valid tag from subject", () => {
    expect(classifyMessage("[STATUS] update")).toBe("STATUS");
  });

  test("returns valid tag with underscore", () => {
    expect(classifyMessage("[SCOPE_CHANGE] change")).toBe("SCOPE_CHANGE");
  });

  test("returns null for random subject", () => {
    expect(classifyMessage("Random subject")).toBe(null);
  });

  test("returns null for invalid tag", () => {
    expect(classifyMessage("[INVALID] nope")).toBe(null);
  });

  test("returns null for lowercase tag", () => {
    expect(classifyMessage("[status] nope")).toBe(null);
  });
});

// ============================================================================
// parseCortexMessage + formatMessageBody round-trip (4+)
// ============================================================================

describe("parseCortexMessage + formatMessageBody", () => {
  test("round-trips STATUS message", () => {
    const msg = {
      tag: "STATUS" as const,
      beadId: "bead-20",
      status: "executing" as const,
      percentComplete: 50,
      files: ["src/foo.ts"],
      blockers: [],
      message: "Halfway",
    };
    const body = formatMessageBody(msg);
    const parsed = parseCortexMessage("[STATUS] bead-20: update", body);
    expect(parsed).toEqual(msg);
  });

  test("round-trips DONE message with learnings", () => {
    const msg = {
      tag: "DONE" as const,
      beadId: "bead-21",
      summary: "Completed",
      files: ["src/a.ts", "src/b.ts"],
      learnings: [{ info: "Note", tags: "tag" }],
    };
    const body = formatMessageBody(msg);
    const parsed = parseCortexMessage("[DONE] bead-21: done", body);
    expect(parsed).toEqual(msg);
  });

  test("round-trips PHASE_GATE message", () => {
    const msg = {
      tag: "PHASE_GATE" as const,
      phaseId: "phase-3",
      status: "failed" as const,
      results: {
        truthsPassed: 1,
        truthsFailed: 2,
        artifactsPassed: 0,
        artifactsFailed: 1,
        keyLinksPassed: 3,
        keyLinksFailed: 1,
      },
    };
    const body = formatMessageBody(msg);
    const parsed = parseCortexMessage("[PHASE_GATE] phase-3: results", body);
    expect(parsed).toEqual(msg);
  });

  test("returns null for malformed body", () => {
    const parsed = parseCortexMessage("[STATUS] bad", "beadId- missing colon");
    expect(parsed).toBe(null);
  });
});

// ============================================================================
// createMailEnvelope Tests (3+)
// ============================================================================

describe("createMailEnvelope", () => {
  test("BLOCKED maps to high importance and ackRequired", () => {
    const msg = {
      tag: "BLOCKED" as const,
      beadId: "bead-30",
      blocker: "Dependency",
    };
    const envelope = createMailEnvelope(msg, "worker-a", ["queen"], "t1");
    expect(envelope.importance).toBe("high");
    expect(envelope.ackRequired).toBe(true);
  });

  test("STATUS maps to normal importance and no ackRequired", () => {
    const msg = {
      tag: "STATUS" as const,
      beadId: "bead-31",
      status: "verifying" as const,
      percentComplete: 80,
    };
    const envelope = createMailEnvelope(msg, "worker-a", ["queen"], "t2");
    expect(envelope.importance).toBe("normal");
    expect(envelope.ackRequired).toBe(false);
  });

  test("PHASE_GATE failed maps to urgent importance and ackRequired", () => {
    const msg = {
      tag: "PHASE_GATE" as const,
      phaseId: "phase-4",
      status: "failed" as const,
      results: {
        truthsPassed: 0,
        truthsFailed: 1,
        artifactsPassed: 0,
        artifactsFailed: 1,
        keyLinksPassed: 0,
        keyLinksFailed: 1,
      },
    };
    const envelope = createMailEnvelope(msg, "queen", ["worker"], "t3");
    expect(envelope.importance).toBe("urgent");
    expect(envelope.ackRequired).toBe(true);
  });
});

// ============================================================================
// CortexMessageSchema basic coverage
// ============================================================================

describe("CortexMessageSchema", () => {
  test("accepts valid discriminated union payload", () => {
    const result = CortexMessageSchema.safeParse({
      tag: "UNBLOCKED",
      beadId: "bead-40",
      resolution: "Resolved",
    });
    expect(result.success).toBe(true);
  });
});
