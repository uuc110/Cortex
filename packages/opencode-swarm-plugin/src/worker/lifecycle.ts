import type { WorkerContext } from "./context-loader.js";
import type { WorkerMailSender } from "./mail-sender.js";

export interface WorkerConfig {
  beadId: string;
  projectPath: string;
  projectKey: string;
  workerName: string;
}

export interface WorkerDeps {
  beadClient: {
    show: (id: string) => Promise<any>;
    update: (id: string, data: any) => Promise<void>;
    close: (id: string, reason: string) => Promise<void>;
  };
  eventStore: { emit: (type: string, data: any) => void };
  memoryStore: (info: string, tags: string) => Promise<void>;
  contextLoader: {
    loadWorkerContext: (beadId: string) => Promise<WorkerContext>;
  };
  selfVerifier: {
    verify: (projectPath: string, files: string[]) => Promise<VerificationResult>;
  };
  mailSender: WorkerMailSender;
}

export type TaskExecutor = (
  context: WorkerContext,
  plan: string,
) => Promise<ExecutionResult>;

export interface ExecutionResult {
  success: boolean;
  files: string[];
  commit?: string;
  learnings?: Array<{ info: string; tags: string }>;
  errors?: string[];
}

export interface VerificationResult {
  passed: boolean;
  buildOk: boolean;
  testsOk: boolean;
  typeCheckOk: boolean;
  errors: string[];
}

export interface WorkerResult {
  status: "completed" | "blocked" | "failed";
  executionResult?: ExecutionResult;
  verificationResult?: VerificationResult;
  context?: WorkerContext;
}

export type WorkerStep =
  | "pickup"
  | "orient"
  | "plan"
  | "execute"
  | "verify"
  | "learn"
  | "report"
  | "close";

export interface WorkerLifecycle {
  run(taskExecutor: TaskExecutor): Promise<WorkerResult>;
  getCurrentStep(): WorkerStep;
}

function formatPlanFromContext(context: WorkerContext): string {
  const siblings = context.siblings.map((sibling) => sibling.title).join(", ");
  const deps = context.dependencies
    .map((dep) => `${dep.title} [${dep.status}]`)
    .join(", ");

  return [
    `Task: ${context.bead.title}`,
    `Epic: ${context.epic?.title ?? "N/A"}`,
    `Siblings: ${siblings}`,
    `Dependencies: ${deps}`,
    `Memory hints: ${context.memoryContext.length} relevant learnings`,
  ].join("\n");
}

export function createWorkerLifecycle(
  config: WorkerConfig,
  deps: WorkerDeps,
): WorkerLifecycle {
  let currentStep: WorkerStep = "pickup";

  function getCurrentStep(): WorkerStep {
    return currentStep;
  }

  async function run(taskExecutor: TaskExecutor): Promise<WorkerResult> {
    let context: WorkerContext | undefined;
    let executionResult: ExecutionResult | undefined;
    let verificationResult: VerificationResult | undefined;

    try {
      currentStep = "pickup";
      await deps.beadClient.update(config.beadId, { status: "in_progress" });
      deps.eventStore.emit("task_started", {
        beadId: config.beadId,
        workerName: config.workerName,
        projectKey: config.projectKey,
      });
      await deps.mailSender.sendStatus(config.beadId, "planning", 5);

      currentStep = "orient";
      context = await deps.contextLoader.loadWorkerContext(config.beadId);
      await deps.mailSender.sendStatus(config.beadId, "planning", 10);

      currentStep = "plan";
      const plan = formatPlanFromContext(context);
      await deps.mailSender.sendStatus(config.beadId, "planning", 15);

      currentStep = "execute";
      executionResult = await taskExecutor(context, plan);
      await deps.mailSender.sendStatus(config.beadId, "executing", 50);

      if (!executionResult.success) {
        const blocker =
          executionResult.errors?.join("; ") ?? "Execution failed";
        await deps.mailSender.sendBlocked(config.beadId, blocker);
        return { status: "failed", executionResult, context };
      }

      currentStep = "verify";
      verificationResult = await deps.selfVerifier.verify(
        config.projectPath,
        executionResult.files,
      );

      if (!verificationResult.passed) {
        const blocker =
          verificationResult.errors.join("; ") || "Verification failed";
        await deps.mailSender.sendBlocked(config.beadId, blocker);
        return { status: "blocked", executionResult, verificationResult, context };
      }

      if (executionResult.learnings && executionResult.learnings.length > 0) {
        currentStep = "learn";
        for (const learning of executionResult.learnings) {
          await deps.memoryStore(learning.info, learning.tags);
          deps.eventStore.emit("learning_stored", {
            beadId: config.beadId,
            info: learning.info,
            tags: learning.tags,
          });
        }
        await deps.mailSender.sendStatus(config.beadId, "learning", 90);
      }

      currentStep = "report";
      const summary = `Completed ${context.bead.title}`;
      await deps.mailSender.sendCompleted(
        config.beadId,
        summary,
        executionResult.files,
        executionResult.commit,
        executionResult.learnings,
      );

      currentStep = "close";
      await deps.beadClient.close(config.beadId, summary);
      deps.eventStore.emit("task_completed", {
        beadId: config.beadId,
        summary,
        success: true,
      });

      return {
        status: "completed",
        executionResult,
        verificationResult,
        context,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await deps.mailSender.sendBlocked(config.beadId, message);
      return { status: "failed", executionResult, verificationResult, context };
    }
  }

  return { run, getCurrentStep };
}
