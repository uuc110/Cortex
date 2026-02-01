import { describe, expect, mock, test } from "bun:test";

import { createLearningPromoter } from "../learning-promoter.js";

const buildDeps = () => ({
  memoryRecall: mock(async () => []) as any,
  memoryStore: mock(async () => undefined) as any,
  eventStore: { emit: mock((..._args: any[]) => undefined) as any },
});

describe("Learning promoter", () => {
  test("No candidates returns zeros", async () => {
    const deps = buildDeps();
    const promoter = createLearningPromoter(deps);
    const result = await promoter.promoteLearnings([]);
    expect(result.promoted).toBe(0);
    expect(result.skipped).toBe(0);
  });

  test("Confidence 0.8 promoted", async () => {
    const deps = buildDeps();
    const promoter = createLearningPromoter(deps);
    const result = await promoter.promoteLearnings([
      { info: "Learn", tags: "tag", confidence: 0.8, age: 1 },
    ]);
    expect(result.promoted).toBe(1);
  });

  test("Confidence 0.5 skipped", async () => {
    const deps = buildDeps();
    const promoter = createLearningPromoter(deps);
    const result = await promoter.promoteLearnings([
      { info: "Learn", tags: "tag", confidence: 0.5, age: 1 },
    ]);
    expect(result.skipped).toBe(1);
  });

  test("Age > 30 skipped", async () => {
    const deps = buildDeps();
    const promoter = createLearningPromoter(deps);
    const result = await promoter.promoteLearnings([
      { info: "Learn", tags: "tag", confidence: 0.9, age: 31 },
    ]);
    expect(result.skipped).toBe(1);
  });

  test("Duplicate skipped", async () => {
    const deps = buildDeps();
    deps.memoryRecall.mockImplementation(async () => [
      { similarity: 0.96 },
    ]);
    const promoter = createLearningPromoter(deps);
    const result = await promoter.promoteLearnings([
      { info: "Learn", tags: "tag", confidence: 0.9, age: 1 },
    ]);
    expect(result.skipped).toBe(1);
    expect(result.promoted).toBe(0);
  });

  test("Store fails captures error", async () => {
    const deps = buildDeps();
    deps.memoryStore.mockImplementation(async () => {
      throw new Error("store failed");
    });
    const promoter = createLearningPromoter(deps);
    const result = await promoter.promoteLearnings([
      { info: "Learn", tags: "tag", confidence: 0.9, age: 1 },
    ]);
    expect(result.errors.length).toBe(1);
  });

  test("Events emitted for stored learning", async () => {
    const deps = buildDeps();
    const promoter = createLearningPromoter(deps);
    await promoter.promoteLearnings([
      { info: "Learn", tags: "tag", confidence: 0.9, age: 1 },
    ]);
    expect(deps.eventStore.emit.mock.calls.length).toBe(1);
    expect(deps.eventStore.emit.mock.calls[0][0]).toBe("learning_stored");
  });

  test("Multiple candidates counts correctly", async () => {
    const deps = buildDeps();
    const promoter = createLearningPromoter(deps);
    const result = await promoter.promoteLearnings([
      { info: "Learn1", tags: "tag", confidence: 0.9, age: 1 },
      { info: "Learn2", tags: "tag", confidence: 0.6, age: 1 },
      { info: "Learn3", tags: "tag", confidence: 0.9, age: 35 },
    ]);
    expect(result.promoted).toBe(1);
    expect(result.skipped).toBe(2);
  });

  test("Duplicate check uses long_term collection", async () => {
    const deps = buildDeps();
    const promoter = createLearningPromoter(deps);
    await promoter.promoteLearnings([
      { info: "Learn", tags: "tag", confidence: 0.9, age: 1 },
    ]);
    const [_, opts] = deps.memoryRecall.mock.calls[0];
    expect(opts.collection).toBe("long_term");
  });

  test("Missing confidence defaults to skip", async () => {
    const deps = buildDeps();
    const promoter = createLearningPromoter(deps);
    const result = await promoter.promoteLearnings([
      { info: "Learn", tags: "tag" },
    ]);
    expect(result.skipped).toBe(1);
  });
});
