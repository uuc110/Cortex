import { tool } from "@opencode-ai/plugin";
import { CellTreeSchema } from "../schemas/cell.js";
import {
  bridgeCellTreeToExecution,
  parsePlanToDispatcherTasks,
} from "./cortex-bridge.js";
import { createVerificationEngine } from "../gsd/verification-engine.js";
import { parsePlan } from "../gsd/plan-generator.js";
import { loadState, getProgress } from "../gsd/state-manager.js";
import { selectMode, type ModeSelectionInput } from "./cortex-modes.js";
import { createCortexResearcher } from "./cortex-research.js";
import { discoverDocTools } from "../swarm-research.js";

import type { GsdMode, MustHaves } from "../gsd/gsd-types.js";

export const cortex_decompose = tool({
  description:
    "Decompose task into wave-organized execution plan. Takes a validated CellTree JSON (from swarm_validate_decomposition) and produces GSD tasks with waves, PLAN.md, and dispatcher-ready tasks. Use AFTER swarm_decompose + swarm_validate_decomposition.",
  args: {
    cell_tree: tool.schema
      .string()
      .min(1)
      .describe("Validated CellTree JSON string (output of swarm_validate_decomposition)"),
    mode: tool.schema
      .enum(["quick", "project"])
      .optional()
      .describe("Execution mode. 'quick' for ≤5 tasks, 'project' for multi-phase. Auto-detected if omitted."),
    phase: tool.schema
      .string()
      .optional()
      .describe("Phase name for project mode (e.g., 'phase-1')"),
    project_path: tool.schema
      .string()
      .optional()
      .describe("Project root path for PLAN.md generation"),
    must_haves_json: tool.schema
      .string()
      .optional()
      .describe("JSON string of MustHaves ({truths, artifacts, key_links}) for verification"),
    research_context: tool.schema
      .string()
      .optional()
      .describe("Research findings to include in PLAN.md"),
  },
  async execute(args) {
    if (!args.cell_tree) {
      return JSON.stringify({
        success: false,
        error: "Missing required parameter: cell_tree",
        hint: "Pass the validated CellTree JSON from swarm_validate_decomposition.",
      }, null, 2);
    }

    try {
      let parsed: unknown;
      if (typeof args.cell_tree === "string") {
        parsed = JSON.parse(args.cell_tree);
        if (typeof parsed === "string") parsed = JSON.parse(parsed);
      } else {
        parsed = args.cell_tree;
      }

      const cellTree = CellTreeSchema.parse(parsed);

      let mustHaves: MustHaves | undefined;
      if (args.must_haves_json) {
        try {
          mustHaves = JSON.parse(args.must_haves_json) as MustHaves;
        } catch {
          return JSON.stringify({
            success: false,
            error: "Invalid must_haves_json: could not parse as JSON",
          }, null, 2);
        }
      }

      const modeInput: ModeSelectionInput = {
        subtaskCount: cellTree.subtasks.length,
        hasExternalDeps: false,
        hasResearchContext: Boolean(args.research_context),
        maxComplexity: Math.max(...cellTree.subtasks.map((s) => s.estimated_complexity)),
      };
      const detectedMode = selectMode(modeInput);
      const mode: GsdMode = args.mode ?? detectedMode.mode;

      const result = bridgeCellTreeToExecution(cellTree, {
        epicTitle: cellTree.epic.title,
        epicDescription: cellTree.epic.description,
        mode,
        phase: args.phase ?? (mode === "project" ? "phase-1" : "quick"),
        mustHaves,
        researchContext: args.research_context,
      });

      return JSON.stringify({
        success: true,
        epic_id: result.epicId,
        mode,
        mode_auto_detected: !args.mode,
        mode_reason: detectedMode.reason,
        total_tasks: result.tasks.length,
        total_waves: result.totalWaves,
        max_parallelism: result.maxParallelism,
        waves: result.waveResult.waves.map((w) => ({
          wave_number: w.wave_number,
          task_count: w.task_ids.length,
          task_ids: w.task_ids,
          parallel: w.parallel,
        })),
        tasks: result.tasks.map((t) => ({
          id: t.id,
          name: t.name,
          wave: t.wave,
          priority: t.priority,
          files: t.files,
          dependencies: t.dependencies,
        })),
        plan_markdown: result.planMarkdown,
        dispatcher_tasks: result.dispatcherTasks,
      }, null, 2);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return JSON.stringify({
        success: false,
        error: `Decomposition bridge failed: ${message}`,
        hint: "Ensure cell_tree is valid CellTree JSON from swarm_validate_decomposition.",
      }, null, 2);
    }
  },
});

export const cortex_verify = tool({
  description:
    "Verify execution results against a PLAN.md. Checks truths, artifacts, and key_links from must_haves. Returns pass/fail with gap analysis.",
  args: {
    plan_markdown: tool.schema
      .string()
      .min(1)
      .describe("PLAN.md content to verify against"),
    completed_task_ids: tool.schema
      .string()
      .describe("JSON array of completed task IDs"),
    failed_task_ids: tool.schema
      .string()
      .optional()
      .describe("JSON array of failed task IDs (default: [])"),
    project_path: tool.schema
      .string()
      .optional()
      .describe("Project root path for artifact checks"),
  },
  async execute(args) {
    if (!args.plan_markdown) {
      return JSON.stringify({
        success: false,
        error: "Missing required parameter: plan_markdown",
      }, null, 2);
    }

    try {
      const plan = parsePlan(args.plan_markdown);

      let completedIds: string[];
      try {
        completedIds = JSON.parse(args.completed_task_ids) as string[];
      } catch {
        return JSON.stringify({
          success: false,
          error: "Invalid completed_task_ids: must be a JSON array of strings",
        }, null, 2);
      }

      let failedIds: string[] = [];
      if (args.failed_task_ids) {
        try {
          failedIds = JSON.parse(args.failed_task_ids) as string[];
        } catch {
          return JSON.stringify({
            success: false,
            error: "Invalid failed_task_ids: must be a JSON array of strings",
          }, null, 2);
        }
      }

      const engine = createVerificationEngine({
        projectPath: args.project_path,
      });

      const verificationResult = engine.verify(plan, {
        completed_task_ids: completedIds,
        failed_task_ids: failedIds,
      });

      const fullyVerified = engine.isFullyVerified(verificationResult);

      return JSON.stringify({
        success: true,
        verified: fullyVerified,
        status: verificationResult.status,
        total_checks: verificationResult.total_checks ?? 0,
        passed_checks: verificationResult.passed_checks ?? 0,
        failed_checks: verificationResult.failed_checks ?? 0,
        truths: verificationResult.truths,
        artifacts: verificationResult.artifacts,
        key_links: verificationResult.key_links,
      }, null, 2);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return JSON.stringify({
        success: false,
        error: `Verification failed: ${message}`,
      }, null, 2);
    }
  },
});

export const cortex_status = tool({
  description:
    "Get current execution status from STATE.md. Shows progress, current wave, completed/failed tasks.",
  args: {
    planning_dir: tool.schema
      .string()
      .min(1)
      .describe("Path to .planning directory containing STATE.md"),
  },
  async execute(args) {
    if (!args.planning_dir) {
      return JSON.stringify({
        success: false,
        error: "Missing required parameter: planning_dir",
      }, null, 2);
    }

    try {
      const state = await loadState(args.planning_dir);

      if (!state) {
        return JSON.stringify({
          success: true,
          has_state: false,
          message: "No STATE.md found — execution has not started yet.",
        }, null, 2);
      }

      const progress = getProgress(state);

      return JSON.stringify({
        success: true,
        has_state: true,
        plan_id: state.plan_id,
        status: state.status,
        mode: state.mode,
        current_wave: state.current_wave,
        progress: {
          completed: progress.completed,
          total: progress.total,
          percent: progress.percentComplete,
        },
        completed_tasks: state.completed_tasks,
        failed_tasks: state.failed_tasks,
        started_at: state.started_at,
        last_updated: state.last_updated,
        completed_at: state.completed_at,
      }, null, 2);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return JSON.stringify({
        success: false,
        error: `Status check failed: ${message}`,
      }, null, 2);
    }
  },
});

export const cortex_research = tool({
  description:
    "Run multi-round research before task decomposition. Discovers available doc tools and executes research queries. Returns findings that can be passed as research_context to cortex_decompose.",
  args: {
    task: tool.schema.string().min(1).describe("Task description to research"),
    queries: tool.schema
      .string()
      .optional()
      .describe(
        "JSON array of research queries. Auto-generated from task if omitted.",
      ),
    max_rounds: tool.schema
      .number()
      .optional()
      .describe("Maximum research rounds (default: 3)"),
    project_key: tool.schema
      .string()
      .optional()
      .describe("Project key for event tracking"),
    epic_id: tool.schema
      .string()
      .optional()
      .describe("Epic ID for event correlation"),
  },
  async execute(args) {
    let parsedQueries: string[] | undefined;

    if (args.queries) {
      try {
        const parsed = JSON.parse(args.queries) as unknown;
        if (!Array.isArray(parsed) || parsed.some((q) => typeof q !== "string")) {
          return JSON.stringify({
            success: false,
            error: "Invalid queries: must be a JSON array of strings",
          }, null, 2);
        }
        parsedQueries = parsed;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return JSON.stringify({
          success: false,
          error: `Invalid queries JSON: ${message}`,
        }, null, 2);
      }
    }

    const researcher = createCortexResearcher(
      {
        projectKey: args.project_key ?? "unknown",
        maxRounds: args.max_rounds ?? 3,
        epicId: args.epic_id,
      },
      {
        discoverTools: discoverDocTools,
        executeQuery: async (query: string, toolName: string) =>
          `Placeholder result for "${query}" via ${toolName}`,
        eventEmit: () => {},
      },
    );

    const result = await researcher.research(args.task, parsedQueries);

    return JSON.stringify({
      success: true,
      findings: result.findings,
      rounds: result.rounds,
      tools_used: result.toolsUsed,
    }, null, 2);
  },
});

export const cortexTools = {
  cortex_decompose,
  cortex_verify,
  cortex_status,
  cortex_research,
};
