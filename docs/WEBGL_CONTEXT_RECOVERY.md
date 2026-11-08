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
  // Paused on loss; resumed only after onRestore succeeds (#1729).
  renderLoop: {
    start: () => renderer.startRenderLoop(),
    stop: () => renderer.stopRenderLoop(),
  },
  onLost() {
    // Optional extra teardown when the context is lost.
  },
  onRestore(gl) {
    // A fresh context is ready. Rebuild shaders, buffers and textures here.
    // Throw if that fails: the user sees a failure notice, not "restored".
    renderer.reinitialize(gl);
  },
  onRestoreFailed(reason) {
    // "timeout" | "error" | "loss-storm" — e.g. switch to a 2D / static fallback.
    renderer.showStaticFallback();
  },
});

// Later — when the component unmounts:
recovery.destroy();
```

**`destroy()`** removes event listeners. Always call it on component cleanup to prevent
listener leaks.

**`WebGLContextRecoveryManager.reset()`** clears internal state and removes any
leftover recovery banner from the DOM — useful between test cases.

**`recovery.state`** is `"active"`, `"lost"` or `"failed"`.

#### Options

| Option | Default | Purpose |
| --- | --- | --- |
| `onRestore(gl)` | required | Rebuild GPU resources on the restored context. Throwing marks recovery as failed. |
| `onLost()` | — | Extra teardown when the context is lost. |
| `renderLoop` | — | `{ start, stop }`. Stopped on loss so no GL calls hit a dead context; restarted after a successful `onRestore`. |
| `onRestoreFailed(reason)` | — | Recovery abandoned: `"timeout"`, `"error"` or `"loss-storm"`. |
| `restoreTimeoutMs` | `10000` | How long to wait for `webglcontextrestored` before reporting `"timeout"`. A late restore still recovers. |
| `maxLosses` / `lossWindowMs` | `3` / `60000` | More losses than this inside the window is a **loss storm**: the manager stops calling `preventDefault()`, so the browser leaves the context lost instead of thrashing the GPU. |

#### Failure handling

Recovery is reported as failed, and the banner switches to an error state, when:

- the browser never fires `webglcontextrestored` within `restoreTimeoutMs`;
- no WebGL context can be obtained after restore;
- `onRestore` throws (e.g. a shader fails to compile on the new context);
- the canvas loses its context more than `maxLosses` times in `lossWindowMs`.

A `webglcontextrestored` event with no preceding loss is ignored.

---

### `attachWebGLContextRecovery()` Helper

`src/lib/webgl/contextManager.ts` provides a simpler one-call API:

```typescript
import { attachWebGLContextRecovery } from "@/lib/webgl/contextManager";

// Returns a cleanup function
const cleanup = attachWebGLContextRecovery(
  canvas,
  () => renderer.reinitialize(), // onRestore
  undefined,                     // onLost
  { renderLoop },                // any other manager option (optional)
);

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

- The banner has `id="webgl-recovery-banner"` and sits at `z-index: 99999`.
- It is shared across all `WebGLContextRecoveryManager` instances, and shows the most
  important state across every managed canvas: **failed** > **recovering** > **restored**.

| State | Text | Accessibility |
| --- | --- | --- |
| Recovering | "Recovering WebGL context…" with a spinner | `role="status"`, `aria-live="polite"`; spinner is `aria-hidden` |
| Restored | "restored successfully" — auto-hides after 2.5 s | `role="status"` |
| Failed | "Graphics couldn't be restored…" with **Reload** and **Dismiss** buttons | `role="alert"`; buttons are keyboard-focusable |

The spinner animation and slide transition are disabled under
`prefers-reduced-motion: reduce`. The Reload button calls
`WebGLContextRecoveryManager.reloadPage()`, which you can stub in tests.

### Consumers

| Consumer | On restore |
| --- | --- |
| `webglHeatmapRenderer.ts` | Rebuilds the program and VBO, **re-uploads the last point data**, then calls `onContextRestored` so `WebGLHeatmapLayer` redraws immediately |
| `useCloudRenderer.ts` | Passes its rAF loop as `renderLoop`, so it is paused while lost and resumed after shaders are rebuilt |
| `useGodRaysRenderer.ts` | Stops / restarts its loop via `onLost` / `onRestore` |
| `FloorPlan3D.tsx` | Re-renders the WebGL fallback |
| `Map.tsx` | Attaches once per canvas (re-checks on tab focus without duplicating listeners) |

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
