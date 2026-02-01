import {
  describe,
  expect,
  test,
  beforeEach,
  afterEach,
  mock,
} from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createSelfVerifier } from "../self-verifier.js";

function mockSpawnResult(opts: {
  stdout?: string;
  stderr?: string;
  exitCode?: number;
}) {
  const stdoutText = opts.stdout ?? "";
  const stderrText = opts.stderr ?? "";
  const exitCode = opts.exitCode ?? 0;

  return {
    stdout: new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(stdoutText));
        controller.close();
      },
    }),
    stderr: new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(stderrText));
        controller.close();
      },
    }),
    exited: Promise.resolve(exitCode),
    pid: 111,
    kill: mock(() => {}),
  };
}

function createSpawnMock(
  results: Array<{ exitCode?: number; stdout?: string; stderr?: string }>,
) {
  let index = 0;
  return mock(() => {
    const result = results[Math.min(index, results.length - 1)] ?? {};
    index += 1;
    return mockSpawnResult(result) as unknown as ReturnType<typeof Bun.spawn>;
  });
}

function getMockCalls(fn: ReturnType<typeof mock>): Array<unknown[]> {
  return fn.mock.calls as unknown as Array<unknown[]>;
}

describe("createSelfVerifier", () => {
  let projectDir: string;

  beforeEach(() => {
    projectDir = join(tmpdir(), `self-verifier-${Date.now()}`);
    mkdirSync(projectDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  test("all pass returns passed true", async () => {
    const spawnFn = createSpawnMock([{ exitCode: 0 }, { exitCode: 0 }, { exitCode: 0 }]);
    const verifier = createSelfVerifier({
      spawnFn: spawnFn as unknown as typeof Bun.spawn,
    });
    const result = await verifier.verify(projectDir, ["src/foo.ts"]);
    expect(result.passed).toBe(true);
    expect(result.errors.length).toBe(0);
  });

  test("build fails returns passed false", async () => {
    const spawnFn = createSpawnMock([
      { exitCode: 1, stderr: "build fail" },
      { exitCode: 0 },
      { exitCode: 0 },
    ]);
    const verifier = createSelfVerifier({
      spawnFn: spawnFn as unknown as typeof Bun.spawn,
    });
    const result = await verifier.verify(projectDir, ["src/foo.ts"]);
    expect(result.passed).toBe(false);
    expect(result.buildOk).toBe(false);
  });

  test("tests fail returns passed false", async () => {
    const testPath = join(projectDir, "src");
    mkdirSync(testPath, { recursive: true });
    writeFileSync(join(testPath, "foo.ts"), "export {};");
    writeFileSync(join(testPath, "foo.test.ts"), "export {};");

    const spawnFn = createSpawnMock([
      { exitCode: 0 },
      { exitCode: 1, stderr: "tests" },
      { exitCode: 0 },
    ]);
    const verifier = createSelfVerifier({
      spawnFn: spawnFn as unknown as typeof Bun.spawn,
    });
    const result = await verifier.verify(projectDir, ["src/foo.ts"]);
    expect(result.passed).toBe(false);
    expect(result.testsOk).toBe(false);
  });

  test("typecheck fails returns passed false", async () => {
    const srcDir = join(projectDir, "src");
    mkdirSync(srcDir, { recursive: true });
    writeFileSync(join(srcDir, "foo.ts"), "export {};");
    writeFileSync(join(srcDir, "foo.test.ts"), "export {};");

    const spawnFn = createSpawnMock([
      { exitCode: 0 },
      { exitCode: 0 },
      { exitCode: 1, stderr: "type" },
    ]);
    const verifier = createSelfVerifier({
      spawnFn: spawnFn as unknown as typeof Bun.spawn,
    });
    const result = await verifier.verify(projectDir, ["src/foo.ts"]);
    expect(result.passed).toBe(false);
    expect(result.typeCheckOk).toBe(false);
  });

  test("no test files yields testsOk true", async () => {
    const spawnFn = createSpawnMock([{ exitCode: 0 }, { exitCode: 0 }]);
    const verifier = createSelfVerifier({
      spawnFn: spawnFn as unknown as typeof Bun.spawn,
    });
    const result = await verifier.verify(projectDir, ["src/foo.ts"]);
    expect(result.testsOk).toBe(true);
    expect(spawnFn).toHaveBeenCalledTimes(2);
  });

  test("multiple failures are reported", async () => {
    const srcDir = join(projectDir, "src");
    mkdirSync(srcDir, { recursive: true });
    writeFileSync(join(srcDir, "foo.ts"), "export {};");
    writeFileSync(join(srcDir, "foo.test.ts"), "export {};");

    const spawnFn = createSpawnMock([
      { exitCode: 1, stderr: "build" },
      { exitCode: 1, stderr: "tests" },
      { exitCode: 1, stderr: "type" },
    ]);
    const verifier = createSelfVerifier({
      spawnFn: spawnFn as unknown as typeof Bun.spawn,
    });
    const result = await verifier.verify(projectDir, ["src/foo.ts"]);
    expect(result.errors.length).toBe(3);
  });

  test("runs related tests when matching file exists", async () => {
    const srcDir = join(projectDir, "src");
    mkdirSync(srcDir, { recursive: true });
    writeFileSync(join(srcDir, "bar.ts"), "export {};");
    writeFileSync(join(srcDir, "bar.test.ts"), "export {};");

    const spawnFn = createSpawnMock([{ exitCode: 0 }, { exitCode: 0 }, { exitCode: 0 }]);
    const verifier = createSelfVerifier({
      spawnFn: spawnFn as unknown as typeof Bun.spawn,
    });
    await verifier.verify(projectDir, ["src/bar.ts"]);
    const testCall = getMockCalls(spawnFn)[1];
    if (!testCall) throw new Error("missing test call");
    const args = testCall[0] as unknown as string[];
    expect(args[0]).toBe("bun");
    expect(args).toContain(join(srcDir, "bar.test.ts"));
  });

  test("includes touched test files directly", async () => {
    const srcDir = join(projectDir, "src");
    mkdirSync(srcDir, { recursive: true });
    writeFileSync(join(srcDir, "baz.test.ts"), "export {};");

    const spawnFn = createSpawnMock([{ exitCode: 0 }, { exitCode: 0 }, { exitCode: 0 }]);
    const verifier = createSelfVerifier({
      spawnFn: spawnFn as unknown as typeof Bun.spawn,
    });
    await verifier.verify(projectDir, ["src/baz.test.ts"]);
    const testCall = getMockCalls(spawnFn)[1];
    if (!testCall) throw new Error("missing test call");
    const args = testCall[0] as unknown as string[];
    expect(args).toContain("src/baz.test.ts");
  });

  test("uses timeout 30000 for tests", async () => {
    const srcDir = join(projectDir, "src");
    mkdirSync(srcDir, { recursive: true });
    writeFileSync(join(srcDir, "foo.ts"), "export {};");
    writeFileSync(join(srcDir, "foo.test.ts"), "export {};");

    const spawnFn = createSpawnMock([{ exitCode: 0 }, { exitCode: 0 }, { exitCode: 0 }]);
    const verifier = createSelfVerifier({
      spawnFn: spawnFn as unknown as typeof Bun.spawn,
    });
    await verifier.verify(projectDir, ["src/foo.ts"]);
    const testCall = getMockCalls(spawnFn)[1];
    if (!testCall) throw new Error("missing test call");
    const args = testCall[0] as unknown as string[];
    expect(args).toContain("--timeout");
    expect(args).toContain("30000");
  });

  test("uses project path as cwd", async () => {
    const spawnFn = createSpawnMock([{ exitCode: 0 }, { exitCode: 0 }, { exitCode: 0 }]);
    const verifier = createSelfVerifier({
      spawnFn: spawnFn as unknown as typeof Bun.spawn,
    });
    await verifier.verify(projectDir, ["src/foo.ts"]);
    const buildCall = getMockCalls(spawnFn)[0];
    if (!buildCall) throw new Error("missing build call");
    const options = buildCall[1] as unknown as { cwd?: string };
    expect(options.cwd).toBe(projectDir);
  });
});
