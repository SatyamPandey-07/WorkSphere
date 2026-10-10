/**
 * IsometricRenderer.ts
 * The core WebGL context manager, texture atlas loader, and instanced rendering pipeline for desks and chairs.
 * Handles the compilation of shaders and the rendering loop for the 3D isometric environment.
 */

import vertexShaderSource from '@/shaders/isometric/desk.vert?raw';
import fragmentShaderSource from '@/shaders/isometric/desk.frag?raw';

export interface DeskInstance {
    id: string;
    x: number;
    y: number;
    z: number;
    rotation: number;
    isAvailable: boolean;
}

export class IsometricRenderer {
    private gl: WebGL2RenderingContext | null = null;
    private program: WebGLProgram | null = null;
    private vao: WebGLVertexArrayObject | null = null;
    private texture: WebGLTexture | null = null;

    private instanceBuffer: WebGLBuffer | null = null;
    private instances: DeskInstance[] = [];

    private uProjectionLocation: WebGLUniformLocation | null = null;
    private uViewLocation: WebGLUniformLocation | null = null;
    private uModelLocation: WebGLUniformLocation | null = null;
    private uTimeLocation: WebGLUniformLocation | null = null;
    private uSunDirectionLocation: WebGLUniformLocation | null = null;

    constructor(canvas: HTMLCanvasElement) {
        this.gl = canvas.getContext('webgl2', { alpha: true, antialias: true });
        if (!this.gl) {
            throw new Error('WebGL2 not supported');
        }
        this.initShaders();
        this.initGeometry();
        this.initTexture();
    }

    private initShaders(): void {
        if (!this.gl) return;
        const gl = this.gl;

        const vs = this.compileShader(gl.VERTEX_SHADER, vertexShaderSource);
        const fs = this.compileShader(gl.FRAGMENT_SHADER, fragmentShaderSource);

        this.program = gl.createProgram();
        if (!this.program) throw new Error('Failed to create WebGL program');

        gl.attachShader(this.program, vs);
        gl.attachShader(this.program, fs);
        gl.linkProgram(this.program);

        if (!gl.getProgramParameter(this.program, gl.LINK_STATUS)) {
            throw new Error('Program link failed: ' + gl.getProgramInfoLog(this.program));
        }

        gl.useProgram(this.program);

        this.uProjectionLocation = gl.getUniformLocation(this.program, 'u_projection');
        this.uViewLocation = gl.getUniformLocation(this.program, 'u_view');
        this.uModelLocation = gl.getUniformLocation(this.program, 'u_model');
        this.uTimeLocation = gl.getUniformLocation(this.program, 'u_time');
        this.uSunDirectionLocation = gl.getUniformLocation(this.program, 'u_sun_direction');
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

    private initGeometry(): void {
        if (!this.gl || !this.program) return;
        const gl = this.gl;

        // Create VAO
        this.vao = gl.createVertexArray();
        gl.bindVertexArray(this.vao);

        // Mock desk geometry (simple quad for scaffold)
        const vertices = new Float32Array([
            -0.5, 0.0, -0.5, 0.0, 0.0,
            0.5, 0.0, -0.5, 1.0, 0.0,
            -0.5, 0.0, 0.5, 0.0, 1.0,
            0.5, 0.0, 0.5, 1.0, 1.0
        ]);

        const vbo = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
        gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);

        gl.enableVertexAttribArray(0);
        gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 5 * 4, 0);
        gl.enableVertexAttribArray(1);
        gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 5 * 4, 3 * 4);

        // Instance buffer
        this.instanceBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer);
        // Will be updated dynamically
    }

    private initTexture(): void {
        if (!this.gl) return;
        this.texture = this.gl.createTexture();
        this.gl.bindTexture(this.gl.TEXTURE_2D, this.texture);
        // Mock 1x1 pixel texture for scaffold
        this.gl.texImage2D(this.gl.TEXTURE_2D, 0, this.gl.RGBA, 1, 1, 0, this.gl.RGBA, this.gl.UNSIGNED_BYTE, new Uint8Array([255, 255, 255, 255]));
    }

    public updateInstances(newInstances: DeskInstance[]): void {
        this.instances = newInstances;
        this.updateInstanceBuffer();
    }

    private updateInstanceBuffer(): void {
        if (!this.gl || !this.instanceBuffer) return;
        const gl = this.gl;

        // Flatten instance data: x, y, z, rotation, isAvailable (as float 0.0 or 1.0)
        const data = new Float32Array(this.instances.length * 5);
        for (let i = 0; i < this.instances.length; i++) {
            const inst = this.instances[i];
            data[i * 5] = inst.x;
            data[i * 5 + 1] = inst.y;
            data[i * 5 + 2] = inst.z;
            data[i * 5 + 3] = inst.rotation;
            data[i * 5 + 4] = inst.isAvailable ? 1.0 : 0.0;
        }

        gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
    }

    public render(projectionMatrix: Float32Array, viewMatrix: Float32Array): void {
        if (!this.gl || !this.program || !this.vao) return;
        const gl = this.gl;

        gl.clearColor(0.95, 0.95, 0.98, 1.0);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        gl.enable(gl.DEPTH_TEST);

        gl.useProgram(this.program);
        gl.bindVertexArray(this.vao);

        gl.uniformMatrix4fv(this.uProjectionLocation, false, projectionMatrix);
        gl.uniformMatrix4fv(this.uViewLocation, false, viewMatrix);
        gl.uniform1f(this.uTimeLocation, performance.now() / 1000);
        gl.uniform3f(this.uSunDirectionLocation, 0.5, -1.0, 0.3);

        // Mock instanced draw call
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
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
