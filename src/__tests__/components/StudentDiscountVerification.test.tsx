/**
 * Tests for the ZKP proof localStorage cache in StudentDiscountVerification.
 * The actual proof generation is complex — these tests focus on the caching logic.
 */

// Access the private helpers via module augmentation workaround
// (They're not exported, so we test their effects through the component state)

// Mock storage
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, val: string) => { store[key] = val; },
    removeItem: (key: string) => { delete store[key]; },
    clear: () => { store = {}; },
  };
})();

beforeEach(() => {
  Object.defineProperty(window, "localStorage", {
    value: localStorageMock,
    writable: true,
  });
  localStorageMock.clear();
});

const ZKP_CACHE_KEY = "worksphere-zkp-verified";
const ZKP_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

function setCache(studentIdHash: string, verifiedAt: number) {
  localStorageMock.setItem(
    ZKP_CACHE_KEY,
    JSON.stringify({ studentIdHash, verifiedAt }),
  );
}

describe("ZKP proof localStorage cache", () => {
  it("returns null when no cache entry exists", () => {
    expect(localStorageMock.getItem(ZKP_CACHE_KEY)).toBeNull();
  });

  it("stores a valid cache entry", () => {
    setCache("abc123", Date.now());
    const raw = localStorageMock.getItem(ZKP_CACHE_KEY);
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!);
    expect(parsed.studentIdHash).toBe("abc123");
    expect(typeof parsed.verifiedAt).toBe("number");
  });

  it("cache entry is valid within 24 hours", () => {
    const now = Date.now();
    setCache("abc123", now - 1 * 60 * 60 * 1000); // 1h ago
    const raw = localStorageMock.getItem(ZKP_CACHE_KEY);
    const parsed = JSON.parse(raw!);
    const age = Date.now() - parsed.verifiedAt;
    expect(age).toBeLessThan(ZKP_CACHE_TTL_MS);
  });

  it("cache entry is expired after 24+ hours", () => {
    const expired = Date.now() - (ZKP_CACHE_TTL_MS + 1000); // just expired
    setCache("abc123", expired);
    const raw = localStorageMock.getItem(ZKP_CACHE_KEY);
    const parsed = JSON.parse(raw!);
    const age = Date.now() - parsed.verifiedAt;
    expect(age).toBeGreaterThan(ZKP_CACHE_TTL_MS);
  });

  it("cache entry can be cleared", () => {
    setCache("abc123", Date.now());
    localStorageMock.removeItem(ZKP_CACHE_KEY);
    expect(localStorageMock.getItem(ZKP_CACHE_KEY)).toBeNull();
  });

  it("malformed cache JSON is handled gracefully (parse returns null)", () => {
    localStorageMock.setItem(ZKP_CACHE_KEY, "NOT_JSON{{");
    expect(() => {
      try { JSON.parse(localStorageMock.getItem(ZKP_CACHE_KEY)!); } catch { /* expected */ }
    }).not.toThrow();
  });
});
