/**
 * End-to-End Integration Smoke Test
 *
 * Exercises the FULL Cortex pipeline:
 *   Research → Decompose → Bridge → PLAN.md → Wave Dispatcher → Worker execution
 *
 * Uses realistic mock data that mirrors an actual swarm run.
 * No real agents/workers — but every module boundary is crossed.
 */
import { describe, expect, test } from "bun:test";

import { createCortexResearcher } from "../cortex-research.js";
import {
  bridgeCellTreeToExecution,
  cellTreeToGsdTasks,
  calculateTaskWaves,
  gsdTasksToDispatcherTasks,
  generateCortexPlan,
  parsePlanToDispatcherTasks,
  generateEpicId,
} from "../cortex-bridge.js";
import { selectMode } from "../cortex-modes.js";
import { createCortexCoordinator } from "../../queen/cortex-coordinator.js";
import { createWaveDispatcher } from "../../queen/wave-dispatcher.js";
import { createWaveCalculator } from "../../gsd/wave-calculator.js";

import type { CellTree } from "../../schemas/cell.js";
import type { GsdState } from "../../gsd/gsd-types.js";
import type { DiscoveredTool } from "../../swarm-research.js";
import type {
  CortexCoordinatorDeps,
  ResearchResult,
} from "../../queen/cortex-coordinator.js";

// ─── Realistic Test Data ─────────────────────────────────────────

/** A realistic CellTree that a swarm_decompose call would produce */
const REALISTIC_CELL_TREE: CellTree = {
  epic: {
    title: "Add user authentication module",
    description:
      "Implement JWT-based authentication with login, registration, password reset, and role-based access control",
  },
  subtasks: [
    {
      title: "Create auth database schema",
      description:
        "Design and create users, sessions, and roles tables with proper indexes",
      files: ["src/db/schema/auth.ts", "src/db/migrations/001-auth.sql"],
      dependencies: [],
      estimated_complexity: 2,
    },
    {
      title: "Implement JWT token service",
      description:
        "Create token generation, validation, and refresh logic with configurable expiry",
      files: ["src/auth/token-service.ts", "src/auth/types.ts"],
      dependencies: [],
      estimated_complexity: 3,
    },
    {
      title: "Build authentication middleware",
      description:
        "Express middleware for token validation, role checking, and request context injection",
      files: ["src/middleware/auth.ts", "src/middleware/roles.ts"],
      dependencies: [0, 1],
      estimated_complexity: 3,
    },
    {
      title: "Create auth API endpoints",
      description:
        "Login, register, logout, refresh, password reset endpoints",
      files: ["src/api/auth/routes.ts", "src/api/auth/handlers.ts"],
      dependencies: [0, 1, 2],
      estimated_complexity: 4,
    },
    {
      title: "Write auth integration tests",
      description:
        "End-to-end tests for auth flow including edge cases and error handling",
      files: [
        "src/tests/auth/auth.test.ts",
        "src/tests/auth/fixtures.ts",
      ],
      dependencies: [3],
      estimated_complexity: 3,
    },
    {
      title: "Add RBAC documentation",
      description:
        "Document role hierarchy, permission model, and API usage examples",
      files: ["docs/auth/rbac.md", "docs/auth/api-reference.md"],
      dependencies: [3],
      estimated_complexity: 1,
    },
  ],
};

/** Smaller CellTree for quick mode testing */
const QUICK_CELL_TREE: CellTree = {
  epic: {
    title: "Fix login button styling",
    description: "Update the login button to match new design system",
  },
  subtasks: [
    {
      title: "Update button styles",
      description: "Apply new color tokens and spacing",
      files: ["src/components/LoginButton.tsx"],
      dependencies: [],
      estimated_complexity: 1,
    },
    {
      title: "Update snapshot tests",
      description: "Regenerate snapshots after style change",
      files: ["src/tests/LoginButton.test.tsx"],
      dependencies: [0],
      estimated_complexity: 1,
    },
  ],
};

// ─── Helpers ─────────────────────────────────────────────────────

const workerLog: Array<{ beadId: string; files: string[] }> = [];
const stateLog: GsdState[] = [];
const planLog: string[] = [];
const eventLog: Array<{ type: string; data: unknown }> = [];

function resetLogs() {
  workerLog.length = 0;
  stateLog.length = 0;
  planLog.length = 0;
  eventLog.length = 0;
}

function makeCoordinatorDeps(
  overrides?: Partial<CortexCoordinatorDeps>,
): CortexCoordinatorDeps {
  return {
    decompose: async (_task, _context) => REALISTIC_CELL_TREE,
    spawnWorker: async (beadId, files) => {
      workerLog.push({ beadId, files });
      return { status: "completed" as const };
    },
    verifyWave: async () => ({ passed: true, errors: [] }),
    createFixBead: async (title) => `fix-${title}`,
    saveState: async (state) => {
      stateLog.push(structuredClone(state));
    },
    loadState: async () => null,
    writePlan: async (planMarkdown) => {
      planLog.push(planMarkdown);
    },
    eventEmit: (type, data) => {
      eventLog.push({ type, data });
    },
    ...overrides,
  };
}

// ─── Tests ───────────────────────────────────────────────────────

describe("E2E Integration: Bridge Pipeline", () => {
  test("CellTree → GsdTasks → Waves → PLAN.md → TaskWithDeps round-trip", () => {
    // Step 1: Convert CellTree to GSD tasks
    const tasks = cellTreeToGsdTasks(REALISTIC_CELL_TREE, {
      epicTitle: REALISTIC_CELL_TREE.epic.title,
    });

    expect(tasks).toHaveLength(6);
    expect(tasks[0].id).toStartWith("ctx-");
    expect(tasks[0].dependencies).toEqual([]); // no deps on first task
    expect(tasks[3].dependencies).toHaveLength(3); // depends on 0,1,2

    // Step 2: Calculate waves
    const { result: waveResult, tasks: wavedTasks } = calculateTaskWaves(tasks);

    expect(waveResult.sequentialWaves).toBeGreaterThanOrEqual(3); // at least 3 waves (0→1,2→3→4,5)
    expect(waveResult.maxParallelism).toBeGreaterThanOrEqual(2); // tasks 0,1 can run in parallel

    // Verify wave assignments are valid
    for (const task of wavedTasks) {
      expect(task.wave).toBeGreaterThanOrEqual(1);
    }

    // Step 3: Generate PLAN.md
    const planMarkdown = generateCortexPlan(wavedTasks, {
      epicTitle: REALISTIC_CELL_TREE.epic.title,
      epicDescription: REALISTIC_CELL_TREE.epic.description,
      mode: "project",
      phase: "phase-1",
    });

    expect(planMarkdown).toContain("Add user authentication module");
    expect(planMarkdown).toContain("Create auth database schema");
    expect(planMarkdown).toContain("Write auth integration tests");

    // Step 4: Convert to dispatcher tasks
    const dispatcherTasks = gsdTasksToDispatcherTasks(wavedTasks);

    expect(dispatcherTasks).toHaveLength(6);
    expect(dispatcherTasks[0].files).toContain("src/db/schema/auth.ts");

    // Step 5: Round-trip — parse PLAN.md back to dispatcher tasks
    const reparsed = parsePlanToDispatcherTasks(planMarkdown);

    expect(reparsed).toHaveLength(6);
    expect(reparsed[0].name).toBe("Create auth database schema");
    expect(reparsed[5].name).toBe("Add RBAC documentation");
  });

  test("bridgeCellTreeToExecution full pipeline produces valid result", () => {
    const result = bridgeCellTreeToExecution(REALISTIC_CELL_TREE, {
      epicTitle: REALISTIC_CELL_TREE.epic.title,
      epicDescription: REALISTIC_CELL_TREE.epic.description,
      mode: "project",
      phase: "phase-1",
      researchContext: "JWT best practices: use RS256, 15min access tokens, 7d refresh tokens",
    });

    expect(result.tasks).toHaveLength(6);
    expect(result.totalWaves).toBeGreaterThanOrEqual(3);
    expect(result.maxParallelism).toBeGreaterThanOrEqual(2);
    expect(result.epicId).toBe(generateEpicId(REALISTIC_CELL_TREE.epic.title));
    expect(result.planMarkdown).toContain("<research_context>");
    expect(result.planMarkdown).toContain("RS256");
    expect(result.dispatcherTasks).toHaveLength(6);

    // Dispatcher tasks should have valid deps (ID-based, not index-based)
    for (const task of result.dispatcherTasks) {
      for (const dep of task.dependencies) {
        expect(dep).toStartWith("ctx-");
      }
    }
  });
});

describe("E2E Integration: Mode Selection", () => {
  test("realistic 6-task CellTree selects project mode", () => {
    const result = selectMode({
      subtaskCount: REALISTIC_CELL_TREE.subtasks.length,
      hasExternalDeps: false,
      hasResearchContext: false,
      maxComplexity: Math.max(
        ...REALISTIC_CELL_TREE.subtasks.map((s) => s.estimated_complexity),
      ),
    });

    expect(result.mode).toBe("project");
  });

  test("small 2-task CellTree selects quick mode", () => {
    const result = selectMode({
      subtaskCount: QUICK_CELL_TREE.subtasks.length,
      hasExternalDeps: false,
      hasResearchContext: false,
      maxComplexity: Math.max(
        ...QUICK_CELL_TREE.subtasks.map((s) => s.estimated_complexity),
      ),
    });

    expect(result.mode).toBe("quick");
  });

  test("research context forces project mode even for small tasks", () => {
    const result = selectMode({
      subtaskCount: 2,
      hasExternalDeps: false,
      hasResearchContext: true,
      maxComplexity: 1,
    });

    expect(result.mode).toBe("project");
  });
});

describe("E2E Integration: Research → Bridge", () => {
  test("research findings flow into bridge as research_context", async () => {
    const researcher = createCortexResearcher(
      { projectKey: "test-proj", maxRounds: 1, epicId: "epic-auth" },
      {
        discoverTools: async () => [
          { name: "context7", type: "mcp" as const, capabilities: ["search"], available: true },
        ],
        executeQuery: async (query) =>
          `Found: JWT RS256 is recommended for ${query}`,
        eventEmit: () => {},
      },
    );

    const researchResult = await researcher.research(
      "Add JWT authentication",
      ["JWT best practices", "token refresh patterns"],
    );

    expect(researchResult.findings).toContain("JWT RS256");
    expect(researchResult.rounds).toHaveLength(1);
    expect(researchResult.toolsUsed).toEqual(["context7"]);

    // Feed research into bridge
    const bridgeResult = bridgeCellTreeToExecution(REALISTIC_CELL_TREE, {
      epicTitle: REALISTIC_CELL_TREE.epic.title,
      mode: "project",
      researchContext: researchResult.findings,
    });

    expect(bridgeResult.planMarkdown).toContain("<research_context>");
    expect(bridgeResult.planMarkdown).toContain("JWT RS256");
  });
});

describe("E2E Integration: Coordinator → Wave Dispatcher", () => {
  test("coordinator executes full pipeline with successful waves", async () => {
    resetLogs();

    const coordinator = createCortexCoordinator(
      {
        projectKey: "test-proj",
        projectPath: "/tmp/test",
        planningDir: "/tmp/planning",
        epicBeadId: "epic-auth-001",
        verifyAfterEachWave: true,
      },
      makeCoordinatorDeps(),
    );

    const result = await coordinator.execute("Add user authentication module");

    // Pipeline produced correct structure
    expect(result.success).toBe(true);
    expect(result.epicId).toStartWith("epic-ctx-");
    expect(result.mode).toBe("project"); // 6 tasks → project mode
    expect(result.bridgeResult.totalWaves).toBeGreaterThanOrEqual(3);
    expect(result.bridgeResult.tasks).toHaveLength(6);

    // Workers were spawned for every task
    expect(workerLog.length).toBe(6);

    // PLAN.md was written
    expect(planLog.length).toBe(1);
    expect(planLog[0]).toContain("Add user authentication module");

    // State was saved (at least once per wave + final)
    expect(stateLog.length).toBeGreaterThanOrEqual(3);

    // Final state should be completed
    const finalState = stateLog[stateLog.length - 1];
    expect(finalState.status).toBe("completed");
    expect(finalState.completed_tasks.length).toBe(6);
    expect(finalState.failed_tasks.length).toBe(0);

    // Events were emitted
    const eventTypes = eventLog.map((e) => e.type);
    expect(eventTypes).toContain("cortex_execution_started");
    expect(eventTypes).toContain("cortex_execution_completed");
    expect(eventTypes).toContain("gsd_wave_started");
    expect(eventTypes).toContain("gsd_wave_completed");
  });

  test("coordinator with research phase passes findings through", async () => {
    resetLogs();

    const coordinator = createCortexCoordinator(
      {
        projectKey: "test-proj",
        projectPath: "/tmp/test",
        planningDir: "/tmp/planning",
        epicBeadId: "epic-auth-002",
      },
      makeCoordinatorDeps({
        research: async (task): Promise<ResearchResult> => ({
          findings: `Research for "${task}": Use bcrypt for password hashing, RS256 for JWT`,
          rounds: [{ round: 1, queries: [task], findings: ["bcrypt", "RS256"] }],
          toolsUsed: ["context7"],
        }),
      }),
    );

    const result = await coordinator.execute("Add user authentication module");

    expect(result.success).toBe(true);
    expect(result.researchFindings).toContain("bcrypt");
    expect(result.researchFindings).toContain("RS256");

    // Research findings should appear in PLAN.md
    expect(planLog[0]).toContain("<research_context>");
    expect(planLog[0]).toContain("bcrypt");

    // Research events emitted
    const eventTypes = eventLog.map((e) => e.type);
    expect(eventTypes).toContain("cortex_research_started");
    expect(eventTypes).toContain("cortex_research_completed");
  });

  test("coordinator handles worker failures and reports overall failure", async () => {
    resetLogs();
    let callCount = 0;

    const coordinator = createCortexCoordinator(
      {
        projectKey: "test-proj",
        projectPath: "/tmp/test",
        planningDir: "/tmp/planning",
        epicBeadId: "epic-fail-001",
        verifyAfterEachWave: false,
        maxFixIterations: 0,
      },
      makeCoordinatorDeps({
        spawnWorker: async (beadId, files) => {
          workerLog.push({ beadId, files });
          callCount++;
          // First two workers succeed (wave 1), third fails (wave 2)
          if (callCount <= 2) {
            return { status: "completed" as const };
          }
          return { status: "failed" as const };
        },
      }),
    );

    const result = await coordinator.execute("Add user authentication module");

    expect(result.success).toBe(false);
    expect(result.executionResult.wavesCompleted).toBeGreaterThanOrEqual(1);

    // Final state should be failed
    const finalState = stateLog[stateLog.length - 1];
    expect(finalState.status).toBe("failed");
    expect(finalState.failed_tasks.length).toBeGreaterThan(0);
  });

  test("coordinator with quick mode (small task)", async () => {
    resetLogs();

    const coordinator = createCortexCoordinator(
      {
        projectKey: "test-proj",
        projectPath: "/tmp/test",
        planningDir: "/tmp/planning",
        epicBeadId: "epic-quick-001",
      },
      makeCoordinatorDeps({
        decompose: async () => QUICK_CELL_TREE,
      }),
    );

    const result = await coordinator.execute("Fix login button styling");

    expect(result.success).toBe(true);
    expect(result.mode).toBe("quick");
    expect(result.bridgeResult.tasks).toHaveLength(2);
    expect(workerLog.length).toBe(2);
  });
});

describe("E2E Integration: Wave Dispatcher Standalone", () => {
  test("wave dispatcher correctly sequences dependent tasks", async () => {
    const spawnLog: string[] = [];
    const calculator = createWaveCalculator();

    const bridgeResult = bridgeCellTreeToExecution(REALISTIC_CELL_TREE, {
      epicTitle: REALISTIC_CELL_TREE.epic.title,
      mode: "project",
    });

    const dispatcher = createWaveDispatcher(
      {
        projectKey: "test-proj",
        projectPath: "/tmp/test",
        planningDir: "/tmp/planning",
        epicBeadId: "epic-wave-001",
        verifyAfterEachWave: false,
      },
      {
        calculateWaves: (tasks) =>
          calculator.calculateWaves(tasks as unknown as import("../../gsd/gsd-types.js").GsdTask[]),
        saveState: async () => {},
        loadState: async () => null,
        spawnWorker: async (beadId) => {
          spawnLog.push(beadId);
          return { status: "completed" as const };
        },
        verifyWave: async () => ({ passed: true, errors: [] }),
        createFixBead: async (title) => `fix-${title}`,
        eventEmit: () => {},
      },
    );

    const result = await dispatcher.executeEpic(bridgeResult.dispatcherTasks);

    expect(result.success).toBe(true);
    expect(result.wavesCompleted).toBe(result.totalWaves);
    expect(spawnLog.length).toBe(6);

    // Verify ordering: wave 1 tasks (no deps) must come before wave 2+ tasks
    const task0Id = bridgeResult.tasks[0].id; // "Create auth database schema" — wave 1
    const task1Id = bridgeResult.tasks[1].id; // "Implement JWT token service" — wave 1
    const task3Id = bridgeResult.tasks[3].id; // "Create auth API endpoints" — wave 3+

    const idx0 = spawnLog.indexOf(task0Id);
    const idx1 = spawnLog.indexOf(task1Id);
    const idx3 = spawnLog.indexOf(task3Id);

    // Wave 1 tasks before wave 3 tasks
    expect(idx0).toBeLessThan(idx3);
    expect(idx1).toBeLessThan(idx3);
  });
});
