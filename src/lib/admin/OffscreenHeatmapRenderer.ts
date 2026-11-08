/**
 * OffscreenHeatmapRenderer.ts
 * Core WebGL rendering logic for the heatmap, designed to run inside a Web Worker.
 */

export class OffscreenHeatmapRenderer {
    private gl: WebGLRenderingContext | null;
    private width: number;
    private height: number;
    private coordinateBuffer: WebGLBuffer | null;
    private intensityBuffer: WebGLBuffer | null;
    private program: WebGLProgram | null;

    constructor(canvas: OffscreenCanvas, width: number, height: number) {
        this.width = width;
        this.height = height;
        this.gl = canvas.getContext('webgl', { alpha: true }) as WebGLRenderingContext | null;
        this.coordinateBuffer = null;
        this.intensityBuffer = null;
        this.program = null;

        if (this.gl) {
            this.initShaders();
            this.initBuffers();
        }
    }

    private initShaders(): void {
        if (!this.gl) return;
        const gl = this.gl;

        const vsSource = `
      attribute vec2 a_position;
      attribute float a_intensity;
      varying float v_intensity;
      void main() {
        gl_Position = vec4(a_position, 0.0, 1.0);
        v_intensity = a_intensity;
        gl_PointSize = 15.0;
      }
    `;

        const fsSource = `
      precision mediump float;
      varying float v_intensity;
      void main() {
        vec3 color = mix(vec3(0.0, 0.0, 1.0), vec3(1.0, 0.0, 0.0), v_intensity);
        float dist = length(gl_PointCoord - vec2(0.5));
        if (dist > 0.5) discard;
        float alpha = 1.0 - smoothstep(0.0, 0.5, dist);
        gl_FragColor = vec4(color, alpha * 0.6);
      }
    `;

        const vs = gl.createShader(gl.VERTEX_SHADER);
        gl.shaderSource(vs!, vsSource);
        gl.compileShader(vs!);

        const fs = gl.createShader(gl.FRAGMENT_SHADER);
        gl.shaderSource(fs!, fsSource);
        gl.compileShader(fs!);

        this.program = gl.createProgram();
        gl.attachShader(this.program!, vs!);
        gl.attachShader(this.program!, fs!);
        gl.linkProgram(this.program!);
        gl.useProgram(this.program!);
    }

    private initBuffers(): void {
        if (!this.gl) return;
        this.coordinateBuffer = this.gl.createBuffer();
        this.intensityBuffer = this.gl.createBuffer();
    }

    public updateData(coordinates: Float32Array, intensities: Float32Array): void {
        if (!this.gl || !this.coordinateBuffer || !this.intensityBuffer) return;
        const gl = this.gl;

        gl.bindBuffer(gl.ARRAY_BUFFER, this.coordinateBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, coordinates, gl.DYNAMIC_DRAW);

        gl.bindBuffer(gl.ARRAY_BUFFER, this.intensityBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, intensities, gl.DYNAMIC_DRAW);
    }

    public render(): void {
        if (!this.gl || !this.program || !this.coordinateBuffer || !this.intensityBuffer) return;
        const gl = this.gl;

        gl.viewport(0, 0, this.width, this.height);
        gl.clearColor(0.0, 0.0, 0.0, 0.0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE);

        const posLoc = gl.getAttribLocation(this.program, 'a_position');
        gl.bindBuffer(gl.ARRAY_BUFFER, this.coordinateBuffer);
        gl.enableVertexAttribArray(posLoc);
        gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

        const intLoc = gl.getAttribLocation(this.program, 'a_intensity');
        gl.bindBuffer(gl.ARRAY_BUFFER, this.intensityBuffer);
        gl.enableVertexAttribArray(intLoc);
        gl.vertexAttribPointer(intLoc, 1, gl.FLOAT, false, 0, 0);

        // Assuming coordinates length / 2 is the number of points
        const numPoints = 1000; // Scaffold value; in production, derive from array length
        gl.drawArrays(gl.POINTS, 0, numPoints);
    }

    public resize(width: number, height: number): void {
        this.width = width;
        this.height = height;
        if (this.gl) {
            this.gl.viewport(0, 0, width, height);
        }
    }
}
