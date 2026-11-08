/**
 * tile.frag
 * GLSL fragment shader implementing the custom WorkSphere dark/light theme styling and anti-aliasing.
 */

#version 300 es

precision highp float;

in vec2 v_uv;

uniform vec4 u_theme_color;

out vec4 frag_color;

void main() {
    // Simple solid color fill for scaffold
    // In production, this would include pattern fills, stroke rendering, and SDF anti-aliasing
    frag_color = u_theme_color;
    
    // Mock grid pattern for visual feedback
    float grid = step(0.95, fract(v_uv.x * 10.0)) + step(0.95, fract(v_uv.y * 10.0));
    frag_color.rgb += vec3(grid * 0.1);
}
