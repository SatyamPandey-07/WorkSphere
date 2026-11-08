import { GoogleGenerativeAI } from "@google/generative-ai";
import Redis from "ioredis";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");
const redis = new Redis(process.env.REDIS_URL || "redis://localhost:6379");

const CACHE_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 Days

export interface HybridSearchResult {
  id: string;
  name: string;
  description: string;
  score: number;
}

/**
 * Generates a 768-dimensional text embedding using Gemini Embeddings API, cached in Redis.
 */
export async function getQueryEmbedding(query: string): Promise<number[]> {
  const cacheKey = `embedding:${Buffer.from(query.toLowerCase().trim()).toString("base64")}`;

  try {
    const cached = await redis.get(cacheKey);
    if (cached) {
      return JSON.parse(cached);
    }
  } catch (err) {
    console.warn("[Redis Cache Miss/Error]:", err);
  }

  const model = genAI.getGenerativeModel({ model: "text-embedding-004" });
  const result = await model.embedContent(query);
  const embedding = result.embedding.values;

  try {
    await redis.setex(cacheKey, CACHE_TTL_SECONDS, JSON.stringify(embedding));
  } catch (err) {
    console.warn("[Redis Set Error]:", err);
  }

  return embedding;
}

/**
 * Executes Reciprocal Rank Fusion (RRF) combining vector cosine distance (<->) and FTS ts_rank_cd.
 */
export async function executeHybridSearch(
  query: string,
  prismaClient: any,
  limit: number = 10,
  rrfK: number = 60,
): Promise<HybridSearchResult[]> {
  const embedding = await getQueryEmbedding(query);
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
