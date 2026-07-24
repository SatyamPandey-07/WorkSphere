# HNSW Vector Index & Similarity Search — Comprehensive Guide

## Executive Summary

WorkSphere implements a Hierarchical Navigable Small World (HNSW) approximate nearest neighbor (ANN) index in [`src/lib/hnsw/hnsw.ts`](src/lib/hnsw/hnsw.ts) with type definitions in [`src/lib/hnsw/types.ts`](src/lib/hnsw/types.ts). This document covers the graph parameters, distance metrics, index serialization, memory footprint, rebuild strategies, and performance characteristics of the implementation.

---

## Table of Contents

1. [Algorithm Overview](#1-algorithm-overview)
2. [Graph Parameters](#2-graph-parameters)
3. [Distance Metrics](#3-distance-metrics)
4. [Index Lifecycle](#4-index-lifecycle)
5. [Index Serialization](#5-index-serialization)
6. [Memory Footprint Analysis](#6-memory-footprint-analysis)
7. [Rebuild Strategies](#7-rebuild-strategies)
8. [Performance Benchmarks vs Brute-Force k-NN](#8-performance-benchmarks-vs-brute-force-k-nn)
9. [Usage Examples](#9-usage-examples)

---

## 1. Algorithm Overview

HNSW constructs a multi-layer proximity graph where each node is connected to a fixed number of neighbors. Lower layers contain all nodes for fine-grained local search, while upper layers contain progressively fewer nodes for fast global navigation.

### Architecture Diagram

```
Layer 2:   [entry] ───────────────────────────── [node-far]
                │                                      │
Layer 1:   [A] ─ [B] ─ [C] ─ [D] ─ [E] ─ [F] ─ [G] ─ [H]
                │         │                   │
Layer 0:   [0]─[1]─[2]─[3]─[4]─[5]─[6]─[7]─[8]─[9]─[10]─[11]
              (all nodes present at layer 0)
```

**Search procedure:**
1. Start at the entry point at the highest layer.
2. Greedily descend: at each layer above 0, find the single nearest node to the query and move to it.
3. At layer 0, run a beam search with `efSearch` candidates to find the top-k results.

**Insert procedure:**
1. Assign a random layer to the new node using the geometric distribution controlled by `ml`.
2. Descend from `maxLevel` to the node's layer, greedily finding the nearest node at each layer.
3. At each layer from the node's layer down to 0, run `efConstruction` beam search, select the top-M neighbors, and bidirectionally link them.

---

## 2. Graph Parameters

The index is configured via the `HnswConfig` interface:

```typescript
// src/lib/hnsw/types.ts
export interface HnswConfig {
  dim: number;        // vector dimensionality
  M: number;          // max neighbors per node per layer
  efConstruction: number;  // beam width during insert
  efSearch: number;   // beam width during search
  ml: number;         // layer normalization factor
}
```

### Default Configuration

| Parameter | Default | Description |
|---|---|---|
| `dim` | 1024 | Dimensionality of all vectors in the index. Every inserted vector must match this length. |
| `M` | 16 | Maximum number of bi-directional neighbors per node at each layer. Higher values improve recall but increase memory and insertion time. |
| `efConstruction` | 200 | Size of the dynamic candidate list during insertion. Higher values produce better graph quality but slower inserts. |
| `efSearch` | 50 | Size of the dynamic candidate list during search at layer 0. Higher values improve recall at the cost of query latency. Must be ≥ `k` for correct top-k results. |
| `ml` | `1 / ln(16)` ≈ 0.361 | Normalization factor for the geometric distribution that assigns node layers. Controls how many nodes appear at each layer. |

### Parameter Tuning Guidelines

| Goal | Adjust |
|---|---|
| Higher recall (≥ 95%) | Increase `efSearch` (100–500) and `M` (24–64) |
| Faster queries | Decrease `efSearch` (10–30) |
| Faster inserts | Decrease `efConstruction` (50–100) |
| Better graph quality at insert time | Increase `efConstruction` (300–500) |
| More layers / deeper hierarchy | Decrease `ml` (e.g., `1/ln(M)` for default, lower for more layers) |

**Trade-off summary:**
- `M` controls the average degree of the graph. Doubling `M` roughly doubles memory per node.
- `efConstruction` determines how thoroughly the graph is connected at insert time. It directly affects recall.
- `efSearch` is the only runtime knob: increase it at query time to trade latency for accuracy.

---

## 3. Distance Metrics

The current implementation uses **cosine distance** exclusively:

```typescript
// src/lib/hnsw/hnsw.ts — cosineDistance()
private cosineDistance(a: number[], b: number[]): number {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  if (denom === 0) return 1;  // zero-vector guard
  return 1 - dot / denom;     // range [0, 2]
}
```

### Cosine Distance vs Euclidean Distance

| Property | Cosine Distance | Euclidean (L2) Distance |
|---|---|---|
| Formula | `1 - (A · B) / (‖A‖ · ‖B‖)` | `√Σ(aᵢ - bᵢ)²` |
| Range | [0, 2] | [0, ∞) |
| Sensitivity to magnitude | Invariant (only measures angle) | Sensitive to vector magnitude |
| Best for | Normalized embeddings (text, semantic search) | Spatial coordinates, unnormalized features |
| Zero-vector behavior | Returns 1 (max distance) | Returns magnitude of the non-zero vector |
| Pre-normalization required | No (built-in) | Recommended if magnitude varies |

**When to consider adding Euclidean support:**
- If vectors are spatial coordinates (e.g., geographic embeddings).
- If the embedding model produces magnitude-meaningful vectors.
- Implementation would require a separate distance function and a config flag; the graph structure and search algorithm remain identical.

---

## 4. Index Lifecycle

### API Reference

| Method | Signature | Description |
|---|---|---|
| `constructor` | `new HNSWIndex(config?: Partial<HnswConfig>)` | Creates an index with merged config defaults. |
| `insert` | `insert(id: string, vector: number[]): void` | Inserts a node. No-op if `id` already exists. Assigns random level, links neighbors. |
| `search` | `search(query: number[], k?: number): SearchResult[]` | Returns top-k nearest neighbors. Default k=10. Returns `[]` if index is empty. |
| `delete` | `delete(id: string): boolean` | Removes a node and re-links its neighbors. Reassigns entry point if deleted. Returns false if id not found. |
| `size` | `size(): number` | Returns the number of nodes. |
| `clear` | `clear(): void` | Removes all nodes, resets entry point and max level. |
| `getNode` | `getNode(id: string): HnswNode \| undefined` | Returns a single node or undefined. |
| `getAllNodes` | `getAllNodes(): Map<string, HnswNode>` | Returns a shallow copy of the internal node map. |
| `toJSON` | `toJSON(): object` | Serializes the entire index to a plain object. |
| `fromJSON` | `static fromJSON(data): HNSWIndex` | Deserializes a previously serialized index. |

### Insert Flow

```
insert(id, vector)
  │
  ├─ If id exists → return (no-op)
  │
  ├─ Generate random level via geometric distribution
  │
  ├─ First node? → Set as entry point, return
  │
  ├─ Descend from maxLevel to node.level:
  │   └─ searchLayer(query, entry, ef=1, layer) → move to nearest
  │
  └─ For each layer from min(level, maxLevel) down to 0:
      ├─ searchLayer(query, entry, efConstruction, layer)
      ├─ selectNeighborsSimple(results, M) → top M by distance
      ├─ Link new node → neighbors
      └─ Back-link neighbors → new node
          └─ If any neighbor exceeds M neighbors, prune to M
```

### Delete Flow

```
delete(id)
  │
  ├─ If id not found → return false
  │
  ├─ For each layer of the deleted node:
  │   └─ Remove id from all neighbors' neighbor lists
  │
  ├─ Remove node from map
  │
  └─ If deleted node was entry point:
      ├─ Nodes remain → find node with highest level as new entry
      └─ No nodes left → set entry=null, maxLevel=0
```

> **Note:** Deletion uses a lazy removal strategy. The deleted node is removed from neighbor lists, but the graph may not be re-optimized. For critical workloads, periodic full rebuilds are recommended (see [Section 7](#7-rebuild-strategies)).

---

## 5. Index Serialization

### JSON Format

The `toJSON()` / `fromJSON()` methods provide full round-trip serialization:

```typescript
const index = new HNSWIndex({ dim: 768, M: 16 });
// ... insert nodes ...
const serialized = index.toJSON();

// Persist to disk, database, or network
const json = JSON.stringify(serialized);
const restored = HNSWIndex.fromJSON(JSON.parse(json));
```

### Serialized Structure

```json
{
  "config": {
    "dim": 1024,
    "M": 16,
    "efConstruction": 200,
    "efSearch": 50,
    "ml": 0.361
  },
  "maxLevel": 5,
  "entryPoint": "node-42",
  "nodes": {
    "node-42": {
      "vector": [0.1, -0.3, 0.7, "..."],
      "level": 5,
      "neighbors": {
        "0": ["node-1", "node-7", "node-12"],
        "1": ["node-7", "node-23"],
        "5": ["node-99"]
      }
    }
  }
}
```

### Serialization Characteristics

| Aspect | Detail |
|---|---|
| Format | JSON (plain object) |
| Node key | String `id` |
| Vector storage | Inline `number[]` |
| Neighbor storage | `Record<layer, string[]>` — layer keys are stringified integers |
| Config preservation | Full config is stored and restored |
| Entry point | Preserved as string `id` |
| Max level | Preserved as integer |

**Size considerations for large indexes:**
- Each node's vector is stored as a JSON number array. For `dim=1024`, each vector is ~12 KB in JSON (including commas, decimal points).
- For 100k nodes at dim=1024: vector data alone ≈ 1.2 GB in JSON.
- Compressed serialization (e.g., MessagePack, Protocol Buffers, or binary Float32Array encoding) is recommended for production persistence beyond ~10k nodes.

---

## 6. Memory Footprint Analysis

### Per-Node Memory Breakdown

| Component | Type | Estimated Size |
|---|---|---|
| `id` | `string` | ~50 bytes (varies by ID length) |
| `vector` | `number[]` | `dim × 8` bytes (IEEE 754 double) |
| `level` | `number` | 8 bytes |
| `neighbors` | `Map<number, string[]>` | `(level + 1) × M × ~50` bytes (string IDs) + Map overhead ~100 bytes |
| **Total per node** | | **~`dim × 8 + (level+1) × M × 50 + 158` bytes** |

### Worked Examples

| Scenario | dim | M | Avg Level | Nodes | Estimated Memory |
|---|---|---|---|---|---|
| Small (1k venues) | 384 | 16 | 1.5 | 1,000 | ~23 MB |
| Medium (10k venues) | 768 | 16 | 1.5 | 10,000 | ~230 MB |
| Large (100k venues) | 1024 | 16 | 1.5 | 100,000 | ~2.3 GB |
| Very large (1M embeddings) | 1024 | 32 | 2.0 | 1,000,000 | ~25 GB |

> **Key driver:** The `number[]` vector is the dominant memory cost. Using `Float32Array` (4 bytes/element) instead of `number[]` (8 bytes/element) would halve vector memory. This would require modifying `HnswNode.vector` from `number[]` to `Float32Array` and updating the `cosineDistance` method.

### Graph-Level Memory

| Layer | Approximate Node Count | Degree per Node | Total Edges |
|---|---|---|---|
| 0 | N (all nodes) | M = 16 | N × 16 |
| 1 | N × ml ≈ 0.36N | M = 16 | 0.36N × 16 |
| 2 | N × ml² ≈ 0.13N | M = 16 | 0.13N × 16 |
| ... | ... | ... | ... |
| **Total** | | | **≈ N × M × 1/(1-ml) ≈ 25N edges** |

For 100k nodes: ~2.5M bidirectional edges × ~50 bytes/string = ~125 MB edge data.

---

## 7. Rebuild Strategies

### When to Rebuild

| Trigger | Recommended Action |
|---|---|
| After >20% of nodes deleted | Full rebuild (graph has accumulated dead edges) |
| After bulk inserts (>50% of current size) | Full rebuild (graph quality degrades with incremental bulk insert) |
| Periodic maintenance | Scheduled rebuild during low-traffic windows |
| Memory pressure | Rebuild with lower M or dim |

### Full Rebuild Procedure

```typescript
function rebuildIndex(
  oldIndex: HNSWIndex,
  config?: Partial<HnswConfig>,
): HNSWIndex {
  const allNodes = oldIndex.getAllNodes();
  const newIndex = new HNSWIndex(config);

  // Collect all (id, vector) pairs
  const entries: [string, number[]][] = [];
  for (const [id, node] of allNodes) {
    entries.push([id, node.vector]);
  }

  // Shuffle to avoid insertion order bias
  for (let i = entries.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [entries[i], entries[j]] = [entries[j], entries[i]];
  }

  // Re-insert all nodes
  for (const [id, vector] of entries) {
    newIndex.insert(id, vector);
  }

  return newIndex;
}
```

### Incremental Deletion Cleanup

For small deletion counts (< 5% of nodes), deletion alone is sufficient. For larger batches, consider:

1. **Snapshot** the current index via `toJSON()`.
2. **Filter** out deleted node IDs from the serialized nodes object.
3. **Reconstruct** via `fromJSON()` with the filtered data.

```typescript
function removeNodes(index: HNSWIndex, idsToRemove: Set<string>): HNSWIndex {
  const serialized = index.toJSON();
  for (const id of idsToRemove) {
    delete serialized.nodes[id];
  }
  // fromJSON will rebuild entry point and maxLevel automatically
  return HNSWIndex.fromJSON(serialized);
}
```

### Serialization-Based Persistence

For production persistence beyond the current session:

1. Call `index.toJSON()` to get the serializable object.
2. Store in a database column (PostgreSQL `jsonb`, etc.) or file system.
3. On application startup, call `HNSWIndex.fromJSON(storedData)` to restore.

```typescript
// Store
const data = JSON.stringify(index.toJSON());
await db.query(
  'INSERT INTO hnsw_indices (id, data, updated_at) VALUES ($1, $2, NOW())',
  [indexId, data]
);

// Restore
const row = await db.query('SELECT data FROM hnsw_indices WHERE id = $1', [indexId]);
const index = HNSWIndex.fromJSON(JSON.parse(row.rows[0].data));
```

---

## 8. Performance Benchmarks vs Brute-Force k-NN

### Theoretical Complexity

| Operation | Brute-Force k-NN | HNSW |
|---|---|---|
| Insert | O(N × dim) | O(dim × log N) (amortized) |
| Search (top-k) | O(N × dim) | O(dim × log N) (amortized) |
| Delete | O(1) | O(M × level) |
| Memory | O(N × dim × 8) bytes | O(N × dim × 8 + N × M × 50 × layers) bytes |

### Expected Recall vs Latency Trade-offs

| Configuration | Recall@10 | Queries/sec (100k nodes, dim=1024) |
|---|---|---|
| Brute-force | 100% | ~100 |
| HNSW (efSearch=10, M=16) | ~85% | ~5,000 |
| HNSW (efSearch=50, M=16) | ~93% | ~2,000 |
| HNSW (efSearch=200, M=16) | ~98% | ~800 |
| HNSW (efSearch=200, M=32) | ~99% | ~400 |

> **Note:** These are representative estimates based on published HNSW benchmarks (Malkov & Yashunin, 2018). Actual performance depends on vector distribution, hardware (CPU cache, memory bandwidth), and JavaScript runtime optimizations.

### Break-Even Point

For N < ~1,000 nodes at dim=1024, brute-force linear scan may outperform HNSW due to:
- No graph traversal overhead.
- Better CPU cache locality for small arrays.
- Simpler code path (single loop vs multi-level BFS).

**HNSW becomes advantageous at N > 5,000** where the O(log N) search depth provides meaningful speedup over O(N) scan.

---

## 9. Usage Examples

### Basic Usage

```typescript
import { HNSWIndex } from '@/lib/hnsw/hnsw';

// Create index with defaults (dim=1024, M=16)
const index = new HNSWIndex();

// Insert vectors
index.insert('venue-1', embeddingVector1);
index.insert('venue-2', embeddingVector2);
index.insert('venue-3', embeddingVector3);

// Search for 5 nearest neighbors
const results = index.search(queryVector, 5);
// → [{ id: 'venue-2', distance: 0.12 }, { id: 'venue-1', distance: 0.34 }, ...]
```

### Custom Configuration

```typescript
const index = new HNSWIndex({
  dim: 768,           // match your embedding model output
  M: 24,              // higher degree for better recall
  efConstruction: 300, // thorough graph construction
  efSearch: 100,      // high recall at query time
});
```

### Serialization Round-Trip

```typescript
// Save to storage
const serialized = JSON.stringify(index.toJSON());
localStorage.setItem('hnsw-index', serialized);

// Restore from storage
const saved = localStorage.getItem('hnsw-index');
const restored = HNSWIndex.fromJSON(JSON.parse(saved!));
const results = restored.search(queryVector, 10);
```

### Batch Insert with Progress

```typescript
function batchInsert(index: HNSWIndex, items: { id: string; vector: number[] }[]): void {
  for (let i = 0; i < items.length; i++) {
    index.insert(items[i].id, items[i].vector);
    if (i % 1000 === 0) {
      console.log(`Inserted ${i}/${items.length} nodes`);
    }
  }
}
```

---

## Source References

| File | Purpose |
|---|---|
| `src/lib/hnsw/hnsw.ts` | HNSWIndex class implementation (322 lines) |
| `src/lib/hnsw/types.ts` | TypeScript interfaces for HnswNode, SearchResult, HnswConfig, CompressedContext, ContextChunk |
