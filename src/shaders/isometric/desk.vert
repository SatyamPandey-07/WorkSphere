/**
 * desk.vert
 * GLSL vertex shader handling the 2.5D isometric matrix projection, depth sorting, and instance attributes.
 * Transforms 3D desk coordinates into screen space with proper isometric foreshortening and hover state detection.
 */

#version 300 es

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
