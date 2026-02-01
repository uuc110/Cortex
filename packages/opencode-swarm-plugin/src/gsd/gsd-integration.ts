import type { StateManager } from "./state-manager.js";
import type { PlanGenerator } from "./plan-generator.js";
import type { WaveCalculator } from "./wave-calculator.js";
import type { VerificationEngine } from "./verification-engine.js";
import type { GsdOrchestrator, OrchestratorConfig } from "./gsd-orchestrator.js";

import { createPlanGenerator } from "./plan-generator.js";
import { createWaveCalculator } from "./wave-calculator.js";
import { createVerificationEngine } from "./verification-engine.js";
import { createGsdOrchestrator } from "./gsd-orchestrator.js";

export interface EventStoreAdapter {
  append: (event: unknown) => Promise<void>;
}

export interface GsdIntegrationConfig {
  projectKey: string;
  eventStore: EventStoreAdapter;
  stateManager: StateManager;
  maxFixIterations?: number;
  waveTimeoutMs?: number;
  verifyAfterEachWave?: boolean;
  projectPath?: string;
}

export interface InitGsdResult {
  orchestrator: GsdOrchestrator;
  planGenerator: PlanGenerator;
  waveCalculator: WaveCalculator;
  verificationEngine: VerificationEngine;
}

export interface GsdIntegration {
  initGsd(): InitGsdResult;
  getOrchestrator(): GsdOrchestrator | null;
  getConfig(): OrchestratorConfig;
}

export const DEFAULT_GSD_CONFIG = Object.freeze({
  maxFixIterations: 3,
  waveTimeoutMs: 1_800_000,
});

export function createGsdIntegration(
  config: GsdIntegrationConfig,
): GsdIntegration {
  const orchestratorConfig: OrchestratorConfig = {
    projectKey: config.projectKey,
    maxFixIterations: config.maxFixIterations ?? DEFAULT_GSD_CONFIG.maxFixIterations,
    waveTimeoutMs: config.waveTimeoutMs ?? DEFAULT_GSD_CONFIG.waveTimeoutMs,
    verifyAfterEachWave: config.verifyAfterEachWave ?? false,
  };

  let cached: InitGsdResult | null = null;

  function initGsd(): InitGsdResult {
    if (cached) return cached;

    const planGenerator = createPlanGenerator();
    const waveCalculator = createWaveCalculator();
    const verificationEngine = createVerificationEngine({
      projectPath: config.projectPath ?? "",
    });

    const emitEvent = async (event: unknown): Promise<void> => {
      await config.eventStore.append(event);
    };

    const orchestrator = createGsdOrchestrator(
      {
        stateManager: config.stateManager,
        planGenerator,
        waveCalculator,
        verificationEngine,
        emitEvent,
      },
      orchestratorConfig,
    );

    cached = { orchestrator, planGenerator, waveCalculator, verificationEngine };
    return cached;
  }

  function getOrchestrator(): GsdOrchestrator | null {
    return cached?.orchestrator ?? null;
  }

  function getConfig(): OrchestratorConfig {
    return { ...orchestratorConfig };
  }

  return { initGsd, getOrchestrator, getConfig };
}
