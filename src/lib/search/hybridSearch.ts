import { createHash } from "crypto";
import { getGeminiClient, isGeminiConfigured } from "@/lib/ai/gemini";
import { getRedis } from "@/lib/redis";

const CACHE_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 Days

/**
 * XFetch tuning. `eta` trades additional background refreshes for a lower
 * probability of a stampede. `DEFAULT_COMPUTE_MS` is used when a cache entry
 * predates the delta recording (legacy payloads stored a bare array).
 */
const XFETCH_ETA = 3;
const DEFAULT_COMPUTE_MS = 250;
const REFRESH_LOCK_TTL_MS = 30_000;

export interface HybridSearchResult {
  id: string;
  name: string;
  description: string;
  score: number;
}

export interface QueryCacheContext {
  userId?: string | null;
  authorizationTier?: string | null;
}

interface CachedEmbedding {
  embedding: number[];
  deltaMs: number;
}

interface ComputedEmbedding {
  embedding: number[];
  deltaMs: number;
}

/** Per-query single-flight guards for background embedding refreshes. */
const inFlightRefreshes = new Map<string, Promise<void>>();

function hashCacheContext(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 32);
}

/**
 * Builds an embedding cache key without exposing authenticated identifiers in
 * Redis. Public queries retain the shared cache, while personalized queries
 * are isolated by user identity or authorization tier.
 */
export function buildQueryEmbeddingCacheKey(
  query: string,
  context: QueryCacheContext = {},
): string {
  const normalizedQuery = query.toLowerCase().trim();
  const userId =
    typeof context.userId === "string" ? context.userId.trim() : "";
  const authorizationTier =
    typeof context.authorizationTier === "string"
      ? context.authorizationTier.trim()
      : "";
  const scope = userId
    ? `user:${hashCacheContext(userId)}`
    : authorizationTier
      ? `tier:${hashCacheContext(authorizationTier)}`
      : "public";

  const encodedQuery = Buffer.from(normalizedQuery).toString("base64");
  return scope === "public"
    ? `embedding:${encodedQuery}`
    : `embedding:${scope}:${encodedQuery}`;
}

/**
 * Normalizes both the current `{ embedding, deltaMs }` payload and the legacy
 * bare-array payload into a single shape.
 */
function parseCachedEmbedding(raw: unknown): CachedEmbedding | null {
  if (raw === null || raw === undefined) return null;

  let parsed: unknown = raw;
  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return null;
    }
  }

  // Legacy entries stored the embedding array directly.
  if (Array.isArray(parsed)) {
    return { embedding: parsed as number[], deltaMs: DEFAULT_COMPUTE_MS };
  }

  if (
    parsed &&
    typeof parsed === "object" &&
    Array.isArray((parsed as { embedding?: unknown }).embedding)
  ) {
    const candidate = parsed as { embedding: number[]; deltaMs?: unknown };
    const deltaMs =
      typeof candidate.deltaMs === "number" && candidate.deltaMs > 0
        ? candidate.deltaMs
        : DEFAULT_COMPUTE_MS;
    return { embedding: candidate.embedding, deltaMs };
  }

  return null;
}

/**
 * XFetch probabilistic early expiration.
 *
 * Returns `true` when the cached embedding should be refreshed in the
 * background, using the decision rule:
 *
 *   -eta * delta * ln(random()) > expiry - now
 *
 * `remainingMs` is `expiry - now`, while `deltaMs` is the observed cost of
 * recomputing the embedding. Refreshes therefore start earlier for expensive
 * embeddings and are spread out probabilistically so that concurrent callers
 * do not all recompute at once.
 */
export function shouldRefreshEmbeddingEarly(
  remainingMs: number,
  deltaMs: number,
  eta: number = XFETCH_ETA,
  random: () => number = Math.random,
): boolean {
  if (remainingMs <= 0 || deltaMs <= 0) return false;
  return -eta * deltaMs * Math.log(random()) > remainingMs;
}

async function computeEmbedding(query: string): Promise<ComputedEmbedding> {
  const startedAt = Date.now();
  const gemini = getGeminiClient();
  const result = await gemini.models.embedContent({
    model: "text-embedding-004",
    contents: query,
  });
  const embedding =
    result.embeddings?.[0]?.values || (result as any).embedding?.values || [];

  return { embedding, deltaMs: Math.max(Date.now() - startedAt, 1) };
}

async function writeEmbeddingCache(
  redis: NonNullable<ReturnType<typeof getRedis>>,
  cacheKey: string,
  embedding: number[],
  deltaMs: number,
): Promise<void> {
  await redis.set(cacheKey, JSON.stringify({ embedding, deltaMs }), {
    ex: CACHE_TTL_SECONDS,
  });
}

/**
 * Recomputes the embedding off the request path. A per-query in-process
 * single-flight guard is combined with a Redis `SET NX` lock so that only one
 * backend instance refreshes a given query hash at a time.
 */
function scheduleEmbeddingRefresh(
  cacheKey: string,
  query: string,
  refresh: () => Promise<void>,
): void {
  if (inFlightRefreshes.has(cacheKey)) return;

  const task = (async () => {
    const redis = getRedis();
    const lockKey = `${cacheKey}:refresh-lock`;
    let holdsLock = false;

    if (redis) {
      try {
        const acquired = await redis.set(lockKey, "1", {
          nx: true,
          px: REFRESH_LOCK_TTL_MS,
        });
        holdsLock = acquired === "OK";
      } catch {
        // Fall back to the in-process single-flight guard.
        holdsLock = true;
      }

      // Another worker already owns the refresh.
      if (!holdsLock) return;
    }

    try {
      await refresh();
    } finally {
      if (redis && holdsLock) {
        try {
          await redis.del(lockKey);
        } catch {
          // Lock will expire on its own.
        }
      }
    }
  })()
    .catch((err) => {
      console.warn("[Embedding Background Refresh Error]:", err);
    })
    .finally(() => {
      inFlightRefreshes.delete(cacheKey);
    });

  inFlightRefreshes.set(cacheKey, task);
}

/**
 * Generates a 768-dimensional text embedding using Gemini Embeddings API, cached in Redis.
 *
 * Cache hits are evaluated with XFetch probabilistic early expiration: when an
 * entry is close enough to expiry, a background refresh is scheduled while the
 * cached embedding is returned immediately.
 */
export async function getQueryEmbedding(
  query: string,
  context: QueryCacheContext = {},
): Promise<number[]> {
  const cacheKey = buildQueryEmbeddingCacheKey(query, context);
  const redis = getRedis();

  if (redis) {
    try {
      const cached = parseCachedEmbedding(
        await redis.get<string | number[]>(cacheKey),
      );

      if (cached && cached.embedding.length > 0) {
        try {
          const ttl = await redis.ttl(cacheKey);
          const remainingMs = ttl > 0 ? ttl * 1000 : -1;

          if (
            remainingMs > 0 &&
            shouldRefreshEmbeddingEarly(remainingMs, cached.deltaMs)
          ) {
            scheduleEmbeddingRefresh(cacheKey, query, async () => {
              if (!isGeminiConfigured()) return;
              const { embedding, deltaMs } = await computeEmbedding(query);
              if (embedding.length > 0) {
                await writeEmbeddingCache(redis, cacheKey, embedding, deltaMs);
              }
            });
          }
        } catch (err) {
          console.warn("[Redis TTL Error]:", err);
        }

        return cached.embedding;
      }
    } catch (err) {
      console.warn("[Redis Cache Miss/Error]:", err);
    }
  }

  if (!isGeminiConfigured()) {
    return new Array(768).fill(0);
  }

  try {
    const { embedding, deltaMs } = await computeEmbedding(query);

    if (redis && embedding.length > 0) {
      try {
        await writeEmbeddingCache(redis, cacheKey, embedding, deltaMs);
      } catch (err) {
        console.warn("[Redis Set Error]:", err);
      }
    }

    return embedding;
  } catch (err) {
    console.warn("[Gemini Embedding Error]:", err);
    return new Array(768).fill(0);
  }
}

/** Reset module-level single-flight state. Exported for tests only. @internal */
export function _resetEmbeddingRefreshStateForTesting(): void {
  inFlightRefreshes.clear();
}

/**
 * Executes Reciprocal Rank Fusion (RRF) combining vector cosine distance (<->) and FTS ts_rank_cd.
 */
export async function executeHybridSearch(
  query: string,
  prismaClient: any,
  limit: number = 10,
  rrfK: number = 60,
  cacheContext: QueryCacheContext = {},
): Promise<HybridSearchResult[]> {
  const embedding = await getQueryEmbedding(query, cacheContext);
  const vectorStr = `[${embedding.join(",")}]`;

  // Reciprocal Rank Fusion (RRF) raw SQL execution
  const results = await prismaClient.$queryRawUnsafe(
    `
    WITH vector_matches AS (
      SELECT 
        id, 
        name, 
        description,
        ROW_NUMBER() OVER (ORDER BY embedding <-> '${vectorStr}'::vector) AS vec_rank
      FROM "Venue"
      WHERE embedding IS NOT NULL
      LIMIT 50
    ),
    fts_matches AS (
      SELECT 
        id, 
        name, 
        description,
        ROW_NUMBER() OVER (ORDER BY ts_rank_cd(search_vector, websearch_to_tsquery('english', $1)) DESC) AS fts_rank
      FROM "Venue"
      WHERE search_vector @@ websearch_to_tsquery('english', $1)
      LIMIT 50
    )
    SELECT 
      COALESCE(v.id, f.id) AS id,
      COALESCE(v.name, f.name) AS name,
      COALESCE(v.description, f.description) AS description,
      (COALESCE(1.0 / ($2 + v.vec_rank), 0.0) + COALESCE(1.0 / ($2 + f.fts_rank), 0.0)) AS score
    FROM vector_matches v
    FULL OUTER JOIN fts_matches f ON v.id = f.id
    ORDER BY score DESC
    LIMIT $3;
  `,
    query,
    rrfK,
    limit,
  );

  return results;
}
