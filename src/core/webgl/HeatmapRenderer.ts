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

export type HeatmapPaletteMode = 'thermal' | 'neon' | 'grayscale';

export class HeatmapRenderer {
    private canvas: HTMLCanvasElement;
    private gl: WebGLRenderingContext | null = null;
    private program: WebGLProgram | null = null;
    private positionBuffer: WebGLBuffer | null = null;
    private valueBuffer: WebGLBuffer | null = null;
    private isContextLost: boolean = false;
    private currentPalette: HeatmapPaletteMode = 'thermal';

    // Floorplan texture and framebuffer pooling to prevent GPU memory leak on rapid floor changes
    private currentFloorId: string | null = null;
    private floorTextures: Map<string, WebGLTexture> = new Map();
    private floorFramebuffers: Map<string, WebGLFramebuffer> = new Map();
    private texturePool: WebGLTexture[] = [];
    private framebufferPool: WebGLFramebuffer[] = [];
    private maxPoolSize: number = 8;

    private uProjectionMatrixLocation: WebGLUniformLocation | null = null;
    private uMapBoundsMinLocation: WebGLUniformLocation | null = null;
    private uMapBoundsMaxLocation: WebGLUniformLocation | null = null;
    private uMaxValueLocation: WebGLUniformLocation | null = null;
    private uAlphaLocation: WebGLUniformLocation | null = null;
    private uPaletteModeLocation: WebGLUniformLocation | null = null;

    private aPositionLocation: number = 0;
    private aValueLocation: number = 0;

    // Event listener references for cleanup
    private handleContextLostBound: (e: Event) => void;
    private handleContextRestoredBound: (e: Event) => void;

    constructor(canvas: HTMLCanvasElement, initialPalette: HeatmapPaletteMode = 'thermal') {
        this.canvas = canvas;
        this.currentPalette = initialPalette;
        this.handleContextLostBound = this.handleContextLost.bind(this);
        this.handleContextRestoredBound = this.handleContextRestored.bind(this);

        this.canvas.addEventListener('webglcontextlost', this.handleContextLostBound, false);
        this.canvas.addEventListener('webglcontextrestored', this.handleContextRestoredBound, false);

        this.initGL();
    }

    private initGL(): void {
        this.gl = this.canvas.getContext('webgl', { alpha: true, antialias: true });
        if (!this.gl) {
            throw new Error('WebGL not supported');
        }
        this.initShaders();
        this.initBuffers();
    }

    private handleContextLost(event: Event): void {
        event.preventDefault(); // Required by WebGL specification to allow restoration
        this.isContextLost = true;

        // Drop invalid GPU handles from previous context
        this.program = null;
        this.positionBuffer = null;
        this.valueBuffer = null;
        this.floorTextures.clear();
        this.floorFramebuffers.clear();
        this.texturePool = [];
        this.framebufferPool = [];
    }

    private handleContextRestored(): void {
        this.isContextLost = false;
        try {
            this.initGL();
        } catch (err) {
            console.error('Failed to rebuild WebGL context on context restore:', err);
        }
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
        this.uPaletteModeLocation = this.gl.getUniformLocation(this.program, 'u_paletteMode');

        // Get attribute locations
        this.aPositionLocation = this.gl.getAttribLocation(this.program, 'a_position');
        this.aValueLocation = this.gl.getAttribLocation(this.program, 'a_value');

        // Apply initial palette uniform immediately
        this.applyPaletteUniform(this.currentPalette);
    }

    private getPaletteModeIndex(palette: HeatmapPaletteMode): number {
        switch (palette) {
            case 'neon':
                return 1;
            case 'grayscale':
                return 2;
            case 'thermal':
            default:
                return 0;
        }
    }

    private applyPaletteUniform(palette: HeatmapPaletteMode): void {
        if (!this.gl || !this.program || !this.uPaletteModeLocation) return;
        this.gl.useProgram(this.program);
        this.gl.uniform1i(this.uPaletteModeLocation, this.getPaletteModeIndex(palette));
    }

    /**
     * Dynamically switches the heatmap color palette uniform without rebuilding the WebGL context.
     * Supported themes:
     * - 'thermal': Red-Yellow-Blue standard thermal palette
     * - 'neon': Cyber Neon Cyan-Magenta-Yellow high-energy palette
     * - 'grayscale': Accessible high-contrast grayscale palette compliant with WCAG
     */
    public setPalette(palette: HeatmapPaletteMode): void {
        this.currentPalette = palette;
        this.applyPaletteUniform(palette);
    }

    /**
     * Gets the currently active color palette theme.
     */
    public getPalette(): HeatmapPaletteMode {
        return this.currentPalette;
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
        if (this.isContextLost || !this.gl || !this.program || !this.positionBuffer || !this.valueBuffer) return;

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
        if (this.uPaletteModeLocation) {
            this.gl.uniform1i(this.uPaletteModeLocation, this.getPaletteModeIndex(this.currentPalette));
        }

        // Draw
        this.gl.drawArrays(this.gl.POINTS, 0, dataPoints.length);
    }

    /**
     * Acquires a WebGLTexture from the pool or creates a new one.
     */
    public acquireTexture(): WebGLTexture | null {
        if (!this.gl) return null;
        if (this.texturePool.length > 0) {
            return this.texturePool.pop()!;
        }
        return this.gl.createTexture();
    }

    /**
     * Returns a texture to the pool for reuse, or deletes it if pool is full.
     */
    public releaseTexture(texture: WebGLTexture | null): void {
        if (!this.gl || !texture) return;
        if (this.texturePool.length < this.maxPoolSize) {
            this.texturePool.push(texture);
        } else {
            this.gl.deleteTexture(texture);
        }
    }

    /**
     * Acquires a WebGLFramebuffer from the pool or creates a new one.
     */
    public acquireFramebuffer(): WebGLFramebuffer | null {
        if (!this.gl) return null;
        if (this.framebufferPool.length > 0) {
            return this.framebufferPool.pop()!;
        }
        return this.gl.createFramebuffer();
    }

    /**
     * Returns a framebuffer to the pool for reuse, or deletes it if pool is full.
     */
    public releaseFramebuffer(framebuffer: WebGLFramebuffer | null): void {
        if (!this.gl || !framebuffer) return;
        if (this.framebufferPool.length < this.maxPoolSize) {
            this.framebufferPool.push(framebuffer);
        } else {
            this.gl.deleteFramebuffer(framebuffer);
        }
    }

    /**
     * Sets or switches the active floor plan texture with pooling and resource disposal.
     */
    public setFloorPlan(
        floorId: string,
        imageSource?: TexImageSource | HTMLImageElement | HTMLCanvasElement
    ): WebGLTexture | null {
        if (!this.gl) return null;

        // If switching from an existing floor, handle transition
        if (this.currentFloorId && this.currentFloorId !== floorId) {
            const oldFb = this.floorFramebuffers.get(this.currentFloorId);
            if (oldFb) {
                this.releaseFramebuffer(oldFb);
                this.floorFramebuffers.delete(this.currentFloorId);
            }
        }

        this.currentFloorId = floorId;

        // Check if a texture already exists for this floor
        let texture = this.floorTextures.get(floorId);
        if (!texture) {
            texture = this.acquireTexture() || undefined;
            if (texture) {
                this.floorTextures.set(floorId, texture);
            }
        }

        if (texture && imageSource) {
            this.gl.bindTexture(this.gl.TEXTURE_2D, texture);
            this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_S, this.gl.CLAMP_TO_EDGE);
            this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_T, this.gl.CLAMP_TO_EDGE);
            this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MIN_FILTER, this.gl.LINEAR);
            this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MAG_FILTER, this.gl.LINEAR);
            this.gl.texImage2D(
                this.gl.TEXTURE_2D,
                0,
                this.gl.RGBA,
                this.gl.RGBA,
                this.gl.UNSIGNED_BYTE,
                imageSource as TexImageSource
            );
        }

        return texture || null;
    }

    /**
     * Explicitly disposes of a floor plan texture and framebuffer when floor is unloaded.
     */
    public disposeFloorPlan(floorId: string): void {
        if (!this.gl) return;

        const texture = this.floorTextures.get(floorId);
        if (texture) {
            this.gl.deleteTexture(texture);
            this.floorTextures.delete(floorId);
        }

        const framebuffer = this.floorFramebuffers.get(floorId);
        if (framebuffer) {
            this.gl.deleteFramebuffer(framebuffer);
            this.floorFramebuffers.delete(floorId);
        }

        if (this.currentFloorId === floorId) {
            this.currentFloorId = null;
        }
    }

    /**
     * Clears all floor plan textures and framebuffers, draining the pools.
     */
    public clearFloorPlans(): void {
        if (!this.gl) return;

        // Delete active floor textures
        for (const texture of this.floorTextures.values()) {
            this.gl.deleteTexture(texture);
        }
        this.floorTextures.clear();

        // Delete active floor framebuffers
        for (const fb of this.floorFramebuffers.values()) {
            this.gl.deleteFramebuffer(fb);
        }
        this.floorFramebuffers.clear();

        // Drain texture pool
        for (const texture of this.texturePool) {
            this.gl.deleteTexture(texture);
        }
        this.texturePool = [];

        // Drain framebuffer pool
        for (const fb of this.framebufferPool) {
            this.gl.deleteFramebuffer(fb);
        }
        this.framebufferPool = [];

        this.currentFloorId = null;
    }

    public resize(width: number, height: number): void {
        if (!this.gl) return;
        this.gl.viewport(0, 0, width, height);
    }

    public destroy(): void {
        this.canvas.removeEventListener('webglcontextlost', this.handleContextLostBound);
        this.canvas.removeEventListener('webglcontextrestored', this.handleContextRestoredBound);

        this.clearFloorPlans();

        if (this.gl) {
            if (this.positionBuffer) {
                this.gl.deleteBuffer(this.positionBuffer);
                this.positionBuffer = null;
            }
            if (this.valueBuffer) {
                this.gl.deleteBuffer(this.valueBuffer);
                this.valueBuffer = null;
            }
            if (this.program) {
                this.gl.deleteProgram(this.program);
                this.program = null;
            }
        }
    }
}
