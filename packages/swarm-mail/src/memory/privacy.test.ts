import { describe, expect, test } from "bun:test";
import {
  isPrivate,
  stripSensitive,
  containsPrivateTag,
  isFullyRedacted,
  filterMemoriesForContext,
  type FilterableMemory,
} from "./privacy.js";

describe("isPrivate", () => {
  test("returns true when tags include 'private'", () => {
    expect(isPrivate("private,auth")).toBe(true);
  });

  test("returns true when content has <private> XML tag", () => {
    expect(isPrivate("auth", "<private>secret stuff</private>")).toBe(true);
  });

  test("returns false for normal content", () => {
    expect(isPrivate("auth", "normal content")).toBe(false);
  });

  test("returns false for empty tags and no content", () => {
    expect(isPrivate("")).toBe(false);
  });

  test("case insensitive tag check", () => {
    expect(isPrivate("Private,auth")).toBe(true);
  });

  test("handles whitespace in tags", () => {
    expect(isPrivate(" private , auth ")).toBe(true);
  });

  test("returns false when 'private' is substring of another tag", () => {
    expect(isPrivate("private-key,auth")).toBe(false);
  });
});

describe("containsPrivateTag", () => {
  test("detects <private> XML tag", () => {
    expect(containsPrivateTag("<private>hidden</private>")).toBe(true);
  });

  test("detects multiline <private> content", () => {
    expect(containsPrivateTag("before\n<private>\nhidden\n</private>\nafter")).toBe(true);
  });

  test("returns false for normal text", () => {
    expect(containsPrivateTag("normal text")).toBe(false);
  });

  test("case insensitive", () => {
    expect(containsPrivateTag("<PRIVATE>hidden</PRIVATE>")).toBe(true);
  });

  test("handles empty string", () => {
    expect(containsPrivateTag("")).toBe(false);
  });
});

describe("stripSensitive", () => {
  test("strips password patterns", () => {
    expect(stripSensitive("password=abc123 normal text")).toBe("[REDACTED] normal text");
  });

  test("strips password with colon", () => {
    expect(stripSensitive("password: abc123 normal")).toBe("[REDACTED] normal");
  });

  test("strips api_key patterns", () => {
    expect(stripSensitive("api_key=sk-123abc normal")).toBe("[REDACTED] normal");
  });

  test("strips api-key with hyphen", () => {
    expect(stripSensitive("api-key=sk-123abc normal")).toBe("[REDACTED] normal");
  });

  test("strips apikey (no separator)", () => {
    expect(stripSensitive("apikey=sk-123abc normal")).toBe("[REDACTED] normal");
  });

  test("strips token patterns", () => {
    expect(stripSensitive("token=eyJhbGci normal")).toBe("[REDACTED] normal");
  });

  test("strips secret patterns", () => {
    expect(stripSensitive("secret=mysecret normal")).toBe("[REDACTED] normal");
  });

  test("strips email addresses", () => {
    expect(stripSensitive("contact user@example.com for help")).toBe("contact [REDACTED] for help");
  });

  test("strips <private> XML tags", () => {
    expect(stripSensitive("<private>hidden</private> visible")).toBe("[REDACTED] visible");
  });

  test("passes through clean text unchanged", () => {
    expect(stripSensitive("no sensitive data here")).toBe("no sensitive data here");
  });

  test("strips multiple sensitive patterns in one string", () => {
    const result = stripSensitive("password=abc token=xyz normal text");
    expect(result).toBe("[REDACTED] [REDACTED] normal text");
  });

  test("handles empty string", () => {
    expect(stripSensitive("")).toBe("");
  });
});

describe("isFullyRedacted", () => {
  test("returns true for only [REDACTED]", () => {
    expect(isFullyRedacted("[REDACTED]")).toBe(true);
  });

  test("returns true for multiple [REDACTED] with whitespace", () => {
    expect(isFullyRedacted("[REDACTED] [REDACTED]")).toBe(true);
  });

  test("returns false when real content remains", () => {
    expect(isFullyRedacted("[REDACTED] normal text")).toBe(false);
  });

  test("returns true for empty/whitespace-only string", () => {
    expect(isFullyRedacted("")).toBe(true);
    expect(isFullyRedacted("   ")).toBe(true);
  });
});

describe("filterMemoriesForContext", () => {
  const makeMem = (id: string, tags: string, information: string): FilterableMemory => ({
    id,
    tags,
    information,
  });

  test("excludes private-tagged memories", () => {
    const memories = [
      makeMem("1", "private,auth", "secret stuff"),
      makeMem("2", "auth", "normal auth info"),
    ];

    const filtered = filterMemoriesForContext(memories);
    expect(filtered).toHaveLength(1);
    expect(filtered[0].id).toBe("2");
  });

  test("strips sensitive data from remaining memories", () => {
    const memories = [
      makeMem("1", "auth", "password=abc123 use oauth"),
    ];

    const filtered = filterMemoriesForContext(memories);
    expect(filtered).toHaveLength(1);
    expect(filtered[0].information).toBe("[REDACTED] use oauth");
  });

  test("excludes fully-redacted memories after stripping", () => {
    const memories = [
      makeMem("1", "auth", "password=abc123"),
    ];

    const filtered = filterMemoriesForContext(memories);
    expect(filtered).toHaveLength(0);
  });

  test("passes through clean memories unchanged", () => {
    const memories = [
      makeMem("1", "auth", "use oauth 2.0 for authentication"),
    ];

    const filtered = filterMemoriesForContext(memories);
    expect(filtered).toHaveLength(1);
    expect(filtered[0].information).toBe("use oauth 2.0 for authentication");
  });

  test("handles empty array", () => {
    expect(filterMemoriesForContext([])).toEqual([]);
  });

  test("handles memories with empty tags", () => {
    const memories = [
      makeMem("1", "", "normal content"),
    ];

    const filtered = filterMemoriesForContext(memories);
    expect(filtered).toHaveLength(1);
  });

  test("excludes memories with <private> in content even if tags are clean", () => {
    const memories = [
      makeMem("1", "auth", "<private>secret api key</private> normal"),
    ];

    const filtered = filterMemoriesForContext(memories);
    expect(filtered).toHaveLength(0);
  });

  test("full pipeline: mixed memories", () => {
    const memories = [
      makeMem("private-tagged", "private", "my passwords"),
      makeMem("has-secret", "auth", "password=abc123"),
      makeMem("partial-sensitive", "auth", "use api-key=sk-123 for oauth"),
      makeMem("clean", "docs", "read the documentation"),
    ];

    const filtered = filterMemoriesForContext(memories);
    expect(filtered).toHaveLength(2);
    expect(filtered[0].id).toBe("partial-sensitive");
    expect(filtered[0].information).toBe("use [REDACTED] for oauth");
    expect(filtered[1].id).toBe("clean");
    expect(filtered[1].information).toBe("read the documentation");
  });
});
