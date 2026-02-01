import { describe, expect, test, beforeEach, mock } from "bun:test";

import { createContextLoader } from "../context-loader.js";

describe("createContextLoader", () => {
  let beadClient: {
    show: ReturnType<typeof mock>;
    list: ReturnType<typeof mock>;
    listDeps?: ReturnType<typeof mock>;
  };
  let memoryRecall: ReturnType<typeof mock>;

  beforeEach(() => {
    beadClient = {
      show: mock(async (id: string) => ({
        id,
        title: `Bead ${id}`,
        description: "desc",
        status: "open",
        priority: 1,
        parent_id: "epic-1",
      })),
      list: mock(async () => [
        {
          id: "bead-1",
          title: "Self",
          description: "",
          status: "open",
          priority: 1,
        },
        {
          id: "bead-2",
          title: "Sibling",
          description: "",
          status: "open",
          priority: 1,
        },
      ]),
      listDeps: mock(async () => [
        {
          id: "dep-1",
          title: "Dependency",
          description: "",
          status: "blocked",
          priority: 1,
        },
      ]),
    };
    memoryRecall = mock(async () => [{ info: "hint" }]);
  });

  test("loads bead successfully", async () => {
    const loader = createContextLoader({
      beadClient,
      memoryRecall,
      projectPath: "/tmp/project",
      projectKey: "proj-key",
    });
    const context = await loader.loadWorkerContext("bead-1");
    expect(context.bead.id).toBe("bead-1");
    expect(context.bead.title).toBe("Bead bead-1");
  });

  test("loads epic from parentId", async () => {
    const loader = createContextLoader({
      beadClient,
      memoryRecall,
      projectPath: "/tmp/project",
      projectKey: "proj-key",
    });
    const context = await loader.loadWorkerContext("bead-1");
    expect(context.epic?.id).toBe("epic-1");
  });

  test("loads siblings excluding own bead", async () => {
    const loader = createContextLoader({
      beadClient,
      memoryRecall,
      projectPath: "/tmp/project",
      projectKey: "proj-key",
    });
    const context = await loader.loadWorkerContext("bead-1");
    expect(context.siblings.map((sib) => sib.id)).toEqual(["bead-2"]);
  });

  test("loads dependencies", async () => {
    const loader = createContextLoader({
      beadClient,
      memoryRecall,
      projectPath: "/tmp/project",
      projectKey: "proj-key",
    });
    const context = await loader.loadWorkerContext("bead-1");
    expect(context.dependencies[0]?.id).toBe("dep-1");
  });

  test("loads memory context", async () => {
    const loader = createContextLoader({
      beadClient,
      memoryRecall,
      projectPath: "/tmp/project",
      projectKey: "proj-key",
    });
    const context = await loader.loadWorkerContext("bead-1");
    expect(context.memoryContext.length).toBe(1);
  });

  test("falls back when bead unavailable", async () => {
    beadClient.show = mock(async () => {
      throw new Error("fail");
    });
    const loader = createContextLoader({
      beadClient,
      memoryRecall,
      projectPath: "/tmp/project",
      projectKey: "proj-key",
    });
    const context = await loader.loadWorkerContext("bead-1");
    expect(context.bead.title).toBe("Unknown");
    expect(context.bead.status).toBe("unknown");
  });

  test("no parent yields null epic", async () => {
    beadClient.show = mock(async (id: string) => ({
      id,
      title: `Bead ${id}`,
      description: "desc",
      status: "open",
      priority: 1,
    }));
    const loader = createContextLoader({
      beadClient,
      memoryRecall,
      projectPath: "/tmp/project",
      projectKey: "proj-key",
    });
    const context = await loader.loadWorkerContext("bead-1");
    expect(context.epic).toBe(null);
  });

  test("no deps yields empty array", async () => {
    beadClient.listDeps = undefined;
    const loader = createContextLoader({
      beadClient,
      memoryRecall,
      projectPath: "/tmp/project",
      projectKey: "proj-key",
    });
    const context = await loader.loadWorkerContext("bead-1");
    expect(context.dependencies).toEqual([]);
  });

  test("sibling list failure yields empty array", async () => {
    beadClient.list = mock(async () => {
      throw new Error("fail");
    });
    const loader = createContextLoader({
      beadClient,
      memoryRecall,
      projectPath: "/tmp/project",
      projectKey: "proj-key",
    });
    const context = await loader.loadWorkerContext("bead-1");
    expect(context.siblings).toEqual([]);
  });

  test("memory recall failure yields empty array", async () => {
    memoryRecall = mock(async () => {
      throw new Error("fail");
    });
    const loader = createContextLoader({
      beadClient,
      memoryRecall,
      projectPath: "/tmp/project",
      projectKey: "proj-key",
    });
    const context = await loader.loadWorkerContext("bead-1");
    expect(context.memoryContext).toEqual([]);
  });
});
