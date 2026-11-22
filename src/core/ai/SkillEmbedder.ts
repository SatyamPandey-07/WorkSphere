/**
 * SkillEmbedder.ts
 * Generates 1024-dimensional vector embeddings for extracted skills using real embedding providers
 * (Cohere embed-english-v3.0 or OpenAI text-embedding-3-small with dimensions: 1024),
 * ensuring dimensional compatibility with Venue.searchEmbedding (vector(1024)).
 */

export interface SkillEmbedding {
  skill: string;
  vector: number[];
}

export const TARGET_EMBEDDING_DIMENSION = 1024;

export class SkillEmbedder {
  private apiKey: string;
  private provider: "cohere" | "openai";

  constructor(apiKey?: string, provider?: "cohere" | "openai") {
    const cohereKey = process.env.COHERE_API_KEY;
    const openaiKey = process.env.OPENAI_API_KEY;

    if (apiKey && apiKey !== "mock-key") {
      this.apiKey = apiKey;
      this.provider =
        provider || (apiKey.startsWith("co_") ? "cohere" : "openai");
    } else if (cohereKey && cohereKey !== "mock-key") {
      this.apiKey = cohereKey;
      this.provider = "cohere";
    } else if (openaiKey && openaiKey !== "mock-key") {
      this.apiKey = openaiKey;
      this.provider = "openai";
    } else {
      throw new Error(
        "Embedding provider API key is not configured. Set COHERE_API_KEY or OPENAI_API_KEY in your environment.",
      );
    }
  }

  /**
   * Generates 1024-dimensional embeddings for a list of skills.
   * @param skills Array of skill strings.
   * @returns Promise resolving to an array of SkillEmbedding objects.
   */
  public async embedSkills(skills: string[]): Promise<SkillEmbedding[]> {
    if (!skills || skills.length === 0) {
      return [];
    }

    const cleanSkills = skills.map((s) => s.trim()).filter((s) => s.length > 0);

    if (cleanSkills.length === 0) {
      return [];
    }

    const embeddings: SkillEmbedding[] = [];
    const batchSize = 10;

    for (let i = 0; i < cleanSkills.length; i += batchSize) {
      const batch = cleanSkills.slice(i, i + batchSize);
      const batchResults = await this.fetchEmbeddings(batch);
      embeddings.push(...batchResults);
    }

    return embeddings;
  }

  private async fetchEmbeddings(skills: string[]): Promise<SkillEmbedding[]> {
    if (this.provider === "cohere") {
      return this.fetchCohereEmbeddings(skills);
    }
    return this.fetchOpenAIEmbeddings(skills);
  }

  private async fetchCohereEmbeddings(
    skills: string[],
  ): Promise<SkillEmbedding[]> {
    const response = await fetch("https://api.cohere.ai/v1/embed", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        texts: skills,
        model: "embed-english-v3.0",
        input_type: "search_query",
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Cohere embedding API failed (${response.status}): ${errorText}`,
      );
    }

    const result = await response.json();
    const rawEmbeddings: number[][] = result.embeddings;

    if (
      !Array.isArray(rawEmbeddings) ||
      rawEmbeddings.length !== skills.length
    ) {
      throw new Error("Invalid response format received from Cohere API.");
    }

    return skills.map((skill, idx) => {
      const vector = rawEmbeddings[idx];
      if (
        !Array.isArray(vector) ||
        vector.length !== TARGET_EMBEDDING_DIMENSION
      ) {
        throw new Error(
          `Embedding dimension mismatch: expected ${TARGET_EMBEDDING_DIMENSION}, got ${vector?.length}`,
        );
      }
      return { skill, vector };
    });
  }

  private async fetchOpenAIEmbeddings(
    skills: string[],
  ): Promise<SkillEmbedding[]> {
    const response = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        input: skills,
        model: "text-embedding-3-small",
        dimensions: TARGET_EMBEDDING_DIMENSION,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `OpenAI embedding API failed (${response.status}): ${errorText}`,
      );
    }

    const result = await response.json();
    const data: Array<{ embedding: number[]; index: number }> = result.data;

    if (!Array.isArray(data) || data.length !== skills.length) {
      throw new Error("Invalid response format received from OpenAI API.");
    }

    return skills.map((skill, idx) => {
      const vector = data[idx]?.embedding;
      if (
        !Array.isArray(vector) ||
        vector.length !== TARGET_EMBEDDING_DIMENSION
      ) {
        throw new Error(
          `Embedding dimension mismatch: expected ${TARGET_EMBEDDING_DIMENSION}, got ${vector?.length}`,
        );
      }
      return { skill, vector };
    });
  }

  /**
   * Calculates cosine similarity between two vectors.
   */
  public calculateCosineSimilarity(vecA: number[], vecB: number[]): number {
    if (vecA.length !== vecB.length) {
      throw new Error("Vectors must be of the same dimension.");
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
