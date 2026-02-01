# Memory Enhancement Spec: Backporting Cortex Improvements to Hivemind

**Goal:** Enhance swarm-tools' hivemind memory system with 4 proven improvements from Cortex.

---

## Current Hivemind Capabilities

swarm-tools' hivemind (in `packages/swarm-mail/src/memory/`) is a comprehensive semantic memory system. Here's what already works:

### Core Memory Operations

| Feature | Implementation | Notes |
|---------|---------------|-------|
| **Store** | `adapter.store(info, { tags })` | Stores with Ollama embedding (mxbai-embed-large, 1024d) |
| **Find** | `adapter.find(query, { limit })` | Vector similarity search via libSQL vec extension |
| **Get** | `adapter.get(id)` | Retrieve by ID |
| **Remove** | `adapter.remove(id)` | Delete memory |
| **Validate** | `adapter.validate(id)` | Reset 90-day decay timer |
| **Stats** | `adapter.stats()` | Collection statistics |

### Smart Operations (Wave 1-3)

| Feature | Implementation | File |
|---------|---------------|------|
| **Smart upsert** (Mem0 pattern) | LLM decides: ADD/UPDATE/DELETE/NOOP | `memory/memory-operations.ts` |
| **Auto-tagging** | LLM extracts tags from content | `memory/auto-tagger.ts` |
| **Memory linking** (Zettelkasten) | Auto-link semantically related memories | `memory/memory-linking.ts` |
| **Entity extraction** (A-MEM) | Extract entities + relationships | `memory/entity-extraction.ts` |
| **Temporal queries** | `findValidAt(query, date)`, supersession chains | `memory/adapter.ts` |

### Schema (libSQL via Drizzle ORM)

```sql
-- Core memories table
CREATE TABLE memories (
  id TEXT PRIMARY KEY,
  content TEXT NOT NULL,
  tags TEXT,                    -- Comma-separated
  metadata TEXT,                -- JSON
  embedding F32_BLOB(1024),     -- libSQL native vector
  created_at INTEGER NOT NULL,  -- Unix ms
  updated_at INTEGER NOT NULL,
  collection TEXT DEFAULT 'default',
  confidence REAL DEFAULT 1.0,
  valid_from INTEGER,           -- Temporal: start validity
  valid_until INTEGER,          -- Temporal: end validity (NULL = current)
  superseded_by TEXT,           -- Version chain pointer
  auto_tags TEXT,               -- JSON array of LLM-extracted tags
  keywords TEXT                 -- Searchable keyword index
);

-- Linking tables
CREATE TABLE memory_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_memory_id TEXT NOT NULL,
  target_memory_id TEXT NOT NULL,
  link_type TEXT NOT NULL,     -- 'related', 'supports', 'contradicts', 'extends'
  score REAL,                  -- Similarity score
  created_at INTEGER NOT NULL
);

-- Entity tables (knowledge graph)
CREATE TABLE entities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  entity_type TEXT NOT NULL,   -- 'person', 'technology', 'concept', etc.
  created_at INTEGER NOT NULL
);

CREATE TABLE relationships (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  from_entity_id INTEGER NOT NULL,
  to_entity_id INTEGER NOT NULL,
  relationship_type TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE memory_entities (
  memory_id TEXT NOT NULL,
  entity_id INTEGER NOT NULL,
  PRIMARY KEY (memory_id, entity_id)
);
```

### Session Indexing (CASS)

| Feature | Implementation | Notes |
|---------|---------------|-------|
| **10+ agent formats** | SessionParser with format detection | Claude, Cursor, Codex, Gemini, Aider, ChatGPT, Cline, OpenCode, Amp, Pi-Agent |
| **Chunk processing** | 512-token sliding window with embeddings | `sessions/chunk-processor.ts` |
| **Staleness detection** | Track mtime for re-indexing triggers | `sessions/staleness-detector.ts` |
| **Pagination** | Field projection for compact output | `sessions/pagination.ts` |
| **cass_* tools** | search, view, expand, index, health, stats | Plugin MCP tools |

### FTS Fallback

When Ollama is unavailable, hivemind falls back to FTS5 full-text search. This is already implemented in `memory/store.ts`.

---

## Cortex Improvements to Backport

### 1. Tag 80/20 Boost for Memory Ranking

**Source:** `cortex/src/memory/vector-search.ts` lines 79-143

**Problem:** Pure semantic similarity misses relevant results that share explicit tags. A memory tagged "oauth,tokens" should rank higher for a query about "oauth tokens" than a semantically similar but differently-tagged memory.

**Cortex implementation:**

```typescript
// cortex/src/memory/vector-search.ts
function computeTagMatchRatio(queryText: string, tags: string): number {
  const queryTokens = queryText.toLowerCase().split(/[\s,]+/).filter(t => t.length > 0);
  if (queryTokens.length === 0) return 0;
  const tagList = tags.toLowerCase().split(",").map(t => t.trim()).filter(t => t.length > 0);
  let matches = 0;
  for (const qt of queryTokens) {
    if (tagList.some(tag => tag.includes(qt) || qt.includes(tag))) {
      matches++;
    }
  }
  return matches / queryTokens.length;
}

// In vectorSearch():
if (queryText) {
  const tagMatchRatio = computeTagMatchRatio(queryText, row.tags);
  similarity = tagMatchRatio * 0.8 + contentSim * 0.2;  // 80% tag, 20% semantic
} else {
  similarity = contentSim;  // Pure semantic when no query text
}
```

**Hivemind integration plan:**

1. Add `computeTagMatchRatio()` helper to `memory/store.ts`
2. Modify `find()` in `memory/adapter.ts` to apply 80/20 weighting when `queryText` is provided
3. Keep pure semantic similarity as fallback when no explicit tags in query
4. Add config option: `memory.tag_boost_ratio` (default 0.8) for tuning

**Schema changes:** None — uses existing `tags` column.

**Test cases:**
- Query "oauth tokens" should rank memory tagged "oauth,tokens" higher than untagged semantically similar memory
- Query without keywords should use pure semantic similarity
- Tag partial match works ("auth" matches "authentication")
- Empty tags don't break ranking

---

### 2. Decay Tiers (Hot/Warm/Cold)

**Source:** `cortex/src/memory/vector-search.ts` lines 4-36

**Problem:** Hivemind has a single 90-day decay half-life. This is too coarse — recently accessed memories should be prioritized, while old, rarely-used memories should decay faster.

**Cortex implementation:**

```typescript
// cortex/src/memory/vector-search.ts
export type DecayTier = "hot" | "warm" | "cold";

const DECAY_HOT_DAYS = 7;       // Last 7 days
const DECAY_WARM_DAYS = 30;      // 8-30 days
const DECAY_FREQUENCY_BONUS_THRESHOLD = 10;  // Frequently accessed memories get bonus
const DECAY_FREQUENCY_BONUS_DAYS = 7;        // Extend cold boundary by 7 days

export function buildDecayTierSql(tier: DecayTier): { clause: string; params: (string | number)[] } {
  const now = new Date();
  const hotCutoff = new Date(now.getTime() - DECAY_HOT_DAYS * 86400000).toISOString();
  const warmCutoff = new Date(now.getTime() - DECAY_WARM_DAYS * 86400000).toISOString();
  const coldWithBonus = new Date(
    now.getTime() - (DECAY_WARM_DAYS + DECAY_FREQUENCY_BONUS_DAYS) * 86400000,
  ).toISOString();

  switch (tier) {
    case "hot":
      return {
        clause: `(last_accessed IS NOT NULL AND last_accessed >= ?)`,
        params: [hotCutoff],
      };
    case "warm":
      return {
        clause: `(last_accessed IS NOT NULL AND last_accessed < ? AND last_accessed >= ?)`,
        params: [hotCutoff, warmCutoff],
      };
    case "cold":
      return {
        clause: `(last_accessed IS NULL OR (last_accessed < ? AND (access_count < ? OR last_accessed < ?)))`,
        params: [warmCutoff, DECAY_FREQUENCY_BONUS_THRESHOLD, coldWithBonus],
      };
  }
}
```

**Hivemind integration plan:**

1. Add `last_accessed` and `access_count` columns to `memories` table (see Enhancement #3)
2. Add `DecayTier` type and `buildDecayTierSql()` to memory store
3. Extend `find()` options with optional `decayTier` parameter
4. Apply tier filtering before vector similarity search (reduces scan set)
5. Default behavior: no tier filtering (backward compatible)

**Schema changes:** See Enhancement #3 (access tracking).

**Test cases:**
- Hot tier returns only memories accessed in last 7 days
- Warm tier returns memories accessed 8-30 days ago
- Cold tier returns old memories, with frequency bonus extending boundary
- No tier specified returns all memories (backward compatible)
- Frequently accessed memories (≥10 times) get extended warm period

---

### 3. Access Tracking

**Source:** `cortex/src/memory/long-term.ts` lines 55-68

**Problem:** Hivemind doesn't track how often memories are accessed. This makes it impossible to:
- Know which memories are actually useful
- Apply frequency-based ranking boosts
- Protect frequently-used memories from cleanup
- Feed the decay tier system

**Cortex implementation:**

```typescript
// cortex/src/memory/long-term.ts
export function trackAccess(ids: string[]): void {
  if (ids.length === 0) return;
  const db = getDb();
  const now = new Date().toISOString();
  const stmt = db.prepare(
    `UPDATE long_memory SET last_accessed = ?, access_count = access_count + 1 WHERE id = ?`,
  );
  const runBatch = db.transaction(() => {
    for (const id of ids) {
      stmt.run(now, id);
    }
  });
  runBatch();
}
```

**Hivemind integration plan:**

1. **Schema migration** — Add columns to `memories` table:
   ```sql
   ALTER TABLE memories ADD COLUMN last_accessed INTEGER;  -- Unix ms timestamp
   ALTER TABLE memories ADD COLUMN access_count INTEGER DEFAULT 0;
   ```

2. **Track on find()** — After `find()` returns results, batch-update `last_accessed` and increment `access_count`:
   ```typescript
   // In adapter.find(), after getting results:
   if (opts?.trackAccess !== false) {
     await trackAccess(results.map(r => r.id));
   }
   ```

3. **Track on get()** — Single memory access:
   ```typescript
   // In adapter.get():
   await trackAccess([id]);
   ```

4. **Cleanup protection** — Never auto-cleanup memories with `access_count > N` (configurable, default 5)

5. **Stats enrichment** — Include access stats in `adapter.stats()`:
   ```typescript
   {
     total: 1234,
     mostAccessed: { id, content_preview, access_count },
     avgAccessCount: 3.2,
     neverAccessed: 456,
   }
   ```

**Schema changes:**

```sql
-- Migration v_access_tracking
ALTER TABLE memories ADD COLUMN last_accessed INTEGER;
ALTER TABLE memories ADD COLUMN access_count INTEGER DEFAULT 0;
CREATE INDEX idx_memories_last_accessed ON memories(last_accessed);
CREATE INDEX idx_memories_access_count ON memories(access_count);
```

**Test cases:**
- `find()` increments access_count on returned results
- `get()` increments access_count for single memory
- `trackAccess` is batched (single transaction)
- `last_accessed` timestamp is updated on each access
- Stats include access metrics
- Cleanup respects access_count threshold
- `trackAccess: false` option skips tracking

---

### 4. Privacy XML Filter

**Source:** `cortex/src/memory/privacy.ts`

**Problem:** Hivemind stores and returns memories as-is, including potentially sensitive data. When memories are injected into agent context (compaction hook, context injection), sensitive data like passwords, API keys, and tokens could leak.

**Cortex implementation:**

```typescript
// cortex/src/memory/privacy.ts
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
  const tagList = tags.split(",").map(t => t.trim().toLowerCase());
  if (tagList.includes(PRIVATE_TAG)) return true;
  if (content && PRIVATE_XML_PATTERN.test(content)) return true;
  return false;
}

export function stripSensitive(text: string): string {
  let result = text;
  result = result.replace(PRIVATE_XML_PATTERN, "[REDACTED]");
  for (const pattern of SENSITIVE_PATTERNS) {
    result = result.replace(pattern, "[REDACTED]");
  }
  return result;
}

export function filterMemoriesForContext<T extends FilterableMemory>(memories: T[]): T[] {
  return memories
    .filter(m => !isPrivate(m.tags, m.information))
    .map(m => ({ ...m, information: stripSensitive(m.information) }))
    .filter(m => !isFullyPrivate(m.information));
}
```

**Hivemind integration plan:**

1. **Create `memory/privacy.ts`** in swarm-mail package with:
   - `isPrivate(tags, content)` — Check if memory is marked private
   - `stripSensitive(text)` — Remove passwords, API keys, tokens, secrets, emails
   - `containsPrivateTag(content)` — Check for `<private>...</private>` XML tags
   - `isFullyPrivate(content)` — Check if content is entirely redacted
   - `filterMemoriesForContext(memories)` — Full pipeline for context injection

2. **Wire into compaction hook** — Filter memories before injecting into compacted context:
   ```typescript
   // In compaction-hook.ts:
   import { filterMemoriesForContext } from "swarm-mail";
   
   const rawMemories = await adapter.find(query);
   const safeMemories = filterMemoriesForContext(rawMemories);
   // Inject safeMemories into context
   ```

3. **Wire into hivemind_find** — Apply privacy filter before returning results to agents:
   ```typescript
   // In hivemind-tools.ts:
   const results = await adapter.find(query);
   const filtered = filterMemoriesForContext(results);
   return filtered;
   ```

4. **Store-time warning** — When storing content with sensitive patterns, emit a warning event:
   ```typescript
   if (containsPrivateTag(content) || hasSensitivePatterns(content)) {
     // Emit memory_stored event with sensitive_content_detected: true
   }
   ```

**Schema changes:** None — privacy is a runtime filter, not stored state.

**Test cases:**
- `<private>API_KEY=sk-123</private>` → `[REDACTED]`
- Memory tagged "private" is excluded from context
- Passwords, API keys, tokens, secrets are stripped
- Email addresses are stripped
- Non-sensitive content passes through unchanged
- Fully-redacted memories are excluded entirely
- `filterMemoriesForContext` is composable with find results

---

## Migration Plan for Existing Hivemind Data

### Step 1: Schema Migration

Run as part of swarm-mail auto-migration (existing pattern in `memory/migrations.ts`):

```typescript
// New migration: add_access_tracking
export async function migrateAccessTracking(db: SwarmDb): Promise<void> {
  // Check if columns exist (idempotent)
  const hasLastAccessed = await columnExists(db, "memories", "last_accessed");
  if (!hasLastAccessed) {
    await db.run(sql`ALTER TABLE memories ADD COLUMN last_accessed INTEGER`);
    await db.run(sql`ALTER TABLE memories ADD COLUMN access_count INTEGER DEFAULT 0`);
    await db.run(sql`CREATE INDEX IF NOT EXISTS idx_memories_last_accessed ON memories(last_accessed)`);
    await db.run(sql`CREATE INDEX IF NOT EXISTS idx_memories_access_count ON memories(access_count)`);
  }
}
```

### Step 2: Backfill Access Data

For existing memories, set initial access data based on what we know:

```sql
-- Set last_accessed = updated_at for memories that have been validated
UPDATE memories 
SET last_accessed = updated_at, access_count = 1
WHERE last_accessed IS NULL 
  AND updated_at IS NOT NULL;

-- All others get access_count = 0 (never accessed)
-- last_accessed stays NULL (cold tier)
```

### Step 3: Verify

```typescript
// Verify migration
const stats = await adapter.stats();
console.log(`Total memories: ${stats.total}`);
console.log(`With access data: ${stats.withAccessTracking}`);
console.log(`Without access data: ${stats.withoutAccessTracking}`);
```

### Rollback

All changes are additive (new columns with DEFAULT NULL/0). To rollback:
- Access tracking: Ignore `last_accessed` and `access_count` columns
- Tag boost: Revert to pure semantic similarity
- Decay tiers: Don't pass `decayTier` option
- Privacy filter: Don't call `filterMemoriesForContext()`

No data is lost in either direction.

---

## Configuration

Add to swarm-tools config:

```json
{
  "memory": {
    "tag_boost_ratio": 0.8,              // Tag vs semantic weight (0.0 = pure semantic, 1.0 = pure tag)
    "semantic_boost_ratio": 0.2,         // Inverse of tag_boost_ratio (must sum to 1.0)
    "decay_hot_days": 7,                 // Hot tier boundary
    "decay_warm_days": 30,               // Warm tier boundary  
    "decay_frequency_bonus_threshold": 10, // Access count for frequency bonus
    "decay_frequency_bonus_days": 7,     // Extra days before cold for frequent memories
    "track_access": true,                // Enable/disable access tracking
    "privacy_filter": true,              // Enable/disable privacy filtering
    "cleanup_min_access_count": 5        // Don't cleanup memories with ≥N accesses
  }
}
```

---

## Implementation Order

| Step | Task | Depends On | Effort |
|------|------|-----------|--------|
| 1 | Schema migration (access tracking columns) | — | S |
| 2 | `trackAccess()` function + wire into find/get | Step 1 | S |
| 3 | `computeTagMatchRatio()` + 80/20 boost in find | — | M |
| 4 | `DecayTier` type + `buildDecayTierSql()` + wire into find | Steps 1-2 | M |
| 5 | `privacy.ts` module (isPrivate, stripSensitive, filterMemoriesForContext) | — | M |
| 6 | Wire privacy filter into compaction hook + hivemind_find | Step 5 | S |
| 7 | Config options (tag_boost_ratio, decay tiers, etc.) | Steps 3-4 | S |
| 8 | Backfill migration for existing data | Step 1 | S |
| 9 | Port Cortex tests (93 memory tests) | Steps 1-6 | L |

**Estimated total effort:** ~2 weeks (1 developer)

---

## Verification Checklist

After implementation, verify:

- [ ] `hivemind_find("oauth tokens")` ranks tag-matched memories 80/20
- [ ] `hivemind_find("auth", { decayTier: "hot" })` returns only recently-accessed
- [ ] `hivemind_stats()` includes access_count metrics
- [ ] Compaction hook strips `<private>...</private>` from context
- [ ] `hivemind_find` strips passwords/keys from results
- [ ] Existing memories still accessible (no data loss)
- [ ] FTS fallback still works when Ollama unavailable
- [ ] Smart upsert still works (no regression)
- [ ] Auto-linking still works (no regression)
- [ ] Entity extraction still works (no regression)
- [ ] All 93 Cortex memory tests pass (ported)
- [ ] `swarm doctor` reports memory health with new metrics
