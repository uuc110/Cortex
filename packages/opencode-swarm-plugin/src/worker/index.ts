// ─── Worker Module Barrel ───────────────────────────────────────
// Re-exports for all Worker sub-modules.
// Import from "src/worker" instead of individual files.

// ─── Lifecycle ──────────────────────────────────────────────────
export type {
  WorkerConfig,
  WorkerDeps,
  TaskExecutor,
  ExecutionResult,
  VerificationResult,
  WorkerResult,
  WorkerStep,
  WorkerLifecycle,
} from "./lifecycle.js";

export { createWorkerLifecycle } from "./lifecycle.js";

// ─── Context Loader ─────────────────────────────────────────────
export type {
  WorkerContext,
  BeadInfo,
  ContextLoaderDeps,
  ContextLoader,
} from "./context-loader.js";

export { createContextLoader } from "./context-loader.js";

// ─── Self Verifier ──────────────────────────────────────────────
export type { SelfVerifier } from "./self-verifier.js";

export { createSelfVerifier } from "./self-verifier.js";

// ─── Mail Sender ────────────────────────────────────────────────
export type { WorkerMailSender } from "./mail-sender.js";

export { createWorkerMailSender } from "./mail-sender.js";

// ─── Discovery Handler ──────────────────────────────────────────
export type {
  DiscoveryInput,
  DiscoveryDeps,
  DiscoveryHandlerFn,
} from "./discovery-handler.js";

export { createDiscoveryHandler } from "./discovery-handler.js";
