import { HnswNode, SearchResult, HnswConfig } from "./types";

const DEFAULT_CONFIG: HnswConfig = {
  dim: 1024,
  M: 16,
  efConstruction: 200,
  efSearch: 50,
  ml: 1 / Math.log(16),
};

export class HNSWIndex {
  private nodes: Map<string, HnswNode> = new Map();
  private config: HnswConfig;
  private maxLevel: number = 0;
  private entryPoint: string | null = null;

  constructor(config?: Partial<HnswConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  private cosineDistance(a: number[], b: number[]): number {
    let dot = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    const denom = Math.sqrt(normA) * Math.sqrt(normB);
    if (denom === 0) return 1;
    return 1 - dot / denom;
  }

  private randomLevel(): number {
    let level = 0;
    while (Math.random() < this.config.ml && level < 32) {
      level++;
    }
    return level;
  }

  private searchLayer(
    query: number[],
    entryId: string,
    ef: number,
    layer: number,
  ): SearchResult[] {
    const visited = new Set<string>();
    const candidates: SearchResult[] = [];
    const results: SearchResult[] = [];

    const entry = this.nodes.get(entryId);
    if (!entry) return [];

    const entryDist = this.cosineDistance(query, entry.vector);
    candidates.push({ id: entryId, distance: entryDist });
    results.push({ id: entryId, distance: entryDist });
    visited.add(entryId);

    candidates.sort((a, b) => a.distance - b.distance);

    while (candidates.length > 0) {
      const closest = candidates.shift()!;
      const farthest = results[results.length - 1];

      if (closest.distance > farthest.distance) break;

      const node = this.nodes.get(closest.id);
      if (!node) continue;

      const layerNeighbors = node.neighbors.get(layer) || [];

      for (const neighborId of layerNeighbors) {
        if (visited.has(neighborId)) continue;
        visited.add(neighborId);

        const neighbor = this.nodes.get(neighborId);
        if (!neighbor) continue;

        const dist = this.cosineDistance(query, neighbor.vector);
        const farthestResult = results[results.length - 1];

        if (results.length < ef || dist < farthestResult.distance) {
          candidates.push({ id: neighborId, distance: dist });
          results.push({ id: neighborId, distance: dist });
          results.sort((a, b) => a.distance - b.distance);

          if (results.length > ef) {
            results.pop();
          }
        }
      }

      candidates.sort((a, b) => a.distance - b.distance);
    }

    return results.sort((a, b) => a.distance - b.distance);
  }

  private selectNeighborsSimple(
    candidates: SearchResult[],
    M: number,
  ): SearchResult[] {
    return candidates.slice(0, M);
  }

  insert(id: string, vector: number[]): void {
    if (this.nodes.has(id)) return;

    const level = this.randomLevel();

    const node: HnswNode = {
      id,
      vector,
      level,
      neighbors: new Map(),
    };

    for (let l = 0; l <= level; l++) {
      node.neighbors.set(l, []);
    }

    this.nodes.set(id, node);

    if (this.entryPoint === null) {
      this.entryPoint = id;
      this.maxLevel = level;
      return;
    }

    let currEntry = this.entryPoint;
    const _currDist = this.cosineDistance(
      vector,
      this.nodes.get(currEntry)!.vector,
    );

    for (let l = this.maxLevel; l > level; l--) {
      const changed = true;
      if (!changed) continue;
      const layerResults = this.searchLayer(vector, currEntry, 1, l);
      if (layerResults.length > 0) {
        currEntry = layerResults[0].id;
      }
    }

    for (let l = Math.min(level, this.maxLevel); l >= 0; l--) {
      const layerResults = this.searchLayer(
        vector,
        currEntry,
        this.config.efConstruction,
        l,
      );

      const neighbors = this.selectNeighborsSimple(layerResults, this.config.M);

      const neighborIds = neighbors.map((n) => n.id);
      node.neighbors.set(l, neighborIds);

      for (const neighborId of neighborIds) {
        const neighborNode = this.nodes.get(neighborId);
        if (!neighborNode) continue;

        let neighborNeighbors = neighborNode.neighbors.get(l) || [];

        neighborNeighbors.push(id);

        if (neighborNeighbors.length > this.config.M) {
          const neighborDistances = neighborNeighbors
            .map((nid) => {
              const n = this.nodes.get(nid);
              return n
                ? {
                    id: nid,
                    distance: this.cosineDistance(
                      n.vector,
                      neighborNode.vector,
                    ),
                  }
                : null;
            })
            .filter((n): n is SearchResult => n !== null)
            .sort((a, b) => a.distance - b.distance);

          neighborNeighbors = neighborDistances
            .slice(0, this.config.M)
            .map((n) => n.id);
        }

        neighborNode.neighbors.set(l, neighborNeighbors);
      }

      if (layerResults.length > 0) {
        currEntry = layerResults[0].id;
      }
    }

    if (level > this.maxLevel) {
      this.maxLevel = level;
      this.entryPoint = id;
    }
  }

  search(query: number[], k: number = 10): SearchResult[] {
    if (this.entryPoint === null || this.nodes.size === 0) return [];

    let currEntry = this.entryPoint;

    for (let l = this.maxLevel; l > 0; l--) {
      const layerResults = this.searchLayer(query, currEntry, 1, l);
      if (layerResults.length > 0) {
        currEntry = layerResults[0].id;
      }
    }

    const finalResults = this.searchLayer(
      query,
      currEntry,
      Math.max(this.config.efSearch, k),
      0,
    );

    return finalResults.slice(0, k);
  }

  delete(id: string): boolean {
    if (!this.nodes.has(id)) return false;

    const node = this.nodes.get(id)!;

    for (const [layer, neighborIds] of node.neighbors.entries()) {
      // 1. Remove deleted node from neighbors' adjacency lists
      for (const neighborId of neighborIds) {
        const neighbor = this.nodes.get(neighborId);
        if (!neighbor) continue;
        const layerNeighbors = neighbor.neighbors.get(layer) || [];
        neighbor.neighbors.set(
          layer,
          layerNeighbors.filter((nid) => nid !== id)
        );
      }

      // 2. Reconnect neighbors to prevent orphaned components
      for (const neighborId of neighborIds) {
        const neighborNode = this.nodes.get(neighborId);
        if (!neighborNode) continue;
        
        const currentNeighbors = neighborNode.neighbors.get(layer) || [];
        const candidateSet = new Set<string>();
        
        // Add other neighbors of deleted node
        for (const nid of neighborIds) {
          if (nid !== neighborId) candidateSet.add(nid);
        }
        
        // Add 2-hop neighbors
        for (const nid of currentNeighbors) {
          const nn = this.nodes.get(nid);
          if (nn) {
            for (const nnid of (nn.neighbors.get(layer) || [])) {
              if (nnid !== neighborId && nnid !== id) candidateSet.add(nnid);
            }
          }
        }
        
        // Exclude current neighbors
        for (const nid of currentNeighbors) {
          candidateSet.delete(nid);
        }
        
        const candidateDistances = Array.from(candidateSet)
          .map((cid) => {
            const cNode = this.nodes.get(cid);
            return cNode ? { id: cid, distance: this.cosineDistance(neighborNode.vector, cNode.vector) } : null;
          })
          .filter((n): n is SearchResult => n !== null)
          .sort((a, b) => a.distance - b.distance);
        
        const needed = this.config.M - currentNeighbors.length;
        if (needed > 0 && candidateDistances.length > 0) {
          const toAdd = candidateDistances.slice(0, needed);
          
          for (const item of toAdd) {
            currentNeighbors.push(item.id);
            
            const targetNode = this.nodes.get(item.id);
            if (targetNode) {
              const targetNeighbors = targetNode.neighbors.get(layer) || [];
              if (!targetNeighbors.includes(neighborId)) {
                targetNeighbors.push(neighborId);
                
                if (targetNeighbors.length > this.config.M) {
                  const targetDistances = targetNeighbors
                    .map((nid) => {
                      const n = this.nodes.get(nid);
                      return n ? { id: nid, distance: this.cosineDistance(n.vector, targetNode.vector) } : null;
                    })
                    .filter((n): n is SearchResult => n !== null)
                    .sort((a, b) => a.distance - b.distance);
                  
                  targetNode.neighbors.set(layer, targetDistances.slice(0, this.config.M).map((n) => n.id));
                } else {
                  targetNode.neighbors.set(layer, targetNeighbors);
                }
              }
            }
          }
        }
        
        neighborNode.neighbors.set(layer, currentNeighbors);
      }
    }

    this.nodes.delete(id);

    if (this.entryPoint === id) {
      if (this.nodes.size > 0) {
        this.entryPoint = this.nodes.keys().next().value!;
        this.maxLevel = this.nodes.get(this.entryPoint)!.level;
        for (const [, n] of this.nodes) {
          if (n.level > this.maxLevel) {
            this.maxLevel = n.level;
            this.entryPoint = n.id;
          }
        }
      } else {
        this.entryPoint = null;
        this.maxLevel = 0;
      }
    }

    return true;
  }

  size(): number {
    return this.nodes.size;
  }

  clear(): void {
    this.nodes.clear();
    this.maxLevel = 0;
    this.entryPoint = null;
  }

  getNode(id: string): HnswNode | undefined {
    return this.nodes.get(id);
  }

  getAllNodes(): Map<string, HnswNode> {
    return new Map(this.nodes);
  }

  toJSON(): any {
    const nodes: any = {};
    for (const [id, node] of this.nodes) {
      const neighbors: Record<number, string[]> = {};
      for (const [layer, nids] of node.neighbors.entries()) {
        neighbors[layer] = nids;
      }
      nodes[id] = {
        vector: node.vector,
        level: node.level,
        neighbors,
      };
    }
    return {
      config: this.config,
      maxLevel: this.maxLevel,
      entryPoint: this.entryPoint,
      nodes,
    };
  }

  static fromJSON(data: any): HNSWIndex {
    const index = new HNSWIndex(data.config);
    index.maxLevel = data.maxLevel;
    index.entryPoint = data.entryPoint;

    for (const [id, nodeData] of Object.entries(data.nodes)) {
      const nd = nodeData as any;
      const neighbors = new Map<number, string[]>();
      for (const [layer, nids] of Object.entries(nd.neighbors)) {
        neighbors.set(parseInt(layer), nids as string[]);
      }
      index.nodes.set(id, {
        id,
        vector: nd.vector,
        level: nd.level,
        neighbors,
      });
    }

    return index;
  }
}
