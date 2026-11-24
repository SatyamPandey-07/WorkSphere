/**
 * Bounded, context-scoped cache for asynchronously loaded WebGL tile textures.
 *
 * A loader must return a fully initialized texture and transfer ownership of
 * the returned resources to the cache. Use `acquire`/the returned load lease
 * while a texture is actively needed by a renderer, then release the lease.
 * The cache never stores ArrayBuffers or typed-array views.
 */

export const DEFAULT_MAX_CACHED_TEXTURES = 16;

export interface WebGLTextureCacheResource {
  texture: WebGLTexture;
  imageBitmap?: ImageBitmap;
  objectUrls?: readonly string[];
  tileId?: string;
  lod?: number;
  ownsTexture?: boolean;
  ownsImageBitmap?: boolean;
  ownsObjectUrls?: boolean;
}

export interface WebGLTextureCacheLease {
  readonly texture: WebGLTexture;
  readonly imageBitmap?: ImageBitmap;
  readonly tileId?: string;
  readonly lod?: number;
  release(): void;
}

export interface WebGLTextureCacheOptions {
  maxTextures?: number;
  canvas?: HTMLCanvasElement | OffscreenCanvas;
  pageWindow?: Window | null;
}

export type WebGLTextureLoader = (
  signal: AbortSignal,
) => Promise<WebGLTextureCacheResource>;

interface ResourceReference {
  references: number;
  owned: boolean;
}

interface TextureEntry {
  readonly key: string;
  resource: WebGLTextureCacheResource | null;
  leases: number;
  uploads: number;
  disposed: boolean;
  retired: boolean;
}

interface PendingEntry {
  readonly key: string;
  readonly controller: AbortController;
  readonly contextGeneration: number;
  promise: Promise<TextureEntry>;
}

export class TextureCacheCapacityError extends Error {
  constructor(maxTextures: number) {
    super(
      `All ${maxTextures} cached WebGL textures are currently in use; release a texture lease before loading another.`,
    );
    this.name = "TextureCacheCapacityError";
  }
}

function createAbortError(): Error {
  const error = new Error("The texture load was cancelled.");
  error.name = "AbortError";
  return error;
}

function throwCleanupErrors(errors: unknown[], message: string): void {
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) throw new AggregateError(errors, message);
}

/**
 * LRU cache for WebGL textures. Capacity includes in-flight loads and pinned
 * resources retained after replacement/deletion until their leases are freed.
 */
export class WebGLTextureCache {
  private readonly entries = new Map<string, TextureEntry>();
  private readonly pending = new Map<string, PendingEntry>();
  private readonly reservations = new Set<PendingEntry>();
  private readonly retired = new Set<TextureEntry>();
  private readonly textures = new Map<WebGLTexture, ResourceReference>();
  private readonly bitmaps = new Map<ImageBitmap, ResourceReference>();
  private readonly objectUrls = new Map<string, ResourceReference>();
  private readonly canvas: HTMLCanvasElement | OffscreenCanvas | undefined;
  private readonly pageWindow: Window | null;
  private readonly maxTextures: number;
  private contextLost = false;
  private contextGeneration = 0;
  private disposed = false;

  constructor(
    private readonly gl: WebGLRenderingContext | WebGL2RenderingContext,
    options: WebGLTextureCacheOptions = {},
  ) {
    const maxTextures = options.maxTextures ?? DEFAULT_MAX_CACHED_TEXTURES;
    if (!Number.isInteger(maxTextures) || maxTextures < 1) {
      throw new RangeError("maxTextures must be a positive integer.");
    }

    this.maxTextures = maxTextures;
    this.canvas =
      options.canvas ??
      (gl.canvas && typeof gl.canvas.addEventListener === "function"
        ? gl.canvas
        : undefined);
    this.pageWindow =
      options.pageWindow !== undefined
        ? options.pageWindow
        : this.getCanvasWindow(this.canvas);

    this.canvas?.addEventListener(
      "webglcontextlost",
      this.handleContextLost,
      false,
    );
    this.canvas?.addEventListener(
      "webglcontextrestored",
      this.handleContextRestored,
      false,
    );
    this.pageWindow?.addEventListener("pagehide", this.handlePageHide);
  }

  /** Number of current ready tile keys. */
  get size(): number {
    return this.entries.size;
  }

  /** Unique cached texture handles plus reservations for in-flight loads. */
  get allocationCount(): number {
    return this.textures.size + this.reservations.size;
  }

  /** True while uploads and lookups are unavailable due to context loss. */
  get isContextLost(): boolean {
    return this.contextLost;
  }

  /** True after this cache has released its resources and listeners. */
  get isDisposed(): boolean {
    return this.disposed;
  }

  /**
   * Acquire an existing texture. The returned lease prevents LRU eviction
   * until `release()` is called; releases are idempotent.
   */
  acquire(key: string): WebGLTextureCacheLease | null {
    this.assertAvailable();
    const entry = this.entries.get(key);
    if (!entry || entry.disposed) return null;

    this.touch(entry);
    return this.createLease(entry);
  }

  /**
   * Load one tile. Concurrent calls for the same key share one loader request.
   * The loader's returned resources become cache-owned, even if the request
   * becomes stale before it resolves.
   */
  async load(
    key: string,
    loader: WebGLTextureLoader,
  ): Promise<WebGLTextureCacheLease> {
    this.assertAvailable();
    if (!key) throw new TypeError("A non-empty texture cache key is required.");

    const existing = this.entries.get(key);
    if (existing) {
      this.touch(existing);
      return Promise.resolve(this.createLease(existing));
    }

    const existingPending = this.pending.get(key);
    if (existingPending) {
      return existingPending.promise.then((entry) => this.createLease(entry));
    }

    this.reserveSlot();
    const pending: PendingEntry = {
      key,
      controller: new AbortController(),
      contextGeneration: this.contextGeneration,
      promise: Promise.resolve(null as unknown as TextureEntry),
    };
    this.pending.set(key, pending);
    this.reservations.add(pending);

    let rejectOnAbort!: (reason: Error) => void;
    const aborted = new Promise<never>((_, reject) => {
      rejectOnAbort = reject;
    });
    const abortListener = () => rejectOnAbort(createAbortError());
    pending.controller.signal.addEventListener("abort", abortListener, {
      once: true,
    });

    let loading: Promise<WebGLTextureCacheResource>;
    try {
      loading = Promise.resolve(loader(pending.controller.signal));
    } catch (error) {
      loading = Promise.reject(error);
    }

    let loadingSettled = false;
    void loading
      .then(
        (resource) => {
          loadingSettled = true;
          if (this.pending.get(key) !== pending) {
            this.reservations.delete(pending);
            this.disposeDetachedResource(
              resource,
              pending.contextGeneration !== this.contextGeneration,
            );
          }
        },
        () => {
          loadingSettled = true;
          this.reservations.delete(pending);
        },
      )
      .catch((error: unknown) => {
        console.error(
          "[WebGLTextureCache] Failed to release a stale texture load:",
          error,
        );
      });

    pending.promise = Promise.race([loading, aborted])
      .then((resource) => {
        if (
          this.disposed ||
          this.contextLost ||
          pending.controller.signal.aborted ||
          this.pending.get(key) !== pending
        ) {
          throw createAbortError();
        }

        try {
          this.validateResource(resource);
        } catch (error) {
          this.disposeDetachedResource(resource);
          throw error;
        }
        this.pending.delete(key);
        const entry = this.createEntry(key, resource);
        this.reservations.delete(pending);
        this.entries.set(key, entry);
        return entry;
      })
      .catch((error: unknown) => {
        if (this.pending.get(key) === pending) this.pending.delete(key);
        if (loadingSettled) this.reservations.delete(pending);
        throw error;
      })
      .finally(() => {
        pending.controller.signal.removeEventListener("abort", abortListener);
      });

    return pending.promise.then((entry) => this.createLease(entry));
  }

  /**
   * Insert a completed texture, replacing the current value for `key`.
   * Ownership of `resource` transfers to the cache when this method is called.
   */
  set(
    key: string,
    resource: WebGLTextureCacheResource,
  ): WebGLTextureCacheLease {
    this.assertAvailable();
    if (!key) throw new TypeError("A non-empty texture cache key is required.");
    const current = this.entries.get(key);
    if (resource.texture && current?.resource?.texture === resource.texture) {
      this.validateResource(resource);
      this.retainResource(resource);
      this.touch(current);
      const replacement = this.createEntry(key, resource, false);
      this.entries.set(key, replacement);
      this.retireEntry(current);
      return this.createLease(replacement);
    }

    try {
      this.validateResource(resource);
    } catch (error) {
      this.disposeDetachedResource(resource);
      throw error;
    }

    const pending = this.pending.get(key);
    if (pending) this.cancelPending(pending);

    try {
      this.reserveSlot(resource.texture);
    } catch (error) {
      this.disposeDetachedResource(resource);
      throw error;
    }

    const entry = this.createEntry(key, resource);
    const previous = this.entries.get(key);
    this.entries.set(key, entry);
    if (previous) this.retireEntry(previous);
    this.touch(entry);
    return this.createLease(entry);
  }

  /**
   * Remove a key. Leased textures are retired and disposed after their final
   * lease is released; unleased textures are cleaned up immediately.
   */
  delete(key: string): boolean {
    const pending = this.pending.get(key);
    if (pending) {
      this.cancelPending(pending);
      return true;
    }

    const entry = this.entries.get(key);
    if (!entry) return false;
    this.entries.delete(key);
    this.retireEntry(entry);
    return true;
  }

  /**
   * Upload pixel data synchronously without retaining the view. A transferred
   * (detached) buffer is rejected before WebGL is called.
   */
  uploadPixels(
    key: string,
    level: number,
    internalFormat: number,
    width: number,
    height: number,
    border: number,
    format: number,
    type: number,
    pixels: ArrayBufferView | null,
  ): void {
    const entry = this.getUploadEntry(key);
    const texture = entry.resource?.texture;
    if (!texture) throw new Error("The cached WebGL texture is unavailable.");
    if (pixels && (pixels.buffer.byteLength === 0 || pixels.byteLength === 0)) {
      throw new TypeError(
        "Cannot upload a detached or empty pixel buffer. Transfer ownership only once and use the receiver's buffer.",
      );
    }

    entry.uploads += 1;
    try {
      this.gl.bindTexture(this.gl.TEXTURE_2D, texture);
      this.gl.texImage2D(
        this.gl.TEXTURE_2D,
        level,
        internalFormat,
        width,
        height,
        border,
        format,
        type,
        pixels,
      );
    } finally {
      entry.uploads -= 1;
      if (entry.retired && entry.leases === 0 && entry.uploads === 0) {
        this.disposeEntry(entry);
      } else if (!entry.disposed) {
        this.touch(entry);
      }
    }
  }

  /** Upload a borrowed image source synchronously without retaining it. */
  uploadImage(
    key: string,
    level: number,
    internalFormat: number,
    format: number,
    type: number,
    source: TexImageSource,
  ): void {
    const entry = this.getUploadEntry(key);
    const texture = entry.resource?.texture;
    if (!texture) throw new Error("The cached WebGL texture is unavailable.");
    entry.uploads += 1;
    try {
      this.gl.bindTexture(this.gl.TEXTURE_2D, texture);
      this.gl.texImage2D(
        this.gl.TEXTURE_2D,
        level,
        internalFormat,
        format,
        type,
        source,
      );
    } finally {
      entry.uploads -= 1;
      if (entry.retired && entry.leases === 0 && entry.uploads === 0) {
        this.disposeEntry(entry);
      } else if (!entry.disposed) {
        this.touch(entry);
      }
    }
  }

  /**
   * Drop every key. Active leases are retained until released, matching delete
   * semantics. Use `dispose()` for final teardown.
   */
  clear(): void {
    const errors: unknown[] = [];
    for (const pending of this.pending.values()) this.cancelPending(pending);
    for (const key of Array.from(this.entries.keys())) {
      try {
        this.delete(key);
      } catch (error) {
        errors.push(error);
      }
    }
    throwCleanupErrors(errors, "Failed to clear all cached WebGL textures.");
  }

  /**
   * Final teardown. Invalidates outstanding leases, cancels pending requests,
   * releases all owned resources, and detaches lifecycle listeners.
   */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    this.canvas?.removeEventListener(
      "webglcontextlost",
      this.handleContextLost,
      false,
    );
    this.canvas?.removeEventListener(
      "webglcontextrestored",
      this.handleContextRestored,
      false,
    );
    this.pageWindow?.removeEventListener("pagehide", this.handlePageHide);

    for (const pending of this.pending.values()) {
      pending.controller.abort();
    }
    this.pending.clear();
    this.reservations.clear();

    const errors = this.disposeAllEntries();
    throwCleanupErrors(errors, "Failed to dispose all cached WebGL textures.");
  }

  private readonly handleContextLost = (event: Event) => {
    event.preventDefault();
    this.contextLost = true;
    this.contextGeneration += 1;
    for (const pending of this.pending.values()) {
      pending.controller.abort();
    }
    this.pending.clear();

    try {
      const errors = this.disposeAllEntries();
      if (errors.length > 0) {
        console.warn(
          "Failed to release resources cleanly after WebGL context loss:",
          errors
        );
      }
    } catch (err) {
      console.warn("Error during WebGL context loss cleanup:", err);
    }
  };

  private readonly handleContextRestored = () => {
    if (!this.disposed) {
      this.contextLost = false;
      this.entries.clear();
      this.retired.clear();
      this.textures.clear();
      this.bitmaps.clear();
      this.objectUrls.clear();
    }
  };

  private readonly handlePageHide = (event: PageTransitionEvent) => {
    if (!event.persisted) this.dispose();
  };

  private getCanvasWindow(
    canvas: HTMLCanvasElement | OffscreenCanvas | undefined,
  ): Window | null {
    if (canvas && "ownerDocument" in canvas) {
      return canvas.ownerDocument?.defaultView ?? null;
    }
    return typeof window === "undefined" ? null : window;
  }

  private assertAvailable(): void {
    if (this.disposed) throw new Error("The WebGL texture cache is disposed.");
    if (this.contextLost)
      throw new Error("The WebGL context is currently lost.");
  }

  private validateResource(
    resource: WebGLTextureCacheResource,
  ): asserts resource is WebGLTextureCacheResource {
    if (!resource || !resource.texture) {
      throw new TypeError(
        "A cached texture resource must contain a WebGLTexture.",
      );
    }
    if (
      resource.objectUrls?.some(
        (url) => typeof url !== "string" || url.length === 0,
      )
    ) {
      throw new TypeError("Object URLs must be non-empty strings.");
    }
  }

  private reserveSlot(texture?: WebGLTexture): void {
    const additional = texture && this.textures.has(texture) ? 0 : 1;
    while (this.allocationCount + additional > this.maxTextures) {
      const candidate = this.findEvictionCandidate();
      if (!candidate) throw new TextureCacheCapacityError(this.maxTextures);
      this.entries.delete(candidate.key);
      this.retireEntry(candidate);
    }
  }

  private findEvictionCandidate(): TextureEntry | undefined {
    for (const entry of this.entries.values()) {
      if (entry.leases === 0 && entry.uploads === 0 && !entry.disposed) {
        return entry;
      }
    }
    return undefined;
  }

  private touch(entry: TextureEntry): void {
    if (
      entry.disposed ||
      entry.retired ||
      this.entries.get(entry.key) !== entry
    ) {
      return;
    }
    this.entries.delete(entry.key);
    this.entries.set(entry.key, entry);
  }

  private createEntry(
    key: string,
    resource: WebGLTextureCacheResource,
    retain = true,
  ): TextureEntry {
    const entry: TextureEntry = {
      key,
      resource,
      leases: 0,
      uploads: 0,
      disposed: false,
      retired: false,
    };
    if (retain) this.retainResource(resource);
    return entry;
  }

  private retainResource(resource: WebGLTextureCacheResource): void {
    this.retainReference(
      this.textures,
      resource.texture,
      resource.ownsTexture !== false,
    );
    if (resource.imageBitmap) {
      this.retainReference(
        this.bitmaps,
        resource.imageBitmap,
        resource.ownsImageBitmap !== false,
      );
    }
    if (resource.objectUrls && resource.ownsObjectUrls !== false) {
      for (const url of new Set(resource.objectUrls)) {
        this.retainReference(this.objectUrls, url, true);
      }
    }
  }

  private retainReference<T extends object | string>(
    references: Map<T, ResourceReference>,
    resource: T,
    owned: boolean,
  ): void {
    const reference = references.get(resource);
    if (reference) {
      reference.references += 1;
      reference.owned ||= owned;
    } else {
      references.set(resource, { references: 1, owned });
    }
  }

  private createLease(entry: TextureEntry): WebGLTextureCacheLease {
    if (entry.disposed || this.disposed || !entry.resource) {
      throw new Error("Cannot acquire a disposed WebGL texture.");
    }
    entry.leases += 1;
    this.touch(entry);

    let released = false;
    const getResource = () => {
      if (released || entry.disposed || !entry.resource) {
        throw new Error("The WebGL texture lease has been released.");
      }
      return entry.resource;
    };
    return {
      get texture() {
        return getResource().texture;
      },
      get imageBitmap() {
        return getResource().imageBitmap;
      },
      get tileId() {
        return getResource().tileId;
      },
      get lod() {
        return getResource().lod;
      },
      release: () => {
        if (released) return;
        released = true;
        if (entry.disposed) return;
        entry.leases -= 1;
        if (entry.retired && entry.leases === 0) this.disposeEntry(entry);
      },
    };
  }

  private getUploadEntry(key: string): TextureEntry {
    this.assertAvailable();
    const entry = this.entries.get(key);
    if (!entry || entry.disposed || !entry.resource) {
      throw new Error(`No cached WebGL texture exists for key "${key}".`);
    }
    this.touch(entry);
    return entry;
  }

  private cancelPending(pending: PendingEntry): void {
    if (this.pending.get(pending.key) !== pending) return;
    this.pending.delete(pending.key);
    pending.controller.abort();
  }

  private retireEntry(entry: TextureEntry): void {
    if (entry.disposed || entry.retired) return;
    entry.retired = true;
    if (entry.leases > 0 || entry.uploads > 0) {
      this.retired.add(entry);
      return;
    }
    this.disposeEntry(entry);
  }

  private disposeDetachedResource(
    resource: WebGLTextureCacheResource,
    skipTextureDeletion = false,
  ): void {
    if (!resource) return;
    if (!resource.texture) {
      const errors: unknown[] = [];
      const bitmap = resource.imageBitmap;
      if (bitmap && typeof bitmap.close === "function") {
        const reference = this.bitmaps.get(bitmap);
        if (reference) {
          reference.owned ||= resource.ownsImageBitmap !== false;
        } else if (resource.ownsImageBitmap !== false) {
          try {
            bitmap.close();
          } catch (error) {
            errors.push(error);
          }
        }
      }

      if (resource.objectUrls && resource.ownsObjectUrls !== false) {
        for (const url of new Set(resource.objectUrls)) {
          if (typeof url !== "string" || url.length === 0) continue;
          const reference = this.objectUrls.get(url);
          if (reference) {
            reference.owned = true;
          } else if (typeof URL.revokeObjectURL === "function") {
            try {
              URL.revokeObjectURL(url);
            } catch (error) {
              errors.push(error);
            }
          }
        }
      }

      throwCleanupErrors(
        errors,
        "Failed to release resources from an invalid WebGL texture.",
      );
      return;
    }
    const safeResource: WebGLTextureCacheResource = {
      texture: resource.texture,
      imageBitmap:
        resource.imageBitmap && typeof resource.imageBitmap.close === "function"
          ? resource.imageBitmap
          : undefined,
      objectUrls: Array.isArray(resource.objectUrls)
        ? resource.objectUrls.filter(
            (url): url is string => typeof url === "string" && url.length > 0,
          )
        : undefined,
      ownsTexture: skipTextureDeletion ? false : resource.ownsTexture,
      ownsImageBitmap: resource.ownsImageBitmap,
      ownsObjectUrls: resource.ownsObjectUrls,
    };
    const entry = this.createEntry("", safeResource);
    this.disposeEntry(entry);
  }

  private disposeAllEntries(): unknown[] {
    const entries = new Set<TextureEntry>([
      ...this.entries.values(),
      ...this.retired,
    ]);
    this.entries.clear();
    this.retired.clear();

    const errors: unknown[] = [];
    for (const entry of entries) {
      try {
        this.disposeEntry(entry);
      } catch (error) {
        errors.push(error);
      }
    }
    return errors;
  }

  private disposeEntry(entry: TextureEntry): void {
    if (entry.disposed) return;
    entry.disposed = true;
    this.retired.delete(entry);
    const resource = entry.resource;
    entry.resource = null;
    if (!resource) return;

    const errors: unknown[] = [];
    const textureReference = this.textures.get(resource.texture);
    if (textureReference) {
      textureReference.references -= 1;
      if (textureReference.references === 0) {
        this.textures.delete(resource.texture);
        if (textureReference.owned && !this.contextLost) {
          try {
            this.gl.deleteTexture(resource.texture);
          } catch (error) {
            errors.push(error);
          }
        }
      }
    }

    const bitmap = resource.imageBitmap;
    if (bitmap) {
      this.releaseReference(this.bitmaps, bitmap, (bitmapReference) => {
        if (bitmapReference.owned) {
          try {
            bitmap.close();
          } catch (error) {
            errors.push(error);
          }
        }
      });
    }

    if (resource.objectUrls && resource.ownsObjectUrls !== false) {
      for (const url of new Set(resource.objectUrls)) {
        this.releaseReference(this.objectUrls, url, (ownedUrl) => {
          if (ownedUrl.owned && typeof URL.revokeObjectURL === "function") {
            try {
              URL.revokeObjectURL(url);
            } catch (error) {
              errors.push(error);
            }
          }
        });
      }
    }

    throwCleanupErrors(
      errors,
      "Failed to release a cached WebGL texture resource.",
    );
  }

  private releaseReference<T extends object | string>(
    references: Map<T, ResourceReference>,
    resource: T,
    onReleased: (reference: ResourceReference) => void,
  ): void {
    const reference = references.get(resource);
    if (!reference) return;
    reference.references -= 1;
    if (reference.references === 0) {
      references.delete(resource);
      onReleased(reference);
    }
  }
}
