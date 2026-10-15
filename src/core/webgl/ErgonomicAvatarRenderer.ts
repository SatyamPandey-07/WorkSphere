/**
 * ErgonomicAvatarRenderer.ts
 * Core WebGL context manager that maps 2D pose estimation landmarks to a 3D rigged mesh skeleton.
 * Handles buffer allocation, shader compilation, and the rendering loop.
 */

export interface PoseLandmark {
    x: number;
    y: number;
    z: number;
    visibility: number;
}

export interface StrainMetrics {
    neckAngle: number;
    shoulderAsymmetry: number;
    lumbarCurvature: number;
}

export class ErgonomicAvatarRenderer {
    private gl: WebGL2RenderingContext;
    private program: WebGLProgram | null = null;
    private vertexBuffer: WebGLBuffer | null = null;
    private indexBuffer: WebGLBuffer | null = null;
    private strainBuffer: WebGLBuffer | null = null;

    private readonly JOINT_COUNT = 33; // MediaPipe BlazePose landmark count
    private readonly MAX_STRAIN = 1.0;

    constructor(canvas: HTMLCanvasElement) {
        const gl = canvas.getContext('webgl2', { antialias: true, alpha: true });
        if (!gl) throw new Error('WebGL2 not supported');
        this.gl = gl;

        this.initializeBuffers();
        this.initializeShaders();
    }

    private initializeBuffers(): void {
        const { gl } = this;

        // Dummy skeleton vertices (will be updated dynamically)
        const vertices = new Float32Array(this.JOINT_COUNT * 3);
        this.vertexBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.DYNAMIC_DRAW);

        // Skeleton line indices for wireframe rendering
        const indices = this.generateSkeletonIndices();
        this.indexBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indexBuffer);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);

        // Strain heat-map colors per joint
        const strains = new Float32Array(this.JOINT_COUNT);
        this.strainBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this.strainBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, strains, gl.DYNAMIC_DRAW);
    }

    private initializeShaders(): void {
        const { gl } = this;
        const vertSrc = this.getVertexShaderSource();
        const fragSrc = this.getFragmentShaderSource();

        const vertShader = this.compileShader(gl.VERTEX_SHADER, vertSrc);
        const fragShader = this.compileShader(gl.FRAGMENT_SHADER, fragSrc);

        const program = gl.createProgram()!;
        gl.attachShader(program, vertShader);
        gl.attachShader(program, fragShader);
        gl.linkProgram(program);

        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
            console.error('Shader link error:', gl.getProgramInfoLog(program));
        }

        this.program = program;
        gl.useProgram(this.program);
    }

    /**
     * Updates the skeleton geometry and strain metrics for the current frame.
     */
    public updatePose(landmarks: PoseLandmark[], metrics: StrainMetrics): void {
        const { gl } = this;
        if (!this.vertexBuffer || !this.strainBuffer) return;

        const positions = new Float32Array(this.JOINT_COUNT * 3);
        const strains = new Float32Array(this.JOINT_COUNT);

        for (let i = 0; i < this.JOINT_COUNT; i++) {
            const lm = landmarks[i] || { x: 0, y: 0, z: 0, visibility: 0 };
            positions[i * 3] = (lm.x - 0.5) * 2; // Normalize to clip space
            positions[i * 3 + 1] = -(lm.y - 0.5) * 2;
            positions[i * 3 + 2] = lm.z * 5; // Exaggerate Z for depth perception

            strains[i] = this.calculateJointStrain(i, lm, metrics);
        }

        gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, positions);

        gl.bindBuffer(gl.ARRAY_BUFFER, this.strainBuffer);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, strains);
    }

    /**
     * Executes the draw call for the current frame.
     */
    public render(): void {
        const { gl, program } = this;
        if (!program || !this.vertexBuffer || !this.indexBuffer || !this.strainBuffer) return;

        gl.clearColor(0.0, 0.0, 0.0, 0.0);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        gl.enable(gl.DEPTH_TEST);

        gl.useProgram(program);

        // Bind Positions
        const posLoc = gl.getAttribLocation(program, 'a_position');
        gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);
        gl.enableVertexAttribArray(posLoc);
        gl.vertexAttribPointer(posLoc, 3, gl.FLOAT, false, 0, 0);

        // Bind Strains
        const strainLoc = gl.getAttribLocation(program, 'a_strain');
        gl.bindBuffer(gl.ARRAY_BUFFER, this.strainBuffer);
        gl.enableVertexAttribArray(strainLoc);
        gl.vertexAttribPointer(strainLoc, 1, gl.FLOAT, false, 0, 0);

        // Draw Lines
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indexBuffer);
        const indexCount = this.generateSkeletonIndices().length;
        gl.drawElements(gl.LINES, indexCount, gl.UNSIGNED_SHORT, 0);
    }

    private calculateJointStrain(index: number, landmark: PoseLandmark, metrics: StrainMetrics): number {
        // Simplified strain mapping based on global metrics
        if (index >= 11 && index <= 12) return Math.min(metrics.shoulderAsymmetry / 45, this.MAX_STRAIN); // Shoulders
        if (index >= 23 && index <= 24) return Math.min(metrics.lumbarCurvature / 30, this.MAX_STRAIN); // Hips/Lumbar
        if (index >= 0 && index <= 10) return Math.min(metrics.neckAngle / 60, this.MAX_STRAIN); // Head/Neck
        return 0;
    }

    private generateSkeletonIndices(): Uint16Array {
        // Simplified bone connections for MediaPipe BlazePose
        const connections = [
            [11, 12], [11, 13], [13, 15], [12, 14], [14, 16], // Arms
            [11, 23], [12, 24], [23, 24], // Torso
            [23, 25], [25, 27], [24, 26], [26, 28], // Legs
            [0, 1], [1, 2], [2, 3], [3, 7], [0, 4], [4, 5], [5, 6], [6, 8] // Face/Head
        ];

        const indices = new Uint16Array(connections.length * 2);
        connections.forEach((conn, i) => {
            indices[i * 2] = conn[0];
            indices[i * 2 + 1] = conn[1];
        });

        return indices;
    }

    private compileShader(type: number, source: string): WebGLShader {
        const { gl } = this;
        const shader = gl.createShader(type)!;
        gl.shaderSource(shader, source);
        gl.compileShader(shader);

        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
            console.error('Shader compile error:', gl.getShaderInfoLog(shader));
            gl.deleteShader(shader);
            throw new Error('Shader compilation failed');
        }
        return shader;
    }

    private getVertexShaderSource(): string {
        return `#version 300 es
    in vec3 a_position;
    in float a_strain;
    out float v_strain;
    void main() {
      v_strain = a_strain;
      gl_Position = vec4(a_position, 1.0);
      gl_PointSize = 10.0;
    }`;
    }

    private getFragmentShaderSource(): string {
        return `#version 300 es
    precision mediump float;
    in float v_strain;
    out vec4 outColor;
    void main() {
      vec3 healthy = vec3(0.0, 1.0, 0.0);
      vec3 strained = vec3(1.0, 0.0, 0.0);
      vec3 color = mix(healthy, strained, v_strain);
      outColor = vec4(color, 1.0);
    }`;
    }

    public dispose(): void {
        const { gl } = this;
        if (this.vertexBuffer) gl.deleteBuffer(this.vertexBuffer);
        if (this.indexBuffer) gl.deleteBuffer(this.indexBuffer);
        if (this.strainBuffer) gl.deleteBuffer(this.strainBuffer);
        if (this.program) gl.deleteProgram(this.program);
    }
}