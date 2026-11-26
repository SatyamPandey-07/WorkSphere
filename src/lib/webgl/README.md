# WebGL texture cache

`WebGLTextureCache` is reusable infrastructure for WebGL tile-streaming
renderers. It is **not currently connected to a globe or tile streamer** in
WorkSphere; `NomadPassportCoin` uses static Three.js `CanvasTexture`s and is
not a compatible integration point.

## Basic use

```ts
const cache = new WebGLTextureCache(gl, { maxTextures: 16 });

const lease = await cache.load(tileKey, async (signal) => {
  const imageBitmap = await loadTileBitmap(tileKey, signal);
  if (signal.aborted) {
    imageBitmap.close();
    throw new DOMException("Tile request aborted", "AbortError");
  }

  const texture = gl.createTexture();
  if (!texture) {
    imageBitmap.close();
    throw new Error("Unable to allocate a WebGL texture.");
  }

  try {
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      imageBitmap,
    );
    return {
      texture,
      imageBitmap,
      tileId: tileKey,
      lod: tileLod,
    };
  } catch (error) {
    gl.deleteTexture(texture);
    imageBitmap.close();
    throw error;
  }
});

try {
  drawTile(lease.texture);
} finally {
  lease.release();
}

// Call from the renderer's effect cleanup.
cache.dispose();
```

## Ownership and lifecycle

- The cache is scoped to the WebGL context passed to its constructor; do not
  share it across unrelated contexts.
- A resolved loader transfers ownership of its returned texture, bitmap, and
  object URLs to the cache. By default, the cache deletes the texture, closes
  the bitmap, and revokes each URL exactly once after its final cache entry
  releases that resource.
- Set `ownsTexture`, `ownsImageBitmap`, or `ownsObjectUrls` to `false` when the
  corresponding resource remains owned by another subsystem. Shared handles
  within a cache are reference-counted.
- A lease pins its texture against LRU eviction. Release it promptly after the
  texture is no longer needed. Releasing a lease twice is safe.
- In-flight requests reserve capacity, are deduplicated by key, and receive an
  `AbortSignal`. Cancellation aborts cooperative loaders; a late result from a
  loader that ignores cancellation is disposed instead of being cached.
- Eviction never selects a leased or synchronously uploading texture. If all
  entries are pinned, the request fails with `TextureCacheCapacityError`
  rather than deleting an actively used resource.
- Context loss clears CPU-side resources and pending work without calling
  `deleteTexture` on invalid handles. A restored context starts with an empty
  cache and must load its textures again. `dispose()` removes listeners and
  releases remaining live-context resources without forcing context loss.
- The cache calls `dispose()` on a non-persisted `pagehide` and also expects
  renderers to call it during their normal unmount cleanup.

## ArrayBuffer transfer and uploads

The cache resource type deliberately has no `ArrayBuffer` or typed-array field.
`uploadPixels()` submits pixel views synchronously and never retains them; it
rejects detached or empty views. If a buffer is transferred with
`postMessage(message, [buffer])`, the sender must discard that buffer
immediately and use only the receiver's transferred buffer. Do not retry an
upload with the detached sender-side view. The cache performs no buffer copies
and does not transfer buffers itself.

`uploadImage()` similarly borrows its `TexImageSource` only for the duration of
the synchronous WebGL upload. To have the cache close an `ImageBitmap` later,
also return it as the resource's owned `imageBitmap`.

## Integration status and validation

No current renderer owns camera-driven tile texture streaming, so this cache is
pending integration with the missing streamer. This implementation alone does
not claim to repair a globe renderer or prove the issue's 120 MB or 60 FPS
targets. Those targets require profiling on representative browsers and GPUs
after a renderer adopts the cache.
