/**
 * WebGL GPU-Accelerated Spatial Clustering Heatmap Renderer (#818)
 *
 * High-performance WebGL rendering engine capable of projecting and clustering
 * up to 100,000 live workspace telemetry points at 60 FPS with hardware acceleration.
 */

import {
  HEATMAP_VERTEX_SHADER,
  HEATMAP_FRAGMENT_SHADER,
} from "@/shaders/heatmapShaders";
import { attachWebGLContextRecovery } from "./contextManager";

export interface HeatmapPoint {
  x: number; // Viewport/canvas pixel X coordinate
  y: number; // Viewport/canvas pixel Y coordinate
  intensity: number; // Intensity (0.0 to 1.0)
  radius?: number; // Spatial influence radius in pixels (default 25)
}

export interface WebGLHeatmapOptions {
  opacity?: number;
  blur?: number;
  maxPoints?: number;
}

export class WebGLHeatmapRenderer {
  private canvas: HTMLCanvasElement;
  private gl: WebGL2RenderingContext | WebGLRenderingContext | null = null;
  private program: WebGLProgram | null = null;
  private vbo: WebGLBuffer | null = null;
  private cleanupContextRecovery?: () => void;

  private pointsCount = 0;
  private maxPoints: number;
  private opacity: number;
  private blur: number;
  private isDestroyed = false;

  // Uniform locations
  private uResolutionLoc: WebGLUniformLocation | null = null;
  private uZoomLoc: WebGLUniformLocation | null = null;
  private uOpacityLoc: WebGLUniformLocation | null = null;
  private uBlurLoc: WebGLUniformLocation | null = null;

  // Attribute locations
  private aPositionLoc = -1;
  private aIntensityLoc = -1;
  private aRadiusLoc = -1;

  constructor(canvas: HTMLCanvasElement, options: WebGLHeatmapOptions = {}) {
    this.canvas = canvas;
    this.maxPoints = options.maxPoints || 100000;
    this.opacity = options.opacity ?? 0.85;
    this.blur = options.blur ?? 1.0;

    this.initGL();
    this.cleanupContextRecovery = attachWebGLContextRecovery(canvas, () => {
      this.initGL();
    });
  }

  private initGL() {
    try {
      // Defensive cleanup: if initGL() ever runs more than once (e.g. the
      // context-recovery callback fires without a true context loss), free
      // the previous program/buffer first so we never leak GPU resources.
      if (this.gl) {
        if (this.program) this.gl.deleteProgram(this.program);
        if (this.vbo) this.gl.deleteBuffer(this.vbo);
        this.program = null;
        this.vbo = null;
      }

      this.gl =
        (this.canvas.getContext("webgl2") as WebGL2RenderingContext | null) ||
        (this.canvas.getContext("webgl") as WebGLRenderingContext | null);

      if (!this.gl) {
        console.warn(
          "[WebGLHeatmap] WebGL context not supported by client environment.",
        );
        return;
      }

      const gl = this.gl;

      // Enable additive color blending for GPU spatial density clustering overlay
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE);

      // Compile Shader Program
      const vertShader = this.compileShader(
        gl.VERTEX_SHADER,
        HEATMAP_VERTEX_SHADER,
      );
      const fragShader = this.compileShader(
        gl.FRAGMENT_SHADER,
        HEATMAP_FRAGMENT_SHADER,
      );

      if (!vertShader || !fragShader) return;

      const program = gl.createProgram();
      if (!program) return;

      gl.attachShader(program, vertShader);
      gl.attachShader(program, fragShader);
      gl.linkProgram(program);

      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        console.error(
          "[WebGLHeatmap] Program link error:",
          gl.getProgramInfoLog(program),
        );
        return;
      }

      this.program = program;
      gl.useProgram(program);

      // Look up attributes & uniforms
      this.aPositionLoc = gl.getAttribLocation(program, "a_position");
      this.aIntensityLoc = gl.getAttribLocation(program, "a_intensity");
      this.aRadiusLoc = gl.getAttribLocation(program, "a_radius");

      this.uResolutionLoc = gl.getUniformLocation(program, "u_resolution");
      this.uZoomLoc = gl.getUniformLocation(program, "u_zoom");
      this.uOpacityLoc = gl.getUniformLocation(program, "u_opacity");
      this.uBlurLoc = gl.getUniformLocation(program, "u_blur");

      // Initialize ArrayBuffer VBO (Float32Array: 4 floats per vertex -> x, y, intensity, radius)
      this.vbo = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
      gl.bufferData(
        gl.ARRAY_BUFFER,
        this.maxPoints * 4 * Float32Array.BYTES_PER_ELEMENT,
        gl.DYNAMIC_DRAW,
      );
    } catch (err) {
      console.error("[WebGLHeatmap] Context initialization error:", err);
    }
  }

  private compileShader(type: number, source: string): WebGLShader | null {
    if (!this.gl) return null;
    const shader = this.gl.createShader(type);
    if (!shader) return null;

    this.gl.shaderSource(shader, source);
    this.gl.compileShader(shader);

    if (!this.gl.getShaderParameter(shader, this.gl.COMPILE_STATUS)) {
      console.error(
        "[WebGLHeatmap] Shader compile failed:",
        this.gl.getShaderInfoLog(shader),
      );
      this.gl.deleteShader(shader);
      return null;
    }
    return shader;
  }

  /**
   * Upload points data to WebGL GPU VBO buffer
   */
  public updatePoints(points: HeatmapPoint[]) {
    if (!this.gl || !this.vbo || !this.program || this.isDestroyed) return;

    const gl = this.gl;
    this.pointsCount = Math.min(points.length, this.maxPoints);

    const bufferData = new Float32Array(this.pointsCount * 4);
    for (let i = 0; i < this.pointsCount; i++) {
      const p = points[i];
      const offset = i * 4;
      bufferData[offset] = p.x;
      bufferData[offset + 1] = p.y;
      bufferData[offset + 2] = p.intensity;
      bufferData[offset + 3] = p.radius ?? 25.0;
    }

    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, bufferData);
  }

  /**
   * Render frame to canvas with hardware spatial clustering
   */
  public render(width: number, height: number, zoom: number = 1.0) {
    if (
      !this.gl ||
      !this.program ||
      !this.vbo ||
      this.pointsCount === 0 ||
      this.isDestroyed
    ) {
      return;
    }

    const gl = this.gl;
    gl.viewport(0, 0, width, height);
    gl.clearColor(0.0, 0.0, 0.0, 0.0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.useProgram(this.program);

    // Uniforms
    gl.uniform2f(this.uResolutionLoc, width, height);
    gl.uniform1f(this.uZoomLoc, zoom);
    gl.uniform1f(this.uOpacityLoc, this.opacity);
    gl.uniform1f(this.uBlurLoc, this.blur);

    // Bind VBO & attributes
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    const stride = 4 * Float32Array.BYTES_PER_ELEMENT;

    if (this.aPositionLoc !== -1) {
      gl.enableVertexAttribArray(this.aPositionLoc);
      gl.vertexAttribPointer(this.aPositionLoc, 2, gl.FLOAT, false, stride, 0);
    }
    if (this.aIntensityLoc !== -1) {
      gl.enableVertexAttribArray(this.aIntensityLoc);
      gl.vertexAttribPointer(
        this.aIntensityLoc,
        1,
        gl.FLOAT,
        false,
        stride,
        2 * Float32Array.BYTES_PER_ELEMENT,
      );
    }
    if (this.aRadiusLoc !== -1) {
      gl.enableVertexAttribArray(this.aRadiusLoc);
      gl.vertexAttribPointer(
        this.aRadiusLoc,
        1,
        gl.FLOAT,
        false,
        stride,
        3 * Float32Array.BYTES_PER_ELEMENT,
      );
    }

    // Draw telemetry points
    gl.drawArrays(gl.POINTS, 0, this.pointsCount);
  }

  public setOpacity(opacity: number) {
    this.opacity = opacity;
  }

  public setBlur(blur: number) {
    this.blur = blur;
  }

  public destroy() {
    this.isDestroyed = true;
    if (this.cleanupContextRecovery) {
      this.cleanupContextRecovery();
    }
    if (this.gl && this.program) {
      this.gl.deleteProgram(this.program);
    }
    if (this.gl && this.vbo) {
      this.gl.deleteBuffer(this.vbo);
    }
  }
}
