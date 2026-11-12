/**
 * GaussianSplatRenderer
 * Core WebGL2 context manager handling the sorting, rasterization, and blending of millions of 3D Gaussians.
 */

export interface SplatData {
    positions: Float32Array;
    covariances: Float32Array;
    colors: Float32Array; // SH coefficients
    opacities: Float32Array;
    count: number;
}

export class GaussianSplatRenderer {
    private gl: WebGL2RenderingContext;
    private program: WebGLProgram | null = null;
    private vao: WebGLVertexArrayObject | null = null;
    private positionBuffer: WebGLBuffer | null = null;
    private covarianceBuffer: WebGLBuffer | null = null;
    private colorBuffer: WebGLBuffer | null = null;

    private viewMatrix = new Float32Array(16);
    private projMatrix = new Float32Array(16);

    constructor(private canvas: HTMLCanvasElement) {
        const gl = canvas.getContext('webgl2', { antialias: false, alpha: false });
        if (!gl) throw new Error('WebGL2 not supported');
        this.gl = gl;
        this.initGL();
    }

    private initGL(): void {
        const gl = this.gl;
        gl.enable(gl.BLEND);
        gl.blendFuncSeparate(gl.ONE_MINUS_DST_ALPHA, gl.ONE, gl.ONE_MINUS_DST_ALPHA, gl.ONE);
        gl.clearColor(0.0, 0.0, 0.0, 0.0);

        // Shader compilation would happen here in a full implementation
        // this.program = this.createProgram(vertSrc, fragSrc);
    }

    public uploadData(data: SplatData): void {
        const gl = this.gl;

        this.positionBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, data.positions, gl.STATIC_DRAW);

        this.covarianceBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this.covarianceBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, data.covariances, gl.STATIC_DRAW);

        this.colorBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this.colorBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, data.colors, gl.STATIC_DRAW);
    }

    public render(cameraView: Float32Array, cameraProj: Float32Array): void {
        const gl = this.gl;
        gl.viewport(0, 0, this.canvas.width, this.canvas.height);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

        if (!this.program) return;

        gl.useProgram(this.program);

        // Uniforms
        const viewLoc = gl.getUniformLocation(this.program, 'u_view');
        const projLoc = gl.getUniformLocation(this.program, 'u_proj');

        gl.uniformMatrix4fv(viewLoc, false, cameraView);
        gl.uniformMatrix4fv(projLoc, false, cameraProj);

        // Draw calls would execute here based on sorted splat indices
        // gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, splatCount);
    }

    public dispose(): void {
        const gl = this.gl;
        if (this.positionBuffer) gl.deleteBuffer(this.positionBuffer);
        if (this.covarianceBuffer) gl.deleteBuffer(this.covarianceBuffer);
        if (this.colorBuffer) gl.deleteBuffer(this.colorBuffer);
        if (this.program) gl.deleteProgram(this.program);
    }
}
