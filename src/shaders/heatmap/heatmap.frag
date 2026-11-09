/**
 * heatmap.frag
 * GLSL fragment shader implementing the color-ramp interpolation and alpha blending.
 * Supports dynamic color palette theme switching:
 * 0: Thermal (Red-Yellow-Blue / Classic Multi-Stop)
 * 1: Cyber Neon (Cyan-Magenta-Yellow)
 * 2: Accessible Grayscale (WCAG Compliant High-Contrast Grayscale)
 */

precision mediump float;

varying float v_intensity;

uniform float u_alpha;
uniform int u_paletteMode; // 0: Thermal, 1: Cyber Neon, 2: Accessible Grayscale

// Thermal Color ramp stops (Red-Yellow-Blue)
const vec3 thermal1 = vec3(0.0, 0.0, 0.5); // Deep Blue
const vec3 thermal2 = vec3(0.0, 0.5, 1.0); // Light Blue
const vec3 thermal3 = vec3(0.0, 1.0, 0.5); // Green / Yellow-Green
const vec3 thermal4 = vec3(1.0, 1.0, 0.0); // Vibrant Yellow
const vec3 thermal5 = vec3(1.0, 0.0, 0.0); // Fiery Red

// Cyber Neon Color ramp stops (Cyan-Magenta-Yellow)
const vec3 neon1 = vec3(0.02, 0.05, 0.2);  // Deep Cyber Navy
const vec3 neon2 = vec3(0.0, 0.9, 1.0);    // Electric Cyan
const vec3 neon3 = vec3(0.85, 0.1, 0.9);   // Vivid Magenta / Purple
const vec3 neon4 = vec3(1.0, 0.2, 0.6);    // Hot Pink
const vec3 neon5 = vec3(1.0, 0.95, 0.2);   // Neon Yellow

// Accessible Grayscale Color ramp stops (WCAG compliant high-contrast grayscale)
const vec3 gray1 = vec3(0.08, 0.08, 0.08); // Near Black
const vec3 gray2 = vec3(0.28, 0.28, 0.28); // Dark Gray
const vec3 gray3 = vec3(0.55, 0.55, 0.55); // Mid Gray
const vec3 gray4 = vec3(0.80, 0.80, 0.80); // Light Gray
const vec3 gray5 = vec3(0.98, 0.98, 0.98); // Crisp White

vec3 interpolatePalette(float t, vec3 c1, vec3 c2, vec3 c3, vec3 c4, vec3 c5) {
    if (t < 0.25) {
        return mix(c1, c2, t / 0.25);
    } else if (t < 0.5) {
        return mix(c2, c3, (t - 0.25) / 0.25);
    } else if (t < 0.75) {
        return mix(c3, c4, (t - 0.5) / 0.25);
    } else {
        return mix(c4, c5, (t - 0.75) / 0.25);
    }
}

vec3 getHeatmapColor(float t) {
    t = clamp(t, 0.0, 1.0);
    
    if (u_paletteMode == 1) {
        // Cyber Neon
        return interpolatePalette(t, neon1, neon2, neon3, neon4, neon5);
    } else if (u_paletteMode == 2) {
        // Accessible Grayscale
        return interpolatePalette(t, gray1, gray2, gray3, gray4, gray5);
    } else {
        // Thermal default
        return interpolatePalette(t, thermal1, thermal2, thermal3, thermal4, thermal5);
    }
}

void main() {
    vec3 color = getHeatmapColor(v_intensity);
    
    // Fade out edges for smooth blending
    float edgeFade = smoothstep(0.0, 0.2, v_intensity) * smoothstep(1.0, 0.8, v_intensity);
    
    gl_FragColor = vec4(color, u_alpha * edgeFade);
}

