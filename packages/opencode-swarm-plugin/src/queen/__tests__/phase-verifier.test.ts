import { beforeEach, describe, expect, mock, test } from "bun:test";

import { createPhaseVerifier } from "../phase-verifier.js";

import type {
  MustHaves,
  PhaseVerifier,
  PhaseVerifierConfig,
  PhaseVerifierDeps,
} from "../phase-verifier.js";

const baseConfig: PhaseVerifierConfig = {
  projectKey: "proj",
  projectPath: "/tmp/proj",
  epicBeadId: "epic-1",
};

const buildMustHaves = (overrides: Partial<MustHaves> = {}): MustHaves => ({
  truths: [],
  artifacts: [],
  keyLinks: [],
  ...overrides,
});

type TruthResult = { truth: string; passed: boolean; evidence?: string };
type ArtifactResult = {
  path: string;
  check: string;
  passed: boolean;
  reason?: string;
};
type KeyLinkResult = {
  from: string;
  to: string;
  type: string;
  passed: boolean;
  reason?: string;
};
type BeadRecord = { id: string; status: string };

const buildDeps = (overrides: Partial<PhaseVerifierDeps> = {}) => {
  const verifyTruths = mock(async (_truths: string[]): Promise<TruthResult[]> => {
    const results: TruthResult[] = [];
    return results;
  });
  const verifyArtifacts = mock(
    async (
      _artifacts: Array<{ path: string; check: string }>,
    ): Promise<ArtifactResult[]> => {
      const results: ArtifactResult[] = [];
      return results;
    },
  );
  const verifyKeyLinks = mock(
    async (
      _links: Array<{ from: string; to: string; type: string }>,
    ): Promise<KeyLinkResult[]> => {
      const results: KeyLinkResult[] = [];
      return results;
    },
  );
  const list = mock(async (_filter?: unknown): Promise<BeadRecord[]> => {
    const results: BeadRecord[] = [];
    return results;
  });
  const create = mock(async (_args: unknown): Promise<string> => "fix-bead");
  const eventEmit = mock((_type: string, _data: unknown) => undefined);
  const promoteLearnings = mock(async (_candidates: unknown[]) => ({
    promoted: 0,
    skipped: 0,
    errors: [] as string[],
  }));

  const baseDeps: PhaseVerifierDeps = {
    verifyTruths,
    verifyArtifacts,
    verifyKeyLinks,
    beadClient: { list, create },
    eventEmit,
    promoteLearnings,
  };

  const deps: PhaseVerifierDeps = {
    ...baseDeps,
    ...overrides,
    beadClient: { ...baseDeps.beadClient, ...(overrides.beadClient ?? {}) },
  };

  return {
    deps,
    mocks: {
      verifyTruths,
      verifyArtifacts,
      verifyKeyLinks,
      list,
      create,
      eventEmit,
      promoteLearnings,
    },
  };
};

describe("Phase verifier", () => {
  let deps: ReturnType<typeof buildDeps>;
  let buildVerifier: (config?: PhaseVerifierConfig) => PhaseVerifier;

  beforeEach(() => {
    deps = buildDeps();
    buildVerifier = (config: PhaseVerifierConfig = baseConfig) =>
      createPhaseVerifier(config, deps.deps);
  });

  test("All beads closed + all must_haves pass => passed true", async () => {
    deps.mocks.verifyTruths.mockResolvedValue([
      { truth: "t1", passed: true, evidence: "ok" },
    ]);
    deps.mocks.verifyArtifacts.mockResolvedValue([
      { path: "a.ts", check: "exists", passed: true },
    ]);
    deps.mocks.verifyKeyLinks.mockResolvedValue([
      { from: "a.ts", to: "b.ts", type: "calls", passed: true },
    ]);

    const verifier = buildVerifier();
    const result = await verifier.verifyPhase(
      buildMustHaves({
        truths: ["t1"],
        artifacts: [{ path: "a.ts", check: "exists" }],
        keyLinks: [{ from: "a.ts", to: "b.ts", type: "calls" }],
      }),
    );

    expect(result.passed).toBe(true);
    expect(result.gapsRemaining.length).toBe(0);
    expect(result.fixBeadsCreated.length).toBe(0);
  });

  test("Open beads exist => passed false with open beads gap", async () => {
    deps.mocks.list.mockResolvedValue([{ id: "bead-1", status: "open" }]);
    const verifier = buildVerifier();

    const result = await verifier.verifyPhase(buildMustHaves());

    expect(result.passed).toBe(false);
    expect(result.iterations).toBe(1);
    expect(result.gapsRemaining[0]).toContain("Open beads");
    expect(deps.mocks.eventEmit.mock.calls.length).toBe(0);
  });

  test("Truth failure creates fix bead with expected title", async () => {
    deps.mocks.verifyTruths.mockResolvedValue([
      { truth: "t1", passed: false },
    ]);
    const verifier = buildVerifier({ ...baseConfig, maxVerifyIterations: 1 });
    await verifier.verifyPhase(buildMustHaves({ truths: ["t1"] }));

    const [call] = deps.mocks.create.mock.calls;
    const payload = call?.[0] as { title: string } | undefined;
    expect(payload?.title).toBe("Fix: 1 truth verification failures");
  });

  test("Artifact failure creates fix bead", async () => {
    deps.mocks.verifyArtifacts.mockResolvedValue([
      { path: "a.ts", check: "exists", passed: false, reason: "missing" },
    ]);
    const verifier = buildVerifier({ ...baseConfig, maxVerifyIterations: 1 });
    await verifier.verifyPhase(
      buildMustHaves({ artifacts: [{ path: "a.ts", check: "exists" }] }),
    );

    const [call] = deps.mocks.create.mock.calls;
    const payload = call?.[0] as { title: string } | undefined;
    expect(payload?.title).toBe("Fix: 1 missing/incomplete artifacts");
  });

  test("Key-link failure creates fix bead", async () => {
    deps.mocks.verifyKeyLinks.mockResolvedValue([
      {
        from: "a.ts",
        to: "b.ts",
        type: "calls",
        passed: false,
        reason: "missing",
      },
    ]);
    const verifier = buildVerifier({ ...baseConfig, maxVerifyIterations: 1 });
    await verifier.verifyPhase(
      buildMustHaves({
        keyLinks: [{ from: "a.ts", to: "b.ts", type: "calls" }],
      }),
    );

    const [call] = deps.mocks.create.mock.calls;
    const payload = call?.[0] as { title: string } | undefined;
    expect(payload?.title).toBe("Fix: 1 broken component links");
  });

  test("Multiple failure categories create multiple fix beads", async () => {
    deps.mocks.verifyTruths.mockResolvedValue([
      { truth: "t1", passed: false },
    ]);
    deps.mocks.verifyArtifacts.mockResolvedValue([
      { path: "a.ts", check: "exists", passed: false, reason: "missing" },
    ]);
    deps.mocks.verifyKeyLinks.mockResolvedValue([
      { from: "a.ts", to: "b.ts", type: "calls", passed: false },
    ]);
    const verifier = buildVerifier({ ...baseConfig, maxVerifyIterations: 1 });

    await verifier.verifyPhase(
      buildMustHaves({
        truths: ["t1"],
        artifacts: [{ path: "a.ts", check: "exists" }],
        keyLinks: [{ from: "a.ts", to: "b.ts", type: "calls" }],
      }),
    );

    expect(deps.mocks.create.mock.calls.length).toBe(3);
  });

  test("Fix beads use epic parentId", async () => {
    deps.mocks.verifyTruths.mockResolvedValue([
      { truth: "t1", passed: false },
    ]);
    const verifier = buildVerifier({ ...baseConfig, maxVerifyIterations: 1 });
    await verifier.verifyPhase(buildMustHaves({ truths: ["t1"] }));

    const [call] = deps.mocks.create.mock.calls;
    const payload = call?.[0] as { parentId: string } | undefined;
    expect(payload?.parentId).toBe(baseConfig.epicBeadId);
  });

  test("goal_completed event emitted on success", async () => {
    deps.mocks.verifyTruths.mockResolvedValue([
      { truth: "t1", passed: true },
    ]);
    const verifier = buildVerifier();
    await verifier.verifyPhase(buildMustHaves({ truths: ["t1"] }));

    const types = deps.mocks.eventEmit.mock.calls.map((call) => call[0]);
    expect(types.includes("goal_completed")).toBe(true);
  });

  test("Learning promoter called on success when available", async () => {
    deps.mocks.verifyTruths.mockResolvedValue([
      { truth: "t1", passed: true },
    ]);
    const verifier = buildVerifier();
    await verifier.verifyPhase(buildMustHaves({ truths: ["t1"] }));
    expect(deps.mocks.promoteLearnings.mock.calls.length).toBe(1);
  });

  test("gsd_verification_run emitted for each iteration", async () => {
    deps.mocks.verifyTruths
      .mockResolvedValueOnce([{ truth: "t1", passed: false }])
      .mockResolvedValueOnce([{ truth: "t1", passed: true }]);
    const verifier = buildVerifier({ ...baseConfig, maxVerifyIterations: 2 });
    await verifier.verifyPhase(buildMustHaves({ truths: ["t1"] }));

    const types = deps.mocks.eventEmit.mock.calls.map((call) => call[0]);
    const runCount = types.filter((type) => type === "gsd_verification_run").length;
    expect(runCount).toBe(2);
  });

  test("First iteration fails, second passes => iterations 2", async () => {
    deps.mocks.verifyTruths
      .mockResolvedValueOnce([{ truth: "t1", passed: false }])
      .mockResolvedValueOnce([{ truth: "t1", passed: true }]);
    const verifier = buildVerifier({ ...baseConfig, maxVerifyIterations: 2 });

    const result = await verifier.verifyPhase(buildMustHaves({ truths: ["t1"] }));

    expect(result.passed).toBe(true);
    expect(result.iterations).toBe(2);
  });

  test("Three iterations all fail => passed false with iterations 3", async () => {
    deps.mocks.verifyTruths.mockResolvedValue([{ truth: "t1", passed: false }]);
    const verifier = buildVerifier({ ...baseConfig, maxVerifyIterations: 3 });

    const result = await verifier.verifyPhase(buildMustHaves({ truths: ["t1"] }));

    expect(result.passed).toBe(false);
    expect(result.iterations).toBe(3);
  });

  test("Fix beads accumulate across iterations", async () => {
    deps.mocks.verifyTruths.mockResolvedValue([{ truth: "t1", passed: false }]);
    let count = 0;
    deps.mocks.create.mockImplementation(async () => {
      count += 1;
      return `fix-${count}`;
    });
    const verifier = buildVerifier({ ...baseConfig, maxVerifyIterations: 2 });

    const result = await verifier.verifyPhase(buildMustHaves({ truths: ["t1"] }));

    expect(result.fixBeadsCreated).toEqual(["fix-1", "fix-2"]);
  });

  test("gsd_verification_passed emitted on success", async () => {
    deps.mocks.verifyTruths.mockResolvedValue([
      { truth: "t1", passed: true },
    ]);
    const verifier = buildVerifier();
    await verifier.verifyPhase(buildMustHaves({ truths: ["t1"] }));

    const types = deps.mocks.eventEmit.mock.calls.map((call) => call[0]);
    expect(types.includes("gsd_verification_passed")).toBe(true);
  });

  test("gsd_verification_failed emitted on failure", async () => {
    deps.mocks.verifyTruths.mockResolvedValue([{ truth: "t1", passed: false }]);
    const verifier = buildVerifier({ ...baseConfig, maxVerifyIterations: 1 });
    await verifier.verifyPhase(buildMustHaves({ truths: ["t1"] }));

    const types = deps.mocks.eventEmit.mock.calls.map((call) => call[0]);
    expect(types.includes("gsd_verification_failed")).toBe(true);
  });

  test("Empty must_haves passes trivially", async () => {
    const verifier = buildVerifier();
    const result = await verifier.verifyPhase(buildMustHaves());

    expect(result.passed).toBe(true);
    expect(deps.mocks.verifyTruths.mock.calls.length).toBe(0);
    expect(deps.mocks.verifyArtifacts.mock.calls.length).toBe(0);
    expect(deps.mocks.verifyKeyLinks.mock.calls.length).toBe(0);
  });

  test("Only truths checked when artifacts/links empty", async () => {
    deps.mocks.verifyTruths.mockResolvedValue([{ truth: "t1", passed: true }]);
    const verifier = buildVerifier();
    await verifier.verifyPhase(buildMustHaves({ truths: ["t1"] }));

    expect(deps.mocks.verifyTruths.mock.calls.length).toBe(1);
    expect(deps.mocks.verifyArtifacts.mock.calls.length).toBe(0);
    expect(deps.mocks.verifyKeyLinks.mock.calls.length).toBe(0);
  });

  test("Only artifacts checked when truths/links empty", async () => {
    deps.mocks.verifyArtifacts.mockResolvedValue([
      { path: "a.ts", check: "exists", passed: true },
    ]);
    const verifier = buildVerifier();
    await verifier.verifyPhase(
      buildMustHaves({ artifacts: [{ path: "a.ts", check: "exists" }] }),
    );

    expect(deps.mocks.verifyTruths.mock.calls.length).toBe(0);
    expect(deps.mocks.verifyArtifacts.mock.calls.length).toBe(1);
    expect(deps.mocks.verifyKeyLinks.mock.calls.length).toBe(0);
  });

  test("Verification throw is caught and reported as failure", async () => {
    deps.mocks.verifyTruths.mockImplementation(async () => {
      throw new Error("boom");
    });
    const verifier = buildVerifier();
    const result = await verifier.verifyPhase(buildMustHaves({ truths: ["t1"] }));

    expect(result.passed).toBe(false);
    expect(result.gapsRemaining[0]).toContain("boom");
  });

  test("No learning promoter skips gracefully", async () => {
    deps = buildDeps({ promoteLearnings: undefined });
    buildVerifier = (config: PhaseVerifierConfig = baseConfig) =>
      createPhaseVerifier(config, deps.deps);
    deps.mocks.verifyTruths.mockResolvedValue([{ truth: "t1", passed: true }]);

    const verifier = buildVerifier();
    const result = await verifier.verifyPhase(buildMustHaves({ truths: ["t1"] }));
    expect(result.passed).toBe(true);
  });

  test("Gaps remaining include failures after max iterations", async () => {
    deps.mocks.verifyTruths.mockResolvedValue([{ truth: "t1", passed: false }]);
    const verifier = buildVerifier({ ...baseConfig, maxVerifyIterations: 1 });

    const result = await verifier.verifyPhase(buildMustHaves({ truths: ["t1"] }));

    expect(result.gapsRemaining[0]).toContain("Truth: t1");
  });

  test("Run event includes check counts", async () => {
    deps.mocks.verifyTruths.mockResolvedValue([{ truth: "t1", passed: true }]);
    deps.mocks.verifyArtifacts.mockResolvedValue([
      { path: "a.ts", check: "exists", passed: true },
    ]);
    const verifier = buildVerifier();
    await verifier.verifyPhase(
      buildMustHaves({
        truths: ["t1"],
        artifacts: [{ path: "a.ts", check: "exists" }],
      }),
    );

    const runEventCall = deps.mocks.eventEmit.mock.calls.find(
      (call) => call[0] === "gsd_verification_run",
    );
    const runEvent = runEventCall?.[1] as
      | { must_haves_checked: number; artifacts_checked: number }
      | undefined;
    expect(runEvent?.must_haves_checked).toBe(1);
    expect(runEvent?.artifacts_checked).toBe(1);
  });
});
