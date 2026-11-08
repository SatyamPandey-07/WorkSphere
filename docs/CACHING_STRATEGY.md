# Venue Data Caching Strategy

WorkSphere uses a three-layer caching approach for venue data: an in-process LRU cache,
a distributed Upstash Redis cache, and a PostgreSQL + semantic-vector cache. Each layer
has a different TTL, scope, and invalidation trigger.

---

## Cache Layers

```
Request
  │
  ├─ 1. In-process LRU cache (src/lib/cache.ts)
  │       └─ hits → return immediately (microseconds)
  │
  ├─ 2. Upstash Redis (rate-limit keys, reminder dedup)
  │       └─ hits → return < 10ms (network round-trip)
  │
  ├─ 3. PostgreSQL vector / semantic cache (src/lib/cache/semanticCache.ts)
  │       └─ cosine similarity > 0.85 → return cached AI response
  │
  └─ 4. Database (Prisma → PostgreSQL)
          └─ always fresh, slowest path (~50–200ms)
```

---

## Layer 1 — In-Process LRU Cache (`src/lib/cache.ts`)

`LRUCache<T>` is a generic least-recently-used cache backed by a JavaScript `Map`.
It lives in the Node.js process memory and is the fastest layer (no network).

| Property | Value |
|----------|-------|
| Type | In-process, per-replica |
| Implementation | `LRUCache<T>` (cap + TTL) |
| Shared across replicas? | No — each serverless function instance has its own |
| When invalidated | TTL expiry or explicit `cache.invalidate(key)` / `cache.clear()` |

### Configuration

```typescript
import { LRUCache } from "@/lib/cache";

const venueCache = new LRUCache<VenueData>(
  200,        // capacity: at most 200 entries
  5 * 60_000, // TTL: 5 minutes in ms
);
```

### Cleanup

The constructor starts a background `setInterval` that runs at `min(ttlMs, 60s)` and
evicts expired entries. Call `cache.dispose()` to cancel the interval on process shutdown.

---

## Layer 2 — Upstash Redis (`@upstash/redis`)

Upstash Redis is used for **shared, cross-replica state** that must be consistent across
all serverless function instances: rate-limit counters and booking-reminder deduplication.

| Use case | Key pattern | TTL |
|----------|-------------|-----|
| Rate-limit counter | `rl:<userId>:<endpoint>` | sliding window (60s) |
| Booking reminder sent | `booking-reminder:<bookingId>` | 7200s (2 h) |
| Translate rate limit | `translate:<userId>` | 60s |

### How it is used

```typescript
import { Redis } from "@upstash/redis";
const redis = Redis.fromEnv(); // reads UPSTASH_REDIS_REST_URL + TOKEN

// Dedup: skip if already sent
const alreadySent = await redis.get(`booking-reminder:${booking.id}`);
if (alreadySent) continue;

// Mark sent for 2 hours
await redis.set(`booking-reminder:${booking.id}`, "sent", { ex: 7200 });
```

### Environment Variables

```
UPSTASH_REDIS_REST_URL=https://<your-db>.upstash.io
UPSTASH_REDIS_REST_TOKEN=<token>
```

If these are absent, the rate-limiter falls back to an in-process `Map`-based implementation
(`memRateLimit` in `src/lib/rateLimit.ts`), which is non-shared and resets on cold starts.

---

## Layer 3 — Semantic Vector Cache (`src/lib/cache/semanticCache.ts`)

AI venue search responses are expensive (Groq LLM + Foursquare API). WorkSphere caches
entire search results by semantic similarity so similar queries hit the cache.

| Property | Value |
|----------|-------|
| Backing store | PostgreSQL (pgvector extension) |
| Embedding model | `embed-english-v3.0` via Cohere API |
| Similarity threshold | cosine distance < 0.15 (similarity > 85%) |
| TTL | No expiry — entries are never evicted automatically |

### How it works

1. On every AI chat request, `checkSemanticCache(query, locationStr)` generates a Cohere
   embedding vector for the user's query.
2. A pgvector cosine-distance query finds the closest previously-cached query within the
   0.15 distance threshold.
3. On a hit the cached `reasoning` JSON is returned directly — the Groq call is skipped.
4. On a miss the full pipeline runs. The result is saved with `saveToSemanticCache()` for
   future queries.

### Cache invalidation

The semantic cache has no automatic TTL. Stale entries can be cleared by deleting rows from
the `SemanticCache` Prisma model:

```sql
-- Clear all entries (dev/staging)
DELETE FROM "SemanticCache";

-- Clear entries older than 30 days
DELETE FROM "SemanticCache" WHERE "createdAt" < NOW() - INTERVAL '30 days';
```

---

## TTL Reference

| Data | Layer | TTL |
|------|-------|-----|
| Rate-limit counter | Redis | 60 s (sliding) |
| Booking reminder dedup | Redis | 7200 s (2 h) |
| Translate rate limit | Redis | 60 s |
| In-process venue data | LRU | Configurable (default 5 min) |
| AI search response | PostgreSQL / pgvector | No expiry |

---

## Invalidation Triggers

| Trigger | Cache cleared |
|---------|--------------|
| Venue update / save | LRU `venueCache.invalidate(venueId)` |
| User avatar upload | In-memory avatar event (not Redis) |
| Rate-limit reset (admin) | `resetRateLimit(userId)` in `rateLimit.ts` |
| Cold start | In-process LRU wiped automatically |
| Semantic cache manual flush | `DELETE FROM "SemanticCache"` (SQL) |

---

## Further Reading

- [`src/lib/cache.ts`](../src/lib/cache.ts) — LRU implementation
- [`src/lib/rateLimit.ts`](../src/lib/rateLimit.ts) — Redis + in-memory rate limiter
- [`src/lib/cache/semanticCache.ts`](../src/lib/cache/semanticCache.ts) — pgvector semantic cache
- [`src/lib/reminderCron.ts`](../src/lib/reminderCron.ts) — Redis dedup for booking reminders
