import { HNSWIndex } from "../../../lib/hnsw/hnsw";

describe("HNSW Benchmark & Functionality", () => {
  const DIM = 1024;
  const NUM_VECTORS = 1000;
  const NUM_QUERIES = 50;

  function generateRandomVector(dim: number): number[] {
    const vec = new Array(dim);
    let norm = 0;
    for (let i = 0; i < dim; i++) {
      vec[i] = Math.random() - 0.5;
      norm += vec[i] * vec[i];
    }
    norm = Math.sqrt(norm);
    for (let i = 0; i < dim; i++) {
      vec[i] /= norm;
    }
    return vec;
  }

  it("should index venue embeddings and return nearest neighbors", () => {
    const index = new HNSWIndex({ dim: DIM, metric: "cosine" });
    const queryVec = generateRandomVector(DIM);

    // Insert
    for (let i = 0; i < NUM_VECTORS; i++) {
      index.insert(`venue-${i}`, generateRandomVector(DIM));
    }
    
    expect(index.size()).toBe(NUM_VECTORS);

    const results = index.search(queryVec, 5);
    expect(results).toHaveLength(5);
    expect(results[0].distance).toBeLessThanOrEqual(results[4].distance);
  });

  it("should perform query in <10ms on average", () => {
    const index = new HNSWIndex({ dim: DIM, metric: "euclidean" });
    
    // Insert vectors
    for (let i = 0; i < NUM_VECTORS; i++) {
      index.insert(`venue-${i}`, generateRandomVector(DIM));
    }

    const queries = Array.from({ length: NUM_QUERIES }, () => generateRandomVector(DIM));

    // Warm up
    index.search(queries[0], 10);

    const start = performance.now();
    for (const query of queries) {
      index.search(query, 10);
    }
    const end = performance.now();

    const avgLatency = (end - start) / NUM_QUERIES;
    
    console.log(`Average Query Latency: ${avgLatency.toFixed(3)} ms`);
    
    // Test assertion for < 10ms
    expect(avgLatency).toBeLessThan(10);
  });
});
