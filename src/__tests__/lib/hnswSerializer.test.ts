import "fake-indexeddb/auto";
import { HNSWIndex } from "@/lib/hnsw/hnsw";
import {
  cosineDistanceADC,
  deserializeHnswIndex,
  quantizeVector,
  serializeHnswIndex,
} from "@/lib/hnsw/hnswSerializer";
import { getOrFetchHnswIndex } from "@/lib/cache/hnswCache";

const config = {
  dim: 384,
  M: 8,
  efConstruction: 40,
  efSearch: 20,
  ml: 0.36,
};

function createIndex(seed: number): HNSWIndex {
  const index = new HNSWIndex(config);
  for (let node = 0; node < 8; node++) {
    const vector = Array.from(
      { length: config.dim },
      (_, dimension) => Math.sin(seed + node * 13 + dimension) * 0.9,
    );
    index.insert(`venue-${node}`, vector);
  }
  return index;
}

describe("HNSW binary serializer", () => {
  it("reconstructs node IDs, levels, edges, entrypoint, and config", () => {
    const original = createIndex(1);
    const restored = deserializeHnswIndex(serializeHnswIndex(original));
    const originalJson = original.toJSON();
    const restoredJson = restored.toJSON();

    expect(restored.size()).toBe(original.size());
    expect(restoredJson.config).toEqual(originalJson.config);
    expect(restoredJson.entryPoint).toBe(originalJson.entryPoint);
    expect(restoredJson.maxLevel).toBe(originalJson.maxLevel);
    for (const [id, node] of Object.entries(originalJson.nodes)) {
      expect(restoredJson.nodes[id].level).toBe(node.level);
      expect(restoredJson.nodes[id].neighbors).toEqual(node.neighbors);
    }
  });

  it("keeps ADC cosine distance close to the full-precision distance", () => {
    const vector = Array.from({ length: config.dim }, (_, i) => Math.cos(i * 0.17));
    const query = Array.from({ length: config.dim }, (_, i) => Math.sin(i * 0.11));
    const quantized = quantizeVector(vector);
    const dot = vector.reduce((sum, value, i) => sum + value * query[i], 0);
    const vectorNorm = Math.sqrt(
      vector.reduce((sum, value) => sum + value * value, 0),
    );
    const queryNorm = Math.sqrt(
      query.reduce((sum, value) => sum + value * value, 0),
    );
    const expected = 1 - dot / (vectorNorm * queryNorm);

    expect(cosineDistanceADC(query, quantized)).toBeCloseTo(expected, 2);
  });

  it("fetches again when the server version changes", async () => {
    const key = `venue-index-${Date.now()}-${Math.random()}`;
    const firstIndex = createIndex(3);
    const updatedIndex = createIndex(9);
    const fetchIndex = jest
      .fn<Promise<HNSWIndex>, []>()
      .mockResolvedValueOnce(firstIndex)
      .mockResolvedValueOnce(updatedIndex);

    await getOrFetchHnswIndex(key, "version-1", fetchIndex);
    const cached = await getOrFetchHnswIndex(key, "version-1", fetchIndex);
    const refreshed = await getOrFetchHnswIndex(key, "version-2", fetchIndex);

    expect(fetchIndex).toHaveBeenCalledTimes(2);
    expect(cached.search(firstIndex.getNode("venue-0")!.vector, 1)[0].id).toBe(
      "venue-0",
    );
    expect(
      refreshed.search(updatedIndex.getNode("venue-0")!.vector, 1)[0].id,
    ).toBe("venue-0");
  });
});