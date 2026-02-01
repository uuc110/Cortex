import type { CellTree } from "../schemas/cell.js";
import type { GsdMode, GsdState } from "../gsd/gsd-types.js";
import type { WaveCalculatorResult } from "../gsd/wave-calculator.js";
import type {
  TaskWithDeps,
  WaveDispatcherConfig,
  EpicExecutionResult,
} from "./wave-dispatcher.js";
import type { WorkerResult } from "../worker/lifecycle.js";
import type { CortexBridgeResult } from "../cortex/cortex-bridge.js";

import { bridgeCellTreeToExecution } from "../cortex/cortex-bridge.js";
import { selectMode, type ModeSelectionInput } from "../cortex/cortex-modes.js";
import { createWaveDispatcher } from "./wave-dispatcher.js";
import { createWaveCalculator } from "../gsd/wave-calculator.js";
import type { GsdTask } from "../gsd/gsd-types.js";

// Research result type (from cortex-research, but we define it inline to avoid circular deps)
export interface ResearchResult {
  findings: string;
  rounds: Array<{ round: number; queries: string[]; findings: string[] }>;
  toolsUsed: string[];
}

export interface CortexCoordinatorConfig {
  projectKey: string;
  projectPath: string;
  planningDir: string;
  epicBeadId: string;
  mode?: GsdMode; // auto-detect if omitted
  waveTimeoutMs?: number;
  maxFixIterations?: number;
  verifyAfterEachWave?: boolean;
  maxResearchRounds?: number;
}

export interface CortexCoordinatorDeps {
  // Decomposition: CellTree from swarm_decompose
  decompose: (task: string, context?: string) => Promise<CellTree>;
  // Research (optional): runs before decomposition in project mode
  research?: (task: string, queries?: string[]) => Promise<ResearchResult>;
  // Worker spawning: given a bead ID and files, spawns a worker agent
  spawnWorker: (beadId: string, files: string[]) => Promise<WorkerResult>;
  // Verification: checks wave output
  verifyWave: (files: string[]) => Promise<{ passed: boolean; errors: string[] }>;
  // Fix bead creation: creates a fix task when verification fails
  createFixBead: (title: string, description: string, parentId: string) => Promise<string>;
  // State persistence
  saveState: (state: GsdState, path: string) => Promise<void>;
  loadState: (path: string) => Promise<GsdState | null>;
  // PLAN.md persistence
  writePlan: (planMarkdown: string, planningDir: string) => Promise<void>;
  // Events
  eventEmit: (type: string, data: any) => void;
}

export interface CortexCoordinatorResult {
  success: boolean;
  epicId: string;
  mode: GsdMode;
  researchFindings?: string;
  bridgeResult: CortexBridgeResult;
  executionResult: EpicExecutionResult;
}

export interface CortexCoordinator {
  execute(task: string, queries?: string[]): Promise<CortexCoordinatorResult>;
}

function buildModeInput(cellTree: CellTree, researchContext?: string): ModeSelectionInput {
  const maxComplexity = cellTree.subtasks.length
    ? Math.max(...cellTree.subtasks.map((task) => task.estimated_complexity))
    : 1;

  return {
    subtaskCount: cellTree.subtasks.length,
    hasExternalDeps: false,
    hasResearchContext: Boolean(researchContext),
    maxComplexity,
  };
}

function buildDispatcherConfig(config: CortexCoordinatorConfig): WaveDispatcherConfig {
  return {
    projectKey: config.projectKey,
    projectPath: config.projectPath,
    epicBeadId: config.epicBeadId,
    planningDir: config.planningDir,
    waveTimeoutMs: config.waveTimeoutMs,
    maxFixIterations: config.maxFixIterations,
    verifyAfterEachWave: config.verifyAfterEachWave,
  };
}

export function createCortexCoordinator(
  config: CortexCoordinatorConfig,
  deps: CortexCoordinatorDeps,
): CortexCoordinator {
  const calculator = createWaveCalculator();

  return {
    async execute(task: string, queries?: string[]) {
      deps.eventEmit("cortex_execution_started", {
        task,
        epic_bead_id: config.epicBeadId,
      });

      let researchFindings: string | undefined;
      if (deps.research) {
        deps.eventEmit("cortex_research_started", { task });
        const researchResult = await deps.research(task, queries);
        researchFindings = researchResult.findings;
        deps.eventEmit("cortex_research_completed", {
          task,
          rounds: researchResult.rounds.length,
          tools: researchResult.toolsUsed,
        });
      }

      let cellTree: CellTree;
      try {
        cellTree = await deps.decompose(task, researchFindings);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        deps.eventEmit("cortex_decompose_failed", { task, error: message });
        throw new Error(`Cortex coordinator failed to decompose task: ${message}`);
      }

      const modeInput = buildModeInput(cellTree, researchFindings);
      const detectedMode = selectMode(modeInput);
      const mode: GsdMode = config.mode ?? detectedMode.mode;

      const bridgeResult = bridgeCellTreeToExecution(cellTree, {
        epicTitle: cellTree.epic.title,
        epicDescription: cellTree.epic.description,
        mode,
        phase: mode === "project" ? "phase-1" : "quick",
        researchContext: researchFindings,
      });

      await deps.writePlan(bridgeResult.planMarkdown, config.planningDir);

      const dispatcher = createWaveDispatcher(buildDispatcherConfig(config), {
        calculateWaves: (tasks: TaskWithDeps[]): WaveCalculatorResult =>
          calculator.calculateWaves(tasks as unknown as GsdTask[]),
        saveState: deps.saveState,
        loadState: deps.loadState,
        spawnWorker: deps.spawnWorker,
        verifyWave: deps.verifyWave,
        createFixBead: deps.createFixBead,
        eventEmit: deps.eventEmit,
      });

      const executionResult = await dispatcher.executeEpic(
        bridgeResult.dispatcherTasks,
      );

      deps.eventEmit("cortex_execution_completed", {
        epic_id: bridgeResult.epicId,
        success: executionResult.success,
        mode,
        waves_completed: executionResult.wavesCompleted,
      });

      return {
        success: executionResult.success,
        epicId: bridgeResult.epicId,
        mode,
        researchFindings,
        bridgeResult,
        executionResult,
      };
    },
  };
}
