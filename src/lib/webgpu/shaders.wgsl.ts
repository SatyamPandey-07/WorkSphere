/**
 * WGSL Shader Definitions for 3D Floor Plan Rendering
 */

export const vertexShader = /* wgsl */ `
struct Uniforms {
  mvp: mat4x4<f32>,
  model: mat4x4<f32>,
  lightDir: vec3<f32>,
  time: f32,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;

struct VertexInput {
  @location(0) position: vec3<f32>,
  @location(1) normal: vec3<f32>,
  @location(2) color: vec3<f32>,
  @location(3) uv: vec2<f32>,
};

struct VertexOutput {
  @builtin(position) clipPosition: vec4<f32>,
  @location(0) worldPosition: vec3<f32>,
  @location(1) normal: vec3<f32>,
  @location(2) color: vec3<f32>,
  @location(3) uv: vec2<f32>,
};

@vertex
fn vs_main(input: VertexInput) -> VertexOutput {
  var output: VertexOutput;
  output.clipPosition = uniforms.mvp * vec4<f32>(input.position, 1.0);
  output.worldPosition = (uniforms.model * vec4<f32>(input.position, 1.0)).xyz;
  output.normal = (uniforms.model * vec4<f32>(input.normal, 0.0)).xyz;
  output.color = input.color;
  output.uv = input.uv;
  return output;
}
`;

export const fragmentShader = /* wgsl */ `
struct Uniforms {
  mvp: mat4x4<f32>,
  model: mat4x4<f32>,
  lightDir: vec3<f32>,
  time: f32,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;

struct FragmentInput {
  @location(0) worldPosition: vec3<f32>,
  @location(1) normal: vec3<f32>,
  @location(2) color: vec3<f32>,
  @location(3) uv: vec2<f32>,
};

@fragment
fn fs_main(input: FragmentInput) -> @location(0) vec4<f32> {
  let normal = normalize(input.normal);
  let lightDir = normalize(uniforms.lightDir);

  // Ambient
  let ambient = 0.3;

  // Diffuse
  let diff = max(dot(normal, lightDir), 0.0);
  let diffuse = diff * 0.5;

  // Specular (Blinn-Phong)
  let viewDir = normalize(vec3<f32>(0.0, 5.0, 5.0));
  let halfDir = normalize(lightDir + viewDir);
  let spec = pow(max(dot(normal, halfDir), 0.0), 32.0);
  let specular = spec * 0.2;

  let lighting = ambient + diffuse + specular;
  var color = input.color * lighting;

  // Subtle grid pattern on floor
  let gridX = fract(input.uv.x * 10.0);
  let gridY = fract(input.uv.y * 10.0);
  let grid = 1.0 - smoothstep(0.0, 0.05, min(gridX, gridY));
  color = mix(color, color * 0.85, grid * 0.15);

  return vec4<f32>(color, 1.0);
}
`;
