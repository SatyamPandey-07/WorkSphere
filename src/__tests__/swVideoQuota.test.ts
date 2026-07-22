import { hasSufficientStorageQuota } from "@/lib/swCacheLru";

describe("Service Worker Storage Quota Estimation & Video Tour Prefetching", () => {
  const originalStorage = navigator.storage;

  afterEach(() => {
    Object.defineProperty(navigator, "storage", {
      value: originalStorage,
      configurable: true,
      writable: true,
    });
  });

  it("checks navigator.storage.estimate() and allows prefetch when quota is sufficient", async () => {
    const mockEstimate = jest.fn().mockResolvedValue({
      quota: 500 * 1024 * 1024,
      usage: 50 * 1024 * 1024,
    });

    Object.defineProperty(navigator, "storage", {
      value: { estimate: mockEstimate },
      configurable: true,
      writable: true,
    });

    const isQuotaSufficient = await hasSufficientStorageQuota(15 * 1024 * 1024);
    expect(mockEstimate).toHaveBeenCalled();
    expect(isQuotaSufficient).toBe(true);
  });

  it("blocks video tour cache write when remaining quota is below minimum safety buffer", async () => {
    const mockEstimate = jest.fn().mockResolvedValue({
      quota: 100 * 1024 * 1024,
      usage: 99 * 1024 * 1024, // Only 1MB remaining
    });

    Object.defineProperty(navigator, "storage", {
      value: { estimate: mockEstimate },
      configurable: true,
      writable: true,
    });

    const isQuotaSufficient = await hasSufficientStorageQuota(10 * 1024 * 1024);
    expect(mockEstimate).toHaveBeenCalled();
    expect(isQuotaSufficient).toBe(false);
  });

  it("safely handles missing navigator.storage API without throwing error", async () => {
    Object.defineProperty(navigator, "storage", {
      value: undefined,
      configurable: true,
      writable: true,
    });

    const isQuotaSufficient = await hasSufficientStorageQuota(5 * 1024 * 1024);
    expect(isQuotaSufficient).toBe(true);
  });
});
