#version 300 es
/**
 * pose_feedback.vert
 * GLSL vertex shader handling the skeletal deformation and joint-rotation matrix transformations.
 * Maps 2D normalized pose coordinates into 3D clip space with depth extrusion.
 */

in vec3 a_position;
in float a_strain;
in float a_visibility;

out float v_strain;
out float v_visibility;

uniform mat4 u_projectionMatrix;
uniform mat4 u_modelViewMatrix;
uniform float u_depthScale;

void main() {
  v_strain = a_strain;
  v_visibility = a_visibility;

  // Apply depth extrusion based on Z coordinate from pose estimator
  vec3 pos = a_position;
  pos.z *= u_depthScale;

  // Transform to clip space
  vec4 worldPosition = u_modelViewMatrix * vec4(pos, 1.0);
  gl_Position = u_projectionMatrix * worldPosition;

  // Dynamic point size based on depth and visibility
  float depthFactor = 1.0 / (1.0 + abs(worldPosition.z));
  gl_PointSize = 12.0 * depthFactor * (0.5 + (a_visibility * 0.5));
}
