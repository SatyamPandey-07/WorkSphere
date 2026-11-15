/**
 * GLSL sources for the real-time nomad collaboration constellation (#7334).
 *
 * The particle sources mirror `particle_constellation.vert` and
 * `particle_constellation.frag` so they can also be consumed directly by
 * tooling that understands `?raw` imports. The line shaders are kept in this
 * module because the renderer draws GL_LINES through a dedicated program.
 */

export const PARTICLE_CONSTELLATION_VERTEX_SHADER = `#version 300 es
precision highp float;

layout(location = 0) in vec2 a_basePosition;
layout(location = 1) in vec2 a_velocity;
layout(location = 2) in float a_phase;
layout(location = 3) in float a_size;
layout(location = 4) in float a_kind;

uniform vec2 u_resolution;
uniform vec2 u_mouse;
uniform vec2 u_pan;
uniform float u_zoom;
uniform float u_dpr;
uniform float u_time;
uniform float u_deltaTime;
uniform float u_damping;
uniform float u_repulsionRadius;
uniform float u_repulsionStrength;
uniform float u_swayAmplitude;

out float v_kind;
out float v_repulsion;
out float v_phase;

void main() {
  // Analytic damped-velocity integration: displacement saturates as the
  // per-particle velocity decays, keeping 10k+ instances entirely on the GPU.
  float damping = max(u_damping, 0.0001);
  float travel = (1.0 - exp(-damping * u_time)) / damping;
  vec2 position = a_basePosition + a_velocity * travel;

  float sway = u_swayAmplitude;
  position += vec2(
    cos(u_time * 0.7 + a_phase),
    sin(u_time * 0.9 + a_phase * 1.37)
  ) * sway;

  // Mouse repulsion with a soft radial falloff and frame-rate independent
  // damping so particles ease away instead of snapping.
  vec2 delta = position - u_mouse;
  float distanceToPointer = length(delta);
  float influence = 1.0 - smoothstep(0.0, u_repulsionRadius, distanceToPointer);
  if (influence > 0.0 && distanceToPointer > 0.0001) {
    float frameDamping = 1.0 - exp(-damping * u_deltaTime);
    position += (delta / distanceToPointer) * influence * u_repulsionStrength * frameDamping;
  }

  vec2 view = (position + u_pan) * u_zoom;
  vec2 clip = view / (u_resolution * 0.5) - 1.0;

  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
  gl_PointSize = clamp(a_size * u_zoom * u_dpr, 1.0, 32.0);

  v_kind = a_kind;
  v_repulsion = influence;
  v_phase = a_phase;
}
`;

export const PARTICLE_CONSTELLATION_FRAGMENT_SHADER = `#version 300 es
precision highp float;

in float v_kind;
in float v_repulsion;
in float v_phase;

uniform vec3 u_nomadColor;
uniform vec3 u_venueColor;
uniform vec3 u_skillColor;

out vec4 fragColor;

void main() {
  vec2 centered = gl_PointCoord - 0.5;
  float radius = length(centered);
  if (radius > 0.5) {
    discard;
  }

  float core = smoothstep(0.5, 0.0, radius);
  float glow = pow(core, 2.2);

  vec3 base = u_nomadColor;
  if (v_kind > 1.5) {
    base = u_skillColor;
  } else if (v_kind > 0.5) {
    base = u_venueColor;
  }

  float sparkle = 0.85 + 0.15 * sin(v_phase + radius * 12.0);
  vec3 color = base + vec3(v_repulsion * 0.7) + vec3(glow * 0.15);
  fragColor = vec4(color, glow * sparkle * (0.75 + v_repulsion * 0.25));
}
`;

export const PARTICLE_CONSTELLATION_LINE_VERTEX_SHADER = `#version 300 es
precision highp float;

layout(location = 0) in vec2 a_position;

uniform vec2 u_resolution;
uniform vec2 u_pan;
uniform float u_zoom;

out float v_alpha;

void main() {
  vec2 view = (a_position + u_pan) * u_zoom;
  vec2 clip = view / (u_resolution * 0.5) - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
  v_alpha = 1.0;
}
`;

export const PARTICLE_CONSTELLATION_LINE_FRAGMENT_SHADER = `#version 300 es
precision mediump float;

in float v_alpha;
uniform vec4 u_lineColor;
out vec4 fragColor;

void main() {
  fragColor = vec4(u_lineColor.rgb, u_lineColor.a * v_alpha);
}
`;
