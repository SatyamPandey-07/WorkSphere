/**
 * TopicSimilarityEngine
 * Calculates cosine similarity between pgvector embeddings of users' active work contexts.
 */

export interface UserContext {
  userId: string;
  embedding: number[]; // High-dimensional vector from Groq
  activeTasks: string[];
  location: string;
}

export class TopicSimilarityEngine {
  private dimension: number;

  constructor(dimension: number = 768) {
    this.dimension = dimension;
  }

  /**
   * Calculates the cosine similarity between two vectors.
   * Result ranges from -1 (opposite) to 1 (identical).
   */
  public cosineSimilarity(vecA: number[], vecB: number[]): number {
    if (vecA.length !== vecB.length || vecA.length !== this.dimension) {
      throw new Error('Vector dimension mismatch');
    }

    let dotProduct = 0.0;
    let magA = 0.0;
    let magB = 0.0;

    for (let i = 0; i < this.dimension; i++) {
      dotProduct += vecA[i] * vecB[i];
      magA += vecA[i] * vecA[i];
      magB += vecB[i] * vecB[i];
    }

    magA = Math.sqrt(magA);
    magB = Math.sqrt(magB);

    if (magA === 0 || magB === 0) return 0;

    return dotProduct / (magA * magB);
  }

  /**
   * Finds the top N most similar users for a given target user.
   */
  public findMatches(
    target: UserContext,
    candidates: UserContext[],
    threshold: number = 0.75,
    topN: number = 5
  ): { userId: string; score: number }[] {
    
    // Filter by location first to ensure physical proximity for meetups
    const localCandidates = candidates.filter(c => c.location === target.location && c.userId !== target.userId);

    const scored = localCandidates.map(candidate => ({
      userId: candidate.userId,
      score: this.cosineSimilarity(target.embedding, candidate.embedding)
    }));

    return scored
      .filter(s => s.score >= threshold)
      .sort((a, b) => b.score - a.score)
      .slice(0, topN);
  }

  /**
   * Normalizes a vector to unit length (L2 normalization).
   */
  public normalizeVector(vec: number[]): number[] {
    let magnitude = 0;
    for (let i = 0; i < vec.length; i++) {
      magnitude += vec[i] * vec[i];
    }
    magnitude = Math.sqrt(magnitude);
    
    if (magnitude === 0) return vec;
    
    return vec.map(val => val / magnitude);
  }
}
