import type { DiscoveredTool } from "../swarm-research.js";
import {
  gsdResearchStarted,
  gsdResearchCompleted,
  type GsdEventBase,
} from "../gsd/gsd-events.js";

export interface ResearchConfig {
  projectKey: string;
  maxRounds: number; // default 3
  epicId?: string;
}

export interface ResearchDeps {
  discoverTools: () => Promise<DiscoveredTool[]>;
  executeQuery: (query: string, tool: string) => Promise<string>;
  eventEmit: (type: string, data: any) => void;
}

export interface ResearchResult {
  findings: string;
  rounds: ResearchRound[];
  toolsUsed: string[];
}

export interface ResearchRound {
  round: number;
  queries: string[];
  findings: string[];
}

function normalizeMaxRounds(maxRounds?: number): number {
  const resolved = Number.isFinite(maxRounds) ? Math.floor(maxRounds ?? 3) : 3;
  return Math.max(1, resolved);
}

function uniqueNonEmpty(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    result.push(trimmed);
  }

  return result;
}

function generateDefaultQueries(task: string): string[] {
  const normalized = task.replace(/[\n\r]+/g, " ").trim();
  if (!normalized) return [];

  const byPunctuation = normalized
    .split(/[,;:.|]+/g)
    .map((part) => part.trim())
    .filter(Boolean);

  const byConjunction = byPunctuation.flatMap((part) =>
    part
      .split(/\b(?:and|then|with|plus)\b/gi)
      .map((segment) => segment.trim())
      .filter(Boolean),
  );

  const phrases = uniqueNonEmpty(byConjunction.length > 0 ? byConjunction : [normalized]);

  while (phrases.length < 3) {
    phrases.push(normalized);
  }

  return phrases.slice(0, 3);
}

function buildBaseEvent(config: ResearchConfig): GsdEventBase {
  return {
    project_key: config.projectKey,
    timestamp: Date.now(),
  };
}

async function runQueries(
  queries: string[],
  tools: DiscoveredTool[],
  executeQuery: ResearchDeps["executeQuery"],
): Promise<string[]> {
  const findings: string[] = [];
  const availableTools = tools.filter((tool) => tool.available);

  if (availableTools.length === 0 || queries.length === 0) {
    return findings;
  }

  for (const query of queries) {
    for (const tool of availableTools) {
      try {
        const result = await executeQuery(query, tool.name);
        findings.push(result);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        findings.push(
          `Error executing query "${query}" with tool "${tool.name}": ${message}`,
        );
      }
    }
  }

  return findings;
}

export function createCortexResearcher(
  config: ResearchConfig,
  deps: ResearchDeps,
) {
  const maxRounds = normalizeMaxRounds(config.maxRounds);

  return {
    async research(task: string, queries?: string[]): Promise<ResearchResult> {
      const discoveredTools = await deps.discoverTools();
      const toolsUsed = discoveredTools
        .filter((tool) => tool.available)
        .map((tool) => tool.name);

      const resolvedQueries = queries && queries.length > 0
        ? queries
        : generateDefaultQueries(task);

      const rounds: ResearchRound[] = [];
      const allFindings: string[] = [];

      for (let round = 1; round <= maxRounds; round += 1) {
        const base = buildBaseEvent(config);
        const started = gsdResearchStarted(base, {
          project_key_ref: config.projectKey,
          round,
          epic_id: config.epicId,
          queries: resolvedQueries,
        });
        deps.eventEmit(started.type, started);

        const roundFindings = await runQueries(
          resolvedQueries,
          discoveredTools,
          deps.executeQuery,
        );

        const completed = gsdResearchCompleted(base, {
          project_key_ref: config.projectKey,
          findings_path: "memory",
          round,
          epic_id: config.epicId,
          findings_count: roundFindings.length,
        });
        deps.eventEmit(completed.type, completed);

        rounds.push({
          round,
          queries: resolvedQueries,
          findings: roundFindings,
        });
        allFindings.push(...roundFindings);
      }

      return {
        findings: allFindings.join("\n"),
        rounds,
        toolsUsed,
      };
    },
  };
}
