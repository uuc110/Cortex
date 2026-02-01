import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";

import type {
  GsdState,
  GsdTaskStatus,
  GsdWaveStatus,
  GsdPlanStatus,
  GsdMode,
  VerificationResult,
} from "./gsd-types.js";

import { isGsdPlanStatus, isGsdMode } from "./gsd-types.js";

export interface ProgressInfo {
  completed: number;
  total: number;
  currentWave: number;
  percentComplete: number;
}

export interface StateManager {
  save: (state: GsdState) => Promise<void>;
  load: () => Promise<GsdState | null>;
}

const STATE_FILENAME = "STATE.md";

function escapeYamlString(value: string): string {
  if (
    value.includes('"') ||
    value.includes("\n") ||
    value.includes(":") ||
    value.includes("#") ||
    value.includes("'") ||
    value.includes("{") ||
    value.includes("}") ||
    value.includes("[") ||
    value.includes("]") ||
    value.includes(",") ||
    value.includes("&") ||
    value.includes("*") ||
    value.includes("!") ||
    value.includes("|") ||
    value.includes(">") ||
    value.includes("%") ||
    value.includes("@") ||
    value.includes("`")
  ) {
    const escaped = value
      .replace(/\\/g, "\\\\")
      .replace(/"/g, '\\"')
      .replace(/\n/g, "\\n");
    return `"${escaped}"`;
  }
  if (value === "" || value === "true" || value === "false" || value === "null") {
    return `"${value}"`;
  }
  if (/^\d+(\.\d+)?$/.test(value)) {
    return `"${value}"`;
  }
  return `"${value}"`;
}

function serializeArray(items: string[], indent: string): string {
  if (items.length === 0) {
    return "[]";
  }
  return (
    "\n" + items.map((item) => `${indent}  - ${escapeYamlString(item)}`).join("\n")
  );
}

function serializeVerificationResults(
  results: VerificationResult[],
  indent: string,
): string {
  if (results.length === 0) {
    return "[]";
  }

  const lines: string[] = [""];
  for (const result of results) {
    lines.push(`${indent}  - status: ${escapeYamlString(result.status)}`);
    lines.push(`${indent}    truths:`);
    if (result.truths.length === 0) {
      lines.push(`${indent}      []`);
    } else {
      for (const truth of result.truths) {
        lines.push(
          `${indent}      - description: ${escapeYamlString(truth.description)}`,
        );
        lines.push(`${indent}        passed: ${truth.passed}`);
      }
    }
    lines.push(`${indent}    artifacts:`);
    if (result.artifacts.length === 0) {
      lines.push(`${indent}      []`);
    } else {
      for (const artifact of result.artifacts) {
        lines.push(
          `${indent}      - path: ${escapeYamlString(artifact.path)}`,
        );
        lines.push(
          `${indent}        check: ${escapeYamlString(artifact.check)}`,
        );
        lines.push(`${indent}        passed: ${artifact.passed}`);
      }
    }
    lines.push(`${indent}    key_links:`);
    if (result.key_links.length === 0) {
      lines.push(`${indent}      []`);
    } else {
      for (const link of result.key_links) {
        lines.push(
          `${indent}      - from: ${escapeYamlString(link.from)}`,
        );
        lines.push(`${indent}        to: ${escapeYamlString(link.to)}`);
        lines.push(
          `${indent}        type: ${escapeYamlString(link.type)}`,
        );
        lines.push(`${indent}        passed: ${link.passed}`);
      }
    }
  }
  return lines.join("\n");
}

export function serializeState(state: GsdState): string {
  const lines: string[] = [];

  lines.push("# GSD State — auto-generated, do not edit manually");
  lines.push(`plan_id: ${escapeYamlString(state.plan_id)}`);
  lines.push(`status: ${escapeYamlString(state.status)}`);
  lines.push(`mode: ${escapeYamlString(state.mode)}`);
  lines.push(`current_wave: ${state.current_wave}`);
  lines.push(`completed_tasks: ${serializeArray(state.completed_tasks, "")}`);
  lines.push(`failed_tasks: ${serializeArray(state.failed_tasks, "")}`);
  lines.push(
    `verification_results: ${serializeVerificationResults(state.verification_results, "")}`,
  );
  lines.push(`started_at: ${escapeYamlString(state.started_at)}`);
  lines.push(`last_updated: ${escapeYamlString(state.last_updated)}`);

  if (state.current_phase !== undefined) {
    lines.push(`current_phase: ${state.current_phase}`);
  }
  if (state.decisions !== undefined) {
    lines.push(`decisions: ${serializeArray(state.decisions, "")}`);
  }
  if (state.context_notes !== undefined) {
    lines.push(`context_notes: ${serializeArray(state.context_notes, "")}`);
  }
  if (state.completed_at !== undefined) {
    lines.push(`completed_at: ${escapeYamlString(state.completed_at)}`);
  }

  return lines.join("\n") + "\n";
}

function stripQuotes(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed
      .slice(1, -1)
      .replace(/\\n/g, "\n")
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, "\\");
  }
  return trimmed;
}

function parseSimpleYamlValue(value: string): string | number | boolean {
  const trimmed = value.trim();
  if (trimmed === "true") return true as unknown as string;
  if (trimmed === "false") return false as unknown as string;
  if (trimmed === "null" || trimmed === "~") return "" as string;
  if (/^-?\d+$/.test(trimmed)) return parseInt(trimmed, 10) as unknown as string;
  if (/^-?\d+\.\d+$/.test(trimmed))
    return parseFloat(trimmed) as unknown as string;
  return stripQuotes(trimmed);
}

interface ParsedYamlMap {
  [key: string]: unknown;
}

function parseYamlLines(content: string): ParsedYamlMap | null {
  const lines = content.split("\n");
  const result: ParsedYamlMap = {};
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const trimmedLine = line.trim();

    if (trimmedLine === "" || trimmedLine.startsWith("#")) {
      i++;
      continue;
    }

    const colonIdx = trimmedLine.indexOf(":");
    if (colonIdx === -1) {
      i++;
      continue;
    }

    const key = trimmedLine.slice(0, colonIdx).trim();
    const afterColon = trimmedLine.slice(colonIdx + 1).trim();

    if (afterColon === "[]") {
      result[key] = [];
      i++;
      continue;
    }

    if (afterColon === "" || afterColon === "|" || afterColon === ">") {
      const arrayItems = collectArrayOrNestedBlock(lines, i + 1);
      if (arrayItems !== null) {
        result[key] = arrayItems.value;
        i = arrayItems.nextIndex;
        continue;
      }
      result[key] = "";
      i++;
      continue;
    }

    result[key] = parseSimpleYamlValue(afterColon);
    i++;
  }

  return result;
}

interface CollectResult {
  value: unknown;
  nextIndex: number;
}

function getIndent(line: string): number {
  let count = 0;
  for (const ch of line) {
    if (ch === " ") count++;
    else break;
  }
  return count;
}

function collectArrayOrNestedBlock(
  lines: string[],
  startIdx: number,
): CollectResult | null {
  if (startIdx >= lines.length) return null;

  let firstContentIdx = startIdx;
  while (firstContentIdx < lines.length) {
    const trimmed = lines[firstContentIdx].trim();
    if (trimmed !== "" && !trimmed.startsWith("#")) break;
    firstContentIdx++;
  }
  if (firstContentIdx >= lines.length) return null;

  const firstLine = lines[firstContentIdx].trim();

  if (firstLine === "[]") {
    return { value: [], nextIndex: firstContentIdx + 1 };
  }

  if (!firstLine.startsWith("- ") && !firstLine.startsWith("-\t")) {
    return null;
  }

  const baseIndent = getIndent(lines[firstContentIdx]);
  const items: unknown[] = [];
  let i = firstContentIdx;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (trimmed === "" || trimmed.startsWith("#")) {
      i++;
      continue;
    }

    const currentIndent = getIndent(line);
    if (currentIndent < baseIndent) break;

    if (currentIndent === baseIndent && trimmed.startsWith("- ")) {
      const itemContent = trimmed.slice(2).trim();
      const itemColonIdx = itemContent.indexOf(":");

      if (itemColonIdx !== -1) {
        const obj: ParsedYamlMap = {};
        const itemKey = itemContent.slice(0, itemColonIdx).trim();
        const itemVal = itemContent.slice(itemColonIdx + 1).trim();
        obj[itemKey] = parseSimpleYamlValue(itemVal);
        i++;

        while (i < lines.length) {
          const subLine = lines[i];
          const subTrimmed = subLine.trim();

          if (subTrimmed === "" || subTrimmed.startsWith("#")) {
            i++;
            continue;
          }

          const subIndent = getIndent(subLine);
          if (subIndent <= baseIndent) break;

          if (subTrimmed.startsWith("- ")) {
            const nestedResult = collectArrayOrNestedBlock(lines, i);
            if (nestedResult !== null) {
              const lastKey = Object.keys(obj).pop();
              if (lastKey && obj[lastKey] === "" || (lastKey && Array.isArray(obj[lastKey]) && (obj[lastKey] as unknown[]).length === 0)) {
                obj[lastKey!] = nestedResult.value;
              }
              i = nestedResult.nextIndex;
              continue;
            }
          }

          const subColonIdx = subTrimmed.indexOf(":");
          if (subColonIdx !== -1) {
            const subKey = subTrimmed.slice(0, subColonIdx).trim();
            const subVal = subTrimmed.slice(subColonIdx + 1).trim();

            if (subVal === "[]") {
              obj[subKey] = [];
              i++;
              continue;
            }

            if (subVal === "" || subVal === "|" || subVal === ">") {
              const nested = collectArrayOrNestedBlock(lines, i + 1);
              if (nested !== null) {
                obj[subKey] = nested.value;
                i = nested.nextIndex;
                continue;
              }
              obj[subKey] = "";
              i++;
              continue;
            }

            obj[subKey] = parseSimpleYamlValue(subVal);
          }
          i++;
        }
        items.push(obj);
      } else {
        items.push(parseSimpleYamlValue(itemContent));
        i++;
      }
    } else {
      i++;
    }
  }

  return { value: items, nextIndex: i };
}

function reconstructVerificationResults(raw: unknown): VerificationResult[] {
  if (!Array.isArray(raw)) return [];

  return raw.map((item: unknown) => {
    const obj = item as ParsedYamlMap;
    return {
      status: String(obj.status ?? "pending"),
      truths: Array.isArray(obj.truths)
        ? obj.truths.map((t: unknown) => {
            const truth = t as ParsedYamlMap;
            return {
              description: String(truth.description ?? ""),
              passed: truth.passed === true || truth.passed === "true",
            };
          })
        : [],
      artifacts: Array.isArray(obj.artifacts)
        ? obj.artifacts.map((a: unknown) => {
            const artifact = a as ParsedYamlMap;
            return {
              path: String(artifact.path ?? ""),
              check: String(artifact.check ?? "exists") as "exists" | "substantive" | "wired",
              passed: artifact.passed === true || artifact.passed === "true",
            };
          })
        : [],
      key_links: Array.isArray(obj.key_links)
        ? obj.key_links.map((l: unknown) => {
            const link = l as ParsedYamlMap;
            return {
              from: String(link.from ?? ""),
              to: String(link.to ?? ""),
              type: String(link.type ?? "calls") as "renders-within" | "imported-by" | "calls" | "extends",
              passed: link.passed === true || link.passed === "true",
            };
          })
        : [],
    } as VerificationResult;
  });
}

function toStringArray(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((item) => String(item));
}

export function deserializeState(content: string): GsdState | null {
  const trimmed = content.trim();
  if (trimmed === "") return null;

  try {
    const parsed = parseYamlLines(content);
    if (parsed === null) return null;

    const planId = parsed.plan_id;
    if (planId === undefined || planId === "") return null;

    const status = String(parsed.status ?? "pending");
    if (!isGsdPlanStatus(status)) return null;

    const mode = String(parsed.mode ?? "quick");
    if (!isGsdMode(mode)) return null;

    const currentWave =
      typeof parsed.current_wave === "number"
        ? parsed.current_wave
        : parseInt(String(parsed.current_wave ?? "1"), 10);

    const completedTasks = toStringArray(parsed.completed_tasks);
    const failedTasks = toStringArray(parsed.failed_tasks);
    const verificationResults = reconstructVerificationResults(
      parsed.verification_results,
    );

    const startedAt = String(parsed.started_at ?? new Date().toISOString());
    const lastUpdated = String(
      parsed.last_updated ?? new Date().toISOString(),
    );

    const state: GsdState = {
      plan_id: String(planId),
      status: status as GsdPlanStatus,
      mode: mode as GsdMode,
      current_wave: isNaN(currentWave) ? 1 : currentWave,
      completed_tasks: completedTasks,
      failed_tasks: failedTasks,
      verification_results: verificationResults,
      started_at: startedAt,
      last_updated: lastUpdated,
    };

    if (parsed.current_phase !== undefined) {
      const phase =
        typeof parsed.current_phase === "number"
          ? parsed.current_phase
          : parseInt(String(parsed.current_phase), 10);
      if (!isNaN(phase)) state.current_phase = phase;
    }

    if (Array.isArray(parsed.decisions)) {
      state.decisions = toStringArray(parsed.decisions);
    }

    if (Array.isArray(parsed.context_notes)) {
      state.context_notes = toStringArray(parsed.context_notes);
    }

    if (parsed.completed_at !== undefined && parsed.completed_at !== "") {
      state.completed_at = String(parsed.completed_at);
    }

    return state;
  } catch {
    return null;
  }
}

export function updateTaskStatus(
  state: GsdState,
  taskId: string,
  status: GsdTaskStatus,
): GsdState {
  let completedTasks = state.completed_tasks.filter((id) => id !== taskId);
  let failedTasks = state.failed_tasks.filter((id) => id !== taskId);

  if (status === "completed" || status === "skipped") {
    completedTasks = [...completedTasks, taskId];
  } else if (status === "failed") {
    failedTasks = [...failedTasks, taskId];
  }

  return {
    ...state,
    completed_tasks: completedTasks,
    failed_tasks: failedTasks,
    last_updated: new Date().toISOString(),
  };
}

export function updateWaveStatus(
  state: GsdState,
  waveNumber: number,
  _status: GsdWaveStatus,
): GsdState {
  return {
    ...state,
    current_wave: waveNumber,
    last_updated: new Date().toISOString(),
  };
}

export function getProgress(state: GsdState): ProgressInfo {
  const completed = state.completed_tasks.length;
  const failed = state.failed_tasks.length;
  const total = completed + failed;

  if (total === 0) {
    return {
      completed: 0,
      total: 0,
      currentWave: state.current_wave,
      percentComplete: 0,
    };
  }

  const percentComplete = Math.round((completed / total) * 100);

  return {
    completed,
    total,
    currentWave: state.current_wave,
    percentComplete: Math.min(100, Math.max(0, percentComplete)),
  };
}

export async function saveState(
  state: GsdState,
  planningDir: string,
): Promise<void> {
  const dir = planningDir;
  await mkdir(dir, { recursive: true });
  const filePath = join(dir, STATE_FILENAME);
  const content = serializeState(state);
  await writeFile(filePath, content, "utf-8");
}

export async function loadState(
  planningDir: string,
): Promise<GsdState | null> {
  const filePath = join(planningDir, STATE_FILENAME);
  try {
    const content = await readFile(filePath, "utf-8");
    return deserializeState(content);
  } catch {
    return null;
  }
}

export function createStateManager(options: {
  planningDir: string;
}): StateManager {
  return {
    save: (state: GsdState) => saveState(state, options.planningDir),
    load: () => loadState(options.planningDir),
  };
}
