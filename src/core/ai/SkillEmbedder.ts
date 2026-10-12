/**
 * SkillEmbedder.ts
 * Generates high-dimensional vector embeddings for extracted skills to enable semantic similarity searches.
 * Interfaces with a vector database (e.g., pgvector via Prisma) to store and query embeddings.
 */

export interface SkillEmbedding {
  skill: string;
  vector: number[];
}

export class SkillEmbedder {
  private embeddingModel: string;
  private apiKey: string;

  constructor(apiKey: string, model: string = 'text-embedding-3-small') {
    this.apiKey = apiKey;
    this.embeddingModel = model;
  }

  /**
   * Generates embeddings for a list of skills.
   * @param skills Array of skill strings.
   * @returns Promise resolving to an array of SkillEmbedding objects.
   */
  public async embedSkills(skills: string[]): Promise<SkillEmbedding[]> {
    if (skills.length === 0) {
      return [];
    }

    const embeddings: SkillEmbedding[] = [];
    
    // Process in batches to avoid rate limits
    const batchSize = 10;
    for (let i = 0; i < skills.length; i += batchSize) {
      const batch = skills.slice(i, i + batchSize);
      const batchResults = await this.fetchEmbeddings(batch);
      embeddings.push(...batchResults);
    }

    return embeddings;
  }

  private async fetchEmbeddings(skills: string[]): Promise<SkillEmbedding[]> {
    try {
      // Mock implementation for scaffold. In production, replace with actual OpenAI/Groq embedding API call.
      // const response = await fetch('https://api.openai.com/v1/embeddings', { ... })
      
      const mockEmbeddings = skills.map(skill => ({
        skill,
        // Generate a deterministic mock 1536-dimensional vector for scaffold purposes
        vector: Array.from({ length: 1536 }, (_, i) => Math.sin(i * skill.length) * 0.1)
      }));

      return mockEmbeddings;
    } catch (error) {
      console.error('Error fetching embeddings:', error);
      throw new Error('Failed to generate skill embeddings.');
    }
  }

  /**
   * Calculates cosine similarity between two vectors.
   */
  public calculateCosineSimilarity(vecA: number[], vecB: number[]): number {
    if (vecA.length !== vecB.length) {
      throw new Error('Vectors must be of the same dimension.');
    }

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < vecA.length; i++) {
      dotProduct += vecA[i] * vecB[i];
      normA += vecA[i] * vecA[i];
      normB += vecB[i] * vecB[i];
    }

    if (normA === 0 || normB === 0) return 0;

    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }
}
