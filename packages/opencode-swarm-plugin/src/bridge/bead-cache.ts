export type CacheTier = "hot" | "warm" | "cold";

export type WriteOperation =
  | "create"
  | "update"
  | "close"
  | "depAdd"
  | "depRemove"
  | "labelAdd"
  | "labelRemove"
  | "commentAdd"
  | "moleculeCreate"
  | "moleculeAddMember";

export interface CacheStats {
  hits: number;
  misses: number;
  evictions: number;
  size: number;
  maxSize: number;
  hitRate: number;
}

export interface BdCacheOptions {
  maxSize?: number;
  hotTtlMs?: number;
  warmTtlMs?: number;
  coldTtlMs?: number;
  enabled?: boolean;
}

interface InvalidationContext {
  id?: string;
  sourceId?: string;
  targetId?: string;
}

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

const DEFAULT_MAX_SIZE = 1000;
const DEFAULT_HOT_TTL_MS = 30_000;
const DEFAULT_WARM_TTL_MS = 60_000;
const DEFAULT_COLD_TTL_MS = 300_000;

export class BdCache {
  private readonly store = new Map<string, CacheEntry<unknown>>();
  private readonly lruOrder: string[] = [];
  private readonly maxSize: number;
  private readonly hotTtlMs: number;
  private readonly warmTtlMs: number;
  private readonly coldTtlMs: number;
  private readonly enabled: boolean;

  private hits = 0;
  private misses = 0;
  private evictions = 0;

  constructor(options?: BdCacheOptions) {
    this.maxSize = options?.maxSize ?? DEFAULT_MAX_SIZE;
    this.hotTtlMs = options?.hotTtlMs ?? DEFAULT_HOT_TTL_MS;
    this.warmTtlMs = options?.warmTtlMs ?? DEFAULT_WARM_TTL_MS;
    this.coldTtlMs = options?.coldTtlMs ?? DEFAULT_COLD_TTL_MS;
    this.enabled = options?.enabled ?? true;
  }

  get<T>(key: string): T | undefined {
    if (!this.enabled) return undefined;

    const entry = this.store.get(key);
    if (!entry) {
      this.misses++;
      return undefined;
    }

    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      this.removeLru(key);
      this.misses++;
      return undefined;
    }

    this.hits++;
    this.touchLru(key);
    return entry.value as T;
  }

  set<T>(key: string, value: T, tier: CacheTier): void {
    if (!this.enabled) return;

    const ttl = this.ttlForTier(tier);
    const expiresAt = Date.now() + ttl;

    if (this.store.has(key)) {
      this.store.set(key, { value, expiresAt });
      this.touchLru(key);
      return;
    }

    if (this.store.size >= this.maxSize) {
      this.evictLru();
    }

    this.store.set(key, { value, expiresAt });
    this.lruOrder.push(key);
  }

  has(key: string): boolean {
    if (!this.enabled) return false;

    const entry = this.store.get(key);
    if (!entry) return false;

    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      this.removeLru(key);
      return false;
    }

    return true;
  }

  delete(key: string): boolean {
    if (!this.enabled) return false;

    if (!this.store.has(key)) return false;

    this.store.delete(key);
    this.removeLru(key);
    return true;
  }

  invalidate(key: string): void {
    if (!this.enabled) return;
    this.store.delete(key);
    this.removeLru(key);
  }

  invalidatePattern(pattern: string): void {
    if (!this.enabled) return;

    if (!pattern.includes("*")) {
      this.invalidate(pattern);
      return;
    }

    const prefix = pattern.slice(0, pattern.indexOf("*"));
    const keysToDelete: string[] = [];

    for (const key of this.store.keys()) {
      if (key.startsWith(prefix)) {
        keysToDelete.push(key);
      }
    }

    for (const key of keysToDelete) {
      this.store.delete(key);
      this.removeLru(key);
    }
  }

  invalidateByOperation(
    operation: WriteOperation,
    context?: InvalidationContext,
  ): void {
    if (!this.enabled) return;

    switch (operation) {
      case "create":
        this.invalidatePattern("list:*");
        this.invalidatePattern("stats:*");
        this.invalidatePattern("ready:*");
        break;

      case "update":
        if (context?.id) this.invalidate(`show:${context.id}`);
        this.invalidatePattern("list:*");
        this.invalidatePattern("ready:*");
        break;

      case "close":
        if (context?.id) this.invalidate(`show:${context.id}`);
        this.invalidatePattern("list:*");
        this.invalidatePattern("stats:*");
        this.invalidatePattern("ready:*");
        break;

      case "depAdd":
      case "depRemove":
        if (context?.sourceId) this.invalidate(`deps:${context.sourceId}`);
        if (context?.targetId) this.invalidate(`deps:${context.targetId}`);
        this.invalidatePattern("tree:*");
        this.invalidatePattern("ready:*");
        break;

      case "labelAdd":
      case "labelRemove":
        if (context?.id) this.invalidate(`labels:${context.id}`);
        this.invalidatePattern("list:*");
        break;

      case "commentAdd":
        if (context?.id) this.invalidate(`comments:${context.id}`);
        break;

      case "moleculeCreate":
      case "moleculeAddMember":
        this.invalidate("molecules");
        if (context?.id) this.invalidate(`molecule:${context.id}`);
        break;
    }
  }

  clear(): void {
    if (!this.enabled) return;
    this.store.clear();
    this.lruOrder.length = 0;
  }

  stats(): CacheStats {
    const total = this.hits + this.misses;
    return {
      hits: this.hits,
      misses: this.misses,
      evictions: this.evictions,
      size: this.store.size,
      maxSize: this.maxSize,
      hitRate: total === 0 ? 0 : this.hits / total,
    };
  }

  size(): number {
    return this.store.size;
  }

  private ttlForTier(tier: CacheTier): number {
    switch (tier) {
      case "hot":
        return this.hotTtlMs;
      case "warm":
        return this.warmTtlMs;
      case "cold":
        return this.coldTtlMs;
    }
  }

  private touchLru(key: string): void {
    const idx = this.lruOrder.indexOf(key);
    if (idx !== -1) {
      this.lruOrder.splice(idx, 1);
    }
    this.lruOrder.push(key);
  }

  private removeLru(key: string): void {
    const idx = this.lruOrder.indexOf(key);
    if (idx !== -1) {
      this.lruOrder.splice(idx, 1);
    }
  }

  private evictLru(): void {
    const evictKey = this.lruOrder.shift();
    if (evictKey !== undefined) {
      this.store.delete(evictKey);
      this.evictions++;
    }
  }
}
