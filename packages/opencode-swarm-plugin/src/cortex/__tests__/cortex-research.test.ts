import type { ToolContext } from "@opencode-ai/plugin";
import { describe, expect, test } from "bun:test";
import type { DiscoveredTool } from "../../swarm-research.js";
import { createCortexResearcher } from "../cortex-research.js";
import { cortex_research } from "../cortex-tools.js";

const mockCtx = {} as ToolContext;

const availableTools: DiscoveredTool[] = [
  {
    name: "context7",
    type: "mcp",
    capabilities: ["search"],
    available: true,
  },
  {
    name: "fetch",
    type: "mcp",
    capabilities: ["http-fetch"],
    available: false,
  },
];

function buildDeps(overrides?: Partial<ReturnType<typeof createDeps>>) {
  const base = createDeps();
  return Object.assign(base, overrides ?? {});
}

function createDeps() {
  let discoverCalls = 0;
  let executeCalls: Array<{ query: string; tool: string }> = [];
  const events: Array<{ type: string; data: unknown }> = [];

  return {
    get discoverCalls() {
      return discoverCalls;
    },
    get executeCalls() {
      return executeCalls;
    },
    get events() {
      return events;
    },
    discoverTools: async () => {
      discoverCalls += 1;
      return availableTools;
    },
    executeQuery: async (query: string, tool: string) => {
      executeCalls.push({ query, tool });
      return `result:${query}:${tool}`;
    },
    eventEmit: (type: string, data: unknown) => {
      events.push({ type, data });
    },
  };
}

describe("createCortexResearcher", () => {
  test("returns object with research method", () => {
    const deps = createDeps();
    const researcher = createCortexResearcher({ projectKey: "proj", maxRounds: 1 }, deps);
    expect(researcher).toHaveProperty("research");
  });

  test("research() discovers available tools", async () => {
    const deps = createDeps();
    const researcher = createCortexResearcher({ projectKey: "proj", maxRounds: 1 }, deps);
    await researcher.research("Find docs", ["query"]);
    expect(deps.discoverCalls).toBe(1);
  });

  test("research() with explicit queries uses them", async () => {
    const deps = createDeps();
    const researcher = createCortexResearcher({ projectKey: "proj", maxRounds: 1 }, deps);
    const queries = ["query one", "query two"];
    const result = await researcher.research("ignored", queries);
    expect(result.rounds[0]?.queries).toEqual(queries);
  });

  test("research() without queries auto-generates from task", async () => {
    const deps = createDeps();
    const researcher = createCortexResearcher({ projectKey: "proj", maxRounds: 1 }, deps);
    const result = await researcher.research("build auth, add oauth, update docs");
    expect(result.rounds[0]?.queries).toEqual([
      "build auth",
      "add oauth",
      "update docs",
    ]);
  });

  test("research() emits gsdResearchStarted for each round", async () => {
    const deps = createDeps();
    const researcher = createCortexResearcher({ projectKey: "proj", maxRounds: 2 }, deps);
    await researcher.research("Find docs", ["query"]);
    const started = deps.events.filter((event) => event.type === "gsd_research_started");
    expect(started).toHaveLength(2);
  });

  test("research() emits gsdResearchCompleted for each round", async () => {
    const deps = createDeps();
    const researcher = createCortexResearcher({ projectKey: "proj", maxRounds: 2 }, deps);
    await researcher.research("Find docs", ["query"]);
    const completed = deps.events.filter(
      (event) => event.type === "gsd_research_completed",
    );
    expect(completed).toHaveLength(2);
  });

  test("research() collects findings from executeQuery", async () => {
    const deps = createDeps();
    const researcher = createCortexResearcher({ projectKey: "proj", maxRounds: 1 }, deps);
    const result = await researcher.research("Find docs", ["query"]);
    expect(result.rounds[0]?.findings[0]).toContain("result:query:context7");
  });

  test("research() concatenates findings into string", async () => {
    const deps = createDeps();
    const researcher = createCortexResearcher({ projectKey: "proj", maxRounds: 1 }, deps);
    const result = await researcher.research("Find docs", ["query"]);
    expect(result.findings).toContain("result:query:context7");
  });

  test("research() respects maxRounds config", async () => {
    const deps = createDeps();
    const researcher = createCortexResearcher({ projectKey: "proj", maxRounds: 2 }, deps);
    const result = await researcher.research("Find docs", ["query"]);
    expect(result.rounds).toHaveLength(2);
  });

  test("research() with maxRounds=1 runs single round", async () => {
    const deps = createDeps();
    const researcher = createCortexResearcher({ projectKey: "proj", maxRounds: 1 }, deps);
    const result = await researcher.research("Find docs", ["query"]);
    expect(result.rounds).toHaveLength(1);
  });

  test("research() returns toolsUsed list", async () => {
    const deps = createDeps();
    const researcher = createCortexResearcher({ projectKey: "proj", maxRounds: 1 }, deps);
    const result = await researcher.research("Find docs", ["query"]);
    expect(result.toolsUsed).toEqual(["context7"]);
  });

  test("research() handles empty tool discovery gracefully", async () => {
    const deps = buildDeps({ discoverTools: async () => [] });
    const researcher = createCortexResearcher({ projectKey: "proj", maxRounds: 1 }, deps);
    const result = await researcher.research("Find docs", ["query"]);
    expect(deps.executeCalls).toHaveLength(0);
    expect(result.toolsUsed).toEqual([]);
  });

  test("research() handles executeQuery errors gracefully", async () => {
    const deps = buildDeps({
      executeQuery: async () => {
        throw new Error("boom");
      },
    });
    const researcher = createCortexResearcher({ projectKey: "proj", maxRounds: 1 }, deps);
    const result = await researcher.research("Find docs", ["query"]);
    expect(result.findings).toContain("Error executing query");
    expect(result.findings).toContain("boom");
  });

  test("research() with no available tools returns empty findings", async () => {
    const deps = buildDeps({
      discoverTools: async () => [
        {
          name: "context7",
          type: "mcp",
          capabilities: ["search"],
          available: false,
        },
      ],
    });
    const researcher = createCortexResearcher({ projectKey: "proj", maxRounds: 1 }, deps);
    const result = await researcher.research("Find docs", ["query"]);
    expect(result.findings).toBe("");
    expect(result.rounds[0]?.findings).toHaveLength(0);
  });
});

describe("cortex_research", () => {
  test("returns success JSON", async () => {
    const result = await cortex_research.execute(
      { task: "Research bun test" },
      mockCtx,
    );
    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(true);
    expect(parsed).toHaveProperty("findings");
    expect(parsed).toHaveProperty("rounds");
    expect(parsed).toHaveProperty("tools_used");
  });
});
