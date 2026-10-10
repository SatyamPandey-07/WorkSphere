/**
 * desk.vert
 * GLSL vertex shader handling the 2.5D isometric matrix projection and depth sorting.
 * Transforms 3D desk coordinates into screen space with proper isometric foreshortening.
 */

#version 300 es

precision highp float;

// Attributes
layout(location = 0) in vec3 a_position;
layout(location = 1) in vec2 a_uv;
layout(location = 2) in float a_instance_id;

// Uniforms
uniform mat4 u_projection;
uniform mat4 u_view;
uniform mat4 u_model;
uniform float u_time;

// Outputs
out vec2 v_uv;
out float v_depth;
out float v_instance_id;

// Isometric projection matrix constants
const float ISO_ANGLE_X = 0.523598776; // 30 degrees
const float ISO_ANGLE_Y = 0.523598776; // 30 degrees

void main() {
    v_uv = a_uv;
    v_instance_id = a_instance_id;

    // Apply model transformation
    vec4 worldPos = u_model * vec4(a_position, 1.0);

    // Custom isometric view transformation
    mat4 isoView = mat4(
        cos(ISO_ANGLE_X), sin(ISO_ANGLE_X) * sin(ISO_ANGLE_Y), sin(ISO_ANGLE_X) * cos(ISO_ANGLE_Y), 0.0,
        0.0, cos(ISO_ANGLE_Y), -sin(ISO_ANGLE_Y), 0.0,
        -sin(ISO_ANGLE_X), cos(ISO_ANGLE_X) * sin(ISO_ANGLE_Y), cos(ISO_ANGLE_X) * cos(ISO_ANGLE_Y), 0.0,
        0.0, 0.0, 0.0, 1.0
    );

    vec4 viewPos = isoView * worldPos;
    gl_Position = u_projection * viewPos;

    // Calculate depth for sorting (distance from camera)
    v_depth = length(viewPos.xyz);
}
