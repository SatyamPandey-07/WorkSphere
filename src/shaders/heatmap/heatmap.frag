/**
 * heatmap.frag
 * GLSL fragment shader implementing the color-ramp interpolation and alpha blending.
 * Maps intensity values to a perceptually uniform color gradient (blue -> green -> yellow -> red).
 */

precision mediump float;

varying float v_intensity;

uniform float u_alpha;

// Color ramp stops
const vec3 color1 = vec3(0.0, 0.0, 0.5); // Deep Blue
const vec3 color2 = vec3(0.0, 0.5, 1.0); // Light Blue
const vec3 color3 = vec3(0.0, 1.0, 0.5); // Green
const vec3 color4 = vec3(1.0, 1.0, 0.0); // Yellow
const vec3 color5 = vec3(1.0, 0.0, 0.0); // Red

vec3 getHeatmapColor(float t) {
    t = clamp(t, 0.0, 1.0);
    
    if (t < 0.25) {
        return mix(color1, color2, t / 0.25);
    } else if (t < 0.5) {
        return mix(color2, color3, (t - 0.25) / 0.25);
    } else if (t < 0.75) {
        return mix(color3, color4, (t - 0.5) / 0.25);
    } else {
        return mix(color4, color5, (t - 0.75) / 0.25);
    }
}

void main() {
    vec3 color = getHeatmapColor(v_intensity);
    
    // Fade out edges for smooth blending
    float edgeFade = smoothstep(0.0, 0.2, v_intensity) * smoothstep(1.0, 0.8, v_intensity);
    
    gl_FragColor = vec4(color, u_alpha * edgeFade);
}
