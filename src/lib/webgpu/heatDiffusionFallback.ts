/**
 * WebGL 2.0 fallback for heat diffusion: CPU Jacobi + R32F temperature texture.
 */

import {
  createAmbientGrid,
  DEFAULT_HEAT_GRID,
  stepHeatDiffusion,
  type HeatDiffusionConfig,
  type HvacSensor,
} from "./heatEquation";
import { HEAT_FALLBACK_FRAG, HEAT_FALLBACK_VERT } from "./heatShaders.wgsl";

export class HeatDiffusionFallback {
  private canvas: HTMLCanvasElement;
  private gl: WebGL2RenderingContext | null = null;
  private program: WebGLProgram | null = null;
  private texture: WebGLTexture | null = null;
  private vao: WebGLVertexArrayObject | null = null;

  private config: Required<
    Pick<
      HeatDiffusionConfig,
      | "width"
      | "height"
      | "alpha"
      | "dt"
      | "ambient"
      | "minTemp"
      | "maxTemp"
      | "opacity"
    >
  > & { sensors: HvacSensor[] };

  private gridA: Float32Array;
  private gridB: Float32Array;
  private ping = true;
  private raf = 0;
  private running = false;

  constructor(
    canvas: HTMLCanvasElement,
    config: Partial<HeatDiffusionConfig> = {},
  ) {
    this.canvas = canvas;
    this.config = {
      width: config.width ?? DEFAULT_HEAT_GRID.width,
      height: config.height ?? DEFAULT_HEAT_GRID.height,
      alpha: config.alpha ?? DEFAULT_HEAT_GRID.alpha,
      dt: config.dt ?? DEFAULT_HEAT_GRID.dt,
      ambient: config.ambient ?? DEFAULT_HEAT_GRID.ambient,
      sensors:
        config.sensors ??
        defaultSensors(config.width ?? 64, config.height ?? 64),
      minTemp: config.minTemp ?? 18,
      maxTemp: config.maxTemp ?? 32,
      opacity: config.opacity ?? 0.72,
    };
    this.gridA = createAmbientGrid(
      this.config.width,
      this.config.height,
      this.config.ambient,
      this.config.sensors,
    );
    this.gridB = new Float32Array(this.gridA);
  }

  initialize(): boolean {
    const gl = this.canvas.getContext("webgl2", {
      alpha: true,
      premultipliedAlpha: true,
    });
    if (!gl) return false;
    this.gl = gl;

    const vs = compile(gl, gl.VERTEX_SHADER, HEAT_FALLBACK_VERT);
    const fs = compile(gl, gl.FRAGMENT_SHADER, HEAT_FALLBACK_FRAG);
    if (!vs || !fs) return false;

    const program = gl.createProgram();
    if (!program) return false;
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.warn("[HeatDiffusionFallback] link failed", gl.getProgramInfoLog(program));
      return false;
    }
    this.program = program;

    const verts = new Float32Array([-1, -1, 3, -1, -1, 3]);
    const vbo = gl.createBuffer();
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(program, "a_pos");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    this.texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.uploadTexture(this.gridA);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    return true;
  }

  setSensors(sensors: HvacSensor[]): void {
    this.config.sensors = sensors;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    const tick = () => {
      if (!this.running) return;
      this.step();
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  stop(): void {
    this.running = false;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  step(): void {
    const input = this.ping ? this.gridA : this.gridB;
    const output = this.ping ? this.gridB : this.gridA;
    stepHeatDiffusion(input, output, this.config);
    this.uploadTexture(output);
    this.draw();
    this.ping = !this.ping;
  }

  private uploadTexture(grid: Float32Array): void {
    const gl = this.gl;
    if (!gl || !this.texture) return;
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.R32F,
      this.config.width,
      this.config.height,
      0,
      gl.RED,
      gl.FLOAT,
      grid,
    );
  }

  private draw(): void {
    const gl = this.gl;
    if (!gl || !this.program || !this.vao || !this.texture) return;

    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0.08, 0.09, 0.11, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.uniform1i(gl.getUniformLocation(this.program, "u_temp"), 0);
    gl.uniform1f(
      gl.getUniformLocation(this.program, "u_minTemp"),
      this.config.minTemp,
    );
    gl.uniform1f(
      gl.getUniformLocation(this.program, "u_maxTemp"),
      this.config.maxTemp,
    );
    gl.uniform1f(
      gl.getUniformLocation(this.program, "u_opacity"),
      this.config.opacity,
    );
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  destroy(): void {
    this.stop();
    const gl = this.gl;
    if (gl && this.texture) gl.deleteTexture(this.texture);
    if (gl && this.program) gl.deleteProgram(this.program);
    if (gl && this.vao) gl.deleteVertexArray(this.vao);
    this.gl = null;
  }
}

function compile(
  gl: WebGL2RenderingContext,
  type: number,
  source: string,
): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.warn("[HeatDiffusionFallback] shader error", gl.getShaderInfoLog(shader));
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

function defaultSensors(width: number, height: number): HvacSensor[] {
  return [
    { x: Math.floor(width * 0.2), y: Math.floor(height * 0.2), temperature: 28 },
    { x: Math.floor(width * 0.75), y: Math.floor(height * 0.3), temperature: 19 },
    { x: Math.floor(width * 0.5), y: Math.floor(height * 0.7), temperature: 26 },
    { x: Math.floor(width * 0.15), y: Math.floor(height * 0.8), temperature: 21 },
  ];
}
