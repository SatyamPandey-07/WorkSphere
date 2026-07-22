/**
 * WGSL shaders for 2D heat-equation diffusion (Jacobi) + heatmap overlay.
 *
 * Compute: explicit finite-difference step on a ping-pong temperature grid,
 * with HVAC sensor cells re-injected each iteration.
 * Render: fullscreen quad mapping temperature → blue→red heatmap colors.
 */

export const HEAT_DIFFUSION_COMPUTE = /* wgsl */ `
struct HeatParams {
  width: u32,
  height: u32,
  alpha: f32,
  dt: f32,
  ambient: f32,
  sensorCount: u32,
  _pad0: f32,
  _pad1: f32,
};

struct Sensor {
  x: u32,
  y: u32,
  temperature: f32,
  _pad: f32,
};

@group(0) @binding(0) var<uniform> params: HeatParams;
@group(0) @binding(1) var<storage, read> tempIn: array<f32>;
@group(0) @binding(2) var<storage, read_write> tempOut: array<f32>;
@group(0) @binding(3) var<storage, read> sensors: array<Sensor>;

@compute @workgroup_size(16, 16)
fn cs_main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let x = gid.x;
  let y = gid.y;
  if (x >= params.width || y >= params.height) {
    return;
  }

  let idx = y * params.width + x;
  let w = params.width;
  let h = params.height;

  // Neumann edges: clamp neighbor samples
  let xl = select(x - 1u, x, x == 0u);
  let xr = select(x + 1u, x, x + 1u >= w);
  let yd = select(y - 1u, y, y == 0u);
  let yu = select(y + 1u, y, y + 1u >= h);

  let c = tempIn[idx];
  let l = tempIn[y * w + xl];
  let r = tempIn[y * w + xr];
  let d = tempIn[yd * w + x];
  let u = tempIn[yu * w + x];

  let lap = l + r + d + u - 4.0 * c;
  var next = c + params.alpha * params.dt * lap;

  // Soft pull toward ambient so the field stays bounded
  next = next + (params.ambient - next) * 0.002;

  tempOut[idx] = next;

  // Re-assert HVAC sensor sources after diffusion
  for (var i = 0u; i < params.sensorCount; i = i + 1u) {
    let s = sensors[i];
    if (s.x == x && s.y == y) {
      tempOut[idx] = s.temperature;
    }
  }
}
`;

export const HEAT_HEATMAP_RENDER = /* wgsl */ `
struct HeatUniforms {
  minTemp: f32,
  maxTemp: f32,
  opacity: f32,
  _pad: f32,
};

struct GridSize {
  width: u32,
  height: u32,
};

@group(0) @binding(0) var<uniform> u: HeatUniforms;
@group(0) @binding(1) var<storage, read> temps: array<f32>;
@group(0) @binding(2) var<uniform> size: GridSize;

struct VSOut {
  @builtin(position) pos: vec4<f32>,
  @location(0) uv: vec2<f32>,
};

@vertex
fn vs_main(@builtin(vertex_index) vi: u32) -> VSOut {
  // Fullscreen triangle
  var positions = array<vec2<f32>, 3>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>( 3.0, -1.0),
    vec2<f32>(-1.0,  3.0),
  );
  var uvs = array<vec2<f32>, 3>(
    vec2<f32>(0.0, 1.0),
    vec2<f32>(2.0, 1.0),
    vec2<f32>(0.0, -1.0),
  );
  var out: VSOut;
  out.pos = vec4<f32>(positions[vi], 0.0, 1.0);
  out.uv = uvs[vi];
  return out;
}

fn heatColor(t: f32) -> vec3<f32> {
  // blue → cyan → yellow → red
  if (t < 0.25) {
    let k = t / 0.25;
    return mix(vec3<f32>(0.05, 0.15, 0.55), vec3<f32>(0.0, 0.75, 1.0), k);
  }
  if (t < 0.5) {
    let k = (t - 0.25) / 0.25;
    return mix(vec3<f32>(0.0, 0.75, 1.0), vec3<f32>(0.15, 0.9, 0.35), k);
  }
  if (t < 0.75) {
    let k = (t - 0.5) / 0.25;
    return mix(vec3<f32>(0.15, 0.9, 0.35), vec3<f32>(1.0, 0.85, 0.1), k);
  }
  let k = (t - 0.75) / 0.25;
  return mix(vec3<f32>(1.0, 0.85, 0.1), vec3<f32>(0.95, 0.1, 0.12), k);
}

@fragment
fn fs_main(input: VSOut) -> @location(0) vec4<f32> {
  let w = size.width;
  let h = size.height;
  let gx = u32(clamp(input.uv.x, 0.0, 0.999) * f32(w));
  let gy = u32(clamp(input.uv.y, 0.0, 0.999) * f32(h));
  let idx = gy * w + gx;
  let raw = temps[idx];
  let span = max(u.maxTemp - u.minTemp, 0.001);
  let t = clamp((raw - u.minTemp) / span, 0.0, 1.0);
  let rgb = heatColor(t);
  return vec4<f32>(rgb, u.opacity);
}
`;

/** Shared GLSL ES 3.0 heatmap for the WebGL 2.0 fallback path. */
export const HEAT_FALLBACK_VERT = `#version 300 es
in vec2 a_pos;
out vec2 v_uv;
void main() {
  v_uv = a_pos * 0.5 + 0.5;
  v_uv.y = 1.0 - v_uv.y;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}
`;

export const HEAT_FALLBACK_FRAG = `#version 300 es
precision highp float;
uniform sampler2D u_temp;
uniform float u_minTemp;
uniform float u_maxTemp;
uniform float u_opacity;
in vec2 v_uv;
out vec4 outColor;

vec3 heatColor(float t) {
  if (t < 0.25) {
    float k = t / 0.25;
    return mix(vec3(0.05, 0.15, 0.55), vec3(0.0, 0.75, 1.0), k);
  }
  if (t < 0.5) {
    float k = (t - 0.25) / 0.25;
    return mix(vec3(0.0, 0.75, 1.0), vec3(0.15, 0.9, 0.35), k);
  }
  if (t < 0.75) {
    float k = (t - 0.5) / 0.25;
    return mix(vec3(0.15, 0.9, 0.35), vec3(1.0, 0.85, 0.1), k);
  }
  float k = (t - 0.75) / 0.25;
  return mix(vec3(1.0, 0.85, 0.1), vec3(0.95, 0.1, 0.12), k);
}

void main() {
  float raw = texture(u_temp, v_uv).r;
  float span = max(u_maxTemp - u_minTemp, 0.001);
  float t = clamp((raw - u_minTemp) / span, 0.0, 1.0);
  outColor = vec4(heatColor(t), u_opacity);
}
`;
