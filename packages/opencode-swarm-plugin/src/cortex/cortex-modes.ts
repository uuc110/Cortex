import type { GsdMode } from "../gsd/gsd-types.js";

export interface ModeSelectionInput {
  subtaskCount: number;
  hasExternalDeps: boolean;
  hasResearchContext: boolean;
  maxComplexity: number;
}

export interface ModeSelectionResult {
  mode: GsdMode;
  reason: string;
}

const QUICK_MODE_TASK_LIMIT = 5;
const QUICK_MODE_COMPLEXITY_LIMIT = 4;

/**
 * Determine whether a task set should use "quick" or "project" mode.
 *
 * Quick: ≤5 tasks, no external deps, no research, max complexity <5
 * Project: everything else (multi-phase, research, roadmap)
 */
export function selectMode(input: ModeSelectionInput): ModeSelectionResult {
  if (input.hasResearchContext) {
    return {
      mode: "project",
      reason: "Research context present — project mode enables research phase integration",
    };
  }

  if (input.hasExternalDeps) {
    return {
      mode: "project",
      reason: "External dependencies detected — project mode enables dependency tracking",
    };
  }

  if (input.subtaskCount > QUICK_MODE_TASK_LIMIT) {
    return {
      mode: "project",
      reason: `${input.subtaskCount} subtasks exceeds quick mode limit of ${QUICK_MODE_TASK_LIMIT}`,
    };
  }

  if (input.maxComplexity > QUICK_MODE_COMPLEXITY_LIMIT) {
    return {
      mode: "project",
      reason: `Max complexity ${input.maxComplexity} exceeds quick mode threshold of ${QUICK_MODE_COMPLEXITY_LIMIT}`,
    };
  }

  return {
    mode: "quick",
    reason: `${input.subtaskCount} tasks, complexity ≤${input.maxComplexity} — fits quick mode`,
  };
}
