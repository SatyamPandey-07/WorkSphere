import fs from "fs";
import path from "path";

const PHOTO_CACHE_NAME = "worksphere-venue-photos-v1";
const PHOTO_META_DB_NAME = "worksphere-venue-photo-cache-lru";

describe("public service worker venue-photo quota handling", () => {
  const originalSelf = global.self;
  const originalCaches = global.caches;
  const originalFetch = global.fetch;
  let listeners: Record<string, ((event: any) => void)[]> = {};
  let photoCache: {
    match: jest.Mock;
    put: jest.Mock;
    keys: jest.Mock;
    delete: jest.Mock;
  };
  let apiCache: { put: jest.Mock; delete: jest.Mock };
  let prefetchCache: { match: jest.Mock };

  beforeEach(() => {
    listeners = {};
    const addEventListener = jest.fn((type: string, callback: (event: any) => void) => {
      listeners[type] = [...(listeners[type] || []), callback];
    });

    global.self = {
      addEventListener,
      skipWaiting: jest.fn(),
      clients: { claim: jest.fn(), matchAll: jest.fn().mockResolvedValue([]) },
      location: { origin: "http://localhost" },
    } as unknown as typeof global.self;
    global.fetch = jest.fn();

    photoCache = {
      match: jest.fn().mockResolvedValue(undefined),
      put: jest.fn(),
      keys: jest.fn().mockResolvedValue([]),
      delete: jest.fn().mockResolvedValue(true),
    };
    apiCache = {
      put: jest.fn().mockResolvedValue(undefined),
      delete: jest.fn().mockResolvedValue(true),
    };
    prefetchCache = { match: jest.fn().mockResolvedValue(undefined) };
    global.caches = {
      open: jest.fn((name: string) => {
        if (name === PHOTO_CACHE_NAME) return Promise.resolve(photoCache);
        if (name === "worksphere-v3") return Promise.resolve(apiCache);
        return Promise.resolve(prefetchCache);
      }),
      match: jest.fn(),
      keys: jest.fn().mockResolvedValue([]),
      delete: jest.fn(),
    } as unknown as CacheStorage;

    const swCode = fs.readFileSync(
      path.join(process.cwd(), "public/sw.js"),
      "utf-8",
    );
    eval(swCode);
  });

  afterEach(() => {
    global.self = originalSelf;
    global.caches = originalCaches;
    global.fetch = originalFetch;
  });

  async function seedPhotoTimestamps(urls: string[]) {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(PHOTO_META_DB_NAME, 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore("entries", { keyPath: "url" });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });

    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction("entries", "readwrite");
      const store = transaction.objectStore("entries");
      urls.forEach((url, index) =>
        store.put({ url, lastAccessed: Date.now() - urls.length + index }),
      );
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
    db.close();
  }

  async function dispatchFetch(request: Request): Promise<Response> {
    let responsePromise: Promise<Response> | undefined;
    listeners.fetch[0]({
      request,
      respondWith: (response: Promise<Response>) => {
        responsePromise = Promise.resolve(response);
      },
      waitUntil: jest.fn(),
    });
    if (!responsePromise) throw new Error("Service worker did not handle fetch");
    return responsePromise;
  }

  it("evicts only venue photos, retries once, and continues caching API metadata", async () => {
    const oldPhotoUrls = Array.from(
      { length: 10 },
      (_, index) => `https://images.pexels.com/old-${index}.jpg`,
    );
    await seedPhotoTimestamps(oldPhotoUrls);
    photoCache.keys.mockResolvedValue(
      [
        ...oldPhotoUrls.map((url) => new Request(url)),
        new Request("http://localhost/api/venues"),
      ],
    );
    photoCache.put
      .mockRejectedValueOnce({ name: "QuotaExceededError" })
      .mockResolvedValueOnce(undefined);
    global.fetch = jest.fn().mockResolvedValue(new Response("image"));
    const warning = jest.spyOn(console, "warn").mockImplementation(() => {});

    try {
      const imageResponse = await dispatchFetch(
        new Request("https://images.pexels.com/new-photo.jpg"),
      );
      expect(await imageResponse.text()).toBe("image");
      expect(photoCache.delete.mock.calls.map(([request]) => request.url)).toEqual(
        oldPhotoUrls.slice(0, 2),
      );
      expect(photoCache.put).toHaveBeenCalledTimes(2);
      expect(apiCache.delete).not.toHaveBeenCalled();

      const metadataResponse = new Response('{"venues":[{"id":"venue-1"}]}', {
        headers: { "Content-Type": "application/json" },
      });
      global.fetch = jest.fn().mockResolvedValue(metadataResponse);
      const apiResponse = await dispatchFetch(
        new Request("http://localhost/api/venues"),
      );

      expect(await apiResponse.json()).toEqual({ venues: [{ id: "venue-1" }] });
      expect(apiCache.put).toHaveBeenCalledTimes(1);
    } finally {
      warning.mockRestore();
    }
  });

  it("serves an image and stops after one retry when quota remains exhausted", async () => {
    photoCache.put.mockRejectedValue({ name: "QuotaExceededError" });
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce(new Response("image"))
      .mockResolvedValueOnce(
        new Response('{"venues":[{"id":"venue-2"}]}', {
          headers: { "Content-Type": "application/json" },
        }),
      );
    const warning = jest.spyOn(console, "warn").mockImplementation(() => {});

    try {
      const response = await dispatchFetch(
        new Request("https://images.pexels.com/large-photo.jpg"),
      );

      expect(await response.text()).toBe("image");
      expect(photoCache.put).toHaveBeenCalledTimes(2);

      const metadataResponse = await dispatchFetch(
        new Request("http://localhost/api/venues"),
      );
      expect(await metadataResponse.json()).toEqual({
        venues: [{ id: "venue-2" }],
      });
      expect(apiCache.put).toHaveBeenCalledTimes(1);
    } finally {
      warning.mockRestore();
    }
  });

  it("evicts venue photos when API metadata itself reaches quota", async () => {
    const urls = Array.from(
      { length: 5 },
      (_, index) => `https://images.pexels.com/api-priority-${index}.jpg`,
    );
    await seedPhotoTimestamps(urls);
    photoCache.keys.mockResolvedValue(urls.map((url) => new Request(url)));
    apiCache.put
      .mockRejectedValueOnce({ name: "QuotaExceededError" })
      .mockResolvedValueOnce(undefined);
    const apiResponse = new Response('{"venues":[]}', {
      headers: { "Content-Type": "application/json" },
    });
    global.fetch = jest.fn().mockResolvedValue(apiResponse);
    const warning = jest.spyOn(console, "warn").mockImplementation(() => {});

    try {
      const response = await dispatchFetch(
        new Request("http://localhost/api/venues"),
      );

      expect(await response.json()).toEqual({ venues: [] });
      expect(apiCache.put).toHaveBeenCalledTimes(2);
      expect(photoCache.delete.mock.calls.map(([request]) => request.url)).toEqual([
        urls[0],
      ]);
    } finally {
      warning.mockRestore();
    }
  });

  it("serializes concurrent image cache writes", async () => {
    let activeWrites = 0;
    let maximumConcurrentWrites = 0;
    photoCache.put.mockImplementation(async () => {
      activeWrites += 1;
      maximumConcurrentWrites = Math.max(
        maximumConcurrentWrites,
        activeWrites,
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
      activeWrites -= 1;
    });
    global.fetch = jest
      .fn()
      .mockImplementation((request: Request) =>
        Promise.resolve(new Response(request.url)),
      );

    const [first, second] = await Promise.all([
      dispatchFetch(new Request("https://images.pexels.com/concurrent-1.jpg")),
      dispatchFetch(new Request("https://images.pexels.com/concurrent-2.jpg")),
    ]);

    expect(await first.text()).toContain("concurrent-1.jpg");
    expect(await second.text()).toContain("concurrent-2.jpg");
    expect(maximumConcurrentWrites).toBe(1);
  });
});
