import { createHash } from "crypto";
import { Prisma } from "@prisma/client";
import { getAnalyticsSummaryAsync } from "@/lib/analytics";
import { swrCache } from "@/lib/cache/swrCache";
import { prisma } from "@/lib/prisma";
import { normalizeSearchQuery } from "@/lib/searchSanitizer";
import { fuzzyFilterVenues } from "@/lib/search/fuzzySearch";

export interface HybridVenueSearchFilters {
  minLat?: number;
  maxLat?: number;
  minLng?: number;
  maxLng?: number;
  category?: string;
  cities?: string[];
  /** Amenity filters (e.g. "quiet", "standing desk"); order and case do not matter. */
  amenities?: string[];
  semanticWeight?: number;
  fullTextWeight?: number;
  rrfK?: number;
  queryEmbedding?: number[] | null;
  /** Set to false to skip the trigram typo-tolerance fallback. */
  enableFuzzyFallback?: boolean;
  /** Minimum pg_trgm similarity for a fuzzy match (default 0.25). */
  minSimilarity?: number;
  /**
   * Best cosine similarity below which a semantic-only result set counts as
   * low confidence and trigram matches are mixed in (default 0.65).
   */
  semanticConfidenceThreshold?: number;
}

export interface RankedVenueId {
  id: string;
  score: number;
  needs_embedding?: boolean;
  search_document?: string;
  fuzzyMatched?: boolean;
  similarity?: number;
  suggestedQuery?: string;
  matchedName?: string;
}

export interface RankedVenueList extends Array<RankedVenueId> {
  fuzzyMatched?: boolean;
  suggestedQuery?: string;
  /** True when trigram matches were mixed into low-confidence semantic results. */
  lowConfidenceFallback?: boolean;
}

export interface HybridVenueSearchResult {
  venues: RankedVenueId[];
  fuzzyMatched: boolean;
  suggestedQuery?: string;
}

export const DEFAULT_RRF_K = 60;
export const DEFAULT_SEMANTIC_CONFIDENCE_THRESHOLD = 0.65;
export const DEFAULT_MIN_TRIGRAM_SIMILARITY = 0.25;
/** Trigram matches mixed into a low-confidence result set are capped here. */
export const LOW_CONFIDENCE_FUZZY_LIMIT = 20;
export const MAX_CONCURRENT_TRENDING_SEARCH_REFRESHES = 2;

const SEARCH_CACHE_FRESH_TTL_SECONDS = 300;
const SEARCH_CACHE_STALE_TTL_SECONDS = 900;
const TRENDING_SEARCH_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const TRENDING_PREFETCH_INTERVAL_MS = 5 * 60 * 1000;
const MAX_QUEUED_SEARCH_REFRESHES = 100;

interface CachedRankedVenueList {
  results: RankedVenueId[];
  fuzzyMatched: boolean;
  suggestedQuery?: string;
  lowConfidenceFallback?: boolean;
}

interface SearchTelemetryEvent {
  name?: unknown;
  properties?: unknown;
  timestamp?: unknown;
}

let searchCacheHits = 0;
let searchCacheMisses = 0;
let lastTrendingPrefetchAt = 0;
let trendingPrefetchPromise: Promise<void> | null = null;
let activeBackgroundSearchRefreshes = 0;
const backgroundSearchRefreshQueue: Array<() => void> = [];
const inFlightSearches = new Map<string, Promise<CachedRankedVenueList>>();

function runWithBackgroundSearchLimit<T>(work: () => Promise<T>): Promise<T> {
  if (
    activeBackgroundSearchRefreshes >=
      MAX_CONCURRENT_TRENDING_SEARCH_REFRESHES &&
    backgroundSearchRefreshQueue.length >= MAX_QUEUED_SEARCH_REFRESHES
  ) {
    return Promise.reject(
      new Error("Trending venue search refresh queue is full"),
    );
  }

  return new Promise<T>((resolve, reject) => {
    const start = () => {
      activeBackgroundSearchRefreshes += 1;
      Promise.resolve()
        .then(work)
        .then(resolve, reject)
        .finally(() => {
          activeBackgroundSearchRefreshes -= 1;
          backgroundSearchRefreshQueue.shift()?.();
        });
    };

    if (
      activeBackgroundSearchRefreshes < MAX_CONCURRENT_TRENDING_SEARCH_REFRESHES
    ) {
      start();
    } else {
      backgroundSearchRefreshQueue.push(start);
    }
  });
}

/**
 * Normalizes an array of amenity filter tokens deterministically:
 * - Trims surrounding whitespace and collapses interior multi-space runs
 * - Converts each token to lowercase (locale-agnostic)
 * - Drops empty/whitespace-only tokens and non-string values
 * - Deduplicates normalized values
 * - Sorts remaining tokens alphabetically
 * - Guarantees immutability of the input array
 */
export function normalizeAmenityFilters(
  amenities?: readonly (string | unknown)[] | null,
): string[] {
  if (!Array.isArray(amenities) || amenities.length === 0) {
    return [];
  }

  const seen = new Set<string>();
  for (const item of amenities) {
    if (typeof item !== "string") continue;
    const normalized = item.trim().toLowerCase();
    if (normalized.length > 0) {
      seen.add(normalized);
    }
  }

  return Array.from(seen).sort();
}

export function normalizedSearchCacheKey(
  query: string,
  filters: HybridVenueSearchFilters = {},
  candidateLimit: number = 20,
): string {
  const embedding =
    filters.queryEmbedding === undefined
      ? "auto"
      : filters.queryEmbedding === null
        ? null
        : createHash("sha256")
            .update(JSON.stringify(filters.queryEmbedding))
            .digest("hex");

  const normalizedCategory =
    typeof filters.category === "string" && filters.category.trim() !== ""
      ? filters.category.trim().toLowerCase()
      : null;

  const normalizedAmenities = normalizeAmenityFilters(filters.amenities);

  const keyParts = {
    query: normalizeSearchQuery(query).slice(0, 256),
    minLat: filters.minLat,
    maxLat: filters.maxLat,
    minLng: filters.minLng,
    maxLng: filters.maxLng,
    category: normalizedCategory,
    cities: [...(filters.cities ?? [])].sort(),
    amenities: normalizedAmenities,
    semanticWeight: filters.semanticWeight ?? null,
    fullTextWeight: filters.fullTextWeight ?? null,
    rrfK: filters.rrfK ?? null,
    queryEmbedding: embedding,
    enableFuzzyFallback: filters.enableFuzzyFallback ?? null,
    minSimilarity: filters.minSimilarity ?? null,
    semanticConfidenceThreshold: filters.semanticConfidenceThreshold ?? null,
    candidateLimit,
  };
  const digest = createHash("sha256")
    .update(JSON.stringify(keyParts))
    .digest("hex");
  return `venue:hybrid-search:v2:${digest}`;
}

function toCachedRankedVenueList(
  ranked: RankedVenueList,
): CachedRankedVenueList {
  return {
    results: [...ranked],
    fuzzyMatched: Boolean(ranked.fuzzyMatched),
    suggestedQuery: ranked.suggestedQuery,
    lowConfidenceFallback: ranked.lowConfidenceFallback,
  };
}

function isCachedRankedVenueList(
  value: unknown,
): value is CachedRankedVenueList {
  if (!value || typeof value !== "object") return false;
  const cached = value as Partial<CachedRankedVenueList>;
  return (
    Array.isArray(cached.results) &&
    cached.results.every(
      (result) =>
        result !== null &&
        typeof result === "object" &&
        typeof result.id === "string" &&
        typeof result.score === "number" &&
        Number.isFinite(result.score),
    ) &&
    typeof cached.fuzzyMatched === "boolean"
  );
}

function fromCachedRankedVenueList(
  cached: CachedRankedVenueList,
): RankedVenueList {
  return Object.assign([...cached.results], {
    fuzzyMatched: cached.fuzzyMatched,
    suggestedQuery: cached.suggestedQuery,
    lowConfidenceFallback: cached.lowConfidenceFallback,
  });
}

function runSearchSingleFlight(
  cacheKey: string,
  fetcher: () => Promise<CachedRankedVenueList>,
): Promise<CachedRankedVenueList> {
  const existing = inFlightSearches.get(cacheKey);
  if (existing) return existing;

  const task = Promise.resolve()
    .then(fetcher)
    .finally(() => {
      if (inFlightSearches.get(cacheKey) === task) {
        inFlightSearches.delete(cacheKey);
      }
    });
  inFlightSearches.set(cacheKey, task);
  return task;
}

function recordSearchCacheStatus(status: "hit" | "miss"): void {
  if (status === "hit") {
    searchCacheHits += 1;
  } else {
    searchCacheMisses += 1;
  }
}

export function getHybridVenueSearchCacheMetrics(): {
  requests: number;
  hits: number;
  misses: number;
  hitRatio: number;
} {
  const requests = searchCacheHits + searchCacheMisses;
  return {
    requests,
    hits: searchCacheHits,
    misses: searchCacheMisses,
    hitRatio: requests === 0 ? 0 : searchCacheHits / requests,
  };
}

export async function getTrendingVenueSearchQueries(
  limit = 10,
  nowMs = Date.now(),
): Promise<Array<{ query: string; count: number; lastUsed: number }>> {
  let recentEvents: unknown;
  try {
    recentEvents = (await getAnalyticsSummaryAsync())?.recentEvents;
  } catch (error) {
    console.warn(
      "[Hybrid Venue Search] Failed to read search telemetry:",
      error,
    );
    return [];
  }

  if (!Array.isArray(recentEvents)) return [];

  const cutoff = nowMs - TRENDING_SEARCH_WINDOW_MS;
  const searches = new Map<string, { count: number; lastUsed: number }>();
  for (const candidate of recentEvents as SearchTelemetryEvent[]) {
    if (
      !candidate ||
      typeof candidate !== "object" ||
      candidate.name !== "search_performed" ||
      typeof candidate.timestamp !== "number" ||
      !Number.isFinite(candidate.timestamp) ||
      (candidate.timestamp as number) < cutoff ||
      (candidate.timestamp as number) > nowMs ||
      !candidate.properties ||
      typeof candidate.properties !== "object" ||
      Array.isArray(candidate.properties)
    ) {
      continue;
    }

    const rawQuery = (candidate.properties as Record<string, unknown>).query;
    if (typeof rawQuery !== "string") continue;
    const query = normalizeSearchQuery(rawQuery).slice(0, 256);
    if (!query) continue;

    const entry = searches.get(query) ?? { count: 0, lastUsed: 0 };
    entry.count += 1;
    entry.lastUsed = Math.max(entry.lastUsed, candidate.timestamp as number);
    searches.set(query, entry);
  }

  const safeLimit =
    Number.isFinite(limit) && limit > 0 ? Math.min(Math.floor(limit), 50) : 10;
  return [...searches.entries()]
    .map(([query, data]) => ({ query, ...data }))
    .sort(
      (a, b) =>
        b.count - a.count ||
        b.lastUsed - a.lastUsed ||
        a.query.localeCompare(b.query),
    )
    .slice(0, safeLimit);
}

async function getCachedRankedVenueSearch(
  query: string,
  filters: HybridVenueSearchFilters,
  candidateLimit: number,
  countMetrics: boolean,
): Promise<RankedVenueList> {
  const cacheKey = normalizedSearchCacheKey(query, filters, candidateLimit);
  const fetcher = () =>
    runSearchSingleFlight(cacheKey, async () =>
      toCachedRankedVenueList(
        await searchVenuesWithRrfUncached(query, filters, candidateLimit),
      ),
    );
  const cached = await swrCache(cacheKey, fetcher, {
    freshTtlSeconds: SEARCH_CACHE_FRESH_TTL_SECONDS,
    staleTtlSeconds: SEARCH_CACHE_STALE_TTL_SECONDS,
    onCacheStatus: countMetrics ? recordSearchCacheStatus : undefined,
    validateData: isCachedRankedVenueList,
    backgroundFetch: runWithBackgroundSearchLimit,
    cacheMissFetch: countMetrics ? undefined : runWithBackgroundSearchLimit,
  });
  return fromCachedRankedVenueList(cached);
}

export async function prefetchTrendingVenueSearches(): Promise<void> {
  const trending = await getTrendingVenueSearchQueries();
  await Promise.all(
    trending.map(async ({ query }) => {
      try {
        await getCachedRankedVenueSearch(query, {}, 500, false);
      } catch (error) {
        console.warn(
          `[Hybrid Venue Search] Failed to warm trending query "${query}":`,
          error,
        );
      }
    }),
  );
}

export function scheduleTrendingVenueSearchPrefetch(): void {
  const now = Date.now();
  if (
    trendingPrefetchPromise ||
    now - lastTrendingPrefetchAt < TRENDING_PREFETCH_INTERVAL_MS
  ) {
    return;
  }

  lastTrendingPrefetchAt = now;
  trendingPrefetchPromise = prefetchTrendingVenueSearches()
    .catch((error) => {
      console.warn("[Hybrid Venue Search] Trending prefetch failed:", error);
    })
    .finally(() => {
      trendingPrefetchPromise = null;
    });
}

export function _resetHybridVenueSearchStateForTesting(): void {
  searchCacheHits = 0;
  searchCacheMisses = 0;
  lastTrendingPrefetchAt = 0;
  trendingPrefetchPromise = null;
  inFlightSearches.clear();
}

function resolveMinSimilarity(value?: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0.05, Math.min(1.0, value))
    : DEFAULT_MIN_TRIGRAM_SIMILARITY;
}

function resolveConfidenceThreshold(value?: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.min(1, value))
    : DEFAULT_SEMANTIC_CONFIDENCE_THRESHOLD;
}

/**
 * Alternates trigram matches with semantic results, trigram match first, and
 * keeps one entry per venue. A venue found by both keeps its trigram entry,
 * so the caller can still label it as a fuzzy match.
 */
export function interleaveFuzzyAndSemantic(
  fuzzy: RankedVenueId[],
  semantic: RankedVenueId[],
): RankedVenueId[] {
  const fuzzyIds = new Set(fuzzy.map((venue) => venue.id));
  const remainingSemantic = semantic.filter((venue) => !fuzzyIds.has(venue.id));
  const seen = new Set<string>();
  const merged: RankedVenueId[] = [];

  const longest = Math.max(fuzzy.length, remainingSemantic.length);
  for (let index = 0; index < longest; index++) {
    for (const venue of [fuzzy[index], remainingSemantic[index]]) {
      if (venue && !seen.has(venue.id)) {
        seen.add(venue.id);
        merged.push(venue);
      }
    }
  }

  return merged;
}

/**
 * Validates and clamps the RRF smoothing constant k to an integer >= 1.
 * Defaults to 60 if not provided or invalid.
 */
export function validateAndClampRrfK(k?: number): number {
  if (typeof k !== "number" || !Number.isFinite(k)) {
    return DEFAULT_RRF_K;
  }
  return Math.max(1, Math.floor(k));
}

/**
 * Calculates a single Reciprocal Rank Fusion (RRF) score component: weight / (k + rank).
 * Strictly enforces k >= 1 and guards against zero, negative, or non-integer ranks
 * to prevent division by zero, infinite, or negative scores.
 */
export function calculateRrfScore(
  rank: number | null | undefined,
  k: number = DEFAULT_RRF_K,
  weight: number = 1,
): number {
  if (
    rank === null ||
    rank === undefined ||
    !Number.isFinite(rank) ||
    rank <= 0
  ) {
    return 0;
  }
  const safeRank = Math.floor(rank);
  if (safeRank < 1) {
    return 0;
  }
  const safeK = validateAndClampRrfK(k);
  const safeWeight = Number.isFinite(weight) ? Math.max(0, weight) : 0;
  return safeWeight / (safeK + safeRank);
}

/**
 * Computes the Euclidean (L2) norm of a numeric vector: sqrt(sum(v_i^2)).
 */
export function computeL2Norm(vector: number[]): number {
  if (!Array.isArray(vector) || vector.length === 0) return 0;
  let sumSquares = 0;
  for (let i = 0; i < vector.length; i++) {
    const val = vector[i];
    if (typeof val === "number" && Number.isFinite(val)) {
      sumSquares += val * val;
    }
  }
  return Math.sqrt(sumSquares);
}

/**
 * Checks if a vector has an L2 norm strictly below epsilon (defaults to 1e-7).
 */
export function isZeroNormVector(
  vector: number[] | null | undefined,
  epsilon = 1e-7,
): boolean {
  if (!vector || !Array.isArray(vector) || vector.length === 0) {
    return true;
  }
  return computeL2Norm(vector) < epsilon;
}

/**
 * Normalizes a vector to unit L2 norm: v / norm.
 * If norm < epsilon (1e-7), returns null to prevent division by zero / NaN.
 */
export function normalizeVector(
  vector: number[],
  epsilon = 1e-7,
): number[] | null {
  if (!Array.isArray(vector) || vector.length === 0) return null;
  const norm = computeL2Norm(vector);
  if (norm < epsilon) {
    return null;
  }
  return vector.map((v) => v / norm);
}

/**
 * Computes cosine similarity between two numeric vectors.
 * Returns 0 if either vector has L2 norm < epsilon (1e-7) to prevent NaN.
 */
export function cosineSimilarity(
  a: number[],
  b: number[],
  epsilon = 1e-7,
): number {
  if (
    !Array.isArray(a) ||
    !Array.isArray(b) ||
    a.length !== b.length ||
    a.length === 0
  ) {
    return 0;
  }
  const normA = computeL2Norm(a);
  const normB = computeL2Norm(b);
  if (normA < epsilon || normB < epsilon) {
    return 0;
  }
  let dotProduct = 0;
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
  }
  const denominator = normA * normB;
  return denominator > 0 ? dotProduct / denominator : 0;
}

const indexingVenueIds = new Set<string>();

export async function indexVenueSearchEmbedding(
  venueId: string,
  document: string,
): Promise<void> {
  const apiKey = process.env.COHERE_API_KEY;
  if (!apiKey || indexingVenueIds.has(venueId)) return;

  indexingVenueIds.add(venueId);
  try {
    const response = await fetch("https://api.cohere.ai/v1/embed", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        texts: [document],
        model: "embed-english-v3.0",
        input_type: "search_document",
      }),
    });

    if (!response.ok) return;
    const result = await response.json();
    const embedding = result.embeddings?.[0];
    if (!Array.isArray(embedding) || embedding.length !== 1024) return;

    const embeddingString = `[${embedding.join(",")}]`;
    await prisma.$executeRaw`
      UPDATE "Venue"
      SET "searchEmbedding" = ${embeddingString}::vector
      WHERE "id" = ${venueId} AND "searchEmbedding" IS NULL
    `;
  } catch (error) {
    console.warn("Venue search document embedding failed:", error);
  } finally {
    indexingVenueIds.delete(venueId);
  }
}

async function embedSearchQuery(query: string): Promise<number[] | null> {
  const apiKey = process.env.COHERE_API_KEY;
  if (!apiKey || process.env.NODE_ENV === "test") return null;

  try {
    const response = await fetch("https://api.cohere.ai/v1/embed", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        texts: [query],
        model: "embed-english-v3.0",
        input_type: "search_query",
      }),
    });

    if (!response.ok) return null;
    const result = await response.json();
    const embedding = result.embeddings?.[0];
    return Array.isArray(embedding) && embedding.length === 1024
      ? embedding
      : null;
  } catch (error) {
    console.warn("Venue search embedding generation failed:", error);
    return null;
  }
}

/**
 * Marks the venues that came from the trigram fallback of a low-confidence
 * search, so the UI can show a "Fuzzy match suggestion" badge. Any other
 * result set is returned unchanged.
 */
export function labelFuzzySuggestions<T extends { id: string }>(
  venues: T[],
  ranked: RankedVenueList,
): Array<T & { fuzzyMatched?: boolean }> {
  if (!ranked.lowConfidenceFallback) return venues;
  const fuzzyIds = new Set(
    ranked.filter((venue) => venue.fuzzyMatched).map((venue) => venue.id),
  );
  return venues.map((venue) =>
    fuzzyIds.has(venue.id) ? { ...venue, fuzzyMatched: true } : venue,
  );
}

interface RankedSearchRow extends RankedVenueId {
  top_vector_similarity?: number | string | null;
  has_text_match?: boolean | null;
}

/**
 * Trigram matches on venue name, address and amenities (food tags and power
 * types). The name is compared as a whole; the longer address and amenity
 * text is compared by its best-matching word run.
 */
async function findTrigramMatches(
  searchQuery: string,
  venueFilters: Prisma.Sql,
  minSimilarity: number,
  limit: number,
): Promise<RankedVenueId[]> {
  const rows = await prisma.$queryRaw<
    Array<{
      id: string;
      name: string;
      similarity: number;
      score: number;
      needs_embedding: boolean;
    }>
  >(Prisma.sql`
    SELECT
      v."id",
      v."name",
      m.similarity,
      m.similarity *
        (1.0 - LEAST(100, GREATEST(0, COALESCE(v."slaPenaltyPoints", 0))) / 100.0) AS score,
      v."searchEmbedding" IS NULL AS needs_embedding
    FROM "Venue" v
    CROSS JOIN LATERAL (
      SELECT GREATEST(
        SIMILARITY(v."name", ${searchQuery}),
        WORD_SIMILARITY(${searchQuery}, COALESCE(v."address", '')),
        WORD_SIMILARITY(
          ${searchQuery},
          concat_ws(' ',
            array_to_string(v."foodTags", ' '),
            array_to_string(v."powerTypes", ' ')
          )
        )
      ) AS similarity
    ) m
    WHERE m.similarity >= ${minSimilarity}
    ${venueFilters}
    ORDER BY score DESC, v."id"
    LIMIT ${limit}
  `);

  return (rows ?? []).map((row) => ({
    id: row.id,
    score: Number(row.score ?? row.similarity ?? 0),
    needs_embedding: Boolean(row.needs_embedding),
    fuzzyMatched: true,
    similarity: Number(row.similarity ?? 0),
    matchedName: row.name,
  }));
}

async function searchVenuesWithRrfUncached(
  query: string,
  filters: HybridVenueSearchFilters = {},
  candidateLimit = 500,
): Promise<RankedVenueList> {
  const searchQuery = query.trim().slice(0, 256);
  if (!searchQuery) {
    const emptyList = [] as RankedVenueList;
    emptyList.fuzzyMatched = false;
    return emptyList;
  }

  const rawEmbedding =
    filters.queryEmbedding !== undefined
      ? filters.queryEmbedding
      : await embedSearchQuery(searchQuery);

  // Compute L2 norm and check for norm < 1e-7 before cosine similarity computation
  let normalizedEmbedding: number[] | null = null;
  let isZeroNorm = false;

  if (rawEmbedding && Array.isArray(rawEmbedding) && rawEmbedding.length > 0) {
    const norm = computeL2Norm(rawEmbedding);
    if (norm < 1e-7) {
      isZeroNorm = true;
      normalizedEmbedding = null;
    } else {
      normalizedEmbedding = rawEmbedding.map((val) => val / norm);
    }
  }

  const embeddingString = normalizedEmbedding
    ? `[${normalizedEmbedding.join(",")}]`
    : null;
  const predicates: Prisma.Sql[] = [];

  let fullTextWeight = 0.5;
  let semanticWeight = 0.5;

  if (isZeroNorm || !normalizedEmbedding) {
    // Fallback exclusively to BM25 full-text results when vector norm is zero
    fullTextWeight = 1.0;
    semanticWeight = 0.0;
  } else {
    const rawTextWeight =
      typeof filters.fullTextWeight === "number" &&
      Number.isFinite(filters.fullTextWeight)
        ? Math.max(0, Math.min(1, filters.fullTextWeight))
        : 0.5;
    const rawSemanticWeight =
      typeof filters.semanticWeight === "number" &&
      Number.isFinite(filters.semanticWeight)
        ? Math.max(0, Math.min(1, filters.semanticWeight))
        : 0.5;

    const sumWeights = rawTextWeight + rawSemanticWeight;
    fullTextWeight = sumWeights > 0 ? rawTextWeight / sumWeights : 0.5;
    semanticWeight = sumWeights > 0 ? rawSemanticWeight / sumWeights : 0.5;
  }

  const rrfK = validateAndClampRrfK(filters.rrfK);

  if (filters.minLat !== undefined) {
    predicates.push(Prisma.sql`v."latitude" >= ${filters.minLat}`);
  }
  if (filters.maxLat !== undefined) {
    predicates.push(Prisma.sql`v."latitude" <= ${filters.maxLat}`);
  }
  if (filters.minLng !== undefined) {
    predicates.push(Prisma.sql`v."longitude" >= ${filters.minLng}`);
  }
  if (filters.maxLng !== undefined) {
    predicates.push(Prisma.sql`v."longitude" <= ${filters.maxLng}`);
  }
  if (filters.category && filters.category !== "all") {
    predicates.push(Prisma.sql`v."category" = ${filters.category}`);
  }
  if (filters.cities?.length) {
    predicates.push(
      Prisma.sql`(${Prisma.join(
        filters.cities.map(
          (city) => Prisma.sql`v."address" ILIKE ${`%${city}%`}`,
        ),
        " OR ",
      )})`,
    );
  }

  const amenityFilters = normalizeAmenityFilters(filters.amenities);
  for (const amenity of amenityFilters) {
    predicates.push(
      Prisma.sql`EXISTS (SELECT 1 FROM "AmenityValidation" av WHERE av."venueId" = v."id" AND LOWER(av."amenity") = ${amenity})`,
    );
  }

  const venueFilters = predicates.length
    ? Prisma.sql`AND ${Prisma.join(predicates, " AND ")}`
    : Prisma.empty;

  const results = await prisma.$queryRaw<RankedSearchRow[]>(Prisma.sql`
    WITH search_input AS (
      SELECT
        ${searchQuery}::text AS query_text,
        websearch_to_tsquery('english', ${searchQuery}) AS query_terms,
        ${embeddingString}::vector AS query_embedding
    ),
    text_candidates AS (
      SELECT
        v."id",
        ROW_NUMBER() OVER (
          ORDER BY
            CASE
              WHEN lower(v."name") = lower(i.query_text) THEN 0
              WHEN lower(v."name") LIKE lower(i.query_text) || '%' THEN 1
              ELSE 2
            END,
            ts_rank_cd(v."searchVector", i.query_terms) DESC,
            v."id"
        ) AS rank_bm25
      FROM "Venue" v
      CROSS JOIN search_input i
      WHERE (
        v."searchVector" @@ i.query_terms
        OR v."name" ILIKE '%' || i.query_text || '%'
        OR v."address" ILIKE '%' || i.query_text || '%'
      )
      ${venueFilters}
      ORDER BY
        CASE
          WHEN lower(v."name") = lower(i.query_text) THEN 0
          WHEN lower(v."name") LIKE lower(i.query_text) || '%' THEN 1
          ELSE 2
        END,
        ts_rank_cd(v."searchVector", i.query_terms) DESC,
        v."id"
      LIMIT ${candidateLimit}
    ),
    vector_candidates AS (
      SELECT
        v."id",
        ROW_NUMBER() OVER (
          ORDER BY v."searchEmbedding" <=> i.query_embedding, v."id"
        ) AS rank_vector,
        1 - (v."searchEmbedding" <=> i.query_embedding) AS cosine_similarity
      FROM "Venue" v
      CROSS JOIN search_input i
      WHERE i.query_embedding IS NOT NULL
        AND v."searchEmbedding" IS NOT NULL
      ${venueFilters}
      ORDER BY v."searchEmbedding" <=> i.query_embedding, v."id"
      LIMIT ${candidateLimit}
    ),
    fused_candidates AS (
      SELECT "id", rank_bm25, NULL::bigint AS rank_vector
      FROM text_candidates
      UNION ALL
      SELECT "id", NULL::bigint AS rank_bm25, rank_vector
      FROM vector_candidates
    ),
    fused_scores AS (
      SELECT
        "id",
        SUM(CASE WHEN rank_bm25 IS NOT NULL AND rank_bm25 >= 1 THEN ${fullTextWeight} / (${rrfK} + FLOOR(rank_bm25)::bigint) ELSE 0 END)
        + SUM(CASE WHEN rank_vector IS NOT NULL AND rank_vector >= 1 THEN ${semanticWeight} / (${rrfK} + FLOOR(rank_vector)::bigint) ELSE 0 END) AS rrf_score
      FROM fused_candidates
      GROUP BY "id"
    )
    SELECT
      fused_scores."id",
      fused_scores.rrf_score * (1.0 - LEAST(100, GREATEST(0, COALESCE(v."slaPenaltyPoints", 0))) / 100.0) AS score,
      v."searchEmbedding" IS NULL AS needs_embedding,
      (SELECT MAX(cosine_similarity) FROM vector_candidates) AS top_vector_similarity,
      EXISTS (SELECT 1 FROM text_candidates) AS has_text_match,
      concat_ws(' ',
        v."name", v."category", v."address",
        array_to_string(v."foodTags", ' '),
        array_to_string(v."powerTypes", ' '),
        v."noiseLevel", v."lighting", v."musicStyle",
        CASE WHEN v."wifiQuality" IS NOT NULL THEN 'wifi wireless internet' END,
        CASE WHEN v."wifiSpeed" IS NOT NULL THEN v."wifiSpeed"::text || ' mbps fast wifi' END,
        CASE WHEN v."hasOutlets" THEN 'power outlets charging' END,
        CASE WHEN v."hasErgonomic" THEN 'ergonomic seating chair' END,
        CASE WHEN v."hasPhoneBooths" THEN 'phone booth private calls' END,
        CASE WHEN v."hasQuietZone" OR v."noiseLevel" = 'quiet' THEN 'quiet focus concentration' END,
        CASE WHEN v."hasNoMusic" THEN 'no music silent' END,
        CASE WHEN v."dogFriendly" OR v."petsAllowedIndoors" THEN 'dog pet friendly' END,
        CASE WHEN v."hasAncHeadsetRental" THEN 'noise cancelling headset' END
      ) AS search_document
    FROM fused_scores
    JOIN "Venue" v ON v."id" = fused_scores."id"
    ORDER BY score DESC, fused_scores."id"
  `);

  // The confidence columns repeat on every row; read them once and keep them
  // out of the returned venues.
  const rows = results ?? [];
  const topVectorSimilarity = rows[0]?.top_vector_similarity;
  const hasTextMatch = rows[0]?.has_text_match === true;
  const venues: RankedVenueId[] = rows.map(
    ({ top_vector_similarity: _top, has_text_match: _text, ...venue }) => venue,
  );

  let ranked: RankedVenueList = Object.assign(venues, {
    fuzzyMatched: false,
    suggestedQuery: undefined,
  });

  // ── Low-confidence semantic fallback (#7846) ────────────────────────────────
  // Vector search always returns its nearest neighbours, even for a query it
  // does not understand (a typo, a name it has never seen). When nothing
  // matched the text and the best cosine similarity is under the threshold,
  // mix in trigram matches on name, address and amenities.
  const isLowConfidence =
    embeddingString !== null &&
    ranked.length > 0 &&
    !hasTextMatch &&
    topVectorSimilarity !== null &&
    topVectorSimilarity !== undefined &&
    Number.isFinite(Number(topVectorSimilarity)) &&
    Number(topVectorSimilarity) <
      resolveConfidenceThreshold(filters.semanticConfidenceThreshold);

  if (
    isLowConfidence &&
    filters.enableFuzzyFallback !== false &&
    searchQuery.length >= 3
  ) {
    try {
      const fuzzyMatches = await findTrigramMatches(
        searchQuery,
        venueFilters,
        resolveMinSimilarity(filters.minSimilarity),
        Math.min(candidateLimit, LOW_CONFIDENCE_FUZZY_LIMIT),
      );

      if (fuzzyMatches.length > 0) {
        ranked = Object.assign(
          interleaveFuzzyAndSemantic(fuzzyMatches, ranked),
          {
            fuzzyMatched: true,
            suggestedQuery: undefined,
            lowConfidenceFallback: true,
          },
        );
      }
    } catch (fuzzyError) {
      // Keep the semantic results; the fallback is an improvement, not a requirement.
      console.warn(
        "Low-confidence pg_trgm fallback failed, keeping semantic results:",
        fuzzyError,
      );
    }
  }

  // ── Typo tolerance fuzzy matching fallback (pg_trgm SIMILARITY) (#5771) ──────
  // When standard full-text / ts_query search yields 0 rows, trigger trigram similarity
  // query: SIMILARITY(v."name", $query) >= minSimilarity
  if (
    ranked.length === 0 &&
    filters.enableFuzzyFallback !== false &&
    searchQuery.length >= 3
  ) {
    const minSimilarity = resolveMinSimilarity(filters.minSimilarity);

    try {
      const fuzzyResults = await prisma.$queryRaw<
        Array<{
          id: string;
          name: string;
          similarity: number;
          score: number;
          needs_embedding: boolean;
          search_document: string;
        }>
      >(Prisma.sql`
        SELECT
          v."id",
          v."name",
          SIMILARITY(v."name", ${searchQuery}) AS similarity,
          SIMILARITY(v."name", ${searchQuery}) *
            (1.0 - LEAST(100, GREATEST(0, COALESCE(v."slaPenaltyPoints", 0))) / 100.0) AS score,
          v."searchEmbedding" IS NULL AS needs_embedding,
          concat_ws(' ',
            v."name", v."category", v."address",
            array_to_string(v."foodTags", ' '),
            array_to_string(v."powerTypes", ' '),
            v."noiseLevel", v."lighting", v."musicStyle",
            CASE WHEN v."wifiQuality" IS NOT NULL THEN 'wifi wireless internet' END,
            CASE WHEN v."wifiSpeed" IS NOT NULL THEN v."wifiSpeed"::text || ' mbps fast wifi' END,
            CASE WHEN v."hasOutlets" THEN 'power outlets charging' END,
            CASE WHEN v."hasErgonomic" THEN 'ergonomic seating chair' END,
            CASE WHEN v."hasPhoneBooths" THEN 'phone booth private calls' END,
            CASE WHEN v."hasQuietZone" OR v."noiseLevel" = 'quiet' THEN 'quiet focus concentration' END,
            CASE WHEN v."hasNoMusic" THEN 'no music silent' END,
            CASE WHEN v."dogFriendly" OR v."petsAllowedIndoors" THEN 'dog pet friendly' END,
            CASE WHEN v."hasAncHeadsetRental" THEN 'noise cancelling headset' END
          ) AS search_document
        FROM "Venue" v
        WHERE SIMILARITY(v."name", ${searchQuery}) >= ${minSimilarity}
        ${venueFilters}
        ORDER BY score DESC, v."id"
        LIMIT ${candidateLimit}
      `);

      if (fuzzyResults && fuzzyResults.length > 0) {
        const suggestedQuery = fuzzyResults[0].name;
        const mappedFuzzy: RankedVenueId[] = fuzzyResults.map((item) => ({
          id: item.id,
          score: Number(item.score ?? item.similarity ?? 0),
          needs_embedding: Boolean(item.needs_embedding),
          search_document: item.search_document,
          fuzzyMatched: true,
          similarity: Number(item.similarity ?? item.score ?? 0),
          matchedName: item.name,
          suggestedQuery,
        }));

        ranked = Object.assign(mappedFuzzy, {
          fuzzyMatched: true,
          suggestedQuery,
        });
      }
    } catch (fuzzyError) {
      console.warn(
        "Postgres pg_trgm SIMILARITY search fallback failed, attempting in-memory fallback:",
        fuzzyError,
      );

      try {
        const allCandidates = await prisma.venue.findMany({
          select: {
            id: true,
            name: true,
            address: true,
          },
          take: candidateLimit,
        });

        const matchedFuzzy = fuzzyFilterVenues(allCandidates, searchQuery);
        if (matchedFuzzy.length > 0) {
          const suggestedQuery = matchedFuzzy[0].name;
          const mappedFuzzy: RankedVenueId[] = matchedFuzzy.map((v, idx) => ({
            id: v.id,
            score: 1 / (idx + 1),
            fuzzyMatched: true,
            matchedName: v.name,
            suggestedQuery,
          }));

          ranked = Object.assign(mappedFuzzy, {
            fuzzyMatched: true,
            suggestedQuery,
          });
        }
      } catch (inMemoryError) {
        console.warn("In-memory fuzzy fallback failed:", inMemoryError);
      }
    }
  }

  if (embeddingString) {
    for (const candidate of ranked
      .filter((result) => result.needs_embedding)
      .slice(0, 3)) {
      if (candidate.search_document) {
        void indexVenueSearchEmbedding(candidate.id, candidate.search_document);
      }
    }
  }

  return ranked;
}

export async function searchVenuesWithRrf(
  query: string,
  filters: HybridVenueSearchFilters = {},
  candidateLimit = 500,
): Promise<RankedVenueList> {
  const searchQuery = normalizeSearchQuery(query).slice(0, 256);
  if (!searchQuery) {
    return searchVenuesWithRrfUncached(query, filters, candidateLimit);
  }

  return getCachedRankedVenueSearch(searchQuery, filters, candidateLimit, true);
}
