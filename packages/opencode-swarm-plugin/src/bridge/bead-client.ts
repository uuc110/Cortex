import type {
  BeadIssue,
  BeadDependency,
  BeadComment,
  BeadMolecule,
  BeadStats,
  BeadDaemonStatus,
  BeadDepType,
  BdCreateOptions,
  BdListOptions,
  BdUpdateOptions,
  BdSearchOptions,
  BdReadyOptions,
  BdRetryConfig,
} from "./bead-types.js";

import { BeadClientError } from "./bead-types.js";

export const DEFAULT_RETRY_CONFIG: BdRetryConfig = {
  maxRetries: 3,
  baseDelay: 1000,
  maxDelay: 10000,
  retryableExitCodes: [1],
};

export interface BeadClient {
  spawnBd(args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }>;
  runBdJson<T>(args: string[]): Promise<T>;
  parseJsonOutput<T>(stdout: string): T;

  isBdInstalled(): Promise<boolean>;
  bdVersion(): Promise<string>;
  bdInit(path?: string): Promise<void>;

  bdCreate(opts: BdCreateOptions): Promise<BeadIssue>;
  bdShow(id: string): Promise<BeadIssue>;
  bdList(opts?: BdListOptions): Promise<BeadIssue[]>;
  bdUpdate(id: string, opts: BdUpdateOptions): Promise<BeadIssue>;
  bdClose(id: string, reason?: string): Promise<BeadIssue>;

  bdReady(opts?: BdReadyOptions): Promise<BeadIssue[]>;

  bdDepAdd(source: string, target: string, depType?: BeadDepType): Promise<void>;
  bdDepRemove(source: string, target: string): Promise<void>;
  bdDepList(id: string): Promise<BeadDependency[]>;
  bdDepTree(id: string): Promise<BeadDependency[]>;

  bdSearch(opts: BdSearchOptions): Promise<BeadIssue[]>;

  bdLabelAdd(id: string, label: string): Promise<void>;
  bdLabelRemove(id: string, label: string): Promise<void>;
  bdLabelList(id: string): Promise<string[]>;

  bdCommentAdd(id: string, body: string, opts?: { author?: string }): Promise<BeadComment>;
  bdCommentList(id: string): Promise<BeadComment[]>;

  bdMoleculeCreate(name: string, description?: string): Promise<BeadMolecule>;
  bdMoleculeList(): Promise<BeadMolecule[]>;
  bdMoleculeShow(name: string): Promise<BeadMolecule>;
  bdMoleculeAddMember(moleculeName: string, beadId: string): Promise<void>;

  bdDaemonStart(): Promise<{ pid: number }>;
  bdDaemonStop(): Promise<void>;
  bdDaemonStatus(): Promise<BeadDaemonStatus>;

  bdStats(): Promise<BeadStats>;
}

export function createBeadClient(config?: BdRetryConfig): BeadClient {
  const retryConfig = config ?? DEFAULT_RETRY_CONFIG;

  function parseJsonOutput<T>(stdout: string): T {
    const trimmed = stdout.trim();
    if (trimmed.length === 0) {
      throw new BeadClientError("bd returned empty JSON output", {
        exitCode: 0,
        stderr: "",
        command: "parseJsonOutput",
        suggestion: "The bd command returned no output. Check if the resource exists.",
      });
    }

    try {
      return JSON.parse(trimmed) as T;
    } catch (cause) {
      throw new BeadClientError(
        `Failed to parse JSON output: ${trimmed.slice(0, 200)}`,
        {
          exitCode: 0,
          stderr: cause instanceof Error ? cause.message : String(cause),
          command: "parseJsonOutput",
        },
      );
    }
  }

  async function spawnBd(args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    const commandStr = ["bd", ...args].join(" ");

    const proc = Bun.spawn(["bd", ...args], {
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env },
    });

    const [exitCode, stdout, stderr] = await Promise.all([
      proc.exited,
      proc.stdout ? new Response(proc.stdout).text() : Promise.resolve(""),
      proc.stderr ? new Response(proc.stderr).text() : Promise.resolve(""),
    ]);

    if (exitCode !== 0) {
      throw BeadClientError.fromSpawnResult(
        { exitCode, stdout, stderr },
        commandStr,
      );
    }

    return { exitCode, stdout, stderr };
  }

  async function spawnBdWithRetry(args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    let lastError: BeadClientError | undefined;

    for (let attempt = 0; attempt <= retryConfig.maxRetries; attempt++) {
      try {
        return await spawnBd(args);
      } catch (thrown: unknown) {
        if (!(thrown instanceof BeadClientError)) throw thrown;
        lastError = thrown;

        const isRetryable = retryConfig.retryableExitCodes.includes(thrown.exitCode);
        if (!isRetryable || attempt === retryConfig.maxRetries) {
          throw thrown;
        }

        const delay = Math.min(
          retryConfig.baseDelay * Math.pow(2, attempt),
          retryConfig.maxDelay,
        );
        await Bun.sleep(delay);
      }
    }

    throw lastError!;
  }

  async function runBdJson<T>(args: string[]): Promise<T> {
    const { stdout } = await spawnBdWithRetry([...args, "--json"]);
    return parseJsonOutput<T>(stdout);
  }

  async function isBdInstalled(): Promise<boolean> {
    try {
      await spawnBd(["version", "--json"]);
      return true;
    } catch {
      return false;
    }
  }

  async function bdVersion(): Promise<string> {
    const result = await runBdJson<{ version?: string }>(["version"]);
    if (!result.version) {
      throw new BeadClientError("bd version response missing 'version' field", {
        exitCode: 0,
        stderr: "",
        command: "bd version --json",
      });
    }
    return result.version;
  }

  async function bdInit(path?: string): Promise<void> {
    const args = ["init", "--json"];
    if (path) {
      const proc = Bun.spawn(["bd", ...args], {
        stdout: "pipe",
        stderr: "pipe",
        cwd: path,
        env: { ...process.env },
      });

      const [exitCode, stdout, stderr] = await Promise.all([
        proc.exited,
        proc.stdout ? new Response(proc.stdout).text() : Promise.resolve(""),
        proc.stderr ? new Response(proc.stderr).text() : Promise.resolve(""),
      ]);

      if (exitCode !== 0) {
        throw BeadClientError.fromSpawnResult(
          { exitCode, stdout, stderr },
          ["bd", ...args].join(" "),
        );
      }
      return;
    }
    await spawnBdWithRetry(args);
  }

  async function bdCreate(opts: BdCreateOptions): Promise<BeadIssue> {
    const args: string[] = ["add", opts.title];

    if (opts.type !== undefined) {
      args.push("-t", opts.type);
    }
    if (opts.priority !== undefined) {
      args.push("-p", String(opts.priority));
    }
    if (opts.parent_id !== undefined) {
      args.push("--parent", opts.parent_id);
    }
    if (opts.description !== undefined) {
      args.push("--description", opts.description);
    }

    return runBdJson<BeadIssue>(args);
  }

  async function bdShow(id: string): Promise<BeadIssue> {
    return runBdJson<BeadIssue>(["show", id]);
  }

  async function bdList(opts?: BdListOptions): Promise<BeadIssue[]> {
    const args: string[] = ["list"];

    if (opts?.status !== undefined) {
      args.push("--status", opts.status);
    }
    if (opts?.type !== undefined) {
      args.push("--type", opts.type);
    }
    if (opts?.label !== undefined) {
      args.push("--label", opts.label);
    }
    if (opts?.limit !== undefined) {
      args.push("--limit", String(opts.limit));
    }
    if (opts?.offset !== undefined) {
      args.push("--offset", String(opts.offset));
    }

    return runBdJson<BeadIssue[]>(args);
  }

  async function bdUpdate(id: string, opts: BdUpdateOptions): Promise<BeadIssue> {
    const hasFields =
      opts.title !== undefined ||
      opts.status !== undefined ||
      opts.priority !== undefined ||
      opts.description !== undefined ||
      opts.assignee !== undefined;

    if (!hasFields) {
      throw new BeadClientError("bdUpdate requires at least one field to update", {
        exitCode: 0,
        stderr: "",
        command: `bd update ${id}`,
      });
    }

    const args: string[] = ["update", id];

    if (opts.title !== undefined) {
      args.push("--title", opts.title);
    }
    if (opts.status !== undefined) {
      args.push("--status", opts.status);
    }
    if (opts.priority !== undefined) {
      args.push("-p", String(opts.priority));
    }
    if (opts.description !== undefined) {
      args.push("--description", opts.description);
    }
    if (opts.assignee !== undefined) {
      args.push("--assignee", opts.assignee);
    }

    return runBdJson<BeadIssue>(args);
  }

  async function bdClose(id: string, reason?: string): Promise<BeadIssue> {
    const args: string[] = ["close", id];
    if (reason !== undefined) {
      args.push("--reason", reason);
    }
    return runBdJson<BeadIssue>(args);
  }

  async function bdReady(_opts?: BdReadyOptions): Promise<BeadIssue[]> {
    return runBdJson<BeadIssue[]>(["ready"]);
  }

  async function bdDepAdd(
    source: string,
    target: string,
    depType: BeadDepType = "blocks",
  ): Promise<void> {
    await runBdJson(["dep", "add", source, target, "--type", depType]);
  }

  async function bdDepRemove(source: string, target: string): Promise<void> {
    await runBdJson(["dep", "remove", source, target]);
  }

  async function bdDepList(id: string): Promise<BeadDependency[]> {
    return runBdJson<BeadDependency[]>(["dep", "list", id]);
  }

  async function bdDepTree(id: string): Promise<BeadDependency[]> {
    return runBdJson<BeadDependency[]>(["dep", "tree", id]);
  }

  async function bdSearch(opts: BdSearchOptions): Promise<BeadIssue[]> {
    const args: string[] = ["search", opts.query];

    if (opts.type !== undefined) {
      args.push("--type", opts.type);
    }
    if (opts.status !== undefined) {
      args.push("--status", opts.status);
    }
    if (opts.limit !== undefined) {
      args.push("--limit", String(opts.limit));
    }

    return runBdJson<BeadIssue[]>(args);
  }

  async function bdLabelAdd(id: string, label: string): Promise<void> {
    await runBdJson(["label", "add", id, label]);
  }

  async function bdLabelRemove(id: string, label: string): Promise<void> {
    await runBdJson(["label", "remove", id, label]);
  }

  async function bdLabelList(id: string): Promise<string[]> {
    return runBdJson<string[]>(["label", "list", id]);
  }

  async function bdCommentAdd(
    id: string,
    body: string,
    opts?: { author?: string },
  ): Promise<BeadComment> {
    const args: string[] = ["comment", "add", id, body];

    if (opts?.author !== undefined) {
      args.push("--author", opts.author);
    }

    return runBdJson<BeadComment>(args);
  }

  async function bdCommentList(id: string): Promise<BeadComment[]> {
    return runBdJson<BeadComment[]>(["comment", "list", id]);
  }

  async function bdMoleculeCreate(
    name: string,
    description?: string,
  ): Promise<BeadMolecule> {
    const args: string[] = ["molecule", "create", name];

    if (description !== undefined) {
      args.push("--description", description);
    }

    return runBdJson<BeadMolecule>(args);
  }

  async function bdMoleculeList(): Promise<BeadMolecule[]> {
    return runBdJson<BeadMolecule[]>(["molecule", "list"]);
  }

  async function bdMoleculeShow(name: string): Promise<BeadMolecule> {
    return runBdJson<BeadMolecule>(["molecule", "show", name]);
  }

  async function bdMoleculeAddMember(
    moleculeName: string,
    beadId: string,
  ): Promise<void> {
    await runBdJson(["molecule", "add-member", moleculeName, beadId]);
  }

  async function bdDaemonStart(): Promise<{ pid: number }> {
    return runBdJson<{ pid: number }>(["daemon", "start"]);
  }

  async function bdDaemonStop(): Promise<void> {
    await runBdJson(["daemon", "stop"]);
  }

  async function bdDaemonStatus(): Promise<BeadDaemonStatus> {
    return runBdJson<BeadDaemonStatus>(["daemon", "status"]);
  }

  async function bdStatsImpl(): Promise<BeadStats> {
    return runBdJson<BeadStats>(["stats"]);
  }

  return {
    spawnBd,
    runBdJson,
    parseJsonOutput,
    isBdInstalled,
    bdVersion,
    bdInit,
    bdCreate,
    bdShow,
    bdList,
    bdUpdate,
    bdClose,
    bdReady,
    bdDepAdd,
    bdDepRemove,
    bdDepList,
    bdDepTree,
    bdSearch,
    bdLabelAdd,
    bdLabelRemove,
    bdLabelList,
    bdCommentAdd,
    bdCommentList,
    bdMoleculeCreate,
    bdMoleculeList,
    bdMoleculeShow,
    bdMoleculeAddMember,
    bdDaemonStart,
    bdDaemonStop,
    bdDaemonStatus,
    bdStats: bdStatsImpl,
  };
}
