/**
 * EmbeddingIndex.ts
 * A lightweight vector store to perform cosine-similarity searches over past conversation nodes 
 * and venue feature descriptions without requiring an external vector database for small-scale ops.
 */

export interface VectorDocument {
  id: string;
  text: string;
  embedding: number[];
  metadata: Record<string, string | number>;
}

export class EmbeddingIndex {
  private documents: Map<string, VectorDocument>;

  constructor() {
    this.documents = new Map();
  }

  public addDocument(doc: VectorDocument): void {
    this.documents.set(doc.id, doc);
  }

  public removeDocument(id: string): void {
    this.documents.delete(id);
  }

  /**
   * Computes cosine similarity between two vectors.
   */
  private cosineSimilarity(vecA: number[], vecB: number[]): number {
    if (vecA.length !== vecB.length) {
      throw new Error('Vector dimensions must match');
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

  /**
   * Searches for the top K most similar documents to the query embedding.
   */
  public search(queryEmbedding: number[], topK: number = 5): { doc: VectorDocument; score: number }[] {
    const scores: { doc: VectorDocument; score: number }[] = [];

    for (const doc of this.documents.values()) {
      const score = this.cosineSimilarity(queryEmbedding, doc.embedding);
      scores.push({ doc, score });
    }

    // Sort descending by score
    scores.sort((a, b) => b.score - a.score);

    return scores.slice(0, topK);
  }

  public getAllDocuments(): VectorDocument[] {
    return Array.from(this.documents.values());
  }
}
