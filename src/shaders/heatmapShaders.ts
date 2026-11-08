/**
 * WebGL GLSL Shader Definitions for GPU-Accelerated Spatial Clustering Heatmap (#818)
 *
 * Provides high-performance vertex and fragment shaders capable of processing 100,000+ points
 * with GPU-computed Gaussian spatial density decay and smooth color gradient transitions.
 */

export const HEATMAP_VERTEX_SHADER = `#version 300 es
precision highp float;

in vec2 a_position;    // Screen/Canvas coordinates (pixels or normalized)
in float a_intensity;  // Telemetry intensity (0.0 to 1.0)
in float a_radius;     // Gaussian influence radius

uniform vec2 u_resolution; // Viewport resolution (width, height)
uniform float u_zoom;       // Current map zoom level multiplier

out float v_intensity;
out float v_radius;

void main() {
    // Project canvas pixel coordinates to WebGL normalized clip space (-1.0 to +1.0)
    vec2 zeroToOne = a_position / u_resolution;
    vec2 zeroToTwo = zeroToOne * 2.0;
    vec2 clipSpace = zeroToTwo - 1.0;

    // Invert Y-axis for screen to clip space coordinate alignment
    gl_Position = vec4(clipSpace.x, -clipSpace.y, 0.0, 1.0);

    // Scale point size smoothly based on zoom factor
    gl_PointSize = clamp(a_radius * (1.0 + u_zoom * 0.15), 8.0, 128.0);

    v_intensity = a_intensity;
    v_radius = a_radius;
}
`;

export const HEATMAP_FRAGMENT_SHADER = `#version 300 es
precision highp float;

in float v_intensity;
in float v_radius;

uniform float u_opacity;     // Layer overall opacity
uniform float u_blur;        // Gaussian blur softness factor
uniform int u_paletteMode;   // 0: Thermal (Red-Yellow-Blue), 1: Cyber Neon, 2: Accessible Grayscale

out vec4 fragColor;

// Dynamic multi-stop heat gradient color ramp lookup
vec4 getHeatColor(float density) {
    if (density <= 0.0) return vec4(0.0);

    // Thermal color stops (Red-Yellow-Blue)
    vec4 t0 = vec4(0.05, 0.15, 0.45, 0.0);
    vec4 t1 = vec4(0.0, 0.8, 1.0, 0.4);
    vec4 t2 = vec4(0.1, 0.9, 0.4, 0.65);
    vec4 t3 = vec4(1.0, 0.85, 0.1, 0.85);
    vec4 t4 = vec4(1.0, 0.4, 0.0, 0.95);
    vec4 t5 = vec4(0.95, 0.05, 0.15, 1.0);

    // Cyber Neon color stops (Cyan-Magenta-Yellow)
    vec4 n0 = vec4(0.02, 0.05, 0.20, 0.0);
    vec4 n1 = vec4(0.0, 0.9, 1.0, 0.4);     // Cyan
    vec4 n2 = vec4(0.5, 0.1, 0.85, 0.65);  // Purple
    vec4 n3 = vec4(0.85, 0.1, 0.9, 0.85);  // Vivid Magenta
    vec4 n4 = vec4(1.0, 0.2, 0.6, 0.95);   // Hot Pink
    vec4 n5 = vec4(1.0, 0.95, 0.2, 1.0);   // Electric Yellow

    // Accessible Grayscale color stops (WCAG compliant high-contrast grayscale)
    vec4 g0 = vec4(0.05, 0.05, 0.05, 0.0);
    vec4 g1 = vec4(0.20, 0.20, 0.20, 0.4);
    vec4 g2 = vec4(0.45, 0.45, 0.45, 0.65);
    vec4 g3 = vec4(0.70, 0.70, 0.70, 0.85);
    vec4 g4 = vec4(0.88, 0.88, 0.88, 0.95);
    vec4 g5 = vec4(0.98, 0.98, 0.98, 1.0);

    vec4 c0 = (u_paletteMode == 1) ? n0 : ((u_paletteMode == 2) ? g0 : t0);
    vec4 c1 = (u_paletteMode == 1) ? n1 : ((u_paletteMode == 2) ? g1 : t1);
    vec4 c2 = (u_paletteMode == 1) ? n2 : ((u_paletteMode == 2) ? g2 : t2);
    vec4 c3 = (u_paletteMode == 1) ? n3 : ((u_paletteMode == 2) ? g3 : t3);
    vec4 c4 = (u_paletteMode == 1) ? n4 : ((u_paletteMode == 2) ? g4 : t4);
    vec4 c5 = (u_paletteMode == 1) ? n5 : ((u_paletteMode == 2) ? g5 : t5);

    if (density < 0.2) return mix(c0, c1, density / 0.2);
    if (density < 0.4) return mix(c1, c2, (density - 0.2) / 0.2);
    if (density < 0.7) return mix(c2, c3, (density - 0.4) / 0.3);
    if (density < 0.9) return mix(c3, c4, (density - 0.7) / 0.2);
    return mix(c4, c5, clamp((density - 0.9) / 0.1, 0.0, 1.0));
}

void main() {
    // Calculate normalized distance from point center [0.0, 1.0]
    vec2 coord = gl_PointCoord - vec2(0.5);
    float distSq = dot(coord, coord);

    // Hard clip outside circle boundary (radius > 0.5)
    if (distSq > 0.25) {
        discard;
    }

    // GPU Gaussian kernel spatial density falloff: exp(-distSq * blurFactor)
    float gaussianFactor = exp(-distSq * 16.0 * max(0.5, u_blur));
    float density = v_intensity * gaussianFactor;

    vec4 color = getHeatColor(density);
    color.a *= u_opacity;

    fragColor = color;
}
`;
