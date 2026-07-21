import {
  MAX_CACHE_BYTES,
  MAX_CACHE_ENTRIES,
  cachePutWithLruLimit,
  estimateResponseSize,
  trimCacheToMaxBytes,
} from "@/lib/swCacheLru";

function makeMockCache() {
  const store = new Map<string, Response>();
  const order: string[] = [];
  return {
    store,
    order,
    cache: {
      async keys() {
        return order.map((url) => new Request(url));
      },
      async match(request: Request) {
        return store.get(request.url);
      },
      async delete(request: Request) {
        store.delete(request.url);
        const idx = order.indexOf(request.url);
        if (idx >= 0) order.splice(idx, 1);
        return true;
      },
      async put(request: Request, response: Response) {
        if (!store.has(request.url)) order.push(request.url);
        store.set(request.url, response);
      },
    },
  };
}

describe("swCacheLru", () => {
  it("exposes a 20MB cap", () => {
    expect(MAX_CACHE_BYTES).toBe(20 * 1024 * 1024);
  });

  it("exposes a 50 entry cap", () => {
    expect(MAX_CACHE_ENTRIES).toBe(50);
  });

  it("prefers content-length when present", async () => {
    const response = new Response("hello", {
      headers: { "content-length": "42" },
    });
    expect(await estimateResponseSize(response)).toBe(42);
  });

  it("evicts oldest entries until under the byte limit", async () => {
    const { cache, order } = makeMockCache();

    await cache.put(
      new Request("https://img/a.jpg"),
      new Response("aaaaaaaaaa", { headers: { "content-length": "10" } }),
    );
    await cache.put(
      new Request("https://img/b.jpg"),
      new Response("bbbbbbbbbb", { headers: { "content-length": "10" } }),
    );
    await cache.put(
      new Request("https://img/c.jpg"),
      new Response("cccccccccc", { headers: { "content-length": "10" } }),
    );

    await trimCacheToMaxBytes(cache, 25);

    expect(order).toEqual(["https://img/b.jpg", "https://img/c.jpg"]);
  });

  it("evicts oldest entries when count exceeds maxEntries", async () => {
    const { cache, order, store } = makeMockCache();

    for (let i = 0; i < 5; i++) {
      await cache.put(
        new Request(`https://img/${i}.jpg`),
        new Response("x", { headers: { "content-length": "1" } }),
      );
    }

    await trimCacheToMaxBytes(cache, 10 * 1024 * 1024, 3);

    expect(order).toEqual([
      "https://img/2.jpg",
      "https://img/3.jpg",
      "https://img/4.jpg",
    ]);
    expect(store.has("https://img/0.jpg")).toBe(false);
    expect(store.has("https://img/1.jpg")).toBe(false);
  });

  it("puts then trims in cachePutWithLruLimit", async () => {
    const { cache, store } = makeMockCache();

    await cachePutWithLruLimit(
      cache,
      new Request("https://img/old.jpg"),
      new Response("x".repeat(20), { headers: { "content-length": "20" } }),
      30,
    );
    await cachePutWithLruLimit(
      cache,
      new Request("https://img/new.jpg"),
      new Response("y".repeat(20), { headers: { "content-length": "20" } }),
      30,
    );

    expect(store.has("https://img/old.jpg")).toBe(false);
    expect(store.has("https://img/new.jpg")).toBe(true);
  });

  it("cachePutWithLruLimit evicts by count when limit exceeded", async () => {
    const { cache, order, store } = makeMockCache();

    await cachePutWithLruLimit(
      cache,
      new Request("https://img/a.jpg"),
      new Response("a", { headers: { "content-length": "1" } }),
      10 * 1024 * 1024,
      3,
    );
    await cachePutWithLruLimit(
      cache,
      new Request("https://img/b.jpg"),
      new Response("b", { headers: { "content-length": "1" } }),
      10 * 1024 * 1024,
      3,
    );
    await cachePutWithLruLimit(
      cache,
      new Request("https://img/c.jpg"),
      new Response("c", { headers: { "content-length": "1" } }),
      10 * 1024 * 1024,
      3,
    );
    await cachePutWithLruLimit(
      cache,
      new Request("https://img/d.jpg"),
      new Response("d", { headers: { "content-length": "1" } }),
      10 * 1024 * 1024,
      3,
    );

    expect(order).toEqual([
      "https://img/b.jpg",
      "https://img/c.jpg",
      "https://img/d.jpg",
    ]);
    expect(store.has("https://img/a.jpg")).toBe(false);
  });
});
