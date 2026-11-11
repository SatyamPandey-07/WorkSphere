import { prisma } from "@/lib/prisma";

export interface VenueSearchResult {
  id: string;
  name: string;
  description: string;
  category: string;
  score: number;
}

/**
 * Combines pg_trgm typo matching, English full-text rank, Double Metaphone,
 * and a small historical-booking popularity signal for venue-name searches.
 */
export async function searchVenuesPhonetic(
  query: string,
  limit = 20,
): Promise<VenueSearchResult[]> {
  const normalizedQuery = typeof query === "string" ? query.trim().slice(0, 128) : "";
  if (!normalizedQuery) return [];

  const safeLimit = Number.isInteger(limit)
    ? Math.max(1, Math.min(50, limit))
    : 20;

  return prisma.$queryRaw<VenueSearchResult[]> `
    SELECT
      venue."id",
      venue."name",
      venue."description",
      venue."category",
      (
        0.55 * similarity(venue."name", ${normalizedQuery}) +
        0.25 * ts_rank(
          to_tsvector(
            'english',
            COALESCE(venue."name", '') || ' ' || COALESCE(venue."description", '')
          ),
          websearch_to_tsquery('english', ${normalizedQuery})
        ) +
        0.15 * CASE
          WHEN dmetaphone(venue."name") = dmetaphone(${normalizedQuery}) THEN 1.0
          WHEN dmetaphone(venue."name") LIKE '%' || dmetaphone(${normalizedQuery}) || '%' THEN 0.5
          ELSE 0.0
        END +
        0.05 * LEAST(
          LN(1 + COALESCE(popularity.booking_count, 0)) / LN(101),
          1.0
        )
      )::double precision AS score
    FROM "Venue" AS venue
    LEFT JOIN LATERAL (
      SELECT COUNT(*)::double precision AS booking_count
      FROM "Booking" AS booking
      WHERE booking."venueId" = venue."id"
    ) AS popularity ON TRUE
    WHERE
      similarity(venue."name", ${normalizedQuery}) > 0.3
      OR to_tsvector(
        'english',
        COALESCE(venue."name", '') || ' ' || COALESCE(venue."description", '')
      ) @@ websearch_to_tsquery('english', ${normalizedQuery})
      OR dmetaphone(venue."name") = dmetaphone(${normalizedQuery})
    ORDER BY
      score DESC,
      popularity.booking_count DESC,
      venue."rating" DESC NULLS LAST,
      venue."name" ASC
    LIMIT ${safeLimit};
  `;
}
