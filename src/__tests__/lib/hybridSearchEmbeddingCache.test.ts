/**
 * Tests for the XFetch probabilistic early expiration added to the hybrid
 * search embedding cache (Issue #7531).
 */

import {
  buildQueryEmbeddingCacheKey,
  getQueryEmbedding,
  shouldRefreshEmbeddingEarly,
  _resetEmbeddingRefreshStateForTesting,
} from "@/lib/search/hybridSearch";
import { getRedis } from "@/lib/redis";
import { getGeminiClient, isGeminiConfigured } from "@/lib/ai/gemini";

jest.mock("@/lib/redis", () => ({
  getRedis: jest.fn(),
}));

jest.mock("@/lib/ai/gemini", () => ({
  getGeminiClient: jest.fn(),
  isGeminiConfigured: jest.fn(),
}));

const mockEmbedContent = jest.fn();

const mockRedis = {
  get: jest.fn(),
  set: jest.fn(),
  del: jest.fn(),
  ttl: jest.fn(),
};

const CACHE_KEY_PREFIX = "embedding:";
const LOCK_KEY_SUFFIX = ":refresh-lock";

function cachePayload(embedding: number[], deltaMs = 250): string {
  return JSON.stringify({ embedding, deltaMs });
}

function findCacheWrite(): [string, string, unknown] | undefined {
  return mockRedis.set.mock.calls.find(
    ([key, value]) =>
      typeof key === "string" &&
      key.startsWith(CACHE_KEY_PREFIX) &&
      !key.endsWith(LOCK_KEY_SUFFIX) &&
      typeof value === "string" &&
      value.includes('"embedding"'),
  ) as [string, string, unknown] | undefined;
}

async function flushAsyncWork(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(() => {
  jest.clearAllMocks();
  _resetEmbeddingRefreshStateForTesting();

  (getRedis as jest.Mock).mockReturnValue(mockRedis);
  (isGeminiConfigured as jest.Mock).mockReturnValue(true);
  (getGeminiClient as jest.Mock).mockReturnValue({
    models: { embedContent: mockEmbedContent },
  });

  mockRedis.get.mockResolvedValue(null);
  mockRedis.set.mockResolvedValue("OK");
  mockRedis.del.mockResolvedValue(1);
  mockRedis.ttl.mockResolvedValue(7 * 24 * 60 * 60);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("shouldRefreshEmbeddingEarly (XFetch)", () => {
  it("triggers only once the remaining TTL falls inside the delta-scaled window", () => {
    // ln(random) === -1 for random === e^-1.
    const random = () => Math.exp(-1);

    // -3 * 1000 * ln(e^-1) = 3000, which is below 5000ms remaining.
    expect(shouldRefreshEmbeddingEarly(5000, 1000, 3, random)).toBe(false);

    // 3000 is above 500ms remaining, so refresh early.
    expect(shouldRefreshEmbeddingEarly(500, 1000, 3, random)).toBe(true);
  });

  it("never refreshes already-expired or zero-cost entries", () => {
    expect(shouldRefreshEmbeddingEarly(0, 1000)).toBe(false);
    expect(shouldRefreshEmbeddingEarly(-10, 1000)).toBe(false);
    expect(shouldRefreshEmbeddingEarly(500, 0)).toBe(false);
  });
});

describe("getQueryEmbedding cache behaviour", () => {
  it("serves a fresh cache hit without calling Gemini", async () => {
    const embedding = [0.1, 0.2, 0.3];
    mockRedis.get.mockResolvedValue(cachePayload(embedding));

    await expect(getQueryEmbedding("Hot Query")).resolves.toEqual(embedding);
    expect(mockEmbedContent).not.toHaveBeenCalled();
  });

  it("still reads legacy bare-array cache entries", async () => {
    const embedding = [0.4, 0.5];
    mockRedis.get.mockResolvedValue(JSON.stringify(embedding));

    await expect(getQueryEmbedding("legacy")).resolves.toEqual(embedding);
    expect(mockEmbedContent).not.toHaveBeenCalled();
  });

  it("returns the cached value immediately and refreshes in the background near expiry", async () => {
    const cachedEmbedding = [1, 1, 1];
    const refreshedEmbedding = [9, 9, 9];

    mockRedis.get.mockResolvedValue(cachePayload(cachedEmbedding, 1000));
    mockRedis.ttl.mockResolvedValue(1);
    mockEmbedContent.mockResolvedValue({
      embeddings: [{ values: refreshedEmbedding }],
    });
    jest.spyOn(Math, "random").mockReturnValue(0.0001);

    await expect(getQueryEmbedding("hot query")).resolves.toEqual(
      cachedEmbedding,
    );

    await flushAsyncWork();

    expect(mockEmbedContent).toHaveBeenCalledTimes(1);
    const write = findCacheWrite();
    expect(write).toBeDefined();
    expect(JSON.parse(write![1])).toMatchObject({
      embedding: refreshedEmbedding,
    });
    expect(mockRedis.del).toHaveBeenCalledWith(
      expect.stringContaining(LOCK_KEY_SUFFIX),
    );
  });

  it("coalesces concurrent refreshes for the same query hash (single-flight)", async () => {
    mockRedis.get.mockResolvedValue(cachePayload([1, 2, 3], 1000));
    mockRedis.ttl.mockResolvedValue(1);
    mockEmbedContent.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      return { embeddings: [{ values: [7, 7, 7] }] };
    });
    jest.spyOn(Math, "random").mockReturnValue(0.0001);

    await Promise.all([getQueryEmbedding("hot"), getQueryEmbedding("hot")]);
    await flushAsyncWork();

    expect(mockEmbedContent).toHaveBeenCalledTimes(1);
  });

  it("computes and stores the embedding, including its delta, on a cache miss", async () => {
    const embedding = [4, 5, 6];
    mockRedis.get.mockResolvedValue(null);
    mockEmbedContent.mockResolvedValue({ embeddings: [{ values: embedding }] });

    await expect(getQueryEmbedding("new query")).resolves.toEqual(embedding);

    const write = findCacheWrite();
    expect(write).toBeDefined();
    expect(JSON.parse(write![1])).toMatchObject({ embedding });
    expect(JSON.parse(write![1]).deltaMs).toBeGreaterThan(0);
  });
});

describe("query normalization for the embedding cache (Issue #7670)", () => {
  const VARIANTS = [
    "quiet cafe",
    " quiet cafe ",
    "  quiet cafe",
    "quiet cafe   ",
    "quiet   cafe",
    "QUIET CAFE",
    "\tQuiet\u00a0 Cafe\n",
  ];

  /** Backs the mocked Redis with a real Map so a write is visible to later reads. */
  function useStatefulRedis(): Map<string, string> {
    const store = new Map<string, string>();
    mockRedis.get.mockImplementation(
      async (key: string) => store.get(key) ?? null,
    );
    mockRedis.set.mockImplementation(async (key: string, value: string) => {
      store.set(key, value);
      return "OK";
    });
    return store;
  }

  it("derives one cache key for every whitespace and casing variant", () => {
    const keys = new Set(VARIANTS.map((q) => buildQueryEmbeddingCacheKey(q)));
    expect(keys.size).toBe(1);
  });

  it("still gives different queries different keys", () => {
    expect(buildQueryEmbeddingCacheKey("quiet cafe")).not.toBe(
      buildQueryEmbeddingCacheKey("quiet cafes"),
    );
  });

  it("keeps per-user and per-tier isolation while normalizing", () => {
    const publicKey = buildQueryEmbeddingCacheKey("quiet cafe");
    const userKey = buildQueryEmbeddingCacheKey(" Quiet  Cafe ", {
      userId: "user_1",
    });
    const otherUserKey = buildQueryEmbeddingCacheKey("quiet cafe", {
      userId: "user_2",
    });
    const tierKey = buildQueryEmbeddingCacheKey("quiet cafe", {
      authorizationTier: "pro",
    });

    expect(new Set([publicKey, userKey, otherUserKey, tierKey]).size).toBe(4);
    expect(userKey).toBe(
      buildQueryEmbeddingCacheKey("quiet cafe", { userId: "user_1" }),
    );
  });

  it("serves a warm cache hit for a spaced variant without a second Gemini call", async () => {
    useStatefulRedis();
    const embedding = [0.1, 0.2, 0.3];
    mockEmbedContent.mockResolvedValue({ embeddings: [{ values: embedding }] });

    // 1. "quiet cafe" -> cache miss, computed.
    await expect(getQueryEmbedding("quiet cafe")).resolves.toEqual(embedding);
    expect(mockEmbedContent).toHaveBeenCalledTimes(1);

    // 2. " quiet cafe " -> must hit the warm cache.
    await expect(getQueryEmbedding(" quiet cafe ")).resolves.toEqual(embedding);
    await expect(getQueryEmbedding("quiet   cafe")).resolves.toEqual(embedding);
    await expect(getQueryEmbedding("QUIET CAFE")).resolves.toEqual(embedding);

    expect(mockEmbedContent).toHaveBeenCalledTimes(1);
  });

  it("writes a single cache entry no matter which variant arrives first", async () => {
    const store = useStatefulRedis();
    mockEmbedContent.mockResolvedValue({ embeddings: [{ values: [1, 2, 3] }] });

    await getQueryEmbedding("  Quiet   Cafe  ");
    await getQueryEmbedding("quiet cafe");

    const embeddingKeys = [...store.keys()].filter(
      (key) =>
        key.startsWith(CACHE_KEY_PREFIX) && !key.endsWith(LOCK_KEY_SUFFIX),
    );
    expect(embeddingKeys).toEqual([buildQueryEmbeddingCacheKey("quiet cafe")]);
  });

  it("embeds the normalized text so the cached vector does not depend on the first spelling", async () => {
    useStatefulRedis();
    mockEmbedContent.mockResolvedValue({ embeddings: [{ values: [1] }] });

    await getQueryEmbedding("  Quiet   CAFE ");

    expect(mockEmbedContent).toHaveBeenCalledWith(
      expect.objectContaining({ contents: "quiet cafe" }),
    );
  });
});
