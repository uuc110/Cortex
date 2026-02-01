import {
  gsdVerificationFailed,
  gsdVerificationPassed,
  gsdVerificationRun,
} from "../gsd/gsd-events.js";

export interface PhaseVerifierConfig {
  projectKey: string;
  projectPath: string;
  epicBeadId: string;
  maxVerifyIterations?: number;
}

export interface PhaseVerifierDeps {
  verifyTruths: (
    truths: string[],
  ) => Promise<Array<{ truth: string; passed: boolean; evidence?: string }>>;
  verifyArtifacts: (
    artifacts: Array<{ path: string; check: string }>,
  ) => Promise<
    Array<{ path: string; check: string; passed: boolean; reason?: string }>
  >;
  verifyKeyLinks: (
    links: Array<{ from: string; to: string; type: string }>,
  ) => Promise<
    Array<{ from: string; to: string; type: string; passed: boolean; reason?: string }>
  >;
  beadClient: {
    list: (filter?: any) => Promise<any[]>;
    create: (args: any) => Promise<string>;
  };
  eventEmit: (type: string, data: any) => void;
  promoteLearnings?: (
    candidates: any[],
  ) => Promise<{ promoted: number; skipped: number; errors: string[] }>;
}

export interface MustHaves {
  truths: string[];
  artifacts: Array<{ path: string; check: "exists" | "substantive" | "wired" }>;
  keyLinks: Array<{
    from: string;
    to: string;
    type: "imported-by" | "renders-within" | "calls" | "extends";
  }>;
}

export interface PhaseVerificationResult {
  passed: boolean;
  iterations: number;
  truthResults: Array<{ truth: string; passed: boolean; evidence?: string }>;
  artifactResults: Array<{
    path: string;
    check: string;
    passed: boolean;
    reason?: string;
  }>;
  keyLinkResults: Array<{
    from: string;
    to: string;
    type: string;
    passed: boolean;
    reason?: string;
  }>;
  fixBeadsCreated: string[];
  gapsRemaining: string[];
}

export interface PhaseVerifier {
  verifyPhase(mustHaves: MustHaves): Promise<PhaseVerificationResult>;
}

const DEFAULT_MAX_VERIFY_ITERATIONS = 3;

function buildFailureList(
  failedTruths: Array<{ truth: string }>,
  failedArtifacts: Array<{ path: string; check: string }>,
  failedLinks: Array<{ from: string; to: string; type: string }>,
): string[] {
  return [
    ...failedTruths.map((truth) => `Truth: ${truth.truth}`),
    ...failedArtifacts.map(
      (artifact) => `Artifact: ${artifact.path} (${artifact.check})`,
    ),
    ...failedLinks.map(
      (link) => `Link: ${link.from} → ${link.to} (${link.type})`,
    ),
  ];
}

export function createPhaseVerifier(
  config: PhaseVerifierConfig,
  deps: PhaseVerifierDeps,
): PhaseVerifier {
  const maxVerifyIterations =
    config.maxVerifyIterations ?? DEFAULT_MAX_VERIFY_ITERATIONS;

  const verifyPhase = async (mustHaves: MustHaves): Promise<PhaseVerificationResult> => {
    const allFixBeads: string[] = [];
    let iteration = 0;
    let truthResults: PhaseVerificationResult["truthResults"] = [];
    let artifactResults: PhaseVerificationResult["artifactResults"] = [];
    let keyLinkResults: PhaseVerificationResult["keyLinkResults"] = [];
    let failedTruths: PhaseVerificationResult["truthResults"] = [];
    let failedArtifacts: PhaseVerificationResult["artifactResults"] = [];
    let failedLinks: PhaseVerificationResult["keyLinkResults"] = [];

    while (iteration < maxVerifyIterations) {
      iteration += 1;

      const beads = await deps.beadClient.list({ parentId: config.epicBeadId });
      const openBeads = beads.filter((bead) => bead.status !== "closed");
      if (openBeads.length > 0) {
        return {
          passed: false,
          iterations: iteration,
          truthResults: [],
          artifactResults: [],
          keyLinkResults: [],
          fixBeadsCreated: allFixBeads,
          gapsRemaining: [
            `Open beads: ${openBeads.map((bead) => bead.id).join(", ")}`,
          ],
        };
      }

      const runEvent = gsdVerificationRun(
        { project_key: config.projectKey, timestamp: Date.now() },
        {
          verification_type: "phase",
          epic_id: config.epicBeadId,
          must_haves_checked: mustHaves.truths.length,
          artifacts_checked: mustHaves.artifacts.length,
          key_links_checked: mustHaves.keyLinks.length,
        },
      );
      deps.eventEmit(runEvent.type, runEvent);

      try {
        truthResults = mustHaves.truths.length
          ? await deps.verifyTruths(mustHaves.truths)
          : [];
        artifactResults = mustHaves.artifacts.length
          ? await deps.verifyArtifacts(mustHaves.artifacts)
          : [];
        keyLinkResults = mustHaves.keyLinks.length
          ? await deps.verifyKeyLinks(mustHaves.keyLinks)
          : [];
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const failedEvent = gsdVerificationFailed(
          { project_key: config.projectKey, timestamp: Date.now() },
          {
            failures: [message],
            epic_id: config.epicBeadId,
            retry_count: iteration,
          },
        );
        deps.eventEmit(failedEvent.type, failedEvent);
        return {
          passed: false,
          iterations: iteration,
          truthResults: [],
          artifactResults: [],
          keyLinkResults: [],
          fixBeadsCreated: allFixBeads,
          gapsRemaining: [message],
        };
      }

      const allPassed =
        truthResults.every((result) => result.passed) &&
        artifactResults.every((result) => result.passed) &&
        keyLinkResults.every((result) => result.passed);

      if (allPassed) {
        const totalChecks =
          truthResults.length + artifactResults.length + keyLinkResults.length;
        const passedEvent = gsdVerificationPassed(
          { project_key: config.projectKey, timestamp: Date.now() },
          {
            must_haves_passed: truthResults.length,
            artifacts_passed: artifactResults.length,
            key_links_passed: keyLinkResults.length,
            total_checks: totalChecks,
            epic_id: config.epicBeadId,
          },
        );
        deps.eventEmit(passedEvent.type, passedEvent);
        if (deps.promoteLearnings) {
          await deps.promoteLearnings([]);
        }
        deps.eventEmit("goal_completed", { epicId: config.epicBeadId });
        return {
          passed: true,
          iterations: iteration,
          truthResults,
          artifactResults,
          keyLinkResults,
          fixBeadsCreated: allFixBeads,
          gapsRemaining: [],
        };
      }

      failedTruths = truthResults.filter((result) => !result.passed);
      failedArtifacts = artifactResults.filter((result) => !result.passed);
      failedLinks = keyLinkResults.filter((result) => !result.passed);

      const failures = buildFailureList(failedTruths, failedArtifacts, failedLinks);
      const failedEvent = gsdVerificationFailed(
        { project_key: config.projectKey, timestamp: Date.now() },
        {
          failures,
          epic_id: config.epicBeadId,
          retry_count: iteration,
        },
      );
      deps.eventEmit(failedEvent.type, failedEvent);

      if (failedTruths.length > 0) {
        const fixId = await deps.beadClient.create({
          title: `Fix: ${failedTruths.length} truth verification failures`,
          type: "bug",
          priority: 0,
          parentId: config.epicBeadId,
          description: failedTruths.map((truth) => `- ${truth.truth}`).join("\n"),
        });
        allFixBeads.push(fixId);
      }

      if (failedArtifacts.length > 0) {
        const fixId = await deps.beadClient.create({
          title: `Fix: ${failedArtifacts.length} missing/incomplete artifacts`,
          type: "bug",
          priority: 0,
          parentId: config.epicBeadId,
          description: failedArtifacts
            .map(
              (artifact) =>
                `- ${artifact.path} (${artifact.check}): ${artifact.reason}`,
            )
            .join("\n"),
        });
        allFixBeads.push(fixId);
      }

      if (failedLinks.length > 0) {
        const fixId = await deps.beadClient.create({
          title: `Fix: ${failedLinks.length} broken component links`,
          type: "bug",
          priority: 0,
          parentId: config.epicBeadId,
          description: failedLinks
            .map(
              (link) => `- ${link.from} → ${link.to} (${link.type}): ${link.reason}`,
            )
            .join("\n"),
        });
        allFixBeads.push(fixId);
      }
    }

    const gapsRemaining = buildFailureList(failedTruths, failedArtifacts, failedLinks);

    return {
      passed: false,
      iterations: maxVerifyIterations,
      truthResults,
      artifactResults,
      keyLinkResults,
      fixBeadsCreated: allFixBeads,
      gapsRemaining,
    };
  };

  return { verifyPhase };
}
