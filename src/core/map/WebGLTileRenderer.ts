/**
 * WebGLTileRenderer.ts
 * Manages the WebGL buffers, shaders, and draw calls to render vector polygons and lines efficiently.
 * Provides a high-performance alternative to raster tiles for offline map viewing.
 */

import tileVertSource from '@/shaders/map/tile.vert?raw';
import tileFragSource from '@/shaders/map/tile.frag?raw';

export class WebGLTileRenderer {
  private gl: WebGL2RenderingContext | null = null;
  private program: WebGLProgram | null = null;
  private vao: WebGLVertexArrayObject | null = null;
  private vertexBuffer: WebGLBuffer | null = null;
  private indexBuffer: WebGLBuffer | null = null;
  private indexCount: number = 0;

  private uProjectionMatrixLocation: WebGLUniformLocation | null = null;
  private uThemeColorLocation: WebGLUniformLocation | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.gl = canvas.getContext('webgl2', { antialias: true });
    if (!this.gl) {
      throw new Error('WebGL2 not supported');
    }
    this.initShaders();
    this.initBuffers();
  }

  private initShaders(): void {
    if (!this.gl) return;
    const gl = this.gl;

    const vs = this.compileShader(gl.VERTEX_SHADER, tileVertSource);
    const fs = this.compileShader(gl.FRAGMENT_SHADER, tileFragSource);

    this.program = gl.createProgram();
    if (!this.program) throw new Error('Failed to create WebGL program');

    gl.attachShader(this.program, vs);
    gl.attachShader(this.program, fs);
    gl.linkProgram(this.program);

    if (!gl.getProgramParameter(this.program, gl.LINK_STATUS)) {
      throw new Error('Program link failed: ' + gl.getProgramInfoLog(this.program));
    }

    gl.useProgram(this.program);

    this.uProjectionMatrixLocation = gl.getUniformLocation(this.program, 'u_projection');
    this.uThemeColorLocation = gl.getUniformLocation(this.program, 'u_theme_color');
  }

  private compileShader(type: number, source: string): WebGLShader {
    if (!this.gl) throw new Error('WebGL context missing');
    const shader = this.gl.createShader(type);
    if (!shader) throw new Error('Failed to create shader');
    
    this.gl.shaderSource(shader, source);
    this.gl.compileShader(shader);
    
    if (!this.gl.getShaderParameter(shader, this.gl.COMPILE_STATUS)) {
      const info = this.gl.getShaderInfoLog(shader);
      this.gl.deleteShader(shader);
      throw new Error('Shader compilation failed: ' + info);
    }
    return shader;
  }

  private initBuffers(): void {
    if (!this.gl || !this.program) return;
    const gl = this.gl;

    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);

    this.vertexBuffer = gl.createBuffer();
    this.indexBuffer = gl.createBuffer();

    gl.enableVertexAttribArray(0);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);

    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indexBuffer);
  }

  public updateGeometry(vertices: Float32Array, indices: Uint16Array): void {
    if (!this.gl || !this.vertexBuffer || !this.indexBuffer) return;
    const gl = this.gl;

    gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.DYNAMIC_DRAW);

    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indexBuffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.DYNAMIC_DRAW);

    this.indexCount = indices.length;
  }

  public render(projectionMatrix: Float32Array, isDarkMode: boolean): void {
    if (!this.gl || !this.program || !this.vao) return;
    const gl = this.gl;

    gl.clearColor(0.0, 0.0, 0.0, 0.0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);

    gl.uniformMatrix4fv(this.uProjectionMatrixLocation, false, projectionMatrix);
    
    // WorkSphere theme colors
    const themeColor = isDarkMode ? [0.2, 0.2, 0.25, 1.0] : [0.9, 0.9, 0.95, 1.0];
    gl.uniform4fv(this.uThemeColorLocation, themeColor);

    if (this.indexCount > 0) {
      gl.drawElements(gl.TRIANGLES, this.indexCount, gl.UNSIGNED_SHORT, 0);
    }
  }

  public resize(width: number, height: number): void {
    if (!this.gl) return;
    this.gl.viewport(0, 0, width, height);
  }

  public destroy(): void {
    if (this.gl && this.program) {
      this.gl.deleteProgram(this.program);
      this.program = null;
    }
  }
}
