// ─── GSD Module Barrel ─────────────────────────────────────────
// Clean re-exports for all GSD (Get Shit Done) sub-modules.
// Import from "src/gsd" instead of individual files.

// ─── Types ──────────────────────────────────────────────────────
export type {
  GsdMode,
  GsdPlanStatus,
  GsdPlanType,
  GsdTaskStatus,
  GsdTaskPriority,
  GsdTaskType,
  GsdWaveStatus,
  GsdVerificationStatus,
  GsdArtifactCheckLevel,
  GsdKeyLinkType,
  GsdSubtask,
  GsdTask,
  GsdWave,
  VerificationTruth,
  VerificationArtifact,
  VerificationKeyLink,
  VerificationResult,
  GsdPlan,
  GsdPlanFrontmatter,
  GsdState,
  MustHaves,
  PlanningDirectoryConfig,
} from "./gsd-types.js";

export {
  // Constants
  GSD_MODES,
  GSD_PLAN_STATUSES,
  GSD_PLAN_TYPES,
  GSD_TASK_STATUSES,
  GSD_TASK_PRIORITIES,
  GSD_TASK_TYPES,
  GSD_WAVE_STATUSES,
  GSD_VERIFICATION_STATUSES,
  GSD_ARTIFACT_CHECK_LEVELS,
  GSD_KEY_LINK_TYPES,
  // Type guards
  isGsdMode,
  isGsdPlanStatus,
  isGsdPlanType,
  isGsdTaskStatus,
  isGsdTaskPriority,
  isGsdTaskType,
  isGsdWaveStatus,
  isGsdVerificationStatus,
  isGsdArtifactCheckLevel,
  isGsdKeyLinkType,
  isGsdPlan,
  isGsdTask,
  isGsdWave,
  isGsdState,
  isVerificationResult,
  isPlanningDirectoryConfig,
} from "./gsd-types.js";

// ─── Events ─────────────────────────────────────────────────────
export type { GsdEventBase } from "./gsd-events.js";

export {
  gsdPlanCreated,
  gsdWaveStarted,
  gsdWaveCompleted,
  gsdTaskExecuted,
  gsdVerificationRun,
  gsdVerificationPassed,
  gsdVerificationFailed,
  gsdStateUpdated,
  gsdCheckpointGate,
  gsdWaveFailed,
  gsdFixPlanGenerated,
  gsdFixPlanCompleted,
  gsdResearchStarted,
  gsdResearchCompleted,
  gsdRoadmapPhaseStarted,
} from "./gsd-events.js";

// ─── State Manager ──────────────────────────────────────────────
export type { StateManager, ProgressInfo } from "./state-manager.js";

export {
  createStateManager,
  serializeState,
  deserializeState,
  updateTaskStatus,
  updateWaveStatus,
  getProgress,
  saveState,
  loadState,
} from "./state-manager.js";

// ─── Plan Generator ─────────────────────────────────────────────
export type {
  PlanGenerator,
  GeneratePlanOptions,
  ValidationResult,
  PlanGeneratorConfig,
} from "./plan-generator.js";

export {
  createPlanGenerator,
  generatePlan,
  parsePlan,
  validatePlan,
} from "./plan-generator.js";

// ─── Wave Calculator ────────────────────────────────────────────
export type {
  WaveCalculator,
  WaveCalculatorResult,
  CycleInfo,
  MissingDependencyInfo,
  DependencyValidation,
  FileConflict,
} from "./wave-calculator.js";

export { createWaveCalculator } from "./wave-calculator.js";

// ─── Verification Engine ────────────────────────────────────────
export type {
  VerificationEngine,
  VerificationEngineOptions,
  TruthCheckResult,
  ArtifactCheckResult,
  KeyLinkCheckResult,
  VerificationFailure,
  TaskResults,
} from "./verification-engine.js";

export { createVerificationEngine } from "./verification-engine.js";

// ─── Orchestrator ───────────────────────────────────────────────
export type {
  GsdOrchestrator,
  GsdOrchestratorDeps,
  OrchestratorConfig,
  TaskDispatcher,
  TaskDispatchResult,
  WaveExecutionResult,
  ExecuteResult,
  ExecuteOptions,
} from "./gsd-orchestrator.js";

export { createGsdOrchestrator } from "./gsd-orchestrator.js";

// ─── Integration ────────────────────────────────────────────────
export type {
  GsdIntegration,
  GsdIntegrationConfig,
  EventStoreAdapter,
  InitGsdResult,
} from "./gsd-integration.js";

export { createGsdIntegration, DEFAULT_GSD_CONFIG } from "./gsd-integration.js";
