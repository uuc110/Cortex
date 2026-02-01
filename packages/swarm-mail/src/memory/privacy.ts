export interface FilterableMemory {
  readonly id: string;
  readonly tags: string;
  readonly information: string;
}

const PRIVATE_TAG = "private";
const PRIVATE_XML_PATTERN = /<private>[\s\S]*?<\/private>/gi;

const SENSITIVE_PATTERNS: RegExp[] = [
  /password\s*[:=]\s*\S+/gi,
  /api[_-]?key\s*[:=]\s*\S+/gi,
  /token\s*[:=]\s*\S+/gi,
  /secret\s*[:=]\s*\S+/gi,
  /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,
];

export function isPrivate(tags: string, content?: string): boolean {
  if (tags) {
    const tagList = tags.split(",").map((t) => t.trim().toLowerCase());
    if (tagList.includes(PRIVATE_TAG)) return true;
  }
  if (content && containsPrivateTag(content)) return true;
  return false;
}

export function containsPrivateTag(content: string): boolean {
  if (!content) return false;
  // Use fresh regex to avoid stale lastIndex from global flag
  return /<private>[\s\S]*?<\/private>/i.test(content);
}

export function stripSensitive(text: string): string {
  let result = text;
  result = result.replace(PRIVATE_XML_PATTERN, "[REDACTED]");
  for (const pattern of SENSITIVE_PATTERNS) {
    result = result.replace(pattern, "[REDACTED]");
  }
  return result;
}

export function isFullyRedacted(text: string): boolean {
  const stripped = text.replace(/\[REDACTED\]/g, "").trim();
  return stripped.length === 0;
}

export function filterMemoriesForContext<T extends FilterableMemory>(
  memories: T[],
): T[] {
  return memories
    .filter((m) => !isPrivate(m.tags, m.information))
    .map((m) => ({ ...m, information: stripSensitive(m.information) }))
    .filter((m) => !isFullyRedacted(m.information));
}
