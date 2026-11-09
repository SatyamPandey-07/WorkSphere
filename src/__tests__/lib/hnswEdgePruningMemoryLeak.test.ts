import { HNSWIndex } from "@/lib/hnsw/hnsw";
import {
  serializeHnswIndex,
  deserializeHnswIndex,
  validateHnswGraphIntegrity,
} from "@/lib/hnsw/hnswSerializer";

describe("HNSW Vector Graph Construction: Memory Leak & Dangling Edge Cleanup (#4384)", () => {
  // Helper to generate normalized random vectors of dimension `dim`
  function generateRandomVector(dim: number): number[] {
    const vec: number[] = [];
    let norm = 0;
    for (let i = 0; i < dim; i++) {
      const val = (Math.random() - 0.5) * 2;
      vec.push(val);
      norm += val * val;
    }
    const sqrtNorm = Math.sqrt(norm) || 1;
    return vec.map((v) => v / sqrtNorm);
  }

  // Helper to generate synthetic clusters of vectors
  function generateClusteredVectors(
    count: number,
    dim: number,
    numClusters: number = 4
  ): Array<{ id: string; vector: number[] }> {
    const centers: number[][] = [];
    for (let c = 0; c < numClusters; c++) {
      centers.push(generateRandomVector(dim));
    }

    const result: Array<{ id: string; vector: number[] }> = [];
    for (let i = 0; i < count; i++) {
      const center = centers[i % numClusters];
      const noise = generateRandomVector(dim).map((v) => v * 0.1);
      const vector = center.map((val, idx) => val + noise[idx]);
      result.push({ id: `node_${i}`, vector });
    }
    return result;
  }

  describe("Bidirectional Edge Pruning & Graph Integrity Verification", () => {
    it("ensures all nodes maintain degree <= M across all layers", () => {
      const M = 8;
      const index = new HNSWIndex({ M, efConstruction: 64, dim: 16 });

      const dataset = generateClusteredVectors(200, 16);
      for (const item of dataset) {
        index.insert(item.id, item.vector);
      }

      const integrity = index.validateGraphIntegrity();
      expect(integrity.isValid).toBe(true);
      expect(integrity.errors).toHaveLength(0);

      const nodes = index.getAllNodes();
      for (const [nodeId, node] of nodes) {
        for (const [layer, neighborIds] of node.neighbors) {
          expect(neighborIds.length).toBeLessThanOrEqual(M);
        }
      }
    });

    it("symmetrically detaches edges on pruned neighbor nodes when trimming to max degree M", () => {
      const M = 4;
      const index = new HNSWIndex({ M, efConstruction: 32, dim: 8 });

      // Insert dense cluster of points forced to prune neighbor connections
      for (let i = 0; i < 50; i++) {
        const vec = [i * 0.01, (i % 5) * 0.02, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6];
        index.insert(`dense_${i}`, vec);
      }

      const integrity = index.validateGraphIntegrity();
      expect(integrity.isValid).toBe(true);
      expect(integrity.errors).toEqual([]);

      // Manual symmetry double-check across all adjacency lists
      const nodes = index.getAllNodes();
      for (const [nodeId, node] of nodes.entries()) {
        for (const [layer, neighbors] of node.neighbors.entries()) {
          for (const neighborId of neighbors) {
            const neighborNode = nodes.get(neighborId);
            expect(neighborNode).toBeDefined();
            const backRefs = neighborNode!.neighbors.get(layer);
            expect(backRefs).toBeDefined();
            expect(backRefs).toContain(nodeId);
          }
        }
      }
    });

    it("detects no dangling neighbor references to deleted or missing node IDs", () => {
      const index = new HNSWIndex({ M: 8, dim: 12 });

      for (let i = 0; i < 100; i++) {
        index.insert(`node_${i}`, generateRandomVector(12));
      }

      // Delete 30 nodes
      for (let i = 0; i < 30; i++) {
        index.delete(`node_${i * 3}`);
      }

      const integrity = validateHnswGraphIntegrity(index);
      expect(integrity.isValid).toBe(true);
      expect(integrity.errors).toHaveLength(0);

      // Verify no neighbor points to a deleted node
      const nodes = index.getAllNodes();
      for (const [nodeId, node] of nodes.entries()) {
        for (const [, neighbors] of node.neighbors.entries()) {
          for (const neighborId of neighbors) {
            expect(nodes.has(neighborId)).toBe(true);
          }
        }
      }
    });
  });

  describe("Memory Stability Over 10,000 Node Insertions (#4384)", () => {
    it("maintains bounded total edge count scaling linearly O(N * M) without memory leak over 10,000 insertions", () => {
      const M = 16;
      const dim = 16;
      const index = new HNSWIndex({ M, efConstruction: 100, dim });

      const totalInsertions = 10000;
      const batchSize = 1000;

      const edgeCountSnapshots: number[] = [];
      const nodeCountSnapshots: number[] = [];

      for (let batch = 0; batch < totalInsertions / batchSize; batch++) {
        for (let i = 0; i < batchSize; i++) {
          const globalIdx = batch * batchSize + i;
          const vector = generateRandomVector(dim);
          index.insert(`vec_${globalIdx}`, vector);
        }

        let totalEdgesInGraph = 0;
        const nodes = index.getAllNodes();

        for (const node of nodes.values()) {
          for (const neighborIds of node.neighbors.values()) {
            totalEdgesInGraph += neighborIds.length;
          }
        }

        edgeCountSnapshots.push(totalEdgesInGraph);
        nodeCountSnapshots.push(nodes.size);

        // Verify graph integrity at each 1,000-node milestone
        const validation = index.validateGraphIntegrity();
        expect(validation.isValid).toBe(true);
        expect(validation.errors).toHaveLength(0);
      }

      expect(index.size()).toBe(totalInsertions);

      // Calculate maximum possible theoretical edge capacity: N * layers * M
      // In practice, average degree per layer is <= 2 * M.
      const finalNodeCount = nodeCountSnapshots[nodeCountSnapshots.length - 1];
      const finalEdgeCount = edgeCountSnapshots[edgeCountSnapshots.length - 1];

      // Average directed edges per node should be bounded and strictly less than (3 * M * avg_layers)
      const avgEdgesPerNode = finalEdgeCount / finalNodeCount;
      expect(avgEdgesPerNode).toBeLessThan(M * 6);

      // Verify linear growth ratio: ratio of edges/nodes should stay stable across batches
      const earlyRatio = edgeCountSnapshots[1] / nodeCountSnapshots[1]; // at 2,000 nodes
      const lateRatio = finalEdgeCount / finalNodeCount; // at 10,000 nodes

      // Growth ratio should remain within 2.5x factor (no exponential memory explosion)
      expect(lateRatio).toBeLessThan(earlyRatio * 2.5);
    });

    it("prevents stale edge index accumulation during repeated insert-delete-reinsert churn", () => {
      const M = 12;
      const index = new HNSWIndex({ M, efConstruction: 50, dim: 8 });

      // Insert initial batch
      for (let i = 0; i < 500; i++) {
        index.insert(`churn_${i}`, generateRandomVector(8));
      }

      // Perform 5 cycles of deleting and re-inserting nodes
      for (let cycle = 0; cycle < 5; cycle++) {
        for (let i = 0; i < 200; i++) {
          const targetId = `churn_${(cycle * 50 + i) % 500}`;
          index.delete(targetId);
          index.insert(targetId, generateRandomVector(8));
        }

        const integrity = index.validateGraphIntegrity();
        expect(integrity.isValid).toBe(true);
        expect(integrity.errors).toEqual([]);
      }

      expect(index.size()).toBe(500);
    });
  });

  describe("Serialization & Deserialization Integrity Checks", () => {
    it("serializes and deserializes pruned graph without loss of symmetry or invalid edge references", () => {
      const index = new HNSWIndex({ M: 16, efConstruction: 100, dim: 16 });

      for (let i = 0; i < 300; i++) {
        index.insert(`ser_node_${i}`, generateRandomVector(16));
      }

      const buffer = serializeHnswIndex(index);
      expect(buffer).toBeInstanceOf(ArrayBuffer);
      expect(buffer.byteLength).toBeGreaterThan(0);

      const deserializedIndex = deserializeHnswIndex(buffer);
      expect(deserializedIndex.size()).toBe(300);

      const validation = validateHnswGraphIntegrity(deserializedIndex);
      expect(validation.isValid).toBe(true);
      expect(validation.errors).toHaveLength(0);
    });

    it("returns consistent search query results after serialization and deserialization", () => {
      const index = new HNSWIndex({ M: 16, efConstruction: 100, dim: 16 });
      const dataset = generateClusteredVectors(150, 16);

      for (const item of dataset) {
        index.insert(item.id, item.vector);
      }

      const queryVector = dataset[10].vector;
      const originalResults = index.search(queryVector, 5);

      const buffer = serializeHnswIndex(index);
      const deserializedIndex = deserializeHnswIndex(buffer);
      const deserializedResults = deserializedIndex.search(queryVector, 5);

      expect(originalResults.length).toBe(deserializedResults.length);
      expect(deserializedResults[0].id).toBe(dataset[10].id);
    });
  });

  describe("Edge Case Verification & Distance Metric Invariants", () => {
    it("handles zero vector and uniform coordinate vectors gracefully without degree overflow", () => {
      const index = new HNSWIndex({ M: 6, dim: 4 });

      index.insert("zero_node", [0, 0, 0, 0]);
      index.insert("ones_node", [1, 1, 1, 1]);
      index.insert("neg_node", [-1, -1, -1, -1]);

      for (let i = 0; i < 20; i++) {
        index.insert(`uniform_${i}`, [i * 0.1, i * 0.1, i * 0.1, i * 0.1]);
      }

      const validation = index.validateGraphIntegrity();
      expect(validation.isValid).toBe(true);
      expect(validation.errors).toHaveLength(0);
    });

    it("works correctly with Euclidean distance metric under high insertion volume", () => {
      const index = new HNSWIndex({
        M: 10,
        efConstruction: 64,
        dim: 8,
        metric: "euclidean",
      });

      for (let i = 0; i < 400; i++) {
        index.insert(`euc_${i}`, generateRandomVector(8));
      }

      const validation = index.validateGraphIntegrity();
      expect(validation.isValid).toBe(true);
      expect(validation.errors).toHaveLength(0);

      const query = generateRandomVector(8);
      const results = index.search(query, 5);
      expect(results.length).toBe(5);
    });

    it("maintains graph connectivity after clearing index and re-populating", () => {
      const index = new HNSWIndex({ M: 8, dim: 8 });

      for (let i = 0; i < 100; i++) {
        index.insert(`init_${i}`, generateRandomVector(8));
      }
      expect(index.size()).toBe(100);

      index.clear();
      expect(index.size()).toBe(0);

      for (let i = 0; i < 150; i++) {
        index.insert(`repop_${i}`, generateRandomVector(8));
      }
      expect(index.size()).toBe(150);

      const validation = index.validateGraphIntegrity();
      expect(validation.isValid).toBe(true);
      expect(validation.errors).toHaveLength(0);
    });
  });
});
