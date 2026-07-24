import { saveWeights, loadWeights, resetWeightDbCache } from "@/lib/federated/weightDb";
import { FEATURE_DIM } from "@/lib/federated/types";

const store = new Map<string, unknown>();

jest.mock("idb", () => ({
  openDB: jest.fn(async () => ({
    put: jest.fn(async (_store: string, value: unknown, key: string) => {
      store.set(key, value);
    }),
    get: jest.fn(async (_store: string, key: string) => store.get(key) ?? undefined),
  })),
}));

describe("weightDb", () => {
  beforeEach(() => {
    store.clear();
    resetWeightDbCache();
  });

  it("persists and reloads model weights from IndexedDB", async () => {
    const weights = new Float32Array(FEATURE_DIM);
    weights[0] = 0.42;
    weights[3] = -0.1;

    await saveWeights({ weights, bias: 0.15, updatedAt: 123 });
    const loaded = await loadWeights();

    expect(loaded).not.toBeNull();
    expect(loaded!.bias).toBe(0.15);
    expect(loaded!.updatedAt).toBe(123);
    expect(loaded!.weights[0]).toBeCloseTo(0.42);
    expect(loaded!.weights[3]).toBeCloseTo(-0.1);
    expect(loaded!.weights.length).toBe(FEATURE_DIM);
  });

  it("returns null when no weights have been stored", async () => {
    await expect(loadWeights()).resolves.toBeNull();
  });
});
