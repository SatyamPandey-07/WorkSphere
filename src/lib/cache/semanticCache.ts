import { prisma } from '@/lib/prisma';

// Generate Cohere embedding
export async function generateEmbedding(text: string): Promise<number[]> {
  if (!process.env.COHERE_API_KEY) {
    throw new Error("COHERE_API_KEY is not configured");
  }
    const embedRes = await fetch('https://api.cohere.ai/v1/embed', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.COHERE_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      texts: [text],
      model: 'embed-english-v3.0',
      input_type: 'search_document',
    }),
  });

  if (!embedRes.ok) {
  throw new Error(
    `Cohere API error (${embedRes.status}): ${embedRes.statusText}`,
  );
}

  const embedData = await embedRes.json();
  return embedData.embeddings[0];
}

// Generate CUID for Postgres INSERT
function cuid() {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let id = 'c';
  for (let i = 0; i < 24; i++) {
    id += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return id;
}

export async function checkSemanticCache(query: string, locationStr: string | null) {
  try {
    const embedding = await generateEmbedding(query);
    const embeddingString = `[${embedding.join(',')}]`;

    // Perform vector similarity search. We use cosine distance (<=>).
    // Similarity = 1 - distance. We want similarity > 0.85 -> distance < 0.15
    let results: any[];
    
    if (locationStr) {
      results = await prisma.$queryRaw`
        SELECT "response", 1 - ("embedding" <=> ${embeddingString}::vector) as similarity
        FROM "SemanticCache"
        WHERE "location" = ${locationStr} 
          AND 1 - ("embedding" <=> ${embeddingString}::vector) > 0.85
        ORDER BY similarity DESC
        LIMIT 1
      `;
    } else {
      results = await prisma.$queryRaw`
        SELECT "response", 1 - ("embedding" <=> ${embeddingString}::vector) as similarity
        FROM "SemanticCache"
        WHERE "location" IS NULL 
          AND 1 - ("embedding" <=> ${embeddingString}::vector) > 0.85
        ORDER BY similarity DESC
        LIMIT 1
      `;
    }

    if (results && results.length > 0) {
      return JSON.parse(results[0].response);
    }

    return null;
  } catch (error) {
    console.error("Error checking semantic cache:", error);
    return null;
  }
}

export async function setSemanticCache(query: string, locationStr: string | null, responseObj: any) {
  try {
    const embedding = await generateEmbedding(query);
    const embeddingString = `[${embedding.join(',')}]`;
    const responseJson = JSON.stringify(responseObj);
    const id = cuid();

    await prisma.$executeRaw`
      INSERT INTO "SemanticCache" ("id", "query", "location", "response", "embedding", "createdAt")
      VALUES (${id}, ${query}, ${locationStr}, ${responseJson}, ${embeddingString}::vector, NOW())
    `;
  } catch (error) {
    console.error("Error setting semantic cache:", error);
  }
}
