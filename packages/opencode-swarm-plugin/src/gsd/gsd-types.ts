export const GSD_MODES = Object.freeze(["quick", "project"] as const);

export const GSD_PLAN_STATUSES = Object.freeze([
  "pending",
  "planning",
  "researching",
  "in_progress",
  "executing",
  "verifying",
  "completed",
  "failed",
] as const);

export const GSD_PLAN_TYPES = Object.freeze([
  "execute",
  "fix",
  "research",
] as const);

export const GSD_TASK_STATUSES = Object.freeze([
  "pending",
  "in_progress",
  "completed",
  "failed",
  "skipped",
] as const);

export const GSD_TASK_PRIORITIES = Object.freeze([
  "critical",
  "high",
  "medium",
  "low",
] as const);

export const GSD_TASK_TYPES = Object.freeze([
  "auto",
  "human-verify",
  "human-action",
  "decision",
] as const);

export const GSD_WAVE_STATUSES = Object.freeze([
  "pending",
  "in_progress",
  "completed",
  "failed",
] as const);

export const GSD_VERIFICATION_STATUSES = Object.freeze([
  "pending",
  "running",
  "passed",
  "failed",
] as const);

export const GSD_ARTIFACT_CHECK_LEVELS = Object.freeze([
  "exists",
  "substantive",
  "wired",
] as const);

export const GSD_KEY_LINK_TYPES = Object.freeze([
  "renders-within",
  "imported-by",
  "calls",
  "extends",
] as const);

export type GsdMode = (typeof GSD_MODES)[number];
export type GsdPlanStatus = (typeof GSD_PLAN_STATUSES)[number];
export type GsdPlanType = (typeof GSD_PLAN_TYPES)[number];
export type GsdTaskStatus = (typeof GSD_TASK_STATUSES)[number];
export type GsdTaskPriority = (typeof GSD_TASK_PRIORITIES)[number];
export type GsdTaskType = (typeof GSD_TASK_TYPES)[number];
export type GsdWaveStatus = (typeof GSD_WAVE_STATUSES)[number];
export type GsdVerificationStatus = (typeof GSD_VERIFICATION_STATUSES)[number];
export type GsdArtifactCheckLevel = (typeof GSD_ARTIFACT_CHECK_LEVELS)[number];
export type GsdKeyLinkType = (typeof GSD_KEY_LINK_TYPES)[number];

export interface GsdSubtask {
  id: string;
  name: string;
  files: string[];
  action: string;
}

export interface GsdTask {
  id: string;
  name: string;
  status: GsdTaskStatus;
  wave: number;
  priority: GsdTaskPriority;
  type: GsdTaskType;
  files: string[];
  action: string;
  verify?: string;
  done?: string;
  dependencies?: string[];
  subtasks?: GsdSubtask[];
}

export interface GsdWave {
  wave_number: number;
  task_ids: string[];
  status: GsdWaveStatus;
  parallel: boolean;
  started_at?: string;
  completed_at?: string;
  duration_ms?: number;
}

export interface VerificationTruth {
  description: string;
  passed: boolean;
}

export interface VerificationArtifact {
  path: string;
  check: GsdArtifactCheckLevel;
  passed: boolean;
}

export interface VerificationKeyLink {
  from: string;
  to: string;
  type: GsdKeyLinkType;
  passed: boolean;
}

export interface VerificationResult {
  status: GsdVerificationStatus;
  truths: VerificationTruth[];
  artifacts: VerificationArtifact[];
  key_links: VerificationKeyLink[];
  checked_at?: string;
  total_checks?: number;
  passed_checks?: number;
  failed_checks?: number;
}

export interface GsdPlan {
  id: string;
  title: string;
  phase: string;
  created: string;
  status: GsdPlanStatus;
  mode: GsdMode;
  type: GsdPlanType;
  tasks: GsdTask[];
  waves: GsdWave[];
  bead_id?: string;
  epic_id?: string;
  worker_id?: string;
  depends_on?: string[];
  files_modified?: string[];
  autonomous?: boolean;
  plan_number?: string;
  verification?: VerificationResult;
  must_haves?: MustHaves;
  research_context?: string;
}

export interface GsdPlanFrontmatter {
  phase: string;
  plan: string;
  type: GsdPlanType;
  mode: GsdMode;
  status: GsdPlanStatus;
  created: string;
  wave: number;
  depends_on: string[];
  files_modified: string[];
  autonomous: boolean;
  bead_id: string;
  epic_id: string;
  worker_id: string;
}

export interface GsdState {
  plan_id: string;
  status: GsdPlanStatus;
  mode: GsdMode;
  current_wave: number;
  completed_tasks: string[];
  failed_tasks: string[];
  verification_results: VerificationResult[];
  started_at: string;
  last_updated: string;
  current_phase?: number;
  decisions?: string[];
  context_notes?: string[];
  completed_at?: string;
}

export interface MustHaves {
  truths: string[];
  artifacts: { path: string; check: GsdArtifactCheckLevel }[];
  key_links: { from: string; to: string; type: GsdKeyLinkType }[];
}

export interface PlanningDirectoryConfig {
  mode: GsdMode;
  root: string;
  project_path?: string;
  roadmap_path?: string;
  state_path?: string;
  research_dir?: string;
  phases_dir?: string;
  quick_dir?: string;
}

function isNonNullObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function includesValue<T extends readonly unknown[]>(
  arr: T,
  value: unknown,
): value is T[number] {
  return (arr as readonly unknown[]).includes(value);
}

export function isGsdMode(value: unknown): value is GsdMode {
  return typeof value === "string" && includesValue(GSD_MODES, value);
}

export function isGsdPlanStatus(value: unknown): value is GsdPlanStatus {
  return typeof value === "string" && includesValue(GSD_PLAN_STATUSES, value);
}

export function isGsdPlanType(value: unknown): value is GsdPlanType {
  return typeof value === "string" && includesValue(GSD_PLAN_TYPES, value);
}

export function isGsdTaskStatus(value: unknown): value is GsdTaskStatus {
  return typeof value === "string" && includesValue(GSD_TASK_STATUSES, value);
}

export function isGsdTaskPriority(value: unknown): value is GsdTaskPriority {
  return typeof value === "string" && includesValue(GSD_TASK_PRIORITIES, value);
}

export function isGsdTaskType(value: unknown): value is GsdTaskType {
  return typeof value === "string" && includesValue(GSD_TASK_TYPES, value);
}

export function isGsdWaveStatus(value: unknown): value is GsdWaveStatus {
  return typeof value === "string" && includesValue(GSD_WAVE_STATUSES, value);
}

export function isGsdVerificationStatus(
  value: unknown,
): value is GsdVerificationStatus {
  return (
    typeof value === "string" && includesValue(GSD_VERIFICATION_STATUSES, value)
  );
}

export function isGsdArtifactCheckLevel(
  value: unknown,
): value is GsdArtifactCheckLevel {
  return (
    typeof value === "string" &&
    includesValue(GSD_ARTIFACT_CHECK_LEVELS, value)
  );
}

export function isGsdKeyLinkType(value: unknown): value is GsdKeyLinkType {
  return typeof value === "string" && includesValue(GSD_KEY_LINK_TYPES, value);
}

export function isGsdPlan(value: unknown): value is GsdPlan {
  if (!isNonNullObject(value)) return false;

  const v = value as Record<string, unknown>;

  return (
    typeof v.id === "string" &&
    v.id.length > 0 &&
    typeof v.title === "string" &&
    typeof v.phase === "string" &&
    typeof v.created === "string" &&
    isGsdPlanStatus(v.status) &&
    isGsdMode(v.mode) &&
    isGsdPlanType(v.type) &&
    Array.isArray(v.tasks) &&
    Array.isArray(v.waves)
  );
}

export function isGsdTask(value: unknown): value is GsdTask {
  if (!isNonNullObject(value)) return false;

  const v = value as Record<string, unknown>;

  return (
    typeof v.id === "string" &&
    v.id.length > 0 &&
    typeof v.name === "string" &&
    isGsdTaskStatus(v.status) &&
    typeof v.wave === "number" &&
    v.wave >= 1 &&
    isGsdTaskPriority(v.priority) &&
    isGsdTaskType(v.type) &&
    Array.isArray(v.files) &&
    typeof v.action === "string"
  );
}

export function isGsdWave(value: unknown): value is GsdWave {
  if (!isNonNullObject(value)) return false;

  const v = value as Record<string, unknown>;

  return (
    typeof v.wave_number === "number" &&
    v.wave_number >= 1 &&
    Array.isArray(v.task_ids) &&
    isGsdWaveStatus(v.status) &&
    typeof v.parallel === "boolean"
  );
}

export function isGsdState(value: unknown): value is GsdState {
  if (!isNonNullObject(value)) return false;

  const v = value as Record<string, unknown>;

  return (
    typeof v.plan_id === "string" &&
    v.plan_id.length > 0 &&
    isGsdPlanStatus(v.status) &&
    isGsdMode(v.mode) &&
    typeof v.current_wave === "number" &&
    Array.isArray(v.completed_tasks) &&
    Array.isArray(v.failed_tasks) &&
    Array.isArray(v.verification_results) &&
    typeof v.started_at === "string" &&
    typeof v.last_updated === "string"
  );
}

export function isVerificationResult(
  value: unknown,
): value is VerificationResult {
  if (!isNonNullObject(value)) return false;

  const v = value as Record<string, unknown>;

  return (
    isGsdVerificationStatus(v.status) &&
    Array.isArray(v.truths) &&
    Array.isArray(v.artifacts) &&
    Array.isArray(v.key_links)
  );
}

export function isPlanningDirectoryConfig(
  value: unknown,
): value is PlanningDirectoryConfig {
  if (!isNonNullObject(value)) return false;

  const v = value as Record<string, unknown>;

  return isGsdMode(v.mode) && typeof v.root === "string";
}
