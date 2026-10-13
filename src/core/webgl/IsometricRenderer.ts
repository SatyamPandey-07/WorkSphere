/**
 * IsometricRenderer.ts
 * The core WebGL context manager, texture atlas loader, and instanced rendering pipeline for desks and chairs.
 * Handles the compilation of shaders, instanced attribute buffering, hover highlight outline shaders for occupied desks,
 * and the rendering loop for the 3D isometric environment.
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

export interface OutlineHighlightConfig {
    occupiedColor?: [number, number, number, number]; // [r, g, b, a]
    availableColor?: [number, number, number, number]; // [r, g, b, a]
    outlineWidth?: number; // UV space width, e.g. 0.08
}

export class IsometricRenderer {
    private gl: WebGL2RenderingContext | null = null;
    private program: WebGLProgram | null = null;
    private vao: WebGLVertexArrayObject | null = null;
    private texture: WebGLTexture | null = null;

    private instanceBuffer: WebGLBuffer | null = null;
    private instances: DeskInstance[] = [];
    private hoveredDeskId: string | null = null;

    // Uniform locations
    private uProjectionLocation: WebGLUniformLocation | null = null;
    private uViewLocation: WebGLUniformLocation | null = null;
    private uModelLocation: WebGLUniformLocation | null = null;
    private uTimeLocation: WebGLUniformLocation | null = null;
    private uSunDirectionLocation: WebGLUniformLocation | null = null;
    private uSunColorLocation: WebGLUniformLocation | null = null;
    private uAmbientColorLocation: WebGLUniformLocation | null = null;
    private uHoveredInstanceIdLocation: WebGLUniformLocation | null = null;
    private uOccupiedOutlineColorLocation: WebGLUniformLocation | null = null;
    private uAvailableOutlineColorLocation: WebGLUniformLocation | null = null;
    private uOutlineWidthLocation: WebGLUniformLocation | null = null;

    // Highlight styling state
    private occupiedOutlineColor: Float32Array = new Float32Array([1.0, 0.35, 0.1, 0.95]); // Warm Amber/Orange
    private availableOutlineColor: Float32Array = new Float32Array([0.1, 0.8, 0.4, 0.85]); // Emerald Green
    private outlineWidth: number = 0.08;

    private modelMatrix: Float32Array = new Float32Array([
        1, 0, 0, 0,
        0, 1, 0, 0,
        0, 0, 1, 0,
        0, 0, 0, 1
    ]);

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
        this.uSunColorLocation = gl.getUniformLocation(this.program, 'u_sun_color');
        this.uAmbientColorLocation = gl.getUniformLocation(this.program, 'u_ambient_color');
        this.uHoveredInstanceIdLocation = gl.getUniformLocation(this.program, 'u_hovered_instance_id');
        this.uOccupiedOutlineColorLocation = gl.getUniformLocation(this.program, 'u_occupied_outline_color');
        this.uAvailableOutlineColorLocation = gl.getUniformLocation(this.program, 'u_available_outline_color');
        this.uOutlineWidthLocation = gl.getUniformLocation(this.program, 'u_outline_width');
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

        // Desk quad geometry (a_position: vec3, a_uv: vec2)
        const vertices = new Float32Array([
            -0.5, 0.0, -0.5, 0.0, 0.0,
            0.5, 0.0, -0.5, 1.0, 0.0,
            -0.5, 0.0, 0.5, 0.0, 1.0,
            0.5, 0.0, 0.5, 1.0, 1.0
        ]);

        const vbo = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
        gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);

        // a_position (location 0)
        gl.enableVertexAttribArray(0);
        gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 5 * 4, 0);

        // a_uv (location 1)
        gl.enableVertexAttribArray(1);
        gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 5 * 4, 3 * 4);

        // Instance buffer (a_instance_id: float, a_instance_pos_rot: vec4, a_is_available: float)
        this.instanceBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer);

        const stride = 6 * 4; // 6 floats per instance = 24 bytes

        // a_instance_id (location 2)
        gl.enableVertexAttribArray(2);
        gl.vertexAttribPointer(2, 1, gl.FLOAT, false, stride, 0);
        gl.vertexAttribDivisor(2, 1);

        // a_instance_pos_rot (location 3: x, y, z, rotation)
        gl.enableVertexAttribArray(3);
        gl.vertexAttribPointer(3, 4, gl.FLOAT, false, stride, 1 * 4);
        gl.vertexAttribDivisor(3, 1);

        // a_is_available (location 4: 1.0 for available, 0.0 for occupied)
        gl.enableVertexAttribArray(4);
        gl.vertexAttribPointer(4, 1, gl.FLOAT, false, stride, 5 * 4);
        gl.vertexAttribDivisor(4, 1);
    }

    private initTexture(): void {
        if (!this.gl) return;
        this.texture = this.gl.createTexture();
        this.gl.bindTexture(this.gl.TEXTURE_2D, this.texture);
        // Mock 1x1 pixel texture for scaffold
        this.gl.texImage2D(
            this.gl.TEXTURE_2D,
            0,
            this.gl.RGBA,
            1,
            1,
            0,
            this.gl.RGBA,
            this.gl.UNSIGNED_BYTE,
            new Uint8Array([255, 255, 255, 255])
        );
    }

    public updateInstances(newInstances: DeskInstance[]): void {
        this.instances = newInstances;
        this.updateInstanceBuffer();
    }

    private updateInstanceBuffer(): void {
        if (!this.gl || !this.instanceBuffer) return;
        const gl = this.gl;

        // Flatten instance data: [instanceIndex, x, y, z, rotation, isAvailable] (6 floats per instance)
        const data = new Float32Array(this.instances.length * 6);
        for (let i = 0; i < this.instances.length; i++) {
            const inst = this.instances[i];
            const offset = i * 6;
            data[offset] = i;
            data[offset + 1] = inst.x;
            data[offset + 2] = inst.y;
            data[offset + 3] = inst.z;
            data[offset + 4] = inst.rotation;
            data[offset + 5] = inst.isAvailable ? 1.0 : 0.0;
        }

        gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
    }

    /**
     * Sets the actively hovered desk ID for shader outline highlighting.
     */
    public setHoveredDesk(id: string | null): void {
        this.hoveredDeskId = id;
    }

    /**
     * Alias for setHoveredDesk.
     */
    public setHoveredDeskId(id: string | null): void {
        this.setHoveredDesk(id);
    }

    public getHoveredDesk(): string | null {
        return this.hoveredDeskId;
    }

    /**
     * Configures the hover highlight outline colors and stroke width.
     */
    public setOutlineConfig(config: OutlineHighlightConfig): void {
        if (config.occupiedColor) {
            this.occupiedOutlineColor = new Float32Array(config.occupiedColor);
        }
        if (config.availableColor) {
            this.availableOutlineColor = new Float32Array(config.availableColor);
        }
        if (config.outlineWidth !== undefined) {
            this.outlineWidth = Math.max(0.001, config.outlineWidth);
        }
    }

    public render(projectionMatrix: Float32Array, viewMatrix: Float32Array): void {
        if (!this.gl || !this.program || !this.vao) return;
        const gl = this.gl;

        gl.clearColor(0.95, 0.95, 0.98, 1.0);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        gl.enable(gl.DEPTH_TEST);
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

        gl.useProgram(this.program);
        gl.bindVertexArray(this.vao);

        gl.uniformMatrix4fv(this.uProjectionLocation, false, projectionMatrix);
        gl.uniformMatrix4fv(this.uViewLocation, false, viewMatrix);
        gl.uniformMatrix4fv(this.uModelLocation, false, this.modelMatrix);
        gl.uniform1f(this.uTimeLocation, performance.now() / 1000);
        gl.uniform3f(this.uSunDirectionLocation, 0.5, -1.0, 0.3);
        gl.uniform3f(this.uSunColorLocation, 1.0, 0.98, 0.9);
        gl.uniform3f(this.uAmbientColorLocation, 0.35, 0.38, 0.45);

        // Find numeric index of hovered desk
        const hoveredIdx = this.hoveredDeskId
            ? this.instances.findIndex(inst => inst.id === this.hoveredDeskId)
            : -1.0;

        gl.uniform1f(this.uHoveredInstanceIdLocation, hoveredIdx >= 0 ? hoveredIdx : -1.0);
        gl.uniform4fv(this.uOccupiedOutlineColorLocation, this.occupiedOutlineColor);
        gl.uniform4fv(this.uAvailableOutlineColorLocation, this.availableOutlineColor);
        gl.uniform1f(this.uOutlineWidthLocation, this.outlineWidth);

        // Instanced draw call for all desk meshes
        if (this.instances.length > 0) {
            gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, this.instances.length);
        } else {
            gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
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
