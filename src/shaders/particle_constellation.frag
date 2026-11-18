#version 300 es
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
