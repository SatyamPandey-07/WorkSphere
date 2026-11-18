/**
 * deskShaders.ts
 * GLSL ES 3.00 shader sources for isometric desk rendering.
 * Provided as TypeScript string constants to be compatible with Jest and Next.js / Turbopack
 * without requiring custom loader plugins.
 */

export const DESK_VERTEX_SHADER = `#version 300 es
precision highp float;

// Attributes
layout(location = 0) in vec3 a_position;
layout(location = 1) in vec2 a_uv;
layout(location = 2) in float a_instance_id;
layout(location = 3) in vec4 a_instance_pos_rot; // x, y, z, rotation
layout(location = 4) in float a_is_available;    // 1.0 = available, 0.0 = occupied

// Uniforms
uniform mat4 u_projection;
uniform mat4 u_view;
uniform mat4 u_model;
uniform float u_time;
uniform float u_hovered_instance_id; // -1.0 if no desk is hovered

// Outputs
out vec2 v_uv;
out float v_depth;
out float v_instance_id;
out float v_is_occupied;
out float v_is_hovered;

// Isometric projection matrix constants
const float ISO_ANGLE_X = 0.523598776; // 30 degrees
const float ISO_ANGLE_Y = 0.523598776; // 30 degrees

void main() {
    v_uv = a_uv;
    v_instance_id = a_instance_id;
    v_is_occupied = (a_is_available < 0.5) ? 1.0 : 0.0;
    v_is_hovered = (abs(a_instance_id - u_hovered_instance_id) < 0.1 && u_hovered_instance_id >= 0.0) ? 1.0 : 0.0;

    // Apply rotation around Y-axis
    float rad = a_instance_pos_rot.w;
    float cosR = cos(rad);
    float sinR = sin(rad);
    vec3 rotatedPos = vec3(
        a_position.x * cosR - a_position.z * sinR,
        a_position.y,
        a_position.x * sinR + a_position.z * cosR
    );

    // Apply instance world position offset
    vec3 worldPos = rotatedPos + a_instance_pos_rot.xyz;
    vec4 transformedPos = u_model * vec4(worldPos, 1.0);

    // Custom isometric view transformation
    mat4 isoView = mat4(
        cos(ISO_ANGLE_X), sin(ISO_ANGLE_X) * sin(ISO_ANGLE_Y), sin(ISO_ANGLE_X) * cos(ISO_ANGLE_Y), 0.0,
        0.0, cos(ISO_ANGLE_Y), -sin(ISO_ANGLE_Y), 0.0,
        -sin(ISO_ANGLE_X), cos(ISO_ANGLE_X) * sin(ISO_ANGLE_Y), cos(ISO_ANGLE_X) * cos(ISO_ANGLE_Y), 0.0,
        0.0, 0.0, 0.0, 1.0
    );

    vec4 viewPos = u_view * isoView * transformedPos;
    gl_Position = u_projection * viewPos;

    // Calculate depth for sorting (distance from camera)
    v_depth = length(viewPos.xyz);
}
`;

export const DESK_FRAGMENT_SHADER = `#version 300 es
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
uniform vec4 u_occupied_outline_color;
uniform vec4 u_available_outline_color;
uniform float u_outline_width;

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
    vec3 ambient = u_ambient_color;
    vec3 lit_color = tex_color.rgb * (diffuse + ambient);

    // Apply hover highlight outline color
    if (v_is_hovered > 0.5 && outline_factor > 0.0) {
        vec4 target_outline = (v_is_occupied > 0.5) ? u_occupied_outline_color : u_available_outline_color;
        // Subtle pulse animation
        float pulse = 0.85 + 0.15 * sin(u_time * 4.0);
        vec3 final_rgb = mix(lit_color, target_outline.rgb * pulse, outline_factor * target_outline.a);
        frag_color = vec4(final_rgb, max(tex_color.a, outline_factor * target_outline.a));
    } else {
        frag_color = vec4(lit_color, tex_color.a);
    }
}
`;
