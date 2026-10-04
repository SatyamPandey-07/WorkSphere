import {
  quantizeVector,
  dequantizeVector,
  evaluateQuantizationQuality,
  createAsymmetricQueryContext,
  computeAsymmetricCosineDistance,
  computeAsymmetricEuclideanDistance,
  computeSymmetricCosineDistance,
  serializeQuantizedVectors,
  deserializeQuantizedVectors,
  QuantizedVectorStore,
} from "@/lib/hnsw/scalarQuantizer";

describe("HNSW Scalar Quantization (SQ8) & Asymmetric Distance Computation", () => {
  const generateRandomVector = (dim: number, seed = 1): number[] => {
    const vec: number[] = new Array(dim);
    for (let i = 0; i < dim; i++) {
      // Deterministic pseudorandom for reproducible test vectors
      const x = Math.sin(seed + i * 1.618) * 10000;
      vec[i] = (x - Math.floor(x)) * 2 - 1; // Range [-1, 1]
    }
    return vec;
  };

  const exactCosineDistance = (a: number[], b: number[]): number => {
    let dot = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    const denom = Math.sqrt(normA) * Math.sqrt(normB);
    return denom === 0 ? 1 : 1 - dot / denom;
  };

  describe("quantizeVector and dequantizeVector", () => {
    test("quantizes and dequantizes vectors with low reconstruction MSE", () => {
      const dim = 64;
      const original = generateRandomVector(dim, 42);

      const qv = quantizeVector(original, "test-1");
      expect(qv.id).toBe("test-1");
      expect(qv.data).toBeInstanceOf(Uint8Array);
      expect(qv.data.length).toBe(dim);
      expect(qv.min).toBeLessThanOrEqual(qv.max);

      const reconstructed = dequantizeVector(qv);
      expect(reconstructed.length).toBe(dim);

      const { mse, sqnrDb } = evaluateQuantizationQuality(original, qv);
      expect(mse).toBeLessThan(1e-4);
      expect(sqnrDb).toBeGreaterThan(30); // SQNR > 30 dB for 8-bit
    });

    test("handles Float32Array input seamlessly", () => {
      const original = new Float32Array([0.1, -0.5, 0.8, -0.2]);
      const qv = quantizeVector(original, "f32-1");
      const rec = dequantizeVector(qv);

      expect(rec.length).toBe(4);
      expect(rec[0]).toBeCloseTo(0.1, 1);
      expect(rec[1]).toBeCloseTo(-0.5, 1);
      expect(rec[2]).toBeCloseTo(0.8, 1);
    });

    test("handles empty vector without errors", () => {
      const qv = quantizeVector([], "empty");
      expect(qv.data.length).toBe(0);
      expect(qv.norm).toBe(0);

      const rec = dequantizeVector(qv);
      expect(rec.length).toBe(0);

      const quality = evaluateQuantizationQuality([], qv);
      expect(quality.mse).toBe(0);
    });

    test("handles constant vector without division by zero", () => {
      const constantVec = [0.5, 0.5, 0.5, 0.5];
      const qv = quantizeVector(constantVec, "const");

      expect(qv.min).toBe(0.5);
      expect(qv.max).toBe(0.5);
      expect(qv.data[0]).toBe(128);

      const rec = dequantizeVector(qv);
      expect(rec[0]).toBeCloseTo(0.5, 4);
    });
  });

  describe("Asymmetric Distance Computation (ADC)", () => {
    test("asymmetric cosine distance is close to exact float cosine distance", () => {
      const dim = 128;
      const vA = generateRandomVector(dim, 101);
      const vB = generateRandomVector(dim, 202);

      const exactDist = exactCosineDistance(vA, vB);

      const qvB = quantizeVector(vB, "node-b");
      const ctx = createAsymmetricQueryContext(vA);

      const adcDist = computeAsymmetricCosineDistance(ctx, qvB);

      // Correlation within ~0.02
      expect(Math.abs(adcDist - exactDist)).toBeLessThan(0.02);
    });

    test("asymmetric cosine distance is ~0 for identical vector", () => {
      const dim = 64;
      const v = generateRandomVector(dim, 77);

      const qv = quantizeVector(v, "self");
      const ctx = createAsymmetricQueryContext(v);

      const dist = computeAsymmetricCosineDistance(ctx, qv);
      expect(dist).toBeCloseTo(0.0, 2);
    });

    test("asymmetric cosine distance handles orthogonal vectors (~1.0)", () => {
      const vA = [1, 0, 0, 0];
      const vB = [0, 1, 0, 0];

      const qvB = quantizeVector(vB, "ortho");
      const ctx = createAsymmetricQueryContext(vA);

      const dist = computeAsymmetricCosineDistance(ctx, qvB);
      expect(dist).toBeCloseTo(1.0, 1);
    });

    test("asymmetric cosine distance handles opposite vectors (~2.0)", () => {
      const vA = [1, 0.5, -0.5];
      const vB = [-1, -0.5, 0.5];

      const qvB = quantizeVector(vB, "opp");
      const ctx = createAsymmetricQueryContext(vA);

      const dist = computeAsymmetricCosineDistance(ctx, qvB);
      expect(dist).toBeCloseTo(2.0, 1);
    });

    test("asymmetric euclidean distance approximates true Euclidean distance", () => {
      const dim = 32;
      const vA = generateRandomVector(dim, 12);
      const vB = generateRandomVector(dim, 34);

      let exactL2 = 0;
      for (let i = 0; i < dim; i++) {
        exactL2 += (vA[i] - vB[i]) ** 2;
      }
      exactL2 = Math.sqrt(exactL2);

      const qvB = quantizeVector(vB, "l2-b");
      const ctx = createAsymmetricQueryContext(vA);

      const adcL2 = computeAsymmetricEuclideanDistance(ctx, qvB);
      expect(Math.abs(adcL2 - exactL2)).toBeLessThan(0.05);
    });

    test("handles zero vector gracefully without NaN", () => {
      const zero = [0, 0, 0];
      const qv = quantizeVector(zero, "zero");
      const ctx = createAsymmetricQueryContext([1, 1, 1]);

      const dist = computeAsymmetricCosineDistance(ctx, qv);
      expect(dist).toBe(1.0);
    });
  });

  describe("Symmetric Quantized Cosine Distance", () => {
    test("calculates distance between two quantized vectors", () => {
      const dim = 64;
      const vA = generateRandomVector(dim, 401);
      const vB = generateRandomVector(dim, 502);

      const qvA = quantizeVector(vA, "qa");
      const qvB = quantizeVector(vB, "qb");

      const exact = exactCosineDistance(vA, vB);
      const symDist = computeSymmetricCosineDistance(qvA, qvB);

      expect(Math.abs(symDist - exact)).toBeLessThan(0.05);
    });
  });

  describe("Binary Serialization & Deserialization", () => {
    test("serializes and deserializes multiple quantized vectors with exact fidelity", () => {
      const dim = 16;
      const vectors = [
        quantizeVector(generateRandomVector(dim, 1), "vec-alpha"),
        quantizeVector(generateRandomVector(dim, 2), "vec-beta"),
        quantizeVector(generateRandomVector(dim, 3), "vec-gamma"),
      ];

      const buffer = serializeQuantizedVectors(vectors);
      expect(buffer).toBeInstanceOf(Uint8Array);

      const deserialized = deserializeQuantizedVectors(buffer);
      expect(deserialized.length).toBe(3);

      for (let i = 0; i < vectors.length; i++) {
        expect(deserialized[i].id).toBe(vectors[i].id);
        expect(deserialized[i].min).toBeCloseTo(vectors[i].min, 5);
        expect(deserialized[i].max).toBeCloseTo(vectors[i].max, 5);
        expect(deserialized[i].norm).toBeCloseTo(vectors[i].norm, 5);
        expect(deserialized[i].sumQ).toBe(vectors[i].sumQ);
        expect(Array.from(deserialized[i].data)).toEqual(
          Array.from(vectors[i].data),
        );
      }
    });

    test("throws an error when deserializing corrupted or invalid buffer", () => {
      expect(() => deserializeQuantizedVectors(new Uint8Array(5))).toThrow(
        "insufficient header bytes",
      );

      const invalidMagic = new Uint8Array(16);
      expect(() => deserializeQuantizedVectors(invalidMagic)).toThrow(
        "magic mismatch",
      );
    });
  });

  describe("QuantizedVectorStore", () => {
    test("manages vector insertions, queries, and dimension validation", () => {
      const store = new QuantizedVectorStore(16);
      const vec = generateRandomVector(16, 88);

      store.add("item-1", vec);
      expect(store.size()).toBe(1);
      expect(store.has("item-1")).toBe(true);

      expect(() => store.add("invalid", [1, 2, 3])).toThrow(
        "Dimension mismatch",
      );
    });

    test("performs batch additions and retrieval", () => {
      const store = new QuantizedVectorStore(8);
      const items = [
        { id: "a", vector: generateRandomVector(8, 1) },
        { id: "b", vector: generateRandomVector(8, 2) },
      ];

      const added = store.addBatch(items);
      expect(added.length).toBe(2);
      expect(store.size()).toBe(2);
      expect(store.get("a")?.id).toBe("a");
    });

    test("calculates memory compression statistics demonstrating ~4x savings", () => {
      const store = new QuantizedVectorStore(128);
      for (let i = 0; i < 50; i++) {
        store.add(`vec-${i}`, generateRandomVector(128, i));
      }

      const stats = store.getMemoryStats();
      expect(stats.vectorCount).toBe(50);
      expect(stats.dimension).toBe(128);
      expect(stats.rawFloat32Bytes).toBe(50 * 128 * 4); // 25,600 bytes
      expect(stats.quantizedBytes).toBeLessThan(stats.rawFloat32Bytes);
      expect(stats.compressionRatio).toBeGreaterThan(3.0);
      expect(stats.bytesSaved).toBeGreaterThan(15000);
    });

    test("asymmetric search retrieves nearest neighbors with high recall", () => {
      const dim = 32;
      const store = new QuantizedVectorStore(dim);
      const vectors: Array<{ id: string; vector: number[] }> = [];

      for (let i = 0; i < 40; i++) {
        const v = generateRandomVector(dim, i * 7);
        vectors.push({ id: `doc-${i}`, vector: v });
        store.add(`doc-${i}`, v);
      }

      const query = generateRandomVector(dim, 999);

      // Exact ground truth brute force
      const exactResults = vectors
        .map((item) => ({
          id: item.id,
          distance: exactCosineDistance(query, item.vector),
        }))
        .sort((a, b) => a.distance - b.distance)
        .slice(0, 5);

      // Quantized search
      const quantizedResults = store.search(query, 5, "cosine");

      expect(quantizedResults.length).toBe(5);
      const recall = store.evaluateRecall(exactResults, quantizedResults);
      // Recall@5 should be high (at least 80% on random distributions)
      expect(recall).toBeGreaterThanOrEqual(0.8);
    });

    test("supports Euclidean distance search", () => {
      const store = new QuantizedVectorStore(4);
      store.add("close", [1.0, 1.0, 1.0, 1.0]);
      store.add("far", [10.0, 10.0, 10.0, 10.0]);

      const results = store.search([1.1, 0.9, 1.0, 1.0], 2, "euclidean");
      expect(results[0].id).toBe("close");
      expect(results[1].id).toBe("far");
    });

    test("exports and imports binary store format", () => {
      const store = new QuantizedVectorStore(8);
      store.add("x1", generateRandomVector(8, 11));
      store.add("x2", generateRandomVector(8, 22));

      const binary = store.exportBinary();

      const newStore = new QuantizedVectorStore(8);
      newStore.importBinary(binary);

      expect(newStore.size()).toBe(2);
      expect(newStore.has("x1")).toBe(true);
      expect(newStore.has("x2")).toBe(true);
    });

    test("deletion and clearing", () => {
      const store = new QuantizedVectorStore(4);
      store.add("d1", [1, 2, 3, 4]);
      expect(store.delete("d1")).toBe(true);
      expect(store.delete("d1")).toBe(false);

      store.add("d2", [1, 2, 3, 4]);
      store.clear();
      expect(store.size()).toBe(0);
    });
  });
});
