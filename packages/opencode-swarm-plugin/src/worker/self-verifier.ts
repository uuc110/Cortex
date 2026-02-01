import { readdirSync } from "node:fs";
import { basename, join } from "node:path";

import type { VerificationResult } from "./lifecycle.js";

export interface SelfVerifier {
  verify(projectPath: string, filesTouched: string[]): Promise<VerificationResult>;
}

type SpawnFn = typeof Bun.spawn;

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
    return results;
  }
  return results;
}

function stripExt(fileName: string): string {
  return fileName.replace(/\.(ts|tsx|js|jsx|mjs|cjs)$/, "");
}

function stripTestSuffix(fileName: string): string {
  return fileName.replace(/\.(test|spec)$/, "");
}

function resolveRelatedTests(projectPath: string, filesTouched: string[]): string[] {
  const touchedBases = new Set(
    filesTouched.map((file) => stripExt(basename(file))),
  );
  const allFiles = findAllFiles(projectPath);
  const tests: string[] = [];
  const seen = new Set<string>();

  for (const file of allFiles) {
    if (!file.endsWith(".test.ts") && !file.endsWith(".test.tsx")) {
      continue;
    }

    const testBase = stripTestSuffix(stripExt(basename(file)));
    if (touchedBases.has(testBase)) {
      if (!seen.has(file)) {
        seen.add(file);
        tests.push(file);
      }
    }
  }

  for (const file of filesTouched) {
    if (file.endsWith(".test.ts") || file.endsWith(".test.tsx")) {
      if (!seen.has(file)) {
        seen.add(file);
        tests.push(file);
      }
    }
  }

  return tests;
}

async function runCommand(
  spawnFn: SpawnFn,
  args: string[],
  projectPath: string,
): Promise<{ ok: boolean; stdout: string; stderr: string; exitCode: number }> {
  const proc = spawnFn(args, {
    stdout: "pipe",
    stderr: "pipe",
    cwd: projectPath,
    env: { ...process.env },
  });

  const [exitCode, stdout, stderr] = await Promise.all([
    proc.exited,
    proc.stdout ? new Response(proc.stdout).text() : Promise.resolve(""),
    proc.stderr ? new Response(proc.stderr).text() : Promise.resolve(""),
  ]);

  return { ok: exitCode === 0, stdout, stderr, exitCode };
}

export function createSelfVerifier(opts?: { spawnFn?: SpawnFn }): SelfVerifier {
  const spawnFn = opts?.spawnFn ?? Bun.spawn;

  async function verify(
    projectPath: string,
    filesTouched: string[],
  ): Promise<VerificationResult> {
    const errors: string[] = [];

    const buildResult = await runCommand(
      spawnFn,
      ["bun", "run", "build"],
      projectPath,
    );
    const buildOk = buildResult.ok;
    if (!buildOk) {
      errors.push(
        `build failed: ${buildResult.stderr || buildResult.stdout || `exit ${buildResult.exitCode}`}`,
      );
    }

    const relatedTests = resolveRelatedTests(projectPath, filesTouched);
    let testsOk = true;
    if (relatedTests.length > 0) {
      const testResult = await runCommand(
        spawnFn,
        ["bun", "test", "--timeout", "30000", ...relatedTests],
        projectPath,
      );
      testsOk = testResult.ok;
      if (!testsOk) {
        errors.push(
          `tests failed: ${testResult.stderr || testResult.stdout || `exit ${testResult.exitCode}`}`,
        );
      }
    }

    const typeResult = await runCommand(
      spawnFn,
      ["tsc", "--noEmit"],
      projectPath,
    );
    const typeCheckOk = typeResult.ok;
    if (!typeCheckOk) {
      errors.push(
        `typecheck failed: ${typeResult.stderr || typeResult.stdout || `exit ${typeResult.exitCode}`}`,
      );
    }

    const passed = buildOk && testsOk && typeCheckOk;

    return {
      passed,
      buildOk,
      testsOk,
      typeCheckOk,
      errors,
    };
  }

  return { verify };
}
