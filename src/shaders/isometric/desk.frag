/**
 * desk.frag
 * GLSL fragment shader implementing dynamic lighting based on virtual window positions and time of day.
 * Applies texture atlases, directional lighting, and hover highlight outline shaders for occupied and available desks.
 */

#version 300 es

precision highp float;

// Inputs
in vec2 v_uv;
in float v_depth;
in float v_instance_id;
in float v_is_occupied;
in float v_is_hovered;

// Uniforms
uniform sampler2D u_texture_atlas;
uniform vec3 u_sun_direction;
uniform vec3 u_sun_color;
uniform vec3 u_ambient_color;
uniform float u_time;
uniform vec4 u_occupied_outline_color; // Highlight outline color for occupied desks (e.g. amber/orange glow)
uniform vec4 u_available_outline_color; // Highlight outline color for available desks (e.g. emerald/cyan)
uniform float u_outline_width;         // Outline thickness in UV space

// Output
out vec4 frag_color;

void main() {
    // Sample texture atlas
    vec4 tex_color = texture(u_texture_atlas, v_uv);

    // Distance to closest UV edge (0.0 at borders, 0.5 at quad center)
    float edge_dist = min(min(v_uv.x, 1.0 - v_uv.x), min(v_uv.y, 1.0 - v_uv.y));
    float outline_width = max(0.01, u_outline_width);
    float outline_factor = 1.0 - smoothstep(0.0, outline_width, edge_dist);

    // Discard transparent non-outline pixels
    if (tex_color.a < 0.1 && (v_is_hovered < 0.5 || outline_factor < 0.01)) {
        discard;
    }

    // Normal for isometric top surface
    vec3 normal = normalize(vec3(0.0, 1.0, 0.0));
    
    // Diffuse lighting
    float diff = max(dot(normal, normalize(u_sun_direction)), 0.0);
    vec3 diffuse = diff * u_sun_color;
    
    // Combine base texture with ambient & directional lighting
    vec3 final_color = tex_color.rgb * (u_ambient_color + diffuse);

    // Apply hover highlight outline
    if (v_is_hovered > 0.5) {
        if (v_is_occupied > 0.5) {
            // Pulsing highlight effect for occupied desks
            float pulse = 0.85 + 0.15 * sin(u_time * 5.0);
            vec3 outline_rgb = u_occupied_outline_color.rgb * pulse;
            
            // Blend outline at quad boundaries
            final_color = mix(final_color, outline_rgb, outline_factor * u_occupied_outline_color.a);
            // Subtle ambient warm glow on interior surface
            final_color += vec3(0.12, 0.04, 0.02) * (1.0 - outline_factor);
        } else {
            // Subtle highlight for available desks
            vec3 outline_rgb = u_available_outline_color.rgb;
            final_color = mix(final_color, outline_rgb, outline_factor * u_available_outline_color.a);
            final_color += vec3(0.02, 0.08, 0.05) * (1.0 - outline_factor);
        }
    }

    // Add subtle depth fog for atmospheric perspective
    float fog_factor = clamp(v_depth / 100.0, 0.0, 0.3);
    final_color = mix(final_color, vec3(0.9, 0.9, 0.95), fog_factor);

    float alpha = max(tex_color.a, (v_is_hovered > 0.5 ? outline_factor * u_occupied_outline_color.a : 0.0));
    frag_color = vec4(final_color, alpha);
}
