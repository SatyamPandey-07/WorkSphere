import { MessageChannel } from "node:worker_threads";
import {
  DEFAULT_MAX_CACHED_TEXTURES,
  TextureCacheCapacityError,
  WebGLTextureCache,
  type WebGLTextureCacheResource,
} from "@/lib/webgl/textureCache";

type MockGl = WebGLRenderingContext & {
  bindTexture: jest.Mock;
  texImage2D: jest.Mock;
  deleteTexture: jest.Mock;
  RGBA: number;
  UNSIGNED_BYTE: number;
};

type MockBitmap = ImageBitmap & { close: jest.Mock };

function createMockGl() {
  const canvas = document.createElement("canvas");
  const gl = {
    canvas,
    TEXTURE_2D: 3553,
    RGBA: 6408,
    UNSIGNED_BYTE: 5121,
    bindTexture: jest.fn(),
    texImage2D: jest.fn(),
    deleteTexture: jest.fn(),
  } as unknown as MockGl;
  return { gl, canvas };
}

function createTexture(id: number): WebGLTexture {
  return { id } as unknown as WebGLTexture;
}

function createBitmap(): MockBitmap {
  return { close: jest.fn() } as unknown as MockBitmap;
}

function createResource(
  id: number,
  overrides: Partial<WebGLTextureCacheResource> = {},
): WebGLTextureCacheResource {
  return {
    texture: createTexture(id),
    tileId: `tile-${id}`,
    lod: 1,
    ...overrides,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("WebGLTextureCache", () => {
  let caches: WebGLTextureCache[];
  let revokeObjectURL: jest.SpyInstance;

  beforeEach(() => {
    caches = [];
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      writable: true,
      value: jest.fn(),
    });
    revokeObjectURL = jest
      .spyOn(URL, "revokeObjectURL")
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    for (const cache of caches) cache.dispose();
    revokeObjectURL.mockRestore();
  });

  function createCache(gl: MockGl, maxTextures?: number): WebGLTextureCache {
    const cache = new WebGLTextureCache(gl, { maxTextures });
    caches.push(cache);
    return cache;
  }

  it("defaults to a maximum of 16 allocations and evicts the least recently used texture", () => {
    const { gl } = createMockGl();
    const cache = createCache(gl, 2);
    const first = cache.set("first", createResource(1));
    const second = cache.set("second", createResource(2));
    first.release();
    second.release();

    const recentlyUsed = cache.acquire("first");
    recentlyUsed?.release();
    const third = cache.set("third", createResource(3));
    const firstAgain = cache.acquire("first");

    expect(cache.size).toBe(2);
    expect(cache.allocationCount).toBe(2);
    expect(firstAgain).not.toBeNull();
    expect(cache.acquire("second")).toBeNull();
    expect(gl.deleteTexture).toHaveBeenCalledTimes(1);
    expect(gl.deleteTexture).toHaveBeenCalledWith(
      expect.objectContaining({ id: 2 }),
    );

    third.release();
    firstAgain?.release();
    expect(DEFAULT_MAX_CACHED_TEXTURES).toBe(16);
  });

  it("does not evict an actively leased texture", () => {
    const { gl } = createMockGl();
    const cache = createCache(gl, 1);
    const lease = cache.set("active", createResource(1));

    expect(() => cache.set("next", createResource(2))).toThrow(
      TextureCacheCapacityError,
    );
    expect(gl.deleteTexture).not.toHaveBeenCalledWith(
      expect.objectContaining({ id: 1 }),
    );

    lease.release();
    const next = cache.set("next", createResource(3));
    expect(gl.deleteTexture).toHaveBeenCalledWith(
      expect.objectContaining({ id: 1 }),
    );
    next.release();
  });

  it("releases the texture, owned bitmap, and owned object URL exactly once", () => {
    const { gl } = createMockGl();
    const cache = createCache(gl);
    const bitmap = createBitmap();
    const lease = cache.set(
      "tile",
      createResource(1, {
        imageBitmap: bitmap,
        objectUrls: ["blob:tile"],
      }),
    );

    lease.release();
    expect(cache.delete("tile")).toBe(true);
    expect(gl.deleteTexture).toHaveBeenCalledTimes(1);
    expect(bitmap.close).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:tile");
    expect(cache.delete("tile")).toBe(false);
  });

  it("does not dispose resources explicitly marked as externally owned", () => {
    const { gl } = createMockGl();
    const cache = createCache(gl);
    const bitmap = createBitmap();
    const lease = cache.set(
      "shared",
      createResource(1, {
        imageBitmap: bitmap,
        objectUrls: ["blob:external"],
        ownsTexture: false,
        ownsImageBitmap: false,
        ownsObjectUrls: false,
      }),
    );

    lease.release();
    cache.delete("shared");
    expect(gl.deleteTexture).not.toHaveBeenCalled();
    expect(bitmap.close).not.toHaveBeenCalled();
    expect(revokeObjectURL).not.toHaveBeenCalled();
  });

  it("shares bitmap ownership across entries and closes it after the last eviction", () => {
    const { gl } = createMockGl();
    const cache = createCache(gl, 2);
    const bitmap = createBitmap();
    const first = cache.set(
      "first",
      createResource(1, { imageBitmap: bitmap }),
    );
    const second = cache.set(
      "second",
      createResource(2, { imageBitmap: bitmap }),
    );
    first.release();
    second.release();

    cache.delete("first");
    expect(bitmap.close).not.toHaveBeenCalled();
    cache.delete("second");
    expect(bitmap.close).toHaveBeenCalledTimes(1);
    expect(gl.deleteTexture).toHaveBeenCalledTimes(2);
  });

  it("replaces a lower-LOD texture and disposes displaced resources", () => {
    const { gl } = createMockGl();
    const cache = createCache(gl, 1);
    const lowLod = cache.set(
      "tile",
      createResource(1, { lod: 1, imageBitmap: createBitmap() }),
    );
    lowLod.release();

    const highBitmap = createBitmap();
    const highLod = cache.set(
      "tile",
      createResource(2, { lod: 2, imageBitmap: highBitmap }),
    );

    expect(gl.deleteTexture).toHaveBeenCalledTimes(1);
    expect(gl.deleteTexture).toHaveBeenCalledWith(
      expect.objectContaining({ id: 1 }),
    );
    expect(highLod.lod).toBe(2);
    expect(highLod.texture).toEqual(expect.objectContaining({ id: 2 }));
    highLod.release();
  });

  it("handles absent optional resources and repeated disposal", () => {
    const { gl } = createMockGl();
    const cache = createCache(gl);
    cache.set("plain", createResource(1)).release();

    cache.dispose();
    cache.dispose();
    expect(gl.deleteTexture).toHaveBeenCalledTimes(1);
    expect(cache.allocationCount).toBe(0);
    expect(cache.size).toBe(0);
  });

  it("releases owned CPU resources when a malformed entry has no texture", () => {
    const { gl } = createMockGl();
    const cache = createCache(gl);
    const bitmap = createBitmap();
    const resource = {
      texture: undefined as unknown as WebGLTexture,
      imageBitmap: bitmap,
      objectUrls: ["blob:invalid"],
    };

    expect(() => cache.set("invalid", resource)).toThrow(TypeError);
    expect(gl.deleteTexture).not.toHaveBeenCalled();
    expect(bitmap.close).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:invalid");
  });

  it("deduplicates concurrent and repeated loads for the same key", async () => {
    const { gl } = createMockGl();
    const cache = createCache(gl);
    const result = deferred<WebGLTextureCacheResource>();
    const loader = jest.fn(() => result.promise);
    const firstPromise = cache.load("tile", loader);
    const secondPromise = cache.load("tile", loader);

    expect(loader).toHaveBeenCalledTimes(1);
    result.resolve(createResource(1));
    const [first, second] = await Promise.all([firstPromise, secondPromise]);
    expect(first.texture).toBe(second.texture);
    expect(cache.allocationCount).toBe(1);

    first.release();
    second.release();
    const repeated = await cache.load("tile", loader);
    expect(loader).toHaveBeenCalledTimes(1);
    repeated.release();
  });

  it("aborts an obsolete load and disposes resources returned after cancellation", async () => {
    const { gl } = createMockGl();
    const cache = createCache(gl, 1);
    const stale = deferred<WebGLTextureCacheResource>();
    let signal: AbortSignal | undefined;
    const staleRequest = cache.load("obsolete", (loadSignal) => {
      signal = loadSignal;
      return stale.promise;
    });

    expect(cache.delete("obsolete")).toBe(true);
    await expect(staleRequest).rejects.toMatchObject({ name: "AbortError" });
    expect(signal?.aborted).toBe(true);

    const staleBitmap = createBitmap();
    stale.resolve(
      createResource(1, {
        imageBitmap: staleBitmap,
        objectUrls: ["blob:stale"],
      }),
    );
    await Promise.resolve();
    await Promise.resolve();

    expect(gl.deleteTexture).toHaveBeenCalledWith(
      expect.objectContaining({ id: 1 }),
    );
    expect(staleBitmap.close).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:stale");
    const active = await cache.load("current", async () => createResource(2));
    const activeAgain = cache.acquire("current");
    expect(activeAgain?.texture).toEqual(expect.objectContaining({ id: 2 }));
    activeAgain?.release();
    active.release();
  });

  it("counts pending loads against the allocation limit", async () => {
    const { gl } = createMockGl();
    const cache = createCache(gl, 1);
    const pending = deferred<WebGLTextureCacheResource>();
    const loading = cache.load("pending", () => pending.promise);

    expect(cache.allocationCount).toBe(1);
    await expect(
      cache.load("other", async () => createResource(2)),
    ).rejects.toBeInstanceOf(TextureCacheCapacityError);

    cache.delete("pending");
    await expect(loading).rejects.toMatchObject({ name: "AbortError" });
    expect(cache.allocationCount).toBe(1);
    await expect(
      cache.load("other", async () => createResource(2)),
    ).rejects.toBeInstanceOf(TextureCacheCapacityError);

    pending.resolve(createResource(1));
    await Promise.resolve();
    await Promise.resolve();
    expect(gl.deleteTexture).toHaveBeenCalledWith(
      expect.objectContaining({ id: 1 }),
    );
    expect(cache.allocationCount).toBe(0);
  });

  it("rejects detached ArrayBuffers without passing them to WebGL", () => {
    const { gl } = createMockGl();
    const cache = createCache(gl);
    cache.set("pixels", createResource(1)).release();

    const transferred = new ArrayBuffer(8);
    const pixels = new Uint8Array(transferred);
    const channel = new MessageChannel();
    channel.port1.postMessage(transferred, [transferred]);
    channel.port1.close();
    channel.port2.close();
    expect(transferred.byteLength).toBe(0);

    expect(() =>
      cache.uploadPixels(
        "pixels",
        0,
        gl.RGBA,
        1,
        2,
        0,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        pixels,
      ),
    ).toThrow(/detached or empty pixel buffer/i);
    expect(gl.texImage2D).not.toHaveBeenCalled();
  });

  it("does not retain pixel views after synchronous upload", () => {
    const { gl } = createMockGl();
    const cache = createCache(gl);
    cache.set("pixels", createResource(1)).release();
    const pixels = new Uint8Array([1, 2, 3, 4]);

    cache.uploadPixels(
      "pixels",
      0,
      gl.RGBA,
      1,
      1,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      pixels,
    );

    expect(gl.texImage2D).toHaveBeenCalledWith(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      1,
      1,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      pixels,
    );
    expect(cache.allocationCount).toBe(1);
  });

  it("protects a texture while it is being uploaded", () => {
    const { gl } = createMockGl();
    const cache = createCache(gl, 1);
    cache.set("uploading", createResource(1)).release();
    gl.texImage2D.mockImplementation(() => {
      expect(() => cache.set("next", createResource(2))).toThrow(
        TextureCacheCapacityError,
      );
    });

    cache.uploadPixels(
      "uploading",
      0,
      gl.RGBA,
      1,
      1,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      new Uint8Array([1, 2, 3, 4]),
    );

    expect(gl.deleteTexture).not.toHaveBeenCalledWith(
      expect.objectContaining({ id: 1 }),
    );
  });

  it("releases CPU resources but does not delete invalid GPU handles on context loss", () => {
    const { gl, canvas } = createMockGl();
    const cache = createCache(gl);
    const bitmap = createBitmap();
    const lease = cache.set(
      "tile",
      createResource(1, {
        imageBitmap: bitmap,
        objectUrls: ["blob:context"],
      }),
    );

    const lostEvent = new Event("webglcontextlost", { cancelable: true });
    canvas.dispatchEvent(lostEvent);

    expect(lostEvent.defaultPrevented).toBe(true);
    expect(cache.isContextLost).toBe(true);
    expect(cache.size).toBe(0);
    expect(gl.deleteTexture).not.toHaveBeenCalled();
    expect(bitmap.close).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:context");
    expect(() => cache.acquire("tile")).toThrow(/context is currently lost/i);
    lease.release();

    canvas.dispatchEvent(new Event("webglcontextrestored"));
    expect(cache.isContextLost).toBe(false);
    expect(cache.set("restored", createResource(2)).texture).toEqual(
      expect.objectContaining({ id: 2 }),
    );
  });

  it("does not delete a stale texture that resolves after context restoration", async () => {
    const { gl, canvas } = createMockGl();
    const cache = createCache(gl);
    const result = deferred<WebGLTextureCacheResource>();
    const loading = cache.load("stale-context", () => result.promise);
    canvas.dispatchEvent(new Event("webglcontextlost", { cancelable: true }));
    await expect(loading).rejects.toMatchObject({ name: "AbortError" });
    canvas.dispatchEvent(new Event("webglcontextrestored"));

    const bitmap = createBitmap();
    result.resolve(
      createResource(1, {
        imageBitmap: bitmap,
        objectUrls: ["blob:old-context"],
      }),
    );
    await Promise.resolve();
    await Promise.resolve();

    expect(gl.deleteTexture).not.toHaveBeenCalled();
    expect(bitmap.close).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:old-context");
    expect(cache.allocationCount).toBe(0);
  });

  it("disposes on pagehide but preserves a page entering the back-forward cache", () => {
    const { gl } = createMockGl();
    const cache = createCache(gl);
    cache.set("tile", createResource(1)).release();

    const persistedPageHide = new Event("pagehide") as PageTransitionEvent;
    Object.defineProperty(persistedPageHide, "persisted", { value: true });
    window.dispatchEvent(persistedPageHide);
    expect(cache.isDisposed).toBe(false);

    const unload = new Event("pagehide") as PageTransitionEvent;
    Object.defineProperty(unload, "persisted", { value: false });
    window.dispatchEvent(unload);
    expect(cache.isDisposed).toBe(true);
    expect(gl.deleteTexture).toHaveBeenCalledTimes(1);
  });

  it("keeps allocations bounded and releases every resource over 500 operations", async () => {
    const { gl } = createMockGl();
    const cache = createCache(gl, DEFAULT_MAX_CACHED_TEXTURES);
    const bitmaps = Array.from({ length: 500 }, createBitmap);

    for (let index = 0; index < 500; index += 1) {
      const lease = await cache.load(`tile-${index}`, async () =>
        createResource(index, {
          imageBitmap: bitmaps[index],
          objectUrls: [`blob:tile-${index}`],
        }),
      );
      lease.release();
      expect(cache.allocationCount).toBeLessThanOrEqual(
        DEFAULT_MAX_CACHED_TEXTURES,
      );
    }

    expect(cache.size).toBe(DEFAULT_MAX_CACHED_TEXTURES);
    expect(gl.deleteTexture).toHaveBeenCalledTimes(
      500 - DEFAULT_MAX_CACHED_TEXTURES,
    );
    expect(revokeObjectURL).toHaveBeenCalledTimes(
      500 - DEFAULT_MAX_CACHED_TEXTURES,
    );
    expect(
      bitmaps.filter((bitmap) => bitmap.close.mock.calls.length === 1),
    ).toHaveLength(500 - DEFAULT_MAX_CACHED_TEXTURES);

    cache.dispose();
    expect(gl.deleteTexture).toHaveBeenCalledTimes(500);
    expect(revokeObjectURL).toHaveBeenCalledTimes(500);
    expect(
      bitmaps.every((bitmap) => bitmap.close.mock.calls.length === 1),
    ).toBe(true);
  });
});
