import prisma from '@/lib/prisma';

export interface SemanticMemory {
  id: string;
  content: string;
  similarity: number;
}

export async function findRelevantMemories(userId: string, queryEmbedding: number[], limit = 3): Promise<SemanticMemory[]> {
  try {
    const memories = await prisma.$queryRaw<SemanticMemory[]>`
      SELECT 
        id, 
        content, 
        1 - (embedding <=> ${queryEmbedding}::vector) as similarity
      FROM "UserMemory"
      WHERE "userId" = ${userId}
      ORDER BY embedding <=> ${queryEmbedding}::vector
      LIMIT ${limit};
    `;
    
    return memories;
  } catch (error) {
    console.error('Semantic search failed:', error);
    return [];
  }
}
