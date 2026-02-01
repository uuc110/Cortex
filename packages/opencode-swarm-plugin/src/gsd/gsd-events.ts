export interface GsdEventBase {
  project_key: string;
  timestamp: number;
}

export function gsdPlanCreated(
  base: GsdEventBase,
  data: {
    plan_id: string;
    plan_path: string;
    task_count: number;
    wave_count: number;
    bead_id?: string;
    epic_id?: string;
    autonomous?: boolean;
  },
): { type: "gsd_plan_created" } & GsdEventBase & typeof data {
  return {
    type: "gsd_plan_created" as const,
    ...base,
    ...data,
  };
}

export function gsdWaveStarted(
  base: GsdEventBase,
  data: {
    wave_number: number;
    task_count: number;
    parallel_workers: number;
    epic_id?: string;
    files_in_scope?: string[];
  },
): { type: "gsd_wave_started" } & GsdEventBase & typeof data {
  return {
    type: "gsd_wave_started" as const,
    ...base,
    ...data,
  };
}

export function gsdWaveCompleted(
  base: GsdEventBase,
  data: {
    wave_number: number;
    tasks_completed: number;
    tasks_failed?: number;
    duration_ms?: number;
    epic_id?: string;
  },
): { type: "gsd_wave_completed" } & GsdEventBase & typeof data {
  return {
    type: "gsd_wave_completed" as const,
    ...base,
    ...data,
  };
}

export function gsdTaskExecuted(
  base: GsdEventBase,
  data: {
    task_name: string;
    success: boolean;
    bead_id?: string;
    epic_id?: string;
    wave_number?: number;
    files_modified?: string[];
    commit_sha?: string;
  },
): { type: "gsd_task_executed" } & GsdEventBase & typeof data {
  return {
    type: "gsd_task_executed" as const,
    ...base,
    ...data,
  };
}

export function gsdVerificationRun(
  base: GsdEventBase,
  data: {
    verification_type: "task" | "phase";
    epic_id?: string;
    phase_num?: number;
    must_haves_checked?: number;
    artifacts_checked?: number;
    key_links_checked?: number;
  },
): { type: "gsd_verification_run" } & GsdEventBase & typeof data {
  return {
    type: "gsd_verification_run" as const,
    ...base,
    ...data,
  };
}

export function gsdVerificationPassed(
  base: GsdEventBase,
  data: {
    must_haves_passed: number;
    artifacts_passed: number;
    key_links_passed: number;
    total_checks: number;
    epic_id?: string;
    phase_num?: number;
  },
): { type: "gsd_verification_passed" } & GsdEventBase & typeof data {
  return {
    type: "gsd_verification_passed" as const,
    ...base,
    ...data,
  };
}

export function gsdVerificationFailed(
  base: GsdEventBase,
  data: {
    failures: string[];
    epic_id?: string;
    phase_num?: number;
    fix_tasks_created?: number;
    retry_count?: number;
  },
): { type: "gsd_verification_failed" } & GsdEventBase & typeof data {
  return {
    type: "gsd_verification_failed" as const,
    ...base,
    ...data,
  };
}

export function gsdStateUpdated(
  base: GsdEventBase,
  data: {
    current_phase?: number;
    current_wave?: number;
    tasks_completed?: number;
    tasks_remaining?: number;
  },
): { type: "gsd_state_updated" } & GsdEventBase & typeof data {
  return {
    type: "gsd_state_updated" as const,
    ...base,
    ...data,
  };
}

export function gsdCheckpointGate(
  base: GsdEventBase,
  data: {
    gate_type: "human-verify" | "decision" | "human-action";
    description: string;
    epic_id?: string;
    response?: string;
  },
): { type: "gsd_checkpoint_gate" } & GsdEventBase & typeof data {
  return {
    type: "gsd_checkpoint_gate" as const,
    ...base,
    ...data,
  };
}

export function gsdWaveFailed(
  base: GsdEventBase,
  data: {
    wave_number: number;
    failures: string[];
    epic_id?: string;
    fix_wave_created?: boolean;
  },
): { type: "gsd_wave_failed" } & GsdEventBase & typeof data {
  return {
    type: "gsd_wave_failed" as const,
    ...base,
    ...data,
  };
}

export function gsdFixPlanGenerated(
  base: GsdEventBase,
  data: {
    source_verification: string;
    fix_tasks: string[];
    epic_id?: string;
    phase_num?: number;
  },
): { type: "gsd_fix_plan_generated" } & GsdEventBase & typeof data {
  return {
    type: "gsd_fix_plan_generated" as const,
    ...base,
    ...data,
  };
}

export function gsdFixPlanCompleted(
  base: GsdEventBase,
  data: {
    fix_tasks: string[];
    re_verification_passed: boolean;
    epic_id?: string;
    phase_num?: number;
    duration_ms?: number;
  },
): { type: "gsd_fix_plan_completed" } & GsdEventBase & typeof data {
  return {
    type: "gsd_fix_plan_completed" as const,
    ...base,
    ...data,
  };
}

export function gsdResearchStarted(
  base: GsdEventBase,
  data: {
    project_key_ref: string;
    round: number;
    epic_id?: string;
    queries?: string[];
  },
): { type: "gsd_research_started" } & GsdEventBase & typeof data {
  return {
    type: "gsd_research_started" as const,
    ...base,
    ...data,
  };
}

export function gsdResearchCompleted(
  base: GsdEventBase,
  data: {
    project_key_ref: string;
    findings_path: string;
    round: number;
    epic_id?: string;
    findings_count?: number;
  },
): { type: "gsd_research_completed" } & GsdEventBase & typeof data {
  return {
    type: "gsd_research_completed" as const,
    ...base,
    ...data,
  };
}

export function gsdRoadmapPhaseStarted(
  base: GsdEventBase,
  data: {
    phase_num: number;
    phase_name: string;
    epic_id?: string;
    acceptance_criteria?: string[];
  },
): { type: "gsd_roadmap_phase_started" } & GsdEventBase & typeof data {
  return {
    type: "gsd_roadmap_phase_started" as const,
    ...base,
    ...data,
  };
}
