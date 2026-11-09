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
  private textIndex: Map<string, string>; // normalizedKey -> canonicalDocId
  private idAliases: Map<string, string>; // aliasId -> canonicalDocId
  private locks: Set<string>;

  constructor() {
    this.documents = new Map();
    this.textIndex = new Map();
    this.idAliases = new Map();
    this.locks = new Set();
  }

  private getDocKey(doc: VectorDocument): string {
    const entityName = (doc.metadata?.entityName || doc.metadata?.name || doc.metadata?.label) as string | undefined;
    if (entityName && typeof entityName === 'string' && entityName.trim().length > 0) {
      return `entity:${entityName.trim().toLowerCase()}`;
    }
    return `text:${doc.text.trim().toLowerCase()}`;
  }

  public resolveDocId(id: string): string {
    return this.idAliases.get(id) ?? id;
  }

  /**
   * Acquires an idempotent insertion lock for an entity or text key.
   */
  public async acquireLock(key: string, timeoutMs = 5000): Promise<() => void> {
    const start = Date.now();
    while (this.locks.has(key)) {
      if (Date.now() - start > timeoutMs) {
        throw new Error(`Embedding index lock timeout for key: ${key}`);
      }
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    this.locks.add(key);
    return () => {
      this.locks.delete(key);
    };
  }

  /**
   * Executes an asynchronous task protected by an insertion lock.
   */
  public async withLock<T>(key: string, task: () => Promise<T> | T): Promise<T> {
    const unlock = await this.acquireLock(key);
    try {
      return await task();
    } finally {
      unlock();
    }
  }

  public isLocked(key: string): boolean {
    return this.locks.has(key);
  }

  public addDocument(doc: VectorDocument): VectorDocument {
    const resolvedId = this.resolveDocId(doc.id);
    const key = this.getDocKey(doc);
    const canonicalId =
      this.textIndex.get(key) ??
      (this.documents.has(resolvedId) ? resolvedId : undefined);

    if (canonicalId && this.documents.has(canonicalId)) {
      const existing = this.documents.get(canonicalId)!;
      const updated: VectorDocument = {
        ...existing,
        ...doc,
        id: canonicalId,
        metadata: {
          ...existing.metadata,
          ...doc.metadata,
        },
      };
      this.documents.set(canonicalId, updated);
      if (doc.id !== canonicalId) {
        this.idAliases.set(doc.id, canonicalId);
      }
      return updated;
    }

    this.documents.set(doc.id, doc);
    this.textIndex.set(key, doc.id);
    return doc;
  }

  public getDocument(id: string): VectorDocument | undefined {
    const resolvedId = this.resolveDocId(id);
    return this.documents.get(resolvedId);
  }

  public removeDocument(id: string): void {
    const resolvedId = this.resolveDocId(id);
    const doc = this.documents.get(resolvedId);
    if (doc) {
      const key = this.getDocKey(doc);
      this.textIndex.delete(key);
    }
    this.documents.delete(resolvedId);
    this.idAliases.delete(id);
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
