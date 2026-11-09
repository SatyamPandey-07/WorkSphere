/**
 * tile.vert
 * GLSL vertex shader handling the Mercator projection and coordinate transformation for vector tiles.
 */

#version 300 es

precision highp float;

layout(location = 0) in vec3 a_position;

uniform mat4 u_projection;

out vec2 v_uv;

void main() {
    // Transform local tile coordinates to clip space
    gl_Position = u_projection * vec4(a_position, 1.0);
    
    // Pass UVs for potential texture mapping or pattern fills
    v_uv = a_position.xy * 0.01; 
}
