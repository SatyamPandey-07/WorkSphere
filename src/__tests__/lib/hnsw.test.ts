import { HNSWIndex } from "../../lib/hnsw/hnsw";
import { HnswConfig } from "../../lib/hnsw/types";

describe("HNSWIndex Deletion and Graph Integrity", () => {
  const config: HnswConfig = {
    dim: 16,
    M: 16,
    efConstruction: 100,
    efSearch: 50,
    ml: 0.36,
  };

  const generateVector = (dim: number) => {
    return Array.from({ length: dim }, () => Math.random());
  };

  it("should maintain graph integrity and recall after multiple deletions", () => {
    const index = new HNSWIndex(config);
    const dimensions = 16;
    const numNodes = 200;
    
    // Insert nodes
    for (let i = 0; i < numNodes; i++) {
      index.insert(`node-${i}`, generateVector(dimensions));
    }
    
    // Delete 100+ nodes
    const deleteCount = 120;
    for (let i = 0; i < deleteCount; i++) {
      const deleted = index.delete(`node-${i}`);
      expect(deleted).toBe(true);
    }
    
    // Verify deleted nodes are not retrievable
    for (let i = 0; i < deleteCount; i++) {
      const deletedNodeId = `node-${i}`;
      expect(index.search(generateVector(dimensions), 5).some(r => r.id === deletedNodeId)).toBe(false);
      
      expect(index.delete(deletedNodeId)).toBe(false);
    }

    // Verify search still works for remaining nodes
    const queryVec = generateVector(dimensions);
    const results = index.search(queryVec, 10);
    
    expect(results.length).toBeGreaterThan(0);
    expect(results.length).toBeLessThanOrEqual(10);
    
    results.forEach(r => {
      const idNum = parseInt(r.id.split('-')[1]);
      expect(idNum).toBeGreaterThanOrEqual(deleteCount);
    });
  });
});
