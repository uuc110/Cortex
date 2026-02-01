import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, basename, extname } from "node:path";

import type {
  GsdPlan,
  GsdTask,
  GsdTaskPriority,
  VerificationTruth,
  VerificationArtifact,
  VerificationKeyLink,
  VerificationResult,
} from "./gsd-types.js";

export interface TruthCheckResult {
  description: string;
  passed: boolean;
  evidence: string;
}

export interface ArtifactCheckResult {
  path: string;
  check: string;
  passed: boolean;
  reason?: string;
}

export interface KeyLinkCheckResult {
  from: string;
  to: string;
  type: string;
  passed: boolean;
  reason?: string;
}

export interface VerificationFailure {
  category: "truth" | "artifact" | "key_link";
  description: string;
  severity: "critical" | "major" | "minor";
  suggestedFix?: string;
}

export interface TaskResults {
  completed_task_ids: string[];
  failed_task_ids: string[];
}

export interface VerificationEngineOptions {
  projectPath?: string;
  artifactMinLines?: number;
  maxFixIterations?: number;
}

export interface VerificationEngine {
  verify(plan: GsdPlan, results: TaskResults): VerificationResult;
  checkTruths(truths: VerificationTruth[]): TruthCheckResult[];
  checkArtifacts(artifacts: VerificationArtifact[]): ArtifactCheckResult[];
  checkKeyLinks(keyLinks: VerificationKeyLink[]): KeyLinkCheckResult[];
  generateFixPlan(failures: VerificationFailure[]): GsdTask[];
  isFullyVerified(result: VerificationResult): boolean;
}

const DEFAULT_ARTIFACT_MIN_LINES = 10;

const SEVERITY_TO_PRIORITY: Record<string, GsdTaskPriority> = {
  critical: "critical",
  major: "high",
  minor: "medium",
};

function countMeaningfulLines(content: string): number {
  return content.split("\n").filter((line) => {
    const trimmed = line.trim();
    return (
      trimmed.length > 0 &&
      !trimmed.startsWith("//") &&
      !trimmed.startsWith("/*") &&
      !trimmed.startsWith("*")
    );
  }).length;
}

function resolveArtifactPath(projectPath: string, artifactPath: string): string {
  if (artifactPath.startsWith("/")) return artifactPath;
  return join(projectPath, artifactPath);
}

function stripExtAndIndex(filePath: string): string {
  return filePath
    .replace(/\.(ts|tsx|js|jsx|mjs|cjs)$/, "")
    .replace(/\/index$/, "");
}

function findAllFiles(dir: string): string[] {
  const results: string[] = [];
  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory() && entry.name !== "node_modules") {
        results.push(...findAllFiles(full));
      } else if (entry.isFile()) {
        results.push(full);
      }
    }
  } catch {
    /* empty */
  }
  return results;
}

function fileImportsModule(
  fileContent: string,
  importPattern: string,
): boolean {
  const escaped = importPattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [
    new RegExp(`from\\s+['"].*${escaped}['"]`),
    new RegExp(`require\\s*\\(\\s*['"].*${escaped}['"]\\s*\\)`),
    new RegExp(`import\\s+['"].*${escaped}['"]`),
  ];
  return patterns.some((p) => p.test(fileContent));
}

function checkFileImportedBy(
  projectPath: string,
  modulePath: string,
): boolean {
  const stripped = stripExtAndIndex(modulePath);
  const moduleBasename = basename(stripped);
  const allFiles = findAllFiles(projectPath);

  for (const file of allFiles) {
    const ext = extname(file);
    if (![".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"].includes(ext))
      continue;

    const fullModulePath = resolveArtifactPath(projectPath, modulePath);
    if (file === fullModulePath) continue;

    try {
      const content = readFileSync(file, "utf-8");
      if (fileImportsModule(content, moduleBasename)) {
        return true;
      }
    } catch {
      /* unreadable */
    }
  }
  return false;
}

function readFileSafe(path: string): string | null {
  try {
    return readFileSync(path, "utf-8");
  } catch {
    return null;
  }
}

export function createVerificationEngine(
  options: VerificationEngineOptions = {},
): VerificationEngine {
  const projectPath = options.projectPath ?? "";
  const artifactMinLines =
    options.artifactMinLines ?? DEFAULT_ARTIFACT_MIN_LINES;

  function checkTruths(truths: VerificationTruth[]): TruthCheckResult[] {
    return truths.map((truth) => ({
      description: truth.description,
      passed: truth.passed,
      evidence: truth.passed
        ? `Truth assertion holds: "${truth.description}"`
        : `Truth assertion FAILED: "${truth.description}"`,
    }));
  }

  function checkArtifacts(
    artifacts: VerificationArtifact[],
  ): ArtifactCheckResult[] {
    return artifacts.map((artifact) => {
      const fullPath = resolveArtifactPath(projectPath, artifact.path);

      if (!existsSync(fullPath)) {
        return {
          path: artifact.path,
          check: artifact.check,
          passed: false,
          reason: `File not found: ${artifact.path}`,
        };
      }

      if (artifact.check === "exists") {
        return { path: artifact.path, check: artifact.check, passed: true };
      }

      const content = readFileSafe(fullPath);
      if (content === null) {
        return {
          path: artifact.path,
          check: artifact.check,
          passed: false,
          reason: `File unreadable: ${artifact.path}`,
        };
      }

      const meaningfulLineCount = countMeaningfulLines(content);
      if (meaningfulLineCount < artifactMinLines) {
        return {
          path: artifact.path,
          check: artifact.check,
          passed: false,
          reason: `File is not substantive: ${meaningfulLineCount} meaningful lines < ${artifactMinLines} required`,
        };
      }

      if (artifact.check === "substantive") {
        return { path: artifact.path, check: artifact.check, passed: true };
      }

      const isImported = checkFileImportedBy(projectPath, artifact.path);
      if (!isImported) {
        return {
          path: artifact.path,
          check: artifact.check,
          passed: false,
          reason: `File is substantive but no import found — not wired into codebase`,
        };
      }

      return { path: artifact.path, check: artifact.check, passed: true };
    });
  }

  function checkKeyLinks(
    keyLinks: VerificationKeyLink[],
  ): KeyLinkCheckResult[] {
    return keyLinks.map((link) => {
      const fromPath = resolveArtifactPath(projectPath, link.from);
      const toPath = resolveArtifactPath(projectPath, link.to);

      const fromExists = existsSync(fromPath);
      const toExists = existsSync(toPath);

      if (!fromExists) {
        return {
          from: link.from,
          to: link.to,
          type: link.type,
          passed: false,
          reason: `Source file not found: ${link.from}`,
        };
      }

      if (!toExists) {
        return {
          from: link.from,
          to: link.to,
          type: link.type,
          passed: false,
          reason: `Target file not found: ${link.to}`,
        };
      }

      const toContent = readFileSafe(toPath);
      if (toContent === null) {
        return {
          from: link.from,
          to: link.to,
          type: link.type,
          passed: false,
          reason: `Target file unreadable: ${link.to}`,
        };
      }

      const fromContent = readFileSafe(fromPath);
      if (fromContent === null) {
        return {
          from: link.from,
          to: link.to,
          type: link.type,
          passed: false,
          reason: `Source file unreadable: ${link.from}`,
        };
      }

      switch (link.type) {
        case "imported-by": {
          const fromBase = stripExtAndIndex(link.from);
          const fromName = basename(fromBase);
          if (fileImportsModule(toContent, fromName)) {
            return {
              from: link.from,
              to: link.to,
              type: link.type,
              passed: true,
            };
          }
          return {
            from: link.from,
            to: link.to,
            type: link.type,
            passed: false,
            reason: `No import of "${fromName}" found in ${link.to}`,
          };
        }

        case "renders-within": {
          const fromBase = basename(link.from, extname(link.from));
          const componentNameFromFile = fromBase
            .split(/[-_.]/)
            .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
            .join("");

          const fromExports =
            fromContent.match(
              /export\s+(?:default\s+)?(?:function|class|const)\s+(\w+)/g,
            ) ?? [];
          const exportedNames = fromExports.map((e) => {
            const match = e.match(/(\w+)$/);
            return match ? match[1] : "";
          });

          const namesToCheck = [
            ...new Set([componentNameFromFile, ...exportedNames]),
          ];

          const rendered = namesToCheck.some((name) => {
            if (!name) return false;
            const jsxPattern = new RegExp(`<${name}[\\s/>]`);
            return jsxPattern.test(toContent);
          });

          if (rendered) {
            return {
              from: link.from,
              to: link.to,
              type: link.type,
              passed: true,
            };
          }
          return {
            from: link.from,
            to: link.to,
            type: link.type,
            passed: false,
            reason: `No JSX usage of component from ${link.from} found in ${link.to}`,
          };
        }

        case "extends": {
          const toBase = basename(link.to, extname(link.to));
          const toExports =
            toContent.match(/export\s+(?:abstract\s+)?class\s+(\w+)/g) ?? [];
          const toClassNames = toExports.map((e) => {
            const match = e.match(/class\s+(\w+)/);
            return match ? match[1] : "";
          });

          if (toClassNames.length === 0) {
            const inferredName =
              toBase.charAt(0).toUpperCase() + toBase.slice(1);
            toClassNames.push(inferredName);
          }

          const extendsFound = toClassNames.some((name) => {
            if (!name) return false;
            const pat = new RegExp(`extends\\s+${name}\\b`);
            return pat.test(fromContent);
          });

          if (extendsFound) {
            return {
              from: link.from,
              to: link.to,
              type: link.type,
              passed: true,
            };
          }
          return {
            from: link.from,
            to: link.to,
            type: link.type,
            passed: false,
            reason: `No "extends" relationship from ${link.from} to classes in ${link.to}`,
          };
        }

        case "calls": {
          const toBase = stripExtAndIndex(link.to);
          const toName = basename(toBase);
          if (fileImportsModule(fromContent, toName)) {
            return {
              from: link.from,
              to: link.to,
              type: link.type,
              passed: true,
            };
          }
          return {
            from: link.from,
            to: link.to,
            type: link.type,
            passed: false,
            reason: `No import/call from ${link.from} to ${link.to}`,
          };
        }

        default:
          return {
            from: link.from,
            to: link.to,
            type: link.type,
            passed: false,
            reason: `Unknown link type: ${link.type}`,
          };
      }
    });
  }

  function verify(plan: GsdPlan, _results: TaskResults): VerificationResult {
    const verification = plan.verification;

    if (!verification) {
      return {
        status: "passed",
        truths: [],
        artifacts: [],
        key_links: [],
        checked_at: new Date().toISOString(),
        total_checks: 0,
        passed_checks: 0,
        failed_checks: 0,
      };
    }

    const truthResults = checkTruths(verification.truths ?? []);
    const artifactResults = checkArtifacts(verification.artifacts ?? []);
    const keyLinkResults = checkKeyLinks(verification.key_links ?? []);

    const allChecked = [
      ...truthResults.map((r) => r.passed),
      ...artifactResults.map((r) => r.passed),
      ...keyLinkResults.map((r) => r.passed),
    ];

    const totalChecks = allChecked.length;
    const passedChecks = allChecked.filter(Boolean).length;
    const failedChecks = totalChecks - passedChecks;
    const allPassed = failedChecks === 0;

    return {
      status: allPassed ? "passed" : "failed",
      truths: truthResults.map((r) => ({
        description: r.description,
        passed: r.passed,
      })),
      artifacts: artifactResults.map((r) => ({
        path: r.path,
        check: r.check as VerificationArtifact["check"],
        passed: r.passed,
      })),
      key_links: keyLinkResults.map((r) => ({
        from: r.from,
        to: r.to,
        type: r.type as VerificationKeyLink["type"],
        passed: r.passed,
      })),
      checked_at: new Date().toISOString(),
      total_checks: totalChecks,
      passed_checks: passedChecks,
      failed_checks: failedChecks,
    };
  }

  function generateFixPlan(failures: VerificationFailure[]): GsdTask[] {
    if (failures.length === 0) return [];

    return failures.map((failure, index): GsdTask => {
      const priority = SEVERITY_TO_PRIORITY[failure.severity] ?? "medium";
      const taskId = `fix-${index + 1}`;

      let name: string;
      let action: string;

      switch (failure.category) {
        case "truth":
          name = `Fix: ${failure.description}`;
          action = failure.suggestedFix
            ? `Truth "${failure.description}" is not met. ${failure.suggestedFix}`
            : `Truth "${failure.description}" is not met. Investigate and fix the implementation.`;
          break;
        case "artifact":
          name = `Fix artifact: ${failure.description}`;
          action = failure.suggestedFix
            ? `Artifact check failed: ${failure.description}. ${failure.suggestedFix}`
            : `Artifact check failed: ${failure.description}. Create or update the file.`;
          break;
        case "key_link":
          name = `Connect: ${failure.description}`;
          action = failure.suggestedFix
            ? `Key link broken: ${failure.description}. ${failure.suggestedFix}`
            : `Key link broken: ${failure.description}. Establish the connection.`;
          break;
      }

      return {
        id: taskId,
        name,
        status: "pending",
        wave: 1,
        priority,
        type: "auto",
        files: [],
        action,
      };
    });
  }

  function isFullyVerified(result: VerificationResult): boolean {
    return result.status === "passed";
  }

  return {
    verify,
    checkTruths,
    checkArtifacts,
    checkKeyLinks,
    generateFixPlan,
    isFullyVerified,
  };
}
