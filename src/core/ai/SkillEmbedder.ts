/**
 * SkillEmbedder.ts
 * Generates 1024-dimensional vector embeddings for extracted skills using real embedding providers
 * (Cohere embed-english-v3.0 or OpenAI text-embedding-3-small with dimensions: 1024),
 * ensuring dimensional compatibility with Venue.searchEmbedding (vector(1024)).
 *
 * @see docs/ai/SEMANTIC_MATCHING_ENGINE.md for detailed documentation on embedding tokenization,
 * cosine distance metrics, and pgvector HNSW index tuning.
 */

export interface SkillEmbedding {
  skill: string;
  vector: number[];
}

export const TARGET_EMBEDDING_DIMENSION = 1024;

export class SkillEmbedder {
  private apiKey: string;
  private provider: "cohere" | "openai";
  private static globalEmbeddingCache = new Map<string, number[]>();

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
   * Clears the in-memory skill embedding cache (useful for tests and memory management).
   */
  public static clearCache(): void {
    SkillEmbedder.globalEmbeddingCache.clear();
  }

  /**
   * Generates 1024-dimensional embeddings for a list of skills.
   * Leverages caching to avoid regenerating embeddings for identical skills.
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

    const results: SkillEmbedding[] = [];
    const missingSkills: string[] = [];
    const cacheKeyPrefix = `${this.provider}:`;

    for (const skill of cleanSkills) {
      const cached = SkillEmbedder.globalEmbeddingCache.get(
        `${cacheKeyPrefix}${skill.toLowerCase()}`,
      );
      if (cached) {
        results.push({ skill, vector: cached });
      } else {
        missingSkills.push(skill);
      }
    }

    if (missingSkills.length > 0) {
      const batchSize = 10;
      for (let i = 0; i < missingSkills.length; i += batchSize) {
        const batch = missingSkills.slice(i, i + batchSize);
        const batchResults = await this.fetchEmbeddings(batch);
        for (const item of batchResults) {
          SkillEmbedder.globalEmbeddingCache.set(
            `${cacheKeyPrefix}${item.skill.toLowerCase()}`,
            item.vector,
          );
          results.push(item);
        }
      }
    }

    return results;
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
   * Clamps results within [-1.0, 1.0] and handles zero/non-finite inputs safely.
   */
  public calculateCosineSimilarity(
    vecA: number[] | Float64Array | null | undefined,
    vecB: number[] | Float64Array | null | undefined,
  ): number {
    if (!vecA || !vecB) return 0;
    if (vecA.length !== vecB.length) {
      throw new Error("Vectors must be of the same dimension.");
    }
    if (vecA.length === 0) return 0;

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < vecA.length; i++) {
      const a = vecA[i];
      const b = vecB[i];
      if (!Number.isFinite(a) || !Number.isFinite(b)) {
        return 0;
      }
      dotProduct += a * b;
      normA += a * a;
      normB += b * b;
    }

    if (normA === 0 || normB === 0) return 0;

    const denominator = Math.sqrt(normA) * Math.sqrt(normB);
    if (denominator === 0 || !Number.isFinite(denominator)) return 0;

    const rawSim = dotProduct / denominator;
    return Math.max(-1.0, Math.min(1.0, rawSim));
  }
}

/**
 * Normalizes a skill string for uniform comparison and deduplication.
 * Strips whitespace, hyphens, and underscores, converting to lowercase.
 */
export function normalizeSkill(skill: string): string {
  if (!skill || typeof skill !== "string") return "";
  return skill
    .toLowerCase()
    .trim()
    .replace(/[-_\s]+/g, "");
}

/**
 * Extracts shared skill highlights between resume skills and candidate skills.
 * Preserves original display casing from the resume or candidate where available.
 * Returns a bounded list of unique matched skills.
 */
export function extractSharedSkillHighlights(
  resumeSkills: string[],
  candidateSkills: string[],
  maxHighlights = 10,
): string[] {
  if (!Array.isArray(resumeSkills) || !Array.isArray(candidateSkills)) {
    return [];
  }

  const normalizedResumeMap = new Map<string, string>();
  for (const s of resumeSkills) {
    if (typeof s === "string") {
      const trimmed = s.trim();
      const norm = normalizeSkill(trimmed);
      if (norm && !normalizedResumeMap.has(norm)) {
        normalizedResumeMap.set(norm, trimmed);
      }
    }
  }

  const shared: string[] = [];
  const seenNorm = new Set<string>();

  for (const c of candidateSkills) {
    if (typeof c === "string") {
      const trimmed = c.trim();
      const norm = normalizeSkill(trimmed);
      if (norm && normalizedResumeMap.has(norm) && !seenNorm.has(norm)) {
        seenNorm.add(norm);
        shared.push(normalizedResumeMap.get(norm) || trimmed);
        if (shared.length >= maxHighlights) {
          break;
        }
      }
    }
  }

  return shared;
}

/**
 * Converts a cosine similarity score [-1, 1] to a bounded match percentage [0, 100].
 */
export function similarityToMatchPercentage(similarity: number): number {
  if (!Number.isFinite(similarity)) return 0;
  const clamped = Math.max(0, Math.min(1, similarity));
  return parseFloat((clamped * 100).toFixed(1));
}
