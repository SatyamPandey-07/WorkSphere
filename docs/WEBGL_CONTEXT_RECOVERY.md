# WebGL Context Recovery Manager Guide

This document explains how WorkSphere handles WebGL context loss and recovery for the
heatmap renderer, floor plan viewer, and crowd simulation overlays.

---

## Why WebGL Contexts Are Lost

WebGL contexts can be lost without warning when:

- The OS reclaims GPU memory (e.g. too many open browser tabs, mobile device with low RAM)
- The GPU driver crashes or resets
- The user switches apps on mobile (backgrounding)
- The device enters power-saving mode

Without recovery logic, a WebGL canvas turns black and stays broken for the rest of
the session. The `WebGLContextRecoveryManager` prevents this by:

1. Listening for `webglcontextlost` / `webglcontextrestored` browser events.
2. Calling application-provided `onLost` / `onRestore` callbacks.
3. Showing a non-intrusive recovery banner during the re-initialization period.

---

## Files

| File | Role |
|------|------|
| `src/lib/webgl/WebGLContextRecoveryManager.ts` | Core recovery class |
| `src/lib/webgl/contextManager.ts` | `attachWebGLContextRecovery()` helper |
| `src/lib/webgl/canvasBufferSize.ts` | Device-pixel-ratio canvas sizing |
| `src/lib/webgl/webglHeatmapRenderer.ts` | Consumer — heatmap overlay |
| `src/lib/webgpu/heatDiffusionFallback.ts` | Consumer — heat diffusion WebGL fallback |
| `src/lib/webgpu/crowdFallback.ts` | Consumer — crowd simulation WebGL fallback |

---

## Core API

### `WebGLContextRecoveryManager`

```typescript
import { WebGLContextRecoveryManager } from "@/lib/webgl/WebGLContextRecoveryManager";

const recovery = new WebGLContextRecoveryManager(canvas, {
  onLost() {
    // Called immediately when context is lost.
    // Stop any animation loops here.
    renderer.stopRenderLoop();
  },
  onRestore(gl) {
    // Called when the context has been restored and a fresh gl context is ready.
    // Re-upload all textures, buffers, and shaders here.
    renderer.reinitialize(gl);
    renderer.startRenderLoop();
  },
});

// Later — when the component unmounts:
recovery.destroy();
```

**`destroy()`** removes event listeners. Always call it on component cleanup to prevent
listener leaks.

**`WebGLContextRecoveryManager.reset()`** clears internal state and removes any
leftover recovery banner from the DOM — useful between test cases.

---

### `attachWebGLContextRecovery()` Helper

`src/lib/webgl/contextManager.ts` provides a simpler one-call API:

```typescript
import { attachWebGLContextRecovery } from "@/lib/webgl/contextManager";

// Returns a cleanup function
const cleanup = attachWebGLContextRecovery(canvas, () => {
  // reinitialize callback — called after context restore
  renderer.reinitialize();
});

// On unmount:
cleanup();
```

This wrapper is what `webglHeatmapRenderer.ts` uses internally so individual
renderer classes don't need to manage the recovery lifecycle themselves.

---

## Recovery Banner

While recovery is in progress, `WebGLContextRecoveryManager` injects a full-width
banner at the top of `<body>`:

```
┌─────────────────────────────────────────────┐
│  ⚡ Graphics context recovering…             │
└─────────────────────────────────────────────┘
```

- The banner has `id="webgl-recovery-banner"` and sits at `z-index: 9999`.
- When all active recoveries resolve, the banner removes itself automatically.
- The banner is shared across all `WebGLContextRecoveryManager` instances —
  multiple simultaneous canvas recoveries show only one banner.

---

## Pattern: What to Do in `onRestore`

Re-create **all** GPU-side resources. The restored context is a blank slate — textures,
VBOs, VAOs, shader programs, and framebuffers must all be re-uploaded.

```typescript
onRestore(gl) {
  // Re-compile shaders
  this.program = compileProgram(gl, vertSource, fragSource);

  // Re-upload vertex data
  this.vbo = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
  gl.bufferData(gl.ARRAY_BUFFER, this.vertexData, gl.STATIC_DRAW);

  // Re-upload textures
  this.texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, this.texture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, pixelData);

  // Restart render loop
  this.startRenderLoop();
}
```

**Important:** Call `gl.deleteShader(vs)` and `gl.deleteShader(fs)` after linking —
shaders are no longer needed once attached to a program (see `heatDiffusionFallback.ts`).

---

## Simulating a Context Loss (Testing)

Use the `WEBGL_lose_context` extension to simulate context loss in the browser:

```javascript
// In the browser console or a test:
const canvas = document.querySelector('canvas');
const gl = canvas.getContext('webgl2');
const ext = gl.getExtension('WEBGL_lose_context');
ext.loseContext();  // triggers webglcontextlost
// ... wait for recovery banner ...
ext.restoreContext(); // triggers webglcontextrestored
```

In Jest (jsdom), mock the events:

```typescript
canvas.dispatchEvent(new Event('webglcontextlost'));
canvas.dispatchEvent(new Event('webglcontextrestored'));
```

---

## Further Reading

- [WebGL Specification — Context Lost](https://www.khronos.org/registry/webgl/specs/latest/1.0/#5.15.2)
- [MDN: `webglcontextlost` event](https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/webglcontextlost_event)
- [`src/lib/webgl/WebGLContextRecoveryManager.ts`](../src/lib/webgl/WebGLContextRecoveryManager.ts)
- [`src/lib/webgl/contextManager.ts`](../src/lib/webgl/contextManager.ts)
