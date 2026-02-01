import { describe, expect, test } from "bun:test";

import { selectMode } from "../cortex-modes.js";

describe("selectMode()", () => {
  test("selects quick for small, simple task sets", () => {
    const result = selectMode({
      subtaskCount: 3,
      hasExternalDeps: false,
      hasResearchContext: false,
      maxComplexity: 3,
    });

    expect(result.mode).toBe("quick");
  });

  test("selects project when subtask count exceeds limit", () => {
    const result = selectMode({
      subtaskCount: 8,
      hasExternalDeps: false,
      hasResearchContext: false,
      maxComplexity: 2,
    });

    expect(result.mode).toBe("project");
    expect(result.reason).toContain("8 subtasks");
  });

  test("selects project when research context is present", () => {
    const result = selectMode({
      subtaskCount: 2,
      hasExternalDeps: false,
      hasResearchContext: true,
      maxComplexity: 1,
    });

    expect(result.mode).toBe("project");
    expect(result.reason).toContain("Research");
  });

  test("selects project when external deps are present", () => {
    const result = selectMode({
      subtaskCount: 2,
      hasExternalDeps: true,
      hasResearchContext: false,
      maxComplexity: 1,
    });

    expect(result.mode).toBe("project");
    expect(result.reason).toContain("External");
  });

  test("selects project when max complexity exceeds threshold", () => {
    const result = selectMode({
      subtaskCount: 3,
      hasExternalDeps: false,
      hasResearchContext: false,
      maxComplexity: 5,
    });

    expect(result.mode).toBe("project");
    expect(result.reason).toContain("complexity");
  });

  test("boundary: exactly 5 tasks is still quick", () => {
    const result = selectMode({
      subtaskCount: 5,
      hasExternalDeps: false,
      hasResearchContext: false,
      maxComplexity: 3,
    });

    expect(result.mode).toBe("quick");
  });

  test("boundary: 6 tasks triggers project", () => {
    const result = selectMode({
      subtaskCount: 6,
      hasExternalDeps: false,
      hasResearchContext: false,
      maxComplexity: 3,
    });

    expect(result.mode).toBe("project");
  });

  test("boundary: complexity 4 is still quick", () => {
    const result = selectMode({
      subtaskCount: 3,
      hasExternalDeps: false,
      hasResearchContext: false,
      maxComplexity: 4,
    });

    expect(result.mode).toBe("quick");
  });

  test("research context takes priority over small task count", () => {
    const result = selectMode({
      subtaskCount: 1,
      hasExternalDeps: false,
      hasResearchContext: true,
      maxComplexity: 1,
    });

    expect(result.mode).toBe("project");
  });

  test("always returns a reason string", () => {
    const quickResult = selectMode({
      subtaskCount: 2,
      hasExternalDeps: false,
      hasResearchContext: false,
      maxComplexity: 2,
    });

    const projectResult = selectMode({
      subtaskCount: 10,
      hasExternalDeps: true,
      hasResearchContext: true,
      maxComplexity: 5,
    });

    expect(quickResult.reason.length).toBeGreaterThan(0);
    expect(projectResult.reason.length).toBeGreaterThan(0);
  });
});
