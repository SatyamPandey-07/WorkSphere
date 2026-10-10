import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export interface HybridVenueSearchFilters {
  minLat?: number;
  maxLat?: number;
  minLng?: number;
  maxLng?: number;
  category?: string;
  cities?: string[];
}

export interface RankedVenueId {
  id: string;
  score: number;
  needs_embedding?: boolean;
  search_document?: string;
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
  if (embeddingString) {
    for (const candidate of ranked.filter((result) => result.needs_embedding).slice(0, 3)) {
      if (candidate.search_document) {
        void indexVenueSearchEmbedding(candidate.id, candidate.search_document);
      }
    }
  }

  return ranked;
}