# Bounded Texture Cache (LRU Eviction & WebGL Context Lifecycle)

## Overview & Motivation

Rendering interactive 3D venue floorplans, maps, and isometric seating layouts requires loading dynamic texture tiles (e.g. ambient occlusion maps, floor materials, heatmap overlays, photo previews). On resource-constrained mobile and embedded browsers, unmanaged texture allocations rapidly lead to WebGL context loss (`CONTEXT_LOST_WEBGL`) or browser tab crashes due to Out-Of-Memory (OOM) GPU driver exceptions.

To eliminate memory leaks and guarantee predictable VRAM consumption, WorkSphere provides a bounded, context-scoped LRU texture cache (`src/lib/webgl/textureCache.ts`).

---

## Architecture & Memory Budgets

### Default Limits & VRAM Budgeting
- **Default Slot Limit**: `DEFAULT_MAX_CACHED_TEXTURES = 16` concurrent textures.
- **Default Memory Budget**: ~64 MB target VRAM budget on mobile devices (calculated based on sixteen 1024x1024 RGBA8 uncompressed textures, $1024 \times 1024 \times 4 \text{ bytes} \approx 4\text{ MB}$ each).
- **Lease Pinning**: Any texture actively referenced by a renderer is granted a `WebGLTextureCacheLease`. Leased textures are pinned in memory and are strictly exempt from LRU eviction.
- **In-flight Deduplication & Reservation**: When a texture request is initiated via `cache.load(key, loader)`, an in-flight entry is registered and reserves a slot. Duplicate requests for the same key await the same promise and increment the lease count.

### Eviction Policy
1. When capacity is exceeded upon loading a new texture, the cache selects the Least Recently Used (LRU) entry whose lease count is `0`.
2. The evicted texture has its underlying WebGL resources cleanly freed:
   - `gl.deleteTexture(texture)` deletes the GPU allocation.
   - Associated `ImageBitmap` instances are closed via `imageBitmap.close()`.
   - Any allocated blob/object URLs are revoked via `URL.revokeObjectURL(url)`.
3. If all slots are currently leased and pinned, the cache refuses to evict active resources and throws `TextureCacheCapacityError`.

---

## WebGL Context Loss & Restoration Lifecycle

WebGL contexts can be dropped at any time by the operating system (e.g., backgrounding the tab, GPU driver reset, device power-saving mode).

### Handling `webglcontextlost`
When the canvas emits `webglcontextlost`:
- The event must call `event.preventDefault()` to signal that the application intends to restore context.
- The cache sets `contextLost = true` and increments `contextGeneration`.
- All pending asynchronous texture loaders are aborted via `AbortController`.
- CPU-side metadata, references, and pending promises are discarded.
- `gl.deleteTexture` is **not** called on dead handles, preventing driver warnings or crashes.

### Handling `webglcontextrestored`
When `webglcontextrestored` fires:
- A fresh `WebGLTextureCache` instance or context re-initialization is established.
- The cache starts empty with generation reset.
- Renderers re-acquire texture leases through their standard render loops and loader functions.

---

## Usage Guide & Code Examples

### Acquiring and Releasing Textures

```typescript
import { WebGLTextureCache } from "@/lib/webgl/textureCache";

// 1. Initialize context-scoped cache
const cache = new WebGLTextureCache(gl, { maxTextures: 16 });

// 2. Request / load a texture tile with an AbortSignal-aware loader
async function renderTile(tileKey: string, tileUrl: string) {
  const lease = await cache.load(tileKey, async (signal: AbortSignal) => {
    const response = await fetch(tileUrl, { signal });
    const blob = await response.blob();
    const imageBitmap = await createImageBitmap(blob);

    if (signal.aborted) {
      imageBitmap.close();
      throw new DOMException("Tile load aborted", "AbortError");
    }

    const texture = gl.createTexture();
    if (!texture) {
      imageBitmap.close();
      throw new Error("Failed to create WebGLTexture");
    }

    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, imageBitmap);
    gl.generateMipmap(gl.TEXTURE_2D);

    return {
      texture,
      imageBitmap,
      tileId: tileKey,
    };
  });

  try {
    // 3. Bind and draw using the leased texture
    gl.bindTexture(gl.TEXTURE_2D, lease.texture);
    drawMesh();
  } finally {
    // 4. Always release lease when finished rendering frame or unmounting tile
    lease.release();
  }
}

// 5. Cleanup on component unmount
function cleanup() {
  cache.dispose();
}
```

---

## Best Practices Checklist

- [x] **Always release leases**: Wrap texture consumption in `try ... finally { lease.release(); }`.
- [x] **Support AbortSignal**: Ensure loader callbacks listen to `signal.aborted` to prevent ghost allocations.
- [x] **Never retain detached ArrayBuffers**: Use synchronous pixel uploads or transfer ownership cleanly.
- [x] **Dispose on unmount**: Always call `cache.dispose()` in component unmount effects.
