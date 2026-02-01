import { z } from "zod";

// Message Tag Enum — 17 tags total
export const MessageTagSchema = z.enum([
  // Worker → Queen (6)
  "STATUS",
  "DONE",
  "BLOCKED",
  "DISCOVERY",
  "DECISION",
  "HELP",
  // Queen → Worker (6)
  "APPROVED",
  "REJECTED",
  "DEFERRED",
  "REVIEW",
  "CONTEXT",
  "UNBLOCKED",
  // Worker → Worker (2)
  "FILE",
  "READY",
  // Special (3)
  "SCOPE_CHANGE",
  "LEARNING",
  "PHASE_GATE",
]);
export type MessageTag = z.infer<typeof MessageTagSchema>;

// ---- Worker → Queen (6) ----

export const StatusUpdateSchema = z.object({
  tag: z.literal("STATUS"),
  beadId: z.string(),
  status: z.enum(["planning", "executing", "verifying", "learning"]),
  percentComplete: z.number().min(0).max(100),
  files: z.array(z.string()).optional(),
  blockers: z.array(z.string()).optional(),
  message: z.string().optional(),
});

export const CompletedSchema = z.object({
  tag: z.literal("DONE"),
  beadId: z.string(),
  summary: z.string().min(1),
  files: z.array(z.string()),
  commit: z.string().optional(),
  learnings: z
    .array(
      z.object({
        info: z.string(),
        tags: z.string(),
      }),
    )
    .optional(),
});

export const BlockedSchema = z.object({
  tag: z.literal("BLOCKED"),
  beadId: z.string(),
  blocker: z.string().min(1),
  attempts: z.number().optional(),
  suggestion: z.string().optional(),
});

export const DiscoverySchema = z.object({
  tag: z.literal("DISCOVERY"),
  beadId: z.string(),
  childBeadId: z.string(),
  title: z.string().min(1),
  priority: z.number().min(0).max(4),
  rationale: z.string().min(1),
});

export const DecisionNeededSchema = z.object({
  tag: z.literal("DECISION"),
  beadId: z.string(),
  question: z.string().min(1),
  options: z
    .array(
      z.object({
        label: z.string(),
        description: z.string(),
        tradeoffs: z.string().optional(),
      }),
    )
    .min(2),
  recommendation: z.string().optional(),
});

export const HelpRequestSchema = z.object({
  tag: z.literal("HELP"),
  beadId: z.string(),
  question: z.string().min(1),
  context: z.string(),
  recommendation: z.string().optional(),
});

// ---- Queen → Worker (6) ----

export const ApprovedSchema = z.object({
  tag: z.literal("APPROVED"),
  beadId: z.string(),
  decision: z.string(),
  reason: z.string().optional(),
});

export const RejectedSchema = z.object({
  tag: z.literal("REJECTED"),
  beadId: z.string(),
  decision: z.string(),
  reason: z.string().min(1),
});

export const DeferredSchema = z.object({
  tag: z.literal("DEFERRED"),
  beadId: z.string(),
  reason: z.string().min(1),
  waitingFor: z.string().optional(),
});

export const ReviewFeedbackSchema = z.object({
  tag: z.literal("REVIEW"),
  beadId: z.string(),
  status: z.enum(["approved", "needs_changes"]),
  issues: z
    .array(
      z.object({
        file: z.string(),
        line: z.number().optional(),
        issue: z.string(),
        suggestion: z.string().optional(),
      }),
    )
    .optional(),
  summary: z.string().optional(),
  remainingAttempts: z.number().optional(),
});

export const ContextUpdateSchema = z.object({
  tag: z.literal("CONTEXT"),
  beadId: z.string().optional(),
  update: z.string().min(1),
  fromWorker: z.string().optional(),
});

export const UnblockedSchema = z.object({
  tag: z.literal("UNBLOCKED"),
  beadId: z.string(),
  resolution: z.string().min(1),
});

// ---- Worker → Worker (2) ----

export const FileHeadsUpSchema = z.object({
  tag: z.literal("FILE"),
  beadId: z.string(),
  files: z.array(z.string()).min(1),
  changeType: z.enum(["created", "modified", "deleted", "renamed"]),
});

export const DependencyReadySchema = z.object({
  tag: z.literal("READY"),
  beadId: z.string(),
  dependentBeadIds: z.array(z.string()),
});

// ---- Special (3) ----

export const ScopeChangeRequestSchema = z.object({
  tag: z.literal("SCOPE_CHANGE"),
  beadId: z.string(),
  proposedChange: z.string().min(1),
  impact: z.enum(["minor", "moderate", "major"]),
});

export const LearningReportSchema = z.object({
  tag: z.literal("LEARNING"),
  beadId: z.string(),
  learnings: z.array(
    z.object({
      info: z.string(),
      tags: z.string(),
      confidence: z.number().min(0).max(1).optional(),
    }),
  ),
});

export const PhaseGateSchema = z.object({
  tag: z.literal("PHASE_GATE"),
  phaseId: z.string(),
  status: z.enum(["passed", "failed", "pending_review"]),
  results: z.object({
    truthsPassed: z.number(),
    truthsFailed: z.number(),
    artifactsPassed: z.number(),
    artifactsFailed: z.number(),
    keyLinksPassed: z.number(),
    keyLinksFailed: z.number(),
  }),
});

// ---- Discriminated Union ----

export const CortexMessageSchema = z.discriminatedUnion("tag", [
  StatusUpdateSchema,
  CompletedSchema,
  BlockedSchema,
  DiscoverySchema,
  DecisionNeededSchema,
  HelpRequestSchema,
  ApprovedSchema,
  RejectedSchema,
  DeferredSchema,
  ReviewFeedbackSchema,
  ContextUpdateSchema,
  UnblockedSchema,
  FileHeadsUpSchema,
  DependencyReadySchema,
  ScopeChangeRequestSchema,
  LearningReportSchema,
  PhaseGateSchema,
]);

export type CortexMessage = z.infer<typeof CortexMessageSchema>;

function parseValue(raw: string): unknown {
  if (raw === "") return "";
  if (raw === "true") return true;
  if (raw === "false") return false;
  if (raw.startsWith("[") || raw.startsWith("{")) {
    return JSON.parse(raw);
  }
  if (/^-?\d+(\.\d+)?$/.test(raw)) {
    return Number(raw);
  }
  return raw;
}

function parseBody(body: string): Record<string, unknown> | null {
  const lines = body
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const parsed: Record<string, unknown> = {};

  for (const line of lines) {
    const separatorIndex = line.indexOf(":");
    if (separatorIndex === -1) return null;
    const key = line.slice(0, separatorIndex).trim();
    const rawValue = line.slice(separatorIndex + 1).trim();
    if (!key) return null;
    try {
      parsed[key] = parseValue(rawValue);
    } catch {
      return null;
    }
  }

  return parsed;
}

function getSummary(msg: CortexMessage): string {
  switch (msg.tag) {
    case "STATUS":
      return msg.message ?? `${msg.status} ${msg.percentComplete}%`;
    case "DONE":
      return msg.summary;
    case "BLOCKED":
      return msg.blocker;
    case "DISCOVERY":
      return msg.title;
    case "DECISION":
      return msg.question;
    case "HELP":
      return msg.question;
    case "APPROVED":
      return msg.decision;
    case "REJECTED":
      return msg.decision;
    case "DEFERRED":
      return msg.reason;
    case "REVIEW":
      return msg.summary ?? msg.status;
    case "CONTEXT":
      return msg.update;
    case "UNBLOCKED":
      return msg.resolution;
    case "FILE":
      return `${msg.changeType}: ${msg.files.join(", ")}`;
    case "READY":
      return `ready: ${msg.dependentBeadIds.join(", ")}`;
    case "SCOPE_CHANGE":
      return msg.proposedChange;
    case "LEARNING":
      return msg.learnings[0]?.info ?? "learning report";
    case "PHASE_GATE":
      return `${msg.phaseId} ${msg.status}`;
    default:
      return "";
  }
}

function getBeadId(msg: CortexMessage): string {
  if ("beadId" in msg && typeof msg.beadId === "string") {
    return msg.beadId;
  }
  if (msg.tag === "PHASE_GATE") return msg.phaseId;
  return "unknown";
}

// 1. classifyMessage — Extract [TAG] from subject prefix
export function classifyMessage(subject: string): MessageTag | null {
  const match = subject.match(/^\[([A-Z_]+)\]/);
  if (!match) return null;
  const tag = match[1];
  const result = MessageTagSchema.safeParse(tag);
  return result.success ? result.data : null;
}

// 2. parseCortexMessage — Parse subject + body into typed message
export function parseCortexMessage(
  subject: string,
  body: string,
): CortexMessage | null {
  const tag = classifyMessage(subject);
  if (!tag) return null;

  const parsed = parseBody(body);
  if (!parsed) return null;

  const merged = { ...parsed, tag };
  const result = CortexMessageSchema.safeParse(merged);
  if (!result.success) return null;
  if ("beadId" in result.data) {
    const beadId = result.data.beadId;
    if (typeof beadId === "string" && beadId.length === 0) return null;
  }
  return result.data;
}

// 3. formatMessageBody — Serialize structured message to key-value body string
export function formatMessageBody(msg: CortexMessage): string {
  const lines: string[] = [];

  for (const [key, value] of Object.entries(msg)) {
    if (key === "tag" || value === undefined) continue;
    if (Array.isArray(value) || (typeof value === "object" && value !== null)) {
      lines.push(`${key}: ${JSON.stringify(value)}`);
      continue;
    }
    lines.push(`${key}: ${String(value)}`);
  }

  return lines.join("\n");
}

// 4. createMailEnvelope — Create ready-to-send swarm-mail params
export function createMailEnvelope(
  msg: CortexMessage,
  from: string,
  to: string[],
  threadId: string,
): {
  fromAgent: string;
  toAgents: string[];
  subject: string;
  body: string;
  threadId: string;
  importance: "low" | "normal" | "high" | "urgent";
  ackRequired: boolean;
} {
  let importance: "low" | "normal" | "high" | "urgent" = "normal";

  if (msg.tag === "BLOCKED" || msg.tag === "DONE") {
    importance = "high";
  } else if (msg.tag === "PHASE_GATE" && msg.status === "failed") {
    importance = "urgent";
  } else if (msg.tag === "STATUS") {
    importance = "normal";
  } else if (msg.tag === "FILE") {
    importance = "low";
  }

  const ackRequired = msg.tag === "BLOCKED" || msg.tag === "PHASE_GATE";
  const beadId = getBeadId(msg);
  const summary = getSummary(msg);
  const subject = `[${msg.tag}] ${beadId}: ${summary}`;

  return {
    fromAgent: from,
    toAgents: to,
    subject,
    body: formatMessageBody(msg),
    threadId,
    importance,
    ackRequired,
  };
}
