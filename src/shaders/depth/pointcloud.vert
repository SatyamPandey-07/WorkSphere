#version 300 es
precision highp float;

// Uniforms for camera and projection
uniform mat4 u_projectionMatrix;
uniform mat4 u_viewMatrix;
uniform float u_pointSizeBase;
uniform float u_depthScale;
uniform vec3 u_cameraPosition;

// Attributes for each point in the cloud
in vec3 a_position;
in float a_confidence;
in vec3 a_color;

// Varyings to pass to fragment shader
out float v_depth;
out float v_confidence;
out vec3 v_color;
out float v_fogFactor;

// Fog parameters for depth fading
const float FOG_START = 1.5;
const float FOG_END = 4.0;

void main() {
    // Transform point to view space
    vec4 viewPosition = u_viewMatrix * vec4(a_position, 1.0);
    
    // Calculate depth (distance from camera)
    float depth = length(a_position - u_cameraPosition);
    v_depth = depth;
    v_confidence = a_confidence;
    v_color = a_color;
    
    // Calculate point size based on depth (perspective scaling)
    // Points further away appear smaller
    float perspectiveScale = u_depthScale / max(depth, 0.1);
    gl_PointSize = u_pointSizeBase * perspectiveScale * a_confidence;
    
    // Clamp point size to prevent excessively large points near camera
    gl_PointSize = clamp(gl_PointSize, 1.0, 32.0);
    
    // Calculate fog factor for depth-based fading
    // Helps visualize depth and reduces visual clutter of distant points
    v_fogFactor = smoothstep(FOG_START, FOG_END, depth);
    
    // Final clip space position
    gl_Position = u_projectionMatrix * viewPosition;
    
    // Discard points behind the camera or with zero confidence
    if (depth < 0.1 || a_confidence <= 0.0) {
        gl_Position = vec4(2.0, 2.0, 2.0, 1.0); // Move off-screen
    }
}
