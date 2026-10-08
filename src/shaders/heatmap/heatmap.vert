/**
 * heatmap.vert
 * GLSL vertex shader handling spatial coordinate mapping for the heatmap grid.
 * Transforms 2D map coordinates into 3D WebGL clip space with elevation offset.
 */

attribute vec2 a_position;
attribute float a_value;

uniform mat3 u_projectionMatrix;
uniform vec2 u_mapBoundsMin;
uniform vec2 u_mapBoundsMax;
uniform float u_maxValue;

varying float v_intensity;

void main() {
    // Normalize position to 0.0 - 1.0 range based on map bounds
    vec2 normalizedPos = (a_position - u_mapBoundsMin) / (u_mapBoundsMax - u_mapBoundsMin);
    
    // Convert to WebGL clip space (-1.0 to 1.0)
    vec2 clipPos = normalizedPos * 2.0 - 1.0;
    
    // Invert Y axis for standard map coordinate systems
    clipPos.y = -clipPos.y;
    
    // Apply elevation offset based on value (creates 3D volumetric effect)
    float elevation = (a_value / u_maxValue) * 0.2; // Max 20% elevation
    
    vec3 finalPosition = vec3(clipPos, elevation);
    
    gl_Position = vec4(u_projectionMatrix * finalPosition, 1.0);
    v_intensity = a_value / u_maxValue;
}
