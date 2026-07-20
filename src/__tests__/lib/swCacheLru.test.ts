import {
  MAX_CACHE_BYTES,
  cachePutWithLruLimit,
  estimateResponseSize,
  trimCacheToMaxBytes,
} from "@/lib/swCacheLru";

describe("swCacheLru", () => {
  it("exposes a 20MB cap", () => {
    expect(MAX_CACHE_BYTES).toBe(20 * 1024 * 1024);
  });

  it("prefers content-length when present", async () => {
    const response = new Response("hello", {
      headers: { "content-length": "42" },
    });
    expect(await estimateResponseSize(response)).toBe(42);
  });

  it("evicts oldest entries until under the byte limit", async () => {
    const store = new Map<string, Response>();
    const order: string[] = [];

    const cache = {
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
    };

    // three ~10 byte payloads, cap at 25 → must drop the oldest
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

    expect(order).toEqual([
      "https://img/b.jpg",
      "https://img/c.jpg",
    ]);
    expect(store.has("https://img/a.jpg")).toBe(false);
  });

  it("puts then trims in cachePutWithLruLimit", async () => {
    const store = new Map<string, Response>();
    const order: string[] = [];
    const cache = {
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
    };

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
});
