/**
 * desk.frag
 * GLSL fragment shader implementing dynamic lighting based on virtual window positions and time of day.
 * Applies texture atlases and calculates ambient/directional lighting for the isometric view.
 */

#version 300 es

precision highp float;

// Inputs
in vec2 v_uv;
in float v_depth;
in float v_instance_id;

// Uniforms
uniform sampler2D u_texture_atlas;
uniform vec3 u_sun_direction;
uniform vec3 u_sun_color;
uniform vec3 u_ambient_color;
uniform float u_time;

// Output
out vec4 frag_color;

void main() {
    // Sample texture atlas
    vec4 tex_color = texture(u_texture_atlas, v_uv);
    
    // Discard transparent pixels (e.g., around desk outlines)
    if (tex_color.a < 0.1) {
        discard;
    }

    // Calculate basic lighting
    // Normal for isometric top surface is roughly (0, 1, 0)
    vec3 normal = normalize(vec3(0.0, 1.0, 0.0));
    
    // Diffuse lighting
    float diff = max(dot(normal, normalize(u_sun_direction)), 0.0);
    vec3 diffuse = diff * u_sun_color;
    
    // Combine lighting
    vec3 final_color = tex_color.rgb * (u_ambient_color + diffuse);
    
    // Add subtle depth fog for atmospheric perspective
    float fog_factor = clamp(v_depth / 100.0, 0.0, 0.3);
    final_color = mix(final_color, vec3(0.9, 0.9, 0.95), fog_factor);

    frag_color = vec4(final_color, tex_color.a);
}
