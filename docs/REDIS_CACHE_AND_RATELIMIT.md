# Upstash Redis — Semantic Caching & Rate Limiting Guide

WorkSphere uses **Upstash Redis** for two purposes:

1. **Semantic vector caching** — avoids re-querying the AI model for near-duplicate questions
2. **Sliding-window rate limiting** — protects API routes from abuse

Both modules fall back gracefully when the Upstash env vars are absent.

---

## 1. Environment Variables

| Variable | Required | Purpose |
|----------|----------|---------|
| `UPSTASH_REDIS_REST_URL` | No (optional) | Redis REST endpoint — omit to use in-memory fallback |
| `UPSTASH_REDIS_REST_TOKEN` | No (optional) | Auth token for the REST endpoint |

### Fallback when env vars are absent

**Rate limiting** (`src/lib/rateLimit.ts`): When Upstash is not configured, an in-memory `Map<identifier, timestamps[]>` implements the same sliding-window logic. This is fine for single-instance local development but does not share state across multiple server instances.

**Semantic caching** (`src/lib/cache/semanticCache.ts`): Uses Postgres `pgvector` directly — there is no Redis dependency for caching; Redis is used for rate limiting only in this path.

---

## 2. Rate Limiting (`src/lib/rateLimit.ts`)

### Algorithm

WorkSphere implements a **sliding-window log** using a Redis sorted set:

1. Each request is stamped with `Date.now()` and added to `worksphere:ratelimit:<identifier>` with a score equal to the timestamp.
2. Entries older than `windowMs` are removed with `ZREMRANGEBYSCORE`.
3. The current count is retrieved with `ZCARD`.
4. If `count > limit`, the request is rejected with `429`.
5. A `EXPIRE` on the key auto-cleans it after the window elapses.

All operations run inside a single Redis `MULTI/EXEC` transaction to prevent race conditions.

### Per-user vs per-IP limits

The `identifier` parameter controls the key scope:

```ts
// Per-user (authenticated)
const identifier = `book:${userId}`;

// Per-IP (anonymous)
const identifier = `book:${req.headers.get("x-forwarded-for")?.split(",")[0] ?? "anonymous"}`;
```

Callers choose which scope to apply. The booking endpoint uses `userId || IP` as a fallback chain.

### Example

```ts
import { rateLimit } from "@/lib/rateLimit";

const allowed = await rateLimit("book:user_abc123", 5); // 5 requests / 60 s
if (!allowed) {
  return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });
}
```

---

## 3. Semantic Vector Caching (`src/lib/cache/semanticCache.ts`)

WorkSphere avoids re-querying the AI model when a semantically near-duplicate question has been answered recently. The cache is stored in the **Postgres `pgvector` extension**, not Redis.

### How similarity is computed

1. The incoming query is embedded into a 1536-dimension vector.
2. A `pgvector` cosine distance query is run:

   ```sql
   SELECT response, 1 - (embedding <=> $1::vector) AS similarity
   FROM semantic_cache
   WHERE user_id = $2
     AND 1 - (embedding <=> $1::vector) > 0.85
   ORDER BY similarity DESC
   LIMIT 1;
   ```

3. The result is returned if `similarity > 0.85` (i.e. cosine distance `< 0.15`).

### Similarity threshold

| Threshold | Meaning |
|-----------|---------|
| `> 0.95` | Near-identical phrasing |
| `0.85–0.95` | Same intent, different words (cache hit) |
| `< 0.85` | Different enough → re-query the model |

The `0.85` threshold is a tuning parameter — lower values increase cache hit rates but risk serving slightly off-topic cached responses.

### Cache write

On a model response, the query + response + embedding are inserted:

```sql
INSERT INTO semantic_cache (user_id, query, response, created_at, embedding)
VALUES ($1, $2, $3, $4, NOW(), $5::vector)
```

### Fallback when Upstash is absent

The semantic cache path does not use Redis at all — it queries Postgres directly via Prisma. It is always active as long as `DATABASE_URL` is configured.
