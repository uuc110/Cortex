import type {
  GsdPlan,
  GsdTask,
  GsdSubtask,
  GsdWave,
  GsdPlanFrontmatter,
  GsdMode,
  GsdPlanType,
  GsdPlanStatus,
  GsdTaskStatus,
  GsdTaskPriority,
  GsdTaskType,
} from "./gsd-types.js";

import {
  isGsdMode,
  isGsdPlanType,
  isGsdPlanStatus,
  isGsdTaskStatus,
  isGsdTaskPriority,
  isGsdTaskType,
} from "./gsd-types.js";

export interface GeneratePlanOptions {
  id: string;
  title: string;
  phase: string;
  mode: GsdMode;
  type: GsdPlanType;
  bead_id: string;
  epic_id: string;
  worker_id: string;
  status?: GsdPlanStatus;
  plan_number?: string;
  depends_on?: string[];
  autonomous?: boolean;
  created?: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

export interface PlanGeneratorConfig {
  indentSize?: number;
}

export interface PlanGenerator {
  generate(tasks: GsdTask[], options: GeneratePlanOptions): string;
  parse(markdown: string): GsdPlan;
  validate(plan: GsdPlan): ValidationResult;
}

export function createPlanGenerator(_config?: PlanGeneratorConfig): PlanGenerator {
  return {
    generate: generatePlan,
    parse: parsePlan,
    validate: validatePlan,
  };
}

function collectAllFiles(tasks: GsdTask[]): string[] {
  const fileSet = new Set<string>();
  for (const task of tasks) {
    for (const f of task.files) {
      fileSet.add(f);
    }
  }
  return [...fileSet];
}

function computeMinWave(tasks: GsdTask[]): number {
  if (tasks.length === 0) return 1;
  let min = tasks[0].wave;
  for (const t of tasks) {
    if (t.wave < min) min = t.wave;
  }
  return min;
}

function hasHumanTasks(tasks: GsdTask[]): boolean {
  for (const t of tasks) {
    if (t.type === "human-verify" || t.type === "human-action" || t.type === "decision") {
      return true;
    }
  }
  return false;
}

function formatYamlArray(items: string[]): string {
  if (items.length === 0) return "[]";
  const lines = items.map((item) => `  - "${item}"`);
  return "\n" + lines.join("\n");
}

function generateFrontmatter(tasks: GsdTask[], options: GeneratePlanOptions): string {
  const status = options.status ?? "pending";
  const planNumber = options.plan_number ?? "01";
  const created = options.created ?? new Date().toISOString();
  const dependsOn = options.depends_on ?? [];
  const filesModified = collectAllFiles(tasks);
  const autonomous = options.autonomous ?? !hasHumanTasks(tasks);
  const wave = computeMinWave(tasks);

  const lines: string[] = [
    "---",
    `id: "${options.id}"`,
    `title: "${options.title}"`,
    `phase: "${options.phase}"`,
    `plan: "${planNumber}"`,
    `type: "${options.type}"`,
    `mode: "${options.mode}"`,
    `status: "${status}"`,
    `created: "${created}"`,
    `wave: ${wave}`,
    `depends_on: ${formatYamlArray(dependsOn)}`,
    `files_modified: ${formatYamlArray(filesModified)}`,
    `autonomous: ${autonomous}`,
    `bead_id: "${options.bead_id}"`,
    `epic_id: "${options.epic_id}"`,
    `worker_id: "${options.worker_id}"`,
    "---",
  ];

  return lines.join("\n");
}

function generateSubtaskXml(subtask: GsdSubtask, indent: string): string {
  const lines: string[] = [
    `${indent}<subtask id="${subtask.id}">`,
    `${indent}  <name>${subtask.name}</name>`,
    `${indent}  <files>${subtask.files.join(", ")}</files>`,
    `${indent}  <action>${subtask.action}</action>`,
    `${indent}</subtask>`,
  ];
  return lines.join("\n");
}

function generateTaskXml(task: GsdTask): string {
  const attrs = `id="${task.id}" status="${task.status}" wave="${task.wave}" priority="${task.priority}" type="${task.type}"`;
  const lines: string[] = [`<task ${attrs}>`];

  lines.push(`  <name>${task.name}</name>`);
  lines.push(`  <files>${task.files.join(", ")}</files>`);

  if (task.subtasks && task.subtasks.length > 0) {
    for (const sub of task.subtasks) {
      lines.push(generateSubtaskXml(sub, "  "));
    }
  }

  lines.push(`  <action>${task.action}</action>`);

  if (task.verify !== undefined) {
    lines.push(`  <verify>\n${task.verify}</verify>`);
  }

  if (task.done !== undefined) {
    lines.push(`  <done>${task.done}</done>`);
  }

  lines.push("</task>");

  return lines.join("\n");
}

function generateTasksSection(tasks: GsdTask[]): string {
  const lines: string[] = ["<tasks>"];
  for (const task of tasks) {
    lines.push(generateTaskXml(task));
  }
  lines.push("</tasks>");
  return lines.join("\n");
}

export function generatePlan(tasks: GsdTask[], options: GeneratePlanOptions): string {
  const frontmatter = generateFrontmatter(tasks, options);
  const tasksSection = generateTasksSection(tasks);

  return `${frontmatter}\n\n${tasksSection}\n`;
}

function parseFrontmatter(content: string): {
  frontmatter: Record<string, unknown>;
  body: string;
} {
  const trimmed = content.trim();
  if (!trimmed.startsWith("---")) {
    throw new Error("Missing YAML frontmatter: document must start with ---");
  }

  const secondDelimiter = trimmed.indexOf("---", 3);
  if (secondDelimiter === -1) {
    throw new Error("Missing closing frontmatter delimiter (---)");
  }

  const yamlBlock = trimmed.slice(3, secondDelimiter).trim();
  const body = trimmed.slice(secondDelimiter + 3).trim();

  const result: Record<string, unknown> = {};
  let currentKey: string | null = null;
  let currentArrayItems: string[] | null = null;

  const lines = yamlBlock.split("\n");
  for (const line of lines) {
    const trimLine = line.trim();
    if (trimLine === "" || trimLine.startsWith("#")) continue;

    if (trimLine.startsWith("- ")) {
      if (currentKey !== null && currentArrayItems !== null) {
        const value = trimLine.slice(2).trim().replace(/^"(.*)"$/, "$1");
        currentArrayItems.push(value);
      }
      continue;
    }

    if (currentKey !== null && currentArrayItems !== null) {
      result[currentKey] = currentArrayItems;
      currentKey = null;
      currentArrayItems = null;
    }

    const colonIdx = trimLine.indexOf(":");
    if (colonIdx === -1) continue;

    const key = trimLine.slice(0, colonIdx).trim();
    const rawValue = trimLine.slice(colonIdx + 1).trim();

    if (rawValue === "" || rawValue === "\n") {
      currentKey = key;
      currentArrayItems = [];
      continue;
    }

    if (rawValue === "[]") {
      result[key] = [];
      continue;
    }

    const wasQuoted = rawValue.startsWith('"') && rawValue.endsWith('"');
    const unquoted = wasQuoted ? rawValue.slice(1, -1) : rawValue;

    if (unquoted === "true") {
      result[key] = true;
    } else if (unquoted === "false") {
      result[key] = false;
    } else if (!wasQuoted && /^\d+$/.test(unquoted)) {
      result[key] = parseInt(unquoted, 10);
    } else {
      result[key] = unquoted;
    }
  }

  if (currentKey !== null && currentArrayItems !== null) {
    result[currentKey] = currentArrayItems;
  }

  return { frontmatter: result, body };
}

function extractElement(xml: string, tagName: string): string | undefined {
  const openTag = `<${tagName}>`;
  const closeTag = `</${tagName}>`;
  const startIdx = xml.indexOf(openTag);
  if (startIdx === -1) return undefined;
  const contentStart = startIdx + openTag.length;
  const endIdx = xml.indexOf(closeTag, contentStart);
  if (endIdx === -1) return undefined;
  return xml.slice(contentStart, endIdx).trim();
}

function parseSubtasks(taskXml: string): GsdSubtask[] | undefined {
  const subtaskRegex = /<subtask\s+id="([^"]*)">([\s\S]*?)<\/subtask>/g;
  const subtasks: GsdSubtask[] = [];

  let match: RegExpExecArray | null = subtaskRegex.exec(taskXml);
  while (match !== null) {
    const id = match[1];
    const inner = match[2];
    const name = extractElement(inner, "name") ?? "";
    const filesStr = extractElement(inner, "files") ?? "";
    const files = filesStr
      ? filesStr.split(",").map((f) => f.trim()).filter((f) => f.length > 0)
      : [];
    const action = extractElement(inner, "action") ?? "";

    subtasks.push({ id, name, files, action });
    match = subtaskRegex.exec(taskXml);
  }

  return subtasks.length > 0 ? subtasks : undefined;
}

function parseTasksFromXml(body: string): GsdTask[] {
  const taskRegex =
    /<task\s+id="([^"]*)"\s+status="([^"]*)"\s+wave="([^"]*)"\s+priority="([^"]*)"\s+type="([^"]*)">([\s\S]*?)<\/task>/g;
  const tasks: GsdTask[] = [];

  let match: RegExpExecArray | null = taskRegex.exec(body);
  while (match !== null) {
    const id = match[1];
    const status = match[2] as GsdTaskStatus;
    const wave = parseInt(match[3], 10);
    const priority = match[4] as GsdTaskPriority;
    const type = match[5] as GsdTaskType;
    const inner = match[6];

    const name = extractElement(inner, "name") ?? "";
    const filesStr = extractElement(inner, "files") ?? "";
    const files = filesStr
      ? filesStr.split(",").map((f) => f.trim()).filter((f) => f.length > 0)
      : [];

    const subtasks = parseSubtasks(inner);

    let actionContent: string | undefined;
    if (subtasks && subtasks.length > 0) {
      const lastSubtaskEnd = inner.lastIndexOf("</subtask>");
      if (lastSubtaskEnd !== -1) {
        const afterSubtasks = inner.slice(lastSubtaskEnd + "</subtask>".length);
        actionContent = extractElement(afterSubtasks, "action");
      }
      if (!actionContent) {
        actionContent = extractElement(inner, "action");
      }
    } else {
      actionContent = extractElement(inner, "action");
    }
    const action = actionContent ?? "";

    const verify = extractElement(inner, "verify");
    const done = extractElement(inner, "done");

    const task: GsdTask = {
      id,
      name,
      status,
      wave,
      priority,
      type,
      files,
      action,
    };

    if (verify !== undefined) task.verify = verify;
    if (done !== undefined) task.done = done;
    if (subtasks !== undefined) task.subtasks = subtasks;

    tasks.push(task);
    match = taskRegex.exec(body);
  }

  return tasks;
}

function deriveWaves(tasks: GsdTask[]): GsdWave[] {
  const waveMap = new Map<number, string[]>();
  for (const task of tasks) {
    const existing = waveMap.get(task.wave) ?? [];
    existing.push(task.id);
    waveMap.set(task.wave, existing);
  }

  const waves: GsdWave[] = [];
  const sortedWaveNumbers = [...waveMap.keys()].sort((a, b) => a - b);

  for (const waveNum of sortedWaveNumbers) {
    const taskIds = waveMap.get(waveNum)!;
    waves.push({
      wave_number: waveNum,
      task_ids: taskIds,
      status: "pending",
      parallel: taskIds.length > 1,
    });
  }

  return waves;
}

export function parsePlan(markdown: string): GsdPlan {
  if (!markdown || markdown.trim().length === 0) {
    throw new Error("Cannot parse empty PLAN.md content");
  }

  const { frontmatter, body } = parseFrontmatter(markdown);

  const phase = frontmatter.phase;
  const type = frontmatter.type;
  const mode = frontmatter.mode;
  const status = frontmatter.status;
  const beadId = frontmatter.bead_id;
  const epicId = frontmatter.epic_id;
  const workerId = frontmatter.worker_id;
  const created = frontmatter.created;
  const planNumber = frontmatter.plan;

  if (typeof phase !== "string" || phase.length === 0) {
    throw new Error("Missing required frontmatter field: phase");
  }
  if (typeof type !== "string" || !isGsdPlanType(type)) {
    throw new Error("Missing or invalid required frontmatter field: type");
  }
  if (typeof mode !== "string" || !isGsdMode(mode)) {
    throw new Error("Missing or invalid required frontmatter field: mode");
  }
  if (typeof status !== "string" || !isGsdPlanStatus(status)) {
    throw new Error("Missing or invalid required frontmatter field: status");
  }
  if (typeof beadId !== "string") {
    throw new Error("Missing required frontmatter field: bead_id");
  }
  if (typeof epicId !== "string") {
    throw new Error("Missing required frontmatter field: epic_id");
  }
  if (typeof workerId !== "string") {
    throw new Error("Missing required frontmatter field: worker_id");
  }
  if (typeof created !== "string") {
    throw new Error("Missing required frontmatter field: created");
  }

  const tasks = parseTasksFromXml(body);
  const waves = deriveWaves(tasks);

  const dependsOn = Array.isArray(frontmatter.depends_on)
    ? (frontmatter.depends_on as string[])
    : [];

  const filesModified = Array.isArray(frontmatter.files_modified)
    ? (frontmatter.files_modified as string[])
    : collectAllFiles(tasks);

  const autonomous =
    typeof frontmatter.autonomous === "boolean" ? frontmatter.autonomous : !hasHumanTasks(tasks);

  const title = typeof frontmatter.title === "string" ? frontmatter.title : "";
  const id = typeof frontmatter.id === "string" ? frontmatter.id : "";

  const plan: GsdPlan = {
    id,
    title,
    phase,
    created,
    status,
    mode,
    type,
    tasks,
    waves,
    bead_id: beadId,
    epic_id: epicId,
    worker_id: workerId,
    depends_on: dependsOn,
    files_modified: filesModified,
    autonomous,
  };

  if (typeof planNumber === "string") {
    plan.plan_number = planNumber;
  }

  return plan;
}

function detectCircularDeps(tasks: GsdTask[]): string[] {
  const errors: string[] = [];
  const taskIds = new Set(tasks.map((t) => t.id));
  const adjacency = new Map<string, string[]>();

  for (const task of tasks) {
    adjacency.set(task.id, task.dependencies ?? []);
  }

  const visited = new Set<string>();
  const inStack = new Set<string>();

  function dfs(nodeId: string, path: string[]): boolean {
    if (inStack.has(nodeId)) {
      const cycleStart = path.indexOf(nodeId);
      const cycle = path.slice(cycleStart).concat(nodeId);
      errors.push(`Circular dependency detected: ${cycle.join(" -> ")}`);
      return true;
    }
    if (visited.has(nodeId)) return false;

    visited.add(nodeId);
    inStack.add(nodeId);

    const deps = adjacency.get(nodeId) ?? [];
    for (const dep of deps) {
      if (taskIds.has(dep)) {
        dfs(dep, [...path, nodeId]);
      }
    }

    inStack.delete(nodeId);
    return false;
  }

  for (const task of tasks) {
    if (!visited.has(task.id)) {
      dfs(task.id, []);
    }
  }

  return errors;
}

export function validatePlan(plan: GsdPlan): ValidationResult {
  const errors: string[] = [];

  if (!plan.id || plan.id.length === 0) {
    errors.push("Plan id is required and cannot be empty");
  }
  if (!plan.title || plan.title.length === 0) {
    errors.push("Plan title is required and cannot be empty");
  }
  if (!plan.phase || plan.phase.length === 0) {
    errors.push("Plan phase is required and cannot be empty");
  }
  if (!plan.created || plan.created.length === 0) {
    errors.push("Plan created timestamp is required and cannot be empty");
  }

  const taskIds = new Set<string>();
  for (const task of plan.tasks) {
    if (taskIds.has(task.id)) {
      errors.push(`Duplicate task id: "${task.id}"`);
    }
    taskIds.add(task.id);
  }

  const waveNumbers = new Set<number>();
  for (const wave of plan.waves) {
    if (waveNumbers.has(wave.wave_number)) {
      errors.push(`Duplicate wave number: ${wave.wave_number}`);
    }
    waveNumbers.add(wave.wave_number);

    for (const tid of wave.task_ids) {
      if (!taskIds.has(tid)) {
        errors.push(`Wave ${wave.wave_number} references non-existent task: "${tid}"`);
      }
    }
  }

  const allWaveTaskIds = new Set<string>();
  for (const wave of plan.waves) {
    for (const tid of wave.task_ids) {
      allWaveTaskIds.add(tid);
    }
  }
  for (const task of plan.tasks) {
    if (!allWaveTaskIds.has(task.id)) {
      errors.push(`Task "${task.id}" is not assigned to any wave`);
    }
  }

  for (const task of plan.tasks) {
    if (!task.dependencies) continue;

    for (const dep of task.dependencies) {
      if (dep === task.id) {
        errors.push(`Task "${task.id}" has a self-referencing dependency`);
      }
      if (!taskIds.has(dep)) {
        errors.push(`Task "${task.id}" depends on non-existent task: "${dep}"`);
      }
    }
  }

  const circularErrors = detectCircularDeps(plan.tasks);
  errors.push(...circularErrors);

  return {
    valid: errors.length === 0,
    errors,
  };
}
