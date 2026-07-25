import {
  saveWeights,
  loadWeights,
  resetWeightDbCache,
  purgeStaleWeights,
  getWeightDb,
} from "@/lib/federated/weightDb";
import { FEATURE_DIM } from "@/lib/federated/types";

const store = new Map<string, any>();

jest.mock("idb", () => ({
  openDB: jest.fn(async () => ({
    put: jest.fn(async (_store: string, value: unknown, key: string) => {
      store.set(key, value);
    }),
    get: jest.fn(
      async (_store: string, key: string) => store.get(key) ?? undefined,
    ),
    transaction: jest.fn(() => ({
      objectStore: jest.fn(() => ({
        openCursor: jest.fn(async () => {
          const entries = Array.from(store.entries());
          let index = 0;

          const createCursor = (): any => {
            if (index >= entries.length) return null;
            const [key, value] = entries[index];
            return {
              key,
              value,
              delete: jest.fn(async () => {
                store.delete(key);
              }),
              continue: jest.fn(async () => {
                index++;
                return createCursor();
              }),
            };
          };

          return createCursor();
        }),
      })),
      done: Promise.resolve(),
    })),
  })),
}));

describe("weightDb", () => {
  beforeEach(() => {
    store.clear();
    resetWeightDbCache();
  });

  afterEach(() => {
    jest.restoreAllMocks();
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

  describe("purgeStaleWeights", () => {
    beforeEach(() => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date("2026-07-24T12:00:00Z"));
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it("removes stale weights and preserves recent weights", async () => {
      const now = Date.now();

      // Recent: 1 day old
      store.set("recent", { updatedAt: now - 24 * 60 * 60 * 1000 });
      // Stale: 31 days old
      store.set("stale", { updatedAt: now - 31 * 24 * 60 * 60 * 1000 });

      const result = await purgeStaleWeights();

      expect(result).toEqual({ deletedCount: 1, remainingCount: 1 });
      expect(store.has("recent")).toBe(true);
      expect(store.has("stale")).toBe(false);
    });

    it("handles an empty database", async () => {
      const result = await purgeStaleWeights();
      expect(result).toEqual({ deletedCount: 0, remainingCount: 0 });
    });

    it("allows custom maxAgeMs", async () => {
      const now = Date.now();

      // 5 days old
      store.set("entry1", { updatedAt: now - 5 * 24 * 60 * 60 * 1000 });

      // Purge everything older than 1 day
      const result = await purgeStaleWeights(24 * 60 * 60 * 1000);

      expect(result).toEqual({ deletedCount: 1, remainingCount: 0 });
      expect(store.has("entry1")).toBe(false);
    });

    it("fails gracefully and logs error", async () => {
      const consoleErrorSpy = jest
        .spyOn(console, "error")
        .mockImplementation(() => {});

      // Mock db to throw an error
      const db = (await getWeightDb()) as any;
      db.transaction.mockImplementationOnce(() => {
        throw new Error("IDB Error");
      });

      const result = await purgeStaleWeights();

      expect(result).toEqual({ deletedCount: 0, remainingCount: 0 });
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "[Federated] Failed to purge stale weights:",
        expect.any(Error),
      );
    });
  });
});
