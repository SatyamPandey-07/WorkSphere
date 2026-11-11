 feature/solana-optimistic-escrow-simulation
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

import { prisma } from "@/lib/prisma";
 main

export interface VenueSearchResult {
  id: string;
  name: string;
  description: string;
  category: string;
  score: number;
}

export async function searchVenuesPhonetic(
  query: string,
 feature/solana-optimistic-escrow-simulation
  limit: number = 20

  limit: number = 20,
 main
): Promise<VenueSearchResult[]> {
  if (!query || query.trim().length === 0) {
    return [];
  }

  const sanitizedQuery = query.trim().replace(/['"\\]/g, "");

  const results = await prisma.$queryRaw<VenueSearchResult[]>`
    SELECT 
      id,
      name,
      description,
      category,
      (
        0.5 * similarity(name, ${sanitizedQuery}) +
        0.3 * ts_rank(
          to_tsvector('english', COALESCE(name, '') || ' ' || COALESCE(description, '')),
          websearch_to_tsquery('english', ${sanitizedQuery})
        ) +
        0.2 * CASE 
          WHEN dmetaphone(name) = dmetaphone(${sanitizedQuery}) THEN 1.0
          WHEN dmetaphone(name) LIKE '%' || dmetaphone(${sanitizedQuery}) || '%' THEN 0.5
          ELSE 0.0
        END
      )::double precision AS score
    FROM "Venue"
    WHERE 
      similarity(name, ${sanitizedQuery}) > 0.15
      OR to_tsvector('english', COALESCE(name, '') || ' ' || COALESCE(description, '')) @@ websearch_to_tsquery('english', ${sanitizedQuery})
      OR dmetaphone(name) = dmetaphone(${sanitizedQuery})
    ORDER BY score DESC
    LIMIT ${limit};
  `;

  return results;
 feature/solana-optimistic-escrow-simulation
}

}
 main
