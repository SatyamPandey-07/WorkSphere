#version 300 es
precision highp float;

// Attributes
layout(location = 0) in vec3 a_position;
layout(location = 1) in vec4 a_covariance1;
layout(location = 2) in vec4 a_covariance2;
layout(location = 3) in vec4 a_color; // Spherical Harmonics DC component
layout(location = 4) in float a_opacity;
layout(location = 5) in vec2 a_quadPos; // Instanced quad corner [-1, 1]

// Uniforms
uniform mat4 u_view;
uniform mat4 u_proj;
uniform vec2 u_viewport;

// Varyings
out vec2 v_quadPos;
out vec3 v_color;
out float v_opacity;

void main() {
    vec4 viewPos = u_view * vec4(a_position, 1.0);
    vec4 clipPos = u_proj * viewPos;
    
    // Project covariance to 2D screen space (simplified for vertex shader)
    // In a full implementation, this involves Jacobian of the projection matrix
    float radius = max(abs(a_covariance1.x), abs(a_covariance2.x)) * 3.0; // 3 sigma
    
    vec2 screenOffset = a_quadPos * radius / u_viewport;
    
    gl_Position = clipPos;
    gl_Position.xy += screenOffset * clipPos.w;
    
    v_quadPos = a_quadPos;
    v_color = a_color.rgb; // Simplified SH evaluation (just DC)
    v_opacity = a_opacity;
}
