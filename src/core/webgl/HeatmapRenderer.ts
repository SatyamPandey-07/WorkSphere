/**
 * HeatmapRenderer.ts
 * The core WebGL context manager, buffer allocation, and shader uniform binding.
 * Handles the compilation of shaders and the rendering loop for the heatmap overlay.
 */

import vertexShaderSource from '@/shaders/heatmap/heatmap.vert?raw';
import fragmentShaderSource from '@/shaders/heatmap/heatmap.frag?raw';

export interface HeatmapDataPoint {
    x: number;
    y: number;
    value: number;
}

export class HeatmapRenderer {
    private gl: WebGLRenderingContext | null = null;
    private program: WebGLProgram | null = null;
    private positionBuffer: WebGLBuffer | null = null;
    private valueBuffer: WebGLBuffer | null = null;

    private uProjectionMatrixLocation: WebGLUniformLocation | null = null;
    private uMapBoundsMinLocation: WebGLUniformLocation | null = null;
    private uMapBoundsMaxLocation: WebGLUniformLocation | null = null;
    private uMaxValueLocation: WebGLUniformLocation | null = null;
    private uAlphaLocation: WebGLUniformLocation | null = null;

    private aPositionLocation: number = 0;
    private aValueLocation: number = 0;

    constructor(canvas: HTMLCanvasElement) {
        this.gl = canvas.getContext('webgl', { alpha: true, antialias: true });
        if (!this.gl) {
            throw new Error('WebGL not supported');
        }
        this.initShaders();
        this.initBuffers();
    }

    private initShaders(): void {
        if (!this.gl) return;

        const vertexShader = this.compileShader(this.gl.VERTEX_SHADER, vertexShaderSource);
        const fragmentShader = this.compileShader(this.gl.FRAGMENT_SHADER, fragmentShaderSource);

        this.program = this.gl.createProgram();
        if (!this.program) throw new Error('Failed to create WebGL program');

        this.gl.attachShader(this.program, vertexShader);
        this.gl.attachShader(this.program, fragmentShader);
        this.gl.linkProgram(this.program);

        if (!this.gl.getProgramParameter(this.program, this.gl.LINK_STATUS)) {
            throw new Error('WebGL program link failed: ' + this.gl.getProgramInfoLog(this.program));
        }

        this.gl.useProgram(this.program);

        // Get uniform locations
        this.uProjectionMatrixLocation = this.gl.getUniformLocation(this.program, 'u_projectionMatrix');
        this.uMapBoundsMinLocation = this.gl.getUniformLocation(this.program, 'u_mapBoundsMin');
        this.uMapBoundsMaxLocation = this.gl.getUniformLocation(this.program, 'u_mapBoundsMax');
        this.uMaxValueLocation = this.gl.getUniformLocation(this.program, 'u_maxValue');
        this.uAlphaLocation = this.gl.getUniformLocation(this.program, 'u_alpha');

        // Get attribute locations
        this.aPositionLocation = this.gl.getAttribLocation(this.program, 'a_position');
        this.aValueLocation = this.gl.getAttribLocation(this.program, 'a_value');
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

        this.positionBuffer = this.gl.createBuffer();
        this.valueBuffer = this.gl.createBuffer();
    }

    public render(dataPoints: HeatmapDataPoint[], mapBoundsMin: [number, number], mapBoundsMax: [number, number], projectionMatrix: Float32Array): void {
        if (!this.gl || !this.program || !this.positionBuffer || !this.valueBuffer) return;

        this.gl.clearColor(0.0, 0.0, 0.0, 0.0);
        this.gl.clear(this.gl.COLOR_BUFFER_BIT);
        this.gl.enable(this.gl.BLEND);
        this.gl.blendFunc(this.gl.SRC_ALPHA, this.gl.ONE_MINUS_SRC_ALPHA);

        // Flatten data for WebGL
        const positions = new Float32Array(dataPoints.length * 2);
        const values = new Float32Array(dataPoints.length);
        let maxValue = 0;

        for (let i = 0; i < dataPoints.length; i++) {
            positions[i * 2] = dataPoints[i].x;
            positions[i * 2 + 1] = dataPoints[i].y;
            values[i] = dataPoints[i].value;
            if (dataPoints[i].value > maxValue) {
                maxValue = dataPoints[i].value;
            }
        }

        // Bind position buffer
        this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.positionBuffer);
        this.gl.bufferData(this.gl.ARRAY_BUFFER, positions, this.gl.DYNAMIC_DRAW);
        this.gl.enableVertexAttribArray(this.aPositionLocation);
        this.gl.vertexAttribPointer(this.aPositionLocation, 2, this.gl.FLOAT, false, 0, 0);

        // Bind value buffer
        this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.valueBuffer);
        this.gl.bufferData(this.gl.ARRAY_BUFFER, values, this.gl.DYNAMIC_DRAW);
        this.gl.enableVertexAttribArray(this.aValueLocation);
        this.gl.vertexAttribPointer(this.aValueLocation, 1, this.gl.FLOAT, false, 0, 0);

        // Set uniforms
        this.gl.uniformMatrix3fv(this.uProjectionMatrixLocation, false, projectionMatrix);
        this.gl.uniform2fv(this.uMapBoundsMinLocation, mapBoundsMin);
        this.gl.uniform2fv(this.uMapBoundsMaxLocation, mapBoundsMax);
        this.gl.uniform1f(this.uMaxValueLocation, maxValue || 1);
        this.gl.uniform1f(this.uAlphaLocation, 0.7);

        // Draw
        this.gl.drawArrays(this.gl.POINTS, 0, dataPoints.length);
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
