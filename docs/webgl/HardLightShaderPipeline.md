# WebGL Hard-Light Construct Rendering Engine

> **Status:** Design specification — Technical Documentation
> **Module scope:** `src/lib/webgl/hardLight/` (proposed), `src/shaders/hardLightShaders.ts`
> **Related modules:** [`src/lib/webgl/contextManager.ts`](../../src/lib/webgl/contextManager.ts), [`src/lib/webgl/WebGLContextRecoveryManager.ts`](../../src/lib/webgl/WebGLContextRecoveryManager.ts), [`src/shaders/godRaysShaders.ts`](../../src/shaders/godRaysShaders.ts)

---

## 1. Overview

The **Hard-Light Construct engine** renders translucent, energy-based "hard-light" volumes — glowing geometric constructs used across WorkSphere's spatial UI (venue holograms, focus-session energy shells, ambient visualizers). It combines:

1. A **custom GLSL pipeline** with Voronoi-cell noise and UV distortion to produce organic, plasma-like surface energy.
2. An **UnrealBloomPass** post-processing chain (Three.js `EffectComposer`) for additive light bleeding.
3. A **tiered capability/fallback system** so low-tier GPUs degrade gracefully to CSS glow effects rather than failing.

---

## 2. Rendering Pipeline

```text
┌─────────────────────────────────────────────────────────────┐
│  Scene Graph (Three.js)                                     │
│   └─ HardLightConstruct meshes (custom ShaderMaterial)      │
│        1. Vertex stage: vertex displacement + UV distortion │
│        2. Fragment stage: Voronoi energy field + fresnel    │
├─────────────────────────────────────────────────────────────┤
│  EffectComposer                                             │
│   RenderPass → UnrealBloomPass → OutputPass                 │
├─────────────────────────────────────────────────────────────┤
│  Tier checks (device capability detection)                  │
│   Tier 3: full pipeline + bloom + high particle count       │
│   Tier 2: full pipeline, bloom strength halved              │
│   Tier 1: no bloom, reduced particle count                  │
│   Tier 0: WebGL unavailable → CSS glow fallback             │
└─────────────────────────────────────────────────────────────┘
```

**Frame order:**

1. `renderer.render` via `EffectComposer` — scene renders into an HDR-capable render target (`HalfFloatType`).
2. `UnrealBloomPass` thresholds bright emissive fragments and blurs them across mip levels.
3. `OutputPass` performs tone mapping (`ACESFilmicToneMapping`) and sRGB conversion.
4. Construct meshes are rendered with additive blending and depth-write disabled so overlapping constructs accumulate light correctly.

---

## 3. Custom GLSL Shaders

Shaders are exported as TypeScript string constants (bundled by Webpack, matching the existing pattern in `src/shaders/heatmapShaders.ts` and `src/shaders/godRaysShaders.ts`).

### 3.1 Vertex Shader — UV distortion + displacement

```glsl
// hardLight.vert
uniform float uTime;
uniform float uDistortAmount;   // amplitude of UV/vertex distortion
uniform float uNoiseScale;      // spatial frequency of the noise field

varying vec2  vUv;
varying vec3  vNormal;
varying vec3  vViewDir;
varying float vVoronoi;

// --- 2D hash used by the Voronoi field ------------------------------------
vec2 hash2(vec2 p) {
  p = vec2(dot(p, vec2(127.1, 311.7)),
           dot(p, vec2(269.5, 183.3)));
  return fract(sin(p) * 43758.5453);
}

// --- Voronoi noise: returns distance to nearest feature point -------------
float voronoi(vec2 p) {
  vec2 n = floor(p);
  vec2 f = fract(p);

  float minDist = 8.0;
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 g = vec2(float(i), float(j));
      vec2 o = hash2(n + g);          // feature point in neighbour cell
      vec2 r = g + o - f;             // vector to feature point
      minDist = min(minDist, dot(r, r));
    }
  }
  return sqrt(minDist);
}

void main() {
  vUv = uv;

  // Distort the UV coordinates with a time-scrolled Voronoi field so the
  // fragment-stage energy pattern "crawls" across the construct surface.
  vec2 distortedUv = uv + uDistortAmount *
      vec2(voronoi(uv * uNoiseScale + uTime * 0.35),
           voronoi(uv * uNoiseScale - uTime * 0.28));

  vNormal    = normalize(normalMatrix * normal);
  vViewDir   = normalize((modelViewMatrix * vec4(position, 1.0)).xyz);

  // Displace vertices outward along the normal for a breathing membrane.
  float displacement = voronoi(distortedUv * 3.0 + uTime * 0.5) * uDistortAmount;
  vec3 displaced = position + normal * displacement;

  vVoronoi = displacement;

  gl_Position = projectionMatrix * modelViewMatrix * vec4(displaced, 1.0);
}
```

### 3.2 Fragment Shader — energy field, fresnel rim, core glow

```glsl
// hardLight.frag
precision highp float;

uniform float uTime;
uniform vec3  uEnergyColor;    // base emissive tint (HDR-capable, can exceed 1.0)
uniform float uNoiseScale;
uniform float uEnergyIntensity;
uniform float uFresnelPower;

varying vec2  vUv;
varying vec3  vNormal;
varying vec3  vViewDir;
varying float vVoronoi;

vec2 hash2(vec2 p) {
  p = vec2(dot(p, vec2(127.1, 311.7)),
           dot(p, vec2(269.5, 183.3)));
  return fract(sin(p) * 43758.5453);
}

float voronoi(vec2 p) {
  vec2 n = floor(p);
  vec2 f = fract(p);
  float minDist = 8.0;
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 g = vec2(float(i), float(j));
      vec2 o = hash2(n + g);
      vec2 r = g + o - f;
      minDist = min(minDist, dot(r, r));
    }
  }
  return sqrt(minDist);
}

void main() {
  // Layered Voronoi: two octaves at different scales/time speeds.
  float cellA = voronoi(vUv * uNoiseScale + uTime * 0.4);
  float cellB = voronoi(vUv * uNoiseScale * 2.3 - uTime * 0.25);

  // Sharp cell edges read as "hard-light" panel seams.
  float seams = smoothstep(0.0, 0.08, abs(cellA - cellB));

  // Fresnel rim: edges glow hotter than faces facing the camera.
  float fresnel = pow(1.0 - abs(dot(normalize(vNormal), -normalize(vViewDir))),
                      uFresnelPower);

  vec3 color = uEnergyColor
             * (0.35 + 0.65 * cellA)          // cell brightness modulation
             * (1.0 + seams * 1.5)            // hot seams
             + uEnergyColor * fresnel * 2.0;  // additive rim light

  float alpha = uEnergyIntensity * (0.55 + 0.45 * cellB) + fresnel * 0.35;

  gl_FragColor = vec4(color * uEnergyIntensity, alpha);
}
```

**Design notes:**

- `voronoi()` is a classic 3×3 neighbour search; it is duplicated in both stages because WebGL 1 GLSL ES 1.00 has no shared includes. On WebGL 2 targets the duplication can be removed with a shared `#include`-style string concatenation at build time.
- The seam term `abs(cellA - cellB)` produces the characteristic hard-edged hexagonal panel look; soften it by widening the `smoothstep` range.
- Output is written with additive-friendly HDR values; the bloom pass decides what bleeds.

---

## 4. UnrealBloomPass Post-Processing

### 4.1 Composer setup (Three.js)

```ts
import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";

export function createComposer(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
  bloom: { strength: number; radius: number; threshold: number },
): EffectComposer {
  const composer = new EffectComposer(renderer, {
    type: THREE.HalfFloatType, // HDR headroom for bloom thresholding
  });
  composer.addPass(new RenderPass(scene, camera));
  composer.addPass(
    new UnrealBloomPass(
      new THREE.Vector2(window.innerWidth, window.innerHeight),
      bloom.strength,
      bloom.radius,
      bloom.threshold,
    ),
  );
  composer.addPass(new OutputPass());
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  return composer;
}
```

### 4.2 Construct material assembly

```ts
import * as THREE from "three";
import { HARDLIGHT_VERT, HARDLIGHT_FRAG } from "@/shaders/hardLightShaders";

export function createConstructMaterial(
  params: { time: number; color: string; noiseScale: number },
): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: HARDLIGHT_VERT,
    fragmentShader: HARDLIGHT_FRAG,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    uniforms: {
      uTime:            { value: params.time },
      uEnergyColor:     { value: new THREE.Color(params.color) },
      uNoiseScale:      { value: params.noiseScale },
      uDistortAmount:   { value: 0.12 },
      uEnergyIntensity: { value: 1.0 },
      uFresnelPower:    { value: 3.0 },
    },
  });
}
```

### 4.3 Uniform reference

| Uniform           | Stage     | Type    | Default  | Description |
|-------------------|-----------|---------|----------|-------------|
| `uTime`           | vert+frag | `float` | `0.0`    | Seconds since start; drives Voronoi scroll and displacement. |
| `uEnergyColor`    | frag      | `vec3`  | `#22d3ee`| Base emissive tint. Values > 1.0 feed the bloom threshold. |
| `uNoiseScale`     | vert+frag | `float` | `6.0`    | Spatial frequency of the Voronoi field (cell density). |
| `uDistortAmount`  | vert      | `float` | `0.12`   | Amplitude of UV distortion and vertex displacement. |
| `uEnergyIntensity`| frag      | `float` | `1.0`    | Global alpha/emissive multiplier. |
| `uFresnelPower`   | frag      | `float` | `3.0`    | Rim-light falloff exponent. Higher = tighter edge glow. |
| `uBloomStrength`  | pass      | `float` | `0.8`    | UnrealBloomPass intensity (constructor arg, not shader uniform). |
| `uBloomRadius`    | pass      | `float` | `0.4`    | Bloom kernel spread radius. |
| `uBloomThreshold` | pass      | `float` | `0.85`   | Luminance cutoff above which pixels bleed. |

---

## 5. Fallback Strategies & Device Tiering

### 5.1 Capability detection

```ts
export type DeviceTier = 0 | 1 | 2 | 3;

export function detectDeviceTier(canvas: HTMLCanvasElement): DeviceTier {
  // 1. Context availability
  const gl =
    canvas.getContext("webgl2") ??
    canvas.getContext("webgl") ??
    canvas.getContext("experimental-webgl");
  if (!gl) return 0; // no WebGL at all → CSS glow fallback

  const gl2 = gl as WebGL2RenderingContext;

  // 2. Debug renderer info → GPU string heuristics
  const dbg = gl2.getExtension("WEBGL_debug_renderer_info");
  const gpu = dbg
    ? String(gl2.getParameter(dbg.UNMASKED_RENDERER_WEBGL))
    : "";
  const isSoftware =
    /swiftshader|software|basic render|llvmpipe/i.test(gpu);

  // 3. Texture / precision / MSAA capability probes
  const maxTex = gl2.getParameter(gl2.MAX_TEXTURE_SIZE) as number;
  const maxVert = gl2.getParameter(gl2.MAX_VERTEX_UNIFORM_VECTORS) as number;
  const supportsHalfFloat = !!gl2.getExtension("EXT_color_buffer_half_float");

  if (isSoftware || maxTex < 2048 || maxVert < 512) return 1;
  if (!supportsHalfFloat || (navigator.hardwareConcurrency ?? 4) <= 4) return 2;
  return 3;
}
```

### 5.2 Tier behaviour matrix

| Tier | Shader pipeline | Bloom | Particle/construct count | Distortion amount |
|------|-----------------|-------|--------------------------|-------------------|
| 3    | Full (vert+frag)| Full strength | 100% | Full |
| 2    | Full            | `uBloomStrength × 0.5` | 70% | Full |
| 1    | Full, `uDistortAmount × 0.5` (cheaper vertex stage) | **Disabled** | 40% | Halved |
| 0    | None            | None | None | — (CSS glow fallback below) |

### 5.3 Runtime degradation

- Listen for `webglcontextlost` through the shared [`WebGLContextRecoveryManager`](../../src/lib/webgl/WebGLContextRecoveryManager.ts). After a second consecutive failed recovery (loss storm), drop one tier permanently for the session.
- Monitor frame time over a 3-second rolling window; sustained < 30 FPS downgrades the tier once.

### 5.4 CSS glow fallback (Tier 0)

When WebGL is unavailable (or `prefers-reduced-motion` is set), the construct renders as a pure-DOM element — no canvas, no animation loop:

```tsx
function HardLightFallback({ color = "#22d3ee" }: { color?: string }) {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none rounded-2xl"
      style={{
        boxShadow: `0 0 24px ${color}66, inset 0 0 12px ${color}44`,
        border: `1px solid ${color}55`,
        background: `radial-gradient(ellipse at center, ${color}22, transparent 70%)`,
      }}
    />
  );
}
```

Rules:

- Tier 0 output must occupy the **same layout box** as the WebGL canvas so no layout shift occurs on tier changes.
- `prefers-reduced-motion: reduce` freezes `uTime` at its current value (one static frame rendered, loop stopped) rather than disabling the construct entirely.
- Context loss mid-session falls back to the CSS variant for the paused period and restores the canvas on `webglcontextrestored`.

---

## 6. Accessibility & Performance Notes

- The construct layer is `aria-hidden="true"` and `pointer-events: none`; all information it conveys is duplicated in the semantic DOM beneath it.
- The render loop pauses when the containing tab is hidden (`document.visibilityState`).
- `uNoiseScale` and `uDistortAmount` are the primary cost levers: the fragment-stage Voronoi is O(9 samples × 2 octaves), so scaling UV frequency does not change cost — reduce *octaves* (drop `cellB`) on Tier 1 instead.
- Keep HDR output (`HalfFloatType`) whenever bloom is enabled; with bloom disabled, switch to `UnsignedByteType` render targets to save fill rate on Tier 1 devices.

---

## 7. File Layout (proposed)

```text
src/
├── shaders/
│   └── hardLightShaders.ts        # HARDLIGHT_VERT / HARDLIGHT_FRAG string constants
├── lib/
│   └── webgl/
│       └── hardLight/
│           ├── HardLightEngine.ts     # scene, composer, render loop
│           ├── constructMaterial.ts   # createConstructMaterial()
│           ├── deviceTier.ts          # detectDeviceTier(), tier matrix
│           └── HardLightFallback.tsx  # Tier 0 CSS glow component
└── __tests__/
    └── webgl/
        └── hardLight.test.tsx
```
