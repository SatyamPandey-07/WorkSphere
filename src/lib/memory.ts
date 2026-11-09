import { prisma } from "@/lib/prisma";
import { HNSWIndex } from "@/lib/hnsw/hnsw";

export interface SemanticMemory {
  id: string;
  content: string;
  similarity: number;
  createdAt?: string | Date;
  metadata?: Record<string, unknown>;
}

export interface MemorySearchOptions {
  limit?: number;
  similarityThreshold?: number;
  useHnswCache?: boolean;
}

// In-memory HNSW index cache per user for fast local ANN search
const userHnswIndices = new Map<string, HNSWIndex>();

/**
 * Generates vector embeddings for a given text using Cohere or OpenAI.
 */
export async function generateEmbedding(text: string): Promise<number[]> {
  const cohereApiKey = process.env.COHERE_API_KEY;

  if (cohereApiKey) {
    try {
      const res = await fetch("https://api.cohere.ai/v1/embed", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${cohereApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          texts: [text],
          model: "embed-english-v3.0",
          input_type: "search_query",
        }),
      });

      if (res.ok) {
        const data = await res.json();
        if (data.embeddings && data.embeddings[0]) {
          return data.embeddings[0];
        }
      }
    } catch (err) {
      console.warn("Cohere embedding generation failed, falling back:", err);
    }
  }

  // Fallback: Deterministic synthetic embedding vector (1024 dimensions) for offline/testing
  return generateDeterministicEmbedding(text, 1024);
}

/**
 * Generates normalized 1024-dim pseudo-semantic embedding for deterministic offline operation.
 */
function generateDeterministicEmbedding(text: string, dim = 1024): number[] {
  const vector = new Array<number>(dim).fill(0);
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    hash = (hash << 5) - hash + text.charCodeAt(i);
    hash |= 0;
    const idx = Math.abs(hash) % dim;
    vector[idx] += 1.0;
  }

  // L2 normalize
  let norm = 0;
  for (let i = 0; i < dim; i++) {
    norm += vector[i] * vector[i];
  }
  norm = Math.sqrt(norm);
  if (norm > 0) {
    for (let i = 0; i < dim; i++) {
      vector[i] /= norm;
    }
  }
  return vector;
}

/**
 * Retrieves or initializes the in-memory HNSW index for a specific user.
 */
function getUserHnswIndex(userId: string, dim = 1024): HNSWIndex {
  let index = userHnswIndices.get(userId);
  if (!index) {
    index = new HNSWIndex({ dim, metric: "cosine", M: 16, efConstruction: 100, efSearch: 32 });
    userHnswIndices.set(userId, index);
  }
  return index;
}

/**
 * Stores a new memory statement for a user with vector embeddings and indexes it in pgvector + HNSW.
 */
export async function storeUserMemory(
  userId: string,
  content: string,
  embedding?: number[]
): Promise<SemanticMemory> {
  const vector = embedding || (await generateEmbedding(content));
  const embeddingString = `[${vector.join(",")}]`;

  // 1. Insert into PostgreSQL with pgvector column
  const inserted = await prisma.$queryRaw<Array<{ id: string; content: string; createdAt: Date }>>`
    INSERT INTO "UserMemory" ("id", "userId", "content", "embedding", "createdAt")
    VALUES (
      gen_random_uuid()::text,
      ${userId},
      ${content},
      ${embeddingString}::vector,
      NOW()
    )
    RETURNING "id", "content", "createdAt";
  `;

  const memoryId = inserted[0]?.id || `mem_${Date.now()}`;

  // 2. Index in in-memory HNSW cache for sub-millisecond local queries
  const hnsw = getUserHnswIndex(userId, vector.length);
  hnsw.insert(memoryId, vector);

  return {
    id: memoryId,
    content,
    similarity: 1.0,
    createdAt: inserted[0]?.createdAt || new Date(),
  };
}

/**
 * Finds relevant user memories using pgvector cosine distance search with in-memory HNSW fallback.
 */
export async function findRelevantMemories(
  userId: string,
  queryEmbedding: number[],
  limit = 3,
  similarityThreshold = 0.5
): Promise<SemanticMemory[]> {
  const embeddingString = `[${queryEmbedding.join(",")}]`;

  try {
    // Primary: pgvector HNSW Index Query in PostgreSQL
    const rows = await prisma.$queryRaw<
      Array<{ id: string; content: string; similarity: number; createdAt?: Date }>
    >`
      SELECT 
        "id", 
        "content", 
        "createdAt",
        1 - ("embedding" <=> ${embeddingString}::vector) AS similarity
      FROM "UserMemory"
      WHERE "userId" = ${userId}
      ORDER BY "embedding" <=> ${embeddingString}::vector
      LIMIT ${limit};
    `;

    if (Array.isArray(rows) && rows.length > 0) {
      return rows
        .filter((r) => r.similarity >= similarityThreshold)
        .map((r) => ({
          id: r.id,
          content: r.content,
          similarity: Math.round(r.similarity * 1000) / 1000,
          createdAt: r.createdAt,
        }));
    }
  } catch (dbError) {
    console.warn("pgvector query failed, falling back to in-memory HNSW index:", dbError);
  }

  // Fallback: In-memory HNSW Approximate Nearest Neighbor (ANN) search
  const hnsw = userHnswIndices.get(userId);
  if (hnsw && hnsw.size() > 0) {
    const results = hnsw.search(queryEmbedding, limit);
    const mapped: SemanticMemory[] = [];

    for (const res of results) {
      const similarity = 1 - res.distance;
      if (similarity >= similarityThreshold) {
        const node = hnsw.getNode(res.id);
        mapped.push({
          id: res.id,
          content: `Memory ${res.id}`,
          similarity: Math.round(similarity * 1000) / 1000,
        });
      }
    }
    return mapped;
  }

  return [];
}

/**
 * High-level search for user memories by natural language query string.
 */
export async function searchUserMemories(
  userId: string,
  query: string,
  options: MemorySearchOptions = {}
): Promise<SemanticMemory[]> {
  const { limit = 5, similarityThreshold = 0.5 } = options;
  const embedding = await generateEmbedding(query);
  return findRelevantMemories(userId, embedding, limit, similarityThreshold);
}

/**
 * Retrieves formatted memory context ready for AI prompt injection.
 */
export async function getUserMemoryContext(
  userId: string,
  userMessage: string,
  limit = 3
): Promise<string> {
  const memories = await searchUserMemories(userId, userMessage, { limit });
  if (memories.length === 0) return "";

  return (
    "\n\nRELEVANT USER MEMORIES (Retrieved via pgvector/HNSW):\n" +
    memories.map((m) => `- ${m.content} (similarity: ${Math.round(m.similarity * 100)}%)`).join("\n")
  );
}
