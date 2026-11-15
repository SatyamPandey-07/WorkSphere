#version 300 es
/**
 * pose_feedback.frag
 * GLSL fragment shader implementing the dynamic "strain heat-map" coloring 
 * based on joint angle deviations.
 */

precision highp float;

in float v_strain;
in float v_visibility;

out vec4 fragColor;

uniform float u_time;

// Smoothstep function for color transitions
float smoothStep(float edge0, float edge1, float x) {
  float t = clamp((x - edge0) / (edge1 - edge0), 0.0, 1.0);
  return t * t * (3.0 - 2.0 * t);
}

void main() {
  // Base colors for ergonomic feedback
  vec3 optimalColor = vec3(0.1, 0.8, 0.3);  // Green
  vec3 warningColor = vec3(0.9, 0.7, 0.1);  // Yellow
  vec3 criticalColor = vec3(0.9, 0.1, 0.1); // Red

  // Interpolate colors based on strain level
  vec3 color;
  if (v_strain < 0.5) {
    color = mix(optimalColor, warningColor, smoothStep(0.0, 0.5, v_strain));
  } else {
    color = mix(warningColor, criticalColor, smoothStep(0.5, 1.0, v_strain));
  }

  // Add a subtle pulse effect to critical strain areas to draw attention
  float pulse = 1.0;
  if (v_strain > 0.8) {
    pulse = 0.8 + 0.2 * sin(u_time * 5.0);
  }

  // Apply visibility mask (fade out low-confidence landmarks)
  float alpha = v_visibility * pulse;

  // Circular point rendering for point-cloud rendering mode
  vec2 circCoord = 2.0 * gl_PointCoord - 1.0;
  if (dot(circCoord, circCoord) > 1.0) {
    discard;
  }

  fragColor = vec4(color * pulse, alpha);
}