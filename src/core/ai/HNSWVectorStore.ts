/**
 * @file HNSWVectorStore.ts
 * @description Hierarchical Navigable Small World (HNSW) multi-layer graph vector indexing
 * and approximate nearest neighbor (ANN) search engine for WorkSphere embeddings.
 */

export const MetricType = {
  COSINE: 'COSINE',
  EUCLIDEAN: 'EUCLIDEAN',
  DOT_PRODUCT: 'DOT_PRODUCT',
} as const;

export type MetricTypeKey = typeof MetricType[keyof typeof MetricType];

export interface VectorDocument {
  id: string;
  vector: number[];
  metadata?: Record<string, unknown>;
}

export interface SearchResult {
  id: string;
  score: number; // Similarity score (higher = closer, 0 to 1 for normalized cosine)
  distance: number; // Metric distance (lower = closer)
  metadata?: Record<string, unknown>;
}

export interface HNSWConfig {
  dimensions: number;
  metric?: MetricTypeKey;
  M?: number; // Max connections per layer > 0 (default: 16)
  M0?: number; // Max connections for layer 0 (default: 32)
  efConstruction?: number; // Size of dynamic candidate list during build (default: 64)
  efSearch?: number; // Size of dynamic candidate list during search (default: 32)
  mL?: number; // Normalization factor for layer generation (default: 1 / ln(M))
}

interface InternalNode {
  id: string;
  vector: number[];
  level: number;
  neighbors: Map<number, string[]>; // layer -> list of neighbor IDs
  metadata?: Record<string, unknown>;
}

export class HNSWVectorStore {
  private _dimensions: number;
  private _metric: MetricTypeKey;
  private _M: number;
  private _M0: number;
  private _efConstruction: number;
  private _efSearch: number;
  private _mL: number;
  private _nodes: Map<string, InternalNode>;
  private _entryPointId: string | null;
  private _maxLevel: number;

  constructor(config: HNSWConfig) {
    if (!config.dimensions || config.dimensions <= 0) {
      throw new Error('HNSWVectorStore requires positive dimensions.');
    }
    this._dimensions = config.dimensions;
    this._metric = config.metric ?? MetricType.COSINE;
    this._M = config.M ?? 16;
    this._M0 = config.M0 ?? (this._M * 2);
    this._efConstruction = config.efConstruction ?? 64;
    this._efSearch = config.efSearch ?? 32;
    this._mL = config.mL ?? (1 / Math.log(this._M > 1 ? this._M : 2));
    this._nodes = new Map();
    this._entryPointId = null;
    this._maxLevel = -1;
  }

  public get size(): number {
    return this._nodes.size;
  }

  public get maxLevel(): number {
    return this._maxLevel;
  }

  public get metric(): MetricTypeKey {
    return this._metric;
  }

  /**
   * Computes vector distance based on configured metric.
   */
  public computeDistance(a: number[], b: number[]): number {
    if (a.length !== this._dimensions || b.length !== this._dimensions) {
      throw new Error(`Dimension mismatch: expected ${this._dimensions}, got a=${a.length}, b=${b.length}`);
    }

    if (this._metric === MetricType.EUCLIDEAN) {
      let sum = 0;
      for (let i = 0; i < this._dimensions; i++) {
        const diff = a[i] - b[i];
        sum += diff * diff;
      }
      return Math.sqrt(sum);
    }

    if (this._metric === MetricType.DOT_PRODUCT) {
      let dot = 0;
      for (let i = 0; i < this._dimensions; i++) {
        dot += a[i] * b[i];
      }
      return -dot; // negate so smaller distance = greater dot product
    }

    // Default: COSINE
    let dot = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < this._dimensions; i++) {
      dot += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    const denom = Math.sqrt(normA) * Math.sqrt(normB);
    if (denom < 1e-12) return 1.0;
    const cosineSim = dot / denom;
    return Math.max(0, 1.0 - cosineSim);
  }

  /**
   * Inserts a document vector into the HNSW multi-layer graph.
   */
  public insert(doc: VectorDocument): void {
    if (doc.vector.length !== this._dimensions) {
      throw new Error(`Vector dimension ${doc.vector.length} does not match index dimension ${this._dimensions}`);
    }

    if (this._nodes.has(doc.id)) {
      this.delete(doc.id);
    }

    const insertLevel = this.generateRandomLevel();
    const newNode: InternalNode = {
      id: doc.id,
      vector: [...doc.vector],
      level: insertLevel,
      neighbors: new Map(),
      metadata: doc.metadata ? { ...doc.metadata } : undefined,
    };

    for (let l = 0; l <= insertLevel; l++) {
      newNode.neighbors.set(l, []);
    }

    if (this._entryPointId === null) {
      this._nodes.set(doc.id, newNode);
      this._entryPointId = doc.id;
      this._maxLevel = insertLevel;
      return;
    }

    let currObj = this._entryPointId;
    let currDist = this.computeDistance(doc.vector, this._nodes.get(currObj)!.vector);

    // 1. Search layers from top down to insertLevel + 1 with greedy 1-NN search
    for (let level = this._maxLevel; level > insertLevel; level--) {
      let changed = true;
      while (changed) {
        changed = false;
        const neighbors = this._nodes.get(currObj)!.neighbors.get(level) || [];
        for (const neighborId of neighbors) {
          const neighborNode = this._nodes.get(neighborId);
          if (!neighborNode) continue;
          const d = this.computeDistance(doc.vector, neighborNode.vector);
          if (d < currDist) {
            currDist = d;
            currObj = neighborId;
            changed = true;
          }
        }
      }
    }

    // 2. Search layers from min(maxLevel, insertLevel) down to 0 with beam search
    let ep = [currObj];
    const topLevelForInsert = Math.min(this._maxLevel, insertLevel);

    for (let level = topLevelForInsert; level >= 0; level--) {
      const candidates = this.searchLayer(doc.vector, ep, this._efConstruction, level);
      const mMax = level === 0 ? this._M0 : this._M;
      const neighbors = this.selectNeighbors(candidates, mMax);

      newNode.neighbors.set(level, [...neighbors]);

      // Add bidirectional links and prune if exceeding degree limit
      for (const neighborId of neighbors) {
        const neighborNode = this._nodes.get(neighborId);
        if (!neighborNode) continue;
        const curList = neighborNode.neighbors.get(level) || [];
        if (!curList.includes(doc.id)) {
          curList.push(doc.id);
          if (curList.length > mMax) {
            const pruned = this.selectNeighbors(
              curList.map((id) => ({
                id,
                distance: this.computeDistance(neighborNode.vector, this._nodes.get(id)!.vector),
              })),
              mMax
            );
            neighborNode.neighbors.set(level, pruned);
          } else {
            neighborNode.neighbors.set(level, curList);
          }
        }
      }

      ep = candidates.map((c) => c.id);
    }

    this._nodes.set(doc.id, newNode);

    if (insertLevel > this._maxLevel) {
      this._maxLevel = insertLevel;
      this._entryPointId = doc.id;
    }
  }

  /**
   * Searches for k approximate nearest neighbors.
   */
  public search(
    queryVector: number[],
    k: number,
    filter?: (metadata?: Record<string, unknown>) => boolean,
    efSearchOverride?: number
  ): SearchResult[] {
    if (this._nodes.size === 0 || this._entryPointId === null) {
      return [];
    }

    if (queryVector.length !== this._dimensions) {
      throw new Error(`Query vector dimension ${queryVector.length} does not match index ${this._dimensions}`);
    }

    const ef = Math.max(k, efSearchOverride ?? this._efSearch);
    let currObj = this._entryPointId;
    let currDist = this.computeDistance(queryVector, this._nodes.get(currObj)!.vector);

    // Greedy 1-NN top down to level 1
    for (let level = this._maxLevel; level > 0; level--) {
      let changed = true;
      while (changed) {
        changed = false;
        const neighbors = this._nodes.get(currObj)!.neighbors.get(level) || [];
        for (const neighborId of neighbors) {
          const neighborNode = this._nodes.get(neighborId);
          if (!neighborNode) continue;
          const d = this.computeDistance(queryVector, neighborNode.vector);
          if (d < currDist) {
            currDist = d;
            currObj = neighborId;
            changed = true;
          }
        }
      }
    }

    // Beam search on layer 0
    const candidates = this.searchLayer(queryVector, [currObj], ef, 0);

    // Apply optional metadata filter and format top k
    const results: SearchResult[] = [];
    for (const item of candidates) {
      const node = this._nodes.get(item.id);
      if (!node) continue;
      if (filter && !filter(node.metadata)) {
        continue;
      }

      let similarityScore = 0;
      if (this._metric === MetricType.COSINE) {
        similarityScore = Math.max(0, 1.0 - item.distance);
      } else if (this._metric === MetricType.DOT_PRODUCT) {
        similarityScore = -item.distance; // restore positive dot product
      } else {
        similarityScore = 1.0 / (1.0 + item.distance);
      }

      results.push({
        id: item.id,
        score: Number(similarityScore.toFixed(6)),
        distance: Number(item.distance.toFixed(6)),
        metadata: node.metadata ? { ...node.metadata } : undefined,
      });

      if (results.length >= k) break;
    }

    return results;
  }

  /**
   * Deletes a vector document from the HNSW graph.
   */
  public delete(id: string): boolean {
    const node = this._nodes.get(id);
    if (!node) return false;

    // Disconnect from all neighbors on each layer
    for (let l = 0; l <= node.level; l++) {
      const neighbors = node.neighbors.get(l) || [];
      for (const neighborId of neighbors) {
        const neighbor = this._nodes.get(neighborId);
        if (neighbor) {
          const updated = (neighbor.neighbors.get(l) || []).filter((nId) => nId !== id);
          neighbor.neighbors.set(l, updated);
        }
      }
    }

    this._nodes.delete(id);

    // If entry point was deleted, pick new entry point
    if (this._entryPointId === id) {
      if (this._nodes.size === 0) {
        this._entryPointId = null;
        this._maxLevel = -1;
      } else {
        let maxL = -1;
        let bestEp = '';
        for (const [nId, n] of this._nodes) {
          if (n.level > maxL) {
            maxL = n.level;
            bestEp = nId;
          }
        }
        this._maxLevel = maxL;
        this._entryPointId = bestEp;
      }
    }

    return true;
  }

  /**
   * Serializes index to structured JSON representation.
   */
  public toJSON(): string {
    const serializedNodes = Array.from(this._nodes.entries()).map(([id, n]) => ({
      id,
      vector: n.vector,
      level: n.level,
      neighbors: Array.from(n.neighbors.entries()).map(([lvl, nbrs]) => [lvl, nbrs]),
      metadata: n.metadata,
    }));

    return JSON.stringify({
      dimensions: this._dimensions,
      metric: this._metric,
      M: this._M,
      M0: this._M0,
      efConstruction: this._efConstruction,
      efSearch: this._efSearch,
      mL: this._mL,
      entryPointId: this._entryPointId,
      maxLevel: this._maxLevel,
      nodes: serializedNodes,
    });
  }

  /**
   * Restores an HNSW index from serialized JSON.
   */
  public static fromJSON(jsonStr: string): HNSWVectorStore {
    const data = JSON.parse(jsonStr);
    const store = new HNSWVectorStore({
      dimensions: data.dimensions,
      metric: data.metric,
      M: data.M,
      M0: data.M0,
      efConstruction: data.efConstruction,
      efSearch: data.efSearch,
      mL: data.mL,
    });

    store._entryPointId = data.entryPointId;
    store._maxLevel = data.maxLevel;

    for (const item of data.nodes) {
      const neighborMap = new Map<number, string[]>();
      for (const [lvl, nbrs] of item.neighbors) {
        neighborMap.set(Number(lvl), nbrs);
      }

      store._nodes.set(item.id, {
        id: item.id,
        vector: item.vector,
        level: item.level,
        neighbors: neighborMap,
        metadata: item.metadata,
      });
    }

    return store;
  }

  /**
   * Explores a specific layer using beam search with dynamic candidate list of size ef.
   */
  private searchLayer(
    queryVector: number[],
    entryPoints: string[],
    ef: number,
    level: number
  ): Array<{ id: string; distance: number }> {
    const visited = new Set<string>();
    const candidates: Array<{ id: string; distance: number }> = [];
    const bestResults: Array<{ id: string; distance: number }> = [];

    for (const epId of entryPoints) {
      const epNode = this._nodes.get(epId);
      if (!epNode) continue;
      const d = this.computeDistance(queryVector, epNode.vector);
      visited.add(epId);
      candidates.push({ id: epId, distance: d });
      bestResults.push({ id: epId, distance: d });
    }

    candidates.sort((a, b) => a.distance - b.distance);
    bestResults.sort((a, b) => a.distance - b.distance);

    while (candidates.length > 0) {
      const current = candidates.shift()!;
      const furthestResult = bestResults[bestResults.length - 1];

      if (current.distance > furthestResult.distance && bestResults.length >= ef) {
        break;
      }

      const currentNode = this._nodes.get(current.id);
      if (!currentNode) continue;

      const neighbors = currentNode.neighbors.get(level) || [];
      for (const neighborId of neighbors) {
        if (!visited.has(neighborId)) {
          visited.add(neighborId);
          const neighborNode = this._nodes.get(neighborId);
          if (!neighborNode) continue;

          const d = this.computeDistance(queryVector, neighborNode.vector);
          const furthest = bestResults[bestResults.length - 1];

          if (d < furthest.distance || bestResults.length < ef) {
            candidates.push({ id: neighborId, distance: d });
            candidates.sort((a, b) => a.distance - b.distance);

            bestResults.push({ id: neighborId, distance: d });
            bestResults.sort((a, b) => a.distance - b.distance);

            if (bestResults.length > ef) {
              bestResults.pop();
            }
          }
        }
      }
    }

    return bestResults;
  }

  private selectNeighbors(candidates: Array<{ id: string; distance: number }>, maxCount: number): string[] {
    const sorted = [...candidates].sort((a, b) => a.distance - b.distance);
    const unique = new Set<string>();
    const result: string[] = [];
    for (const c of sorted) {
      if (!unique.has(c.id)) {
        unique.add(c.id);
        result.push(c.id);
        if (result.length >= maxCount) break;
      }
    }
    return result;
  }

  private generateRandomLevel(): number {
    const uniform = Math.random();
    if (uniform === 0) return 0;
    return Math.floor(-Math.log(uniform) * this._mL);
  }
}
