// ─── Queen Module Barrel ────────────────────────────────────────
// Re-exports for all Queen (orchestration) sub-modules.
// Import from "src/queen" instead of individual files.

// ─── Message Types ──────────────────────────────────────────────
export type {
  MessageTag,
  CortexMessage,
} from "./message-types.js";

export {
  MessageTagSchema,
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
  CortexMessageSchema,
  classifyMessage,
  parseCortexMessage,
  formatMessageBody,
  createMailEnvelope,
} from "./message-types.js";

// ─── Monitor ────────────────────────────────────────────────────
export type {
  MonitorConfig,
  InboxMessage,
  InboxResult,
  QueenDeps,
  MonitorStats,
  QueenMonitor,
} from "./monitor.js";

export { createQueenMonitor } from "./monitor.js";

// ─── Decision Handler ───────────────────────────────────────────
export type {
  DecisionDeps,
  DecisionResult,
  DecisionHandler,
} from "./decision-handler.js";

export { createDecisionHandler } from "./decision-handler.js";

// ─── Review Handler ─────────────────────────────────────────────
export type {
  ReviewDeps,
  ReviewIssue,
  ReviewResult,
  ReviewHandler,
} from "./review-handler.js";

export { createReviewHandler } from "./review-handler.js";

// ─── Learning Promoter ──────────────────────────────────────────
export type {
  LearningDeps,
  PromotionResult,
  LearningPromoter,
} from "./learning-promoter.js";

export { createLearningPromoter } from "./learning-promoter.js";

// ─── Wave Dispatcher ────────────────────────────────────────────
export type {
  WaveDispatcherConfig,
  WaveDispatcherDeps,
  TaskWithDeps,
  WaveResult,
  EpicExecutionResult,
  WaveDispatcher,
} from "./wave-dispatcher.js";

export { createWaveDispatcher } from "./wave-dispatcher.js";

// ─── Phase Verifier ──────────────────────────────────────────────
export type {
  PhaseVerifierConfig,
  PhaseVerifierDeps,
  MustHaves,
  PhaseVerificationResult,
  PhaseVerifier,
} from "./phase-verifier.js";

export { createPhaseVerifier } from "./phase-verifier.js";

// ─── Cortex Coordinator ──────────────────────────────────────────
export type {
  CortexCoordinatorConfig,
  CortexCoordinatorDeps,
  CortexCoordinatorResult,
  CortexCoordinator,
  ResearchResult as CortexResearchResult,
} from "./cortex-coordinator.js";

export { createCortexCoordinator } from "./cortex-coordinator.js";
