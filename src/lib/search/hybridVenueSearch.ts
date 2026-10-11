import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { fuzzyFilterVenues } from "@/lib/search/fuzzySearch";

export interface HybridVenueSearchFilters {
  minLat?: number;
  maxLat?: number;
  minLng?: number;
  maxLng?: number;
  category?: string;
  cities?: string[];
  semanticWeight?: number;
  fullTextWeight?: number;
  rrfK?: number;
  queryEmbedding?: number[] | null;
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
}

export interface HybridVenueSearchResult {
  venues: RankedVenueId[];
  fuzzyMatched: boolean;
  suggestedQuery?: string;
}

export const DEFAULT_RRF_K = 60;

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
  if (rank === null || rank === undefined || !Number.isFinite(rank) || rank <= 0) {
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
    return Array.isArray(embedding) && embedding.length === 1024 ? embedding : null;
  } catch (error) {
    console.warn("Venue search embedding generation failed:", error);
    return null;
  }
}

export async function searchVenuesWithRrf(
  query: string,
  filters: HybridVenueSearchFilters = {},
  candidateLimit = 500,
): Promise<RankedVenueId[]> {
  const searchQuery = query.trim().slice(0, 256);
  if (!searchQuery) return [];

  const embedding = await embedSearchQuery(searchQuery);
  const embeddingString = embedding ? `[${embedding.join(",")}]` : null;
  const predicates: Prisma.Sql[] = [];

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

  const venueFilters = predicates.length
    ? Prisma.sql`AND ${Prisma.join(predicates, " AND ")}`
    : Prisma.empty;

  const results = await prisma.$queryRaw<RankedVenueId[]>(Prisma.sql`
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
        ) AS rank_vector
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
        SUM(CASE WHEN rank_bm25 IS NOT NULL THEN 1.0 / (60 + rank_bm25) ELSE 0 END)
        + SUM(CASE WHEN rank_vector IS NOT NULL THEN 1.0 / (60 + rank_vector) ELSE 0 END) AS rrf_score
        SUM(CASE WHEN rank_bm25 IS NOT NULL AND rank_bm25 >= 1 THEN ${fullTextWeight} / (${rrfK} + FLOOR(rank_bm25)::bigint) ELSE 0 END)
        + SUM(CASE WHEN rank_vector IS NOT NULL AND rank_vector >= 1 THEN ${semanticWeight} / (${rrfK} + FLOOR(rank_vector)::bigint) ELSE 0 END) AS rrf_score
      FROM fused_candidates
      GROUP BY "id"
    )
    SELECT
      fused_scores."id",
      fused_scores.rrf_score AS score,
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
    FROM fused_scores
    JOIN "Venue" v ON v."id" = fused_scores."id"
    ORDER BY fused_scores.rrf_score DESC, fused_scores."id"
  `);

  const ranked = results ?? [];
  let ranked: RankedVenueList = Object.assign([...(results ?? [])], {
    fuzzyMatched: false,
    suggestedQuery: undefined,
  });

  // ── Typo tolerance fuzzy matching fallback (pg_trgm SIMILARITY) (#5771) ──────
  // When standard full-text / ts_query search yields 0 rows, trigger trigram similarity
  // query: SIMILARITY(v."name", $query) >= minSimilarity
  if (
    ranked.length === 0 &&
    filters.enableFuzzyFallback !== false &&
    searchQuery.length >= 3
  ) {
    const minSimilarity =
      typeof filters.minSimilarity === "number" && Number.isFinite(filters.minSimilarity)
        ? Math.max(0.05, Math.min(1.0, filters.minSimilarity))
        : 0.25;

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
          SIMILARITY(v."name", ${searchQuery}) AS score,
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
        ORDER BY SIMILARITY(v."name", ${searchQuery}) DESC, v."id"
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
            description: true,
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
    for (const candidate of ranked.filter((result) => result.needs_embedding).slice(0, 3)) {
      if (candidate.search_document) {
        void indexVenueSearchEmbedding(candidate.id, candidate.search_document);
      }
    }
  }

  return ranked;
}