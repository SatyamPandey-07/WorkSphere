import { describe, it, expect, beforeEach } from 'vitest';
import {
  HNSWVectorStore,
  MetricType,
  type VectorDocument,
} from '../../core/ai/HNSWVectorStore';

describe('HNSWVectorStore - Hierarchical Navigable Small World Vector Index', () => {
  let store: HNSWVectorStore;

  beforeEach(() => {
    store = new HNSWVectorStore({
      dimensions: 4,
      metric: MetricType.COSINE,
      M: 8,
      M0: 16,
      efConstruction: 32,
      efSearch: 16,
    });
  });

  describe('Distance Metrics', () => {
    it('computes exact cosine distance for identical and orthogonal vectors', () => {
      const v1 = [1, 0, 0, 0];
      const v2 = [1, 0, 0, 0];
      const v3 = [0, 1, 0, 0];

      expect(store.computeDistance(v1, v2)).toBeCloseTo(0, 5);
      expect(store.computeDistance(v1, v3)).toBeCloseTo(1.0, 5);
    });

    it('computes Euclidean (L2) distance accurately', () => {
      const l2Store = new HNSWVectorStore({ dimensions: 3, metric: MetricType.EUCLIDEAN });
      const a = [0, 0, 0];
      const b = [3, 4, 0];
      expect(l2Store.computeDistance(a, b)).toBeCloseTo(5.0, 5);
    });

    it('computes Dot Product distance accurately', () => {
      const dotStore = new HNSWVectorStore({ dimensions: 2, metric: MetricType.DOT_PRODUCT });
      const a = [2, 3];
      const b = [4, 5]; // 2*4 + 3*5 = 8 + 15 = 23 -> distance = -23
      expect(dotStore.computeDistance(a, b)).toBe(-23);
    });
  });

  describe('Indexing & Approximate Nearest Neighbor Retrieval', () => {
    it('indexes vectors and returns exact query as closest match', () => {
      const docs: VectorDocument[] = [
        { id: 'doc_desk_quiet', vector: [0.9, 0.1, 0.0, 0.0], metadata: { tag: 'quiet' } },
        { id: 'doc_desk_collab', vector: [0.1, 0.9, 0.2, 0.0], metadata: { tag: 'collab' } },
        { id: 'doc_desk_booth', vector: [0.0, 0.1, 0.9, 0.1], metadata: { tag: 'booth' } },
        { id: 'doc_desk_outdoor', vector: [0.0, 0.0, 0.1, 0.9], metadata: { tag: 'outdoor' } },
      ];

      for (const d of docs) {
        store.insert(d);
      }

      expect(store.size).toBe(4);

      // Query close to quiet desk
      const results = store.search([0.95, 0.05, 0.0, 0.0], 2);
      expect(results.length).toBe(2);
      expect(results[0].id).toBe('doc_desk_quiet');
      expect(results[0].score).toBeGreaterThan(0.95);
    });

    it('filters nearest neighbors using metadata predicate', () => {
      store.insert({ id: 'desk_1', vector: [1, 0, 0, 0], metadata: { floor: 1, vip: false } });
      store.insert({ id: 'desk_2', vector: [0.9, 0.1, 0, 0], metadata: { floor: 2, vip: true } });
      store.insert({ id: 'desk_3', vector: [0.8, 0.2, 0, 0], metadata: { floor: 2, vip: false } });

      // Search for floor 2 only
      const floor2Results = store.search([1, 0, 0, 0], 3, (m) => m?.floor === 2);
      expect(floor2Results.length).toBe(2);
      expect(floor2Results[0].id).toBe('desk_2');
      expect(floor2Results[1].id).toBe('desk_3');

      // Search for VIP only
      const vipResults = store.search([1, 0, 0, 0], 3, (m) => Boolean(m?.vip));
      expect(vipResults.length).toBe(1);
      expect(vipResults[0].id).toBe('desk_2');
    });

    it('supports document deletion and entry-point re-election', () => {
      store.insert({ id: 'v1', vector: [1, 0, 0, 0] });
      store.insert({ id: 'v2', vector: [0, 1, 0, 0] });

      expect(store.size).toBe(2);
      const deleted = store.delete('v1');
      expect(deleted).toBe(true);
      expect(store.size).toBe(1);

      const results = store.search([1, 0, 0, 0], 2);
      expect(results.length).toBe(1);
      expect(results[0].id).toBe('v2');
    });
  });

  describe('Serialization & Deserialization', () => {
    it('serializes to JSON and restores identical graph and search outcomes', () => {
      store.insert({ id: 'p1', vector: [0.5, 0.5, 0.5, 0.5], metadata: { name: 'Pod 1' } });
      store.insert({ id: 'p2', vector: [1.0, 0.0, 0.0, 0.0], metadata: { name: 'Pod 2' } });

      const jsonStr = store.toJSON();
      const restored = HNSWVectorStore.fromJSON(jsonStr);

      expect(restored.size).toBe(2);
      expect(restored.metric).toBe(MetricType.COSINE);

      const query = [0.9, 0.1, 0.0, 0.0];
      const origResults = store.search(query, 1);
      const restoredResults = restored.search(query, 1);

      expect(origResults[0].id).toBe(restoredResults[0].id);
      expect(origResults[0].score).toBeCloseTo(restoredResults[0].score, 5);
      expect(restoredResults[0].metadata?.name).toBe('Pod 2');
    });
  });
});
