# WebGLHeatmapRenderer Configuration Guide

## Overview

`WebGLHeatmapRenderer` is a GPU-accelerated WebGL renderer used to visualize spatial density and telemetry data as a heatmap.

The renderer converts telemetry points into a smooth heat visualization using:

- Point radius configuration
- Blur smoothing
- Shader-based gradient color transitions

Relevant implementation files:

```
src/lib/webgl/webglHeatmapRenderer.ts
src/shaders/heatmapShaders.ts
```

---

# Radius Configuration

## Description

The `radius` parameter controls the spatial influence area of an individual heatmap point.

Each point contributes density within its configured radius in pixels.

## Configuration

The radius is defined in the `HeatmapPoint` interface:

```ts
export interface HeatmapPoint {
  x: number;
  y: number;
  intensity: number;
  radius?: number;
}
```

Default value:

```ts
p.radius ?? 25.0
```

If no radius is provided, the renderer uses:

```
25 pixels
```

## Example

```ts
{
  x: 200,
  y: 150,
  intensity: 0.8,
  radius: 30
}
```

## Effect

| Radius Value | Result |
|---|---|
| Small radius | Concentrated and localized heat spots |
| Large radius | Wider heat distribution |

Use larger radius values when visualizing broader areas and smaller values when precise clustering is required.

---

# Blur Configuration

## Description

The `blur` parameter controls the softness of heatmap transitions.

It affects how smoothly density regions blend together.

## Configuration

The option is defined in:

```
WebGLHeatmapOptions
```

Example:

```ts
export interface WebGLHeatmapOptions {
  opacity?: number;
  blur?: number;
  maxPoints?: number;
}
```

Default value:

```ts
this.blur = options.blur ?? 1.0;
```

The value is passed to the WebGL shader:

```ts
gl.uniform1f(this.uBlurLoc, this.blur);
```

## Effect

| Blur Value | Result |
|---|---|
| Lower blur | Sharper heat boundaries |
| Higher blur | Smoother and softer transitions |

Increasing blur can make visualizations easier to read but may increase GPU workload.

---

# Gradient Color Stop Thresholds

## Description

The heatmap color gradient is generated inside the WebGL fragment shader:

```
src/shaders/heatmapShaders.ts
```

The shader uses density values to interpolate between multiple color stops.

Density values range from:

```
0.0 - 1.0
```

---

# Color Stops

The renderer uses the following gradient:

| Density Threshold | Color |
|---|---|
| 0.0 | Transparent Blue |
| 0.25 | Electric Cyan |
| 0.50 | Mint Emerald |
| 0.75 | Vibrant Yellow |
| 0.90 | Fiery Orange |
| 1.00 | Glowing Crimson Red |

Low density areas appear cooler, while high density areas transition toward warmer colors.

---

# Shader Interpolation Thresholds

The fragment shader blends colors based on density:

```glsl
if (density < 0.2)
    mix(c0, c1)

if (density < 0.4)
    mix(c1, c2)

if (density < 0.7)
    mix(c2, c3)

if (density < 0.9)
    mix(c3, c4)

otherwise
    mix(c4, c5)
```

Interpolation ranges:

| Density Range | Transition |
|---|---|
| 0.0 - 0.2 | Transparent Blue → Electric Cyan |
| 0.2 - 0.4 | Electric Cyan → Mint Emerald |
| 0.4 - 0.7 | Mint Emerald → Vibrant Yellow |
| 0.7 - 0.9 | Vibrant Yellow → Fiery Orange |
| 0.9 - 1.0 | Fiery Orange → Crimson Red |

---

# Example Renderer Configuration

```ts
const renderer = new WebGLHeatmapRenderer(canvas, {
  opacity: 0.85,
  blur: 1.0,
  maxPoints: 100000,
});
```

Adding heatmap points:

```ts
renderer.updatePoints([
  {
    x: 250,
    y: 120,
    intensity: 0.75,
    radius: 30,
  },
]);
```

---

# Performance Recommendations

## Radius

- Use smaller radius values for dense clusters.
- Use larger radius values for broader visual coverage.

## Blur

- Keep blur values moderate for better GPU performance.
- Higher blur values provide smoother visuals but require more processing.

## Maximum Points

The renderer supports up to:

```
100,000 points
```

by default.

Configure `maxPoints` according to available GPU resources.

---

# Related Files

- `src/lib/webgl/webglHeatmapRenderer.ts`
- `src/shaders/heatmapShaders.ts`
- `src/components/WebGLHeatmapLayer.tsx`
