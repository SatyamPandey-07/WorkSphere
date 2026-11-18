/**
 * DepthOfFieldPass.ts
 * WebGL 2.0 Gaussian Blur Multi-Pass Depth-of-Field Post-Processing Pipeline.
 *
 * Implements a separable, two-pass Gaussian blur pipeline with circle-of-confusion (CoC)
 * modulation for realistic camera depth-of-field effects:
 *
 * Flow:
 * Scene Color + Scene Depth
 *    ↓
 * Horizontal Gaussian Blur Pass (dofHorizontalProgram)
 *    ↓
 * Intermediate Ping-Pong FBO (color: RGBA, alpha: CoC)
 *    ↓
 * Vertical Gaussian Blur + CoC Composite Pass (dofVerticalProgram)
 *    ↓
 * Output (Target Framebuffer or Canvas Screen)
 */

import {
  DOF_VERTEX_SHADER,
  DOF_HORIZONTAL_FRAGMENT_SHADER,
  DOF_VERTICAL_FRAGMENT_SHADER,
} from "../shaders/dofShaderSource";

export interface DepthOfFieldConfig {
  /** Camera focal length in mm or world units (e.g. 50.0). Default: 50.0 */
  focalLength?: number;
  /** Aperture diameter / size (e.g. 2.8). Default: 2.8 */
  apertureSize?: number;
  /** Distance to the focal plane in world units (e.g. 10.0). Default: 10.0 */
  focusDistance?: number;
  /** Camera near clipping plane distance. Default: 0.1 */
  nearPlane?: number;
  /** Camera far clipping plane distance. Default: 1000.0 */
  farPlane?: number;
  /** Maximum allowable Gaussian blur radius in pixels. Default: 12.0 */
  maxBlurRadius?: number;
  /** Whether the depth-of-field post-processing effect is enabled. Default: true */
  enabled?: boolean;
}

export interface FramebufferRenderTarget {
  framebuffer: WebGLFramebuffer;
  texture: WebGLTexture;
  width: number;
  height: number;
}

export class DepthOfFieldPass {
  private gl: WebGL2RenderingContext;
  private width: number;
  private height: number;

  // Pipeline configuration
  private config: Required<DepthOfFieldConfig>;

  // GPU Shader Programs
  private horizontalProgram: WebGLProgram | null = null;
  private verticalProgram: WebGLProgram | null = null;

  // Fullscreen Quad Geometry
  private quadVAO: WebGLVertexArrayObject | null = null;
  private quadVBO: WebGLBuffer | null = null;

  // Ping-pong Framebuffer Render Targets
  private intermediateTarget: FramebufferRenderTarget | null = null;

  // Program Uniform Locations
  private hUniforms: Record<string, WebGLUniformLocation | null> = {};
  private vUniforms: Record<string, WebGLUniformLocation | null> = {};

  // Operational State
  private isInitialized = false;
  private hasInitializationFailed = false;
  private isDisposed = false;

  constructor(
    gl: WebGL2RenderingContext,
    width: number,
    height: number,
    config: DepthOfFieldConfig = {},
  ) {
    if (!gl) {
      throw new Error("[DepthOfFieldPass] A valid WebGL2RenderingContext is required.");
    }
    this.gl = gl;
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);

    this.config = {
      focalLength: Math.max(0.1, config.focalLength ?? 50.0),
      apertureSize: Math.max(0.01, config.apertureSize ?? 2.8),
      focusDistance: Math.max(0.1, config.focusDistance ?? 10.0),
      nearPlane: Math.max(0.001, config.nearPlane ?? 0.1),
      farPlane: Math.max(0.1, config.farPlane ?? 1000.0),
      maxBlurRadius: Math.max(0.0, config.maxBlurRadius ?? 12.0),
      enabled: config.enabled ?? true,
    };

    this.init();
  }

  /**
   * Initializes GPU resources (shaders, quad geometry, ping-pong render targets).
   */
  public init(): boolean {
    if (this.isInitialized || this.isDisposed) {
      return this.isInitialized;
    }

    try {
      // 1. Compile and link Horizontal Gaussian Blur Shader Program
      this.horizontalProgram = this.createProgram(
        DOF_VERTEX_SHADER,
        DOF_HORIZONTAL_FRAGMENT_SHADER,
      );
      if (!this.horizontalProgram) {
        throw new Error("Failed to compile horizontal Gaussian blur shader program.");
      }
      this.cacheUniformLocations(this.horizontalProgram, "h");

      // 2. Compile and link Vertical Gaussian Blur Shader Program
      this.verticalProgram = this.createProgram(
        DOF_VERTEX_SHADER,
        DOF_VERTICAL_FRAGMENT_SHADER,
      );
      if (!this.verticalProgram) {
        throw new Error("Failed to compile vertical Gaussian blur shader program.");
      }
      this.cacheUniformLocations(this.verticalProgram, "v");

      // 3. Create Fullscreen Quad Geometry
      this.initQuad();

      // 4. Create Intermediate Ping-Pong Render Target
      this.intermediateTarget = this.createRenderTarget(this.width, this.height);
      if (!this.intermediateTarget) {
        throw new Error("Failed to allocate intermediate framebuffer render target.");
      }

      this.isInitialized = true;
      this.hasInitializationFailed = false;
      return true;
    } catch (err) {
      console.warn("[DepthOfFieldPass] Initialization failed, falling back to bypass mode:", err);
      this.hasInitializationFailed = true;
      this.cleanupPartialInit();
      return false;
    }
  }

  /**
   * Caches uniform locations for quick per-frame upload without string lookups.
   */
  private cacheUniformLocations(program: WebGLProgram, pass: "h" | "v"): void {
    const gl = this.gl;
    const target = pass === "h" ? this.hUniforms : this.vUniforms;

    target.u_resolution = gl.getUniformLocation(program, "u_resolution");
    target.u_focalLength = gl.getUniformLocation(program, "u_focalLength");
    target.u_apertureSize = gl.getUniformLocation(program, "u_apertureSize");
    target.u_focusDistance = gl.getUniformLocation(program, "u_focusDistance");
    target.u_nearPlane = gl.getUniformLocation(program, "u_nearPlane");
    target.u_farPlane = gl.getUniformLocation(program, "u_farPlane");
    target.u_maxBlurRadius = gl.getUniformLocation(program, "u_maxBlurRadius");
    target.u_hasDepthTexture = gl.getUniformLocation(program, "u_hasDepthTexture");

    if (pass === "h") {
      target.u_colorTexture = gl.getUniformLocation(program, "u_colorTexture");
      target.u_depthTexture = gl.getUniformLocation(program, "u_depthTexture");
    } else {
      target.u_intermediateTexture = gl.getUniformLocation(program, "u_intermediateTexture");
      target.u_colorTexture = gl.getUniformLocation(program, "u_colorTexture");
      target.u_depthTexture = gl.getUniformLocation(program, "u_depthTexture");
    }
  }

  /**
   * Compiles GLSL shaders and links a WebGLProgram with full diagnostic error handling.
   */
  private createProgram(vertSrc: string, fragSrc: string): WebGLProgram | null {
    const gl = this.gl;

    const vertShader = this.compileShader(gl.VERTEX_SHADER, vertSrc);
    if (!vertShader) return null;

    const fragShader = this.compileShader(gl.FRAGMENT_SHADER, fragSrc);
    if (!fragShader) {
      gl.deleteShader(vertShader);
      return null;
    }

    const program = gl.createProgram();
    if (!program) {
      gl.deleteShader(vertShader);
      gl.deleteShader(fragShader);
      return null;
    }

    gl.attachShader(program, vertShader);
    gl.attachShader(program, fragShader);
    gl.linkProgram(program);

    // Flag shaders for deletion once program is linked/deleted
    gl.deleteShader(vertShader);
    gl.deleteShader(fragShader);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error(
        "[DepthOfFieldPass] Program link failed:",
        gl.getProgramInfoLog(program),
      );
      gl.deleteProgram(program);
      return null;
    }

    return program;
  }

  /**
   * Compiles a single shader stage with diagnostic log capture.
   */
  private compileShader(type: number, src: string): WebGLShader | null {
    const gl = this.gl;
    const shader = gl.createShader(type);
    if (!shader) return null;

    gl.shaderSource(shader, src);
    gl.compileShader(shader);

    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      console.error(
        `[DepthOfFieldPass] ${type === gl.VERTEX_SHADER ? "Vertex" : "Fragment"} shader compilation failed:`,
        gl.getShaderInfoLog(shader),
      );
      gl.deleteShader(shader);
      return null;
    }

    return shader;
  }

  /**
   * Sets up fullscreen quad buffer and VAO.
   */
  private initQuad(): void {
    const gl = this.gl;

    // Fullscreen quad [-1, -1] to [1, 1] (two triangles)
    const quadVertices = new Float32Array([
      -1.0, -1.0,
       1.0, -1.0,
      -1.0,  1.0,
      -1.0,  1.0,
       1.0, -1.0,
       1.0,  1.0,
    ]);

    this.quadVAO = gl.createVertexArray();
    this.quadVBO = gl.createBuffer();

    gl.bindVertexArray(this.quadVAO);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadVBO);
    gl.bufferData(gl.ARRAY_BUFFER, quadVertices, gl.STATIC_DRAW);

    // Attribute location 0 for position
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    gl.bindVertexArray(null);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
  }

  /**
   * Allocates an RGBA8 render target texture and attaches it to an FBO with completeness validation.
   */
  private createRenderTarget(width: number, height: number): FramebufferRenderTarget | null {
    const gl = this.gl;

    const texture = gl.createTexture();
    if (!texture) return null;

    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA8,
      width,
      height,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      null,
    );

    // Clamped coordinates to prevent edge convolution artifacts
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    const framebuffer = gl.createFramebuffer();
    if (!framebuffer) {
      gl.deleteTexture(texture);
      return null;
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(
      gl.FRAMEBUFFER,
      gl.COLOR_ATTACHMENT0,
      gl.TEXTURE_2D,
      texture,
      0,
    );

    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindTexture(gl.TEXTURE_2D, null);

    if (status !== gl.FRAMEBUFFER_COMPLETE) {
      console.warn(`[DepthOfFieldPass] Framebuffer incomplete (status: 0x${status.toString(16)})`);
      gl.deleteTexture(texture);
      gl.deleteFramebuffer(framebuffer);
      return null;
    }

    return { framebuffer, texture, width, height };
  }

  /**
   * Updates viewport and render-target dimensions.
   */
  public resize(width: number, height: number): void {
    if (this.isDisposed) return;
    const w = Math.max(1, Math.round(width));
    const h = Math.max(1, Math.round(height));

    if (this.width === w && this.height === h) {
      return;
    }

    this.width = w;
    this.height = h;

    if (this.intermediateTarget) {
      this.disposeRenderTarget(this.intermediateTarget);
      this.intermediateTarget = this.createRenderTarget(this.width, this.height);
    }
  }

  /**
   * Main Post-Processing Render Pipeline.
   *
   * @param inputColorTexture Scene color texture from 3D render pass.
   * @param inputDepthTexture Scene depth texture from 3D render pass (or null if unavailable).
   * @param targetFramebuffer Destination framebuffer (null for default canvas backbuffer).
   */
  public render(
    inputColorTexture: WebGLTexture,
    inputDepthTexture: WebGLTexture | null,
    targetFramebuffer: WebGLFramebuffer | null = null,
  ): boolean {
    if (this.isDisposed || !inputColorTexture) {
      return false;
    }

    const gl = this.gl;

    // Graceful fallback: If DoF disabled or shader compilation failed, bypass processing
    if (
      !this.config.enabled ||
      this.hasInitializationFailed ||
      !this.horizontalProgram ||
      !this.verticalProgram ||
      !this.intermediateTarget ||
      !this.quadVAO
    ) {
      return this.renderBypass(inputColorTexture, targetFramebuffer);
    }

    // Preserve previous WebGL states
    const prevFramebuffer = gl.getParameter(gl.FRAMEBUFFER_BINDING) as WebGLFramebuffer | null;
    const prevViewport = gl.getParameter(gl.VIEWPORT) as Int32Array;
    const prevProgram = gl.getParameter(gl.CURRENT_PROGRAM) as WebGLProgram | null;
    const prevVAO = gl.getParameter(gl.VERTEX_ARRAY_BINDING) as WebGLVertexArrayObject | null;
    const prevActiveTexture = gl.getParameter(gl.ACTIVE_TEXTURE) as number;

    const hasDepth = inputDepthTexture !== null;

    try {
      // -------------------------------------------------------------
      // Pass 1: Horizontal Gaussian Blur -> Intermediate FBO
      // -------------------------------------------------------------
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.intermediateTarget.framebuffer);
      gl.viewport(0, 0, this.width, this.height);

      gl.useProgram(this.horizontalProgram);
      this.uploadPassUniforms("h", hasDepth);

      // Bind input color texture to unit 0
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, inputColorTexture);
      if (this.hUniforms.u_colorTexture) {
        gl.uniform1i(this.hUniforms.u_colorTexture, 0);
      }

      // Bind input depth texture to unit 1 (if present)
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, inputDepthTexture);
      if (this.hUniforms.u_depthTexture) {
        gl.uniform1i(this.hUniforms.u_depthTexture, 1);
      }

      gl.bindVertexArray(this.quadVAO);
      gl.drawArrays(gl.TRIANGLES, 0, 6);

      // -------------------------------------------------------------
      // Pass 2: Vertical Gaussian Blur + CoC Modulation -> Target FBO
      // -------------------------------------------------------------
      gl.bindFramebuffer(gl.FRAMEBUFFER, targetFramebuffer);
      gl.viewport(0, 0, this.width, this.height);

      gl.useProgram(this.verticalProgram);
      this.uploadPassUniforms("v", hasDepth);

      // Unit 0: Pass 1 output (intermediate texture)
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.intermediateTarget.texture);
      if (this.vUniforms.u_intermediateTexture) {
        gl.uniform1i(this.vUniforms.u_intermediateTexture, 0);
      }

      // Unit 1: Original sharp color texture
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, inputColorTexture);
      if (this.vUniforms.u_colorTexture) {
        gl.uniform1i(this.vUniforms.u_colorTexture, 1);
      }

      // Unit 2: Original depth texture
      gl.activeTexture(gl.TEXTURE2);
      gl.bindTexture(gl.TEXTURE_2D, inputDepthTexture);
      if (this.vUniforms.u_depthTexture) {
        gl.uniform1i(this.vUniforms.u_depthTexture, 2);
      }

      gl.bindVertexArray(this.quadVAO);
      gl.drawArrays(gl.TRIANGLES, 0, 6);

      return true;
    } catch (err) {
      console.warn("[DepthOfFieldPass] Error during render pass:", err);
      return false;
    } finally {
      // Restore WebGL state
      gl.activeTexture(gl.TEXTURE2);
      gl.bindTexture(gl.TEXTURE_2D, null);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, null);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, null);

      gl.activeTexture(prevActiveTexture);
      gl.bindVertexArray(prevVAO);
      gl.useProgram(prevProgram);
      gl.bindFramebuffer(gl.FRAMEBUFFER, prevFramebuffer);
      if (prevViewport) {
        gl.viewport(prevViewport[0], prevViewport[1], prevViewport[2], prevViewport[3]);
      }
    }
  }

  /**
   * Fallback: Renders untouched scene color directly to the destination target.
   */
  private renderBypass(
    colorTexture: WebGLTexture,
    targetFramebuffer: WebGLFramebuffer | null,
  ): boolean {
    const gl = this.gl;
    if (!this.quadVAO || !this.horizontalProgram) {
      return false;
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, targetFramebuffer);
    gl.viewport(0, 0, this.width, this.height);

    gl.useProgram(this.horizontalProgram);
    if (this.hUniforms.u_hasDepthTexture) {
      gl.uniform1i(this.hUniforms.u_hasDepthTexture, 0); // triggers passthrough
    }

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, colorTexture);
    if (this.hUniforms.u_colorTexture) {
      gl.uniform1i(this.hUniforms.u_colorTexture, 0);
    }

    gl.bindVertexArray(this.quadVAO);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.bindVertexArray(null);

    return true;
  }

  /**
   * Uploads active camera and lens uniforms without recompiling shaders.
   */
  private uploadPassUniforms(pass: "h" | "v", hasDepth: boolean): void {
    const gl = this.gl;
    const u = pass === "h" ? this.hUniforms : this.vUniforms;

    if (u.u_resolution) {
      gl.uniform2f(u.u_resolution, this.width, this.height);
    }
    if (u.u_focalLength) {
      gl.uniform1f(u.u_focalLength, this.config.focalLength);
    }
    if (u.u_apertureSize) {
      gl.uniform1f(u.u_apertureSize, this.config.apertureSize);
    }
    if (u.u_focusDistance) {
      gl.uniform1f(u.u_focusDistance, this.config.focusDistance);
    }
    if (u.u_nearPlane) {
      gl.uniform1f(u.u_nearPlane, this.config.nearPlane);
    }
    if (u.u_farPlane) {
      gl.uniform1f(u.u_farPlane, this.config.farPlane);
    }
    if (u.u_maxBlurRadius) {
      gl.uniform1f(u.u_maxBlurRadius, this.config.maxBlurRadius);
    }
    if (u.u_hasDepthTexture) {
      gl.uniform1i(u.u_hasDepthTexture, hasDepth ? 1 : 0);
    }
  }

  // --- Dynamic Configuration & Camera Control API ---

  public setFocusDistance(distance: number): void {
    this.config.focusDistance = Math.max(0.01, Number.isFinite(distance) ? distance : 10.0);
  }

  public getFocusDistance(): number {
    return this.config.focusDistance;
  }

  public setFocalLength(length: number): void {
    this.config.focalLength = Math.max(0.1, Number.isFinite(length) ? length : 50.0);
  }

  public getFocalLength(): number {
    return this.config.focalLength;
  }

  public setApertureSize(size: number): void {
    this.config.apertureSize = Math.max(0.001, Number.isFinite(size) ? size : 2.8);
  }

  public getApertureSize(): number {
    return this.config.apertureSize;
  }

  public setCameraPlanes(near: number, far: number): void {
    this.config.nearPlane = Math.max(0.001, near);
    this.config.farPlane = Math.max(this.config.nearPlane + 0.1, far);
  }

  public setMaxBlurRadius(radius: number): void {
    this.config.maxBlurRadius = Math.max(0.0, Number.isFinite(radius) ? radius : 12.0);
  }

  public getMaxBlurRadius(): number {
    return this.config.maxBlurRadius;
  }

  public setEnabled(enabled: boolean): void {
    this.config.enabled = Boolean(enabled);
  }

  public isEnabled(): boolean {
    return this.config.enabled && !this.hasInitializationFailed && !this.isDisposed;
  }

  public getConfig(): Readonly<Required<DepthOfFieldConfig>> {
    return this.config;
  }

  public getIntermediateRenderTarget(): Readonly<FramebufferRenderTarget> | null {
    return this.intermediateTarget;
  }

  /**
   * Cleans up partial resources allocated during failed initialization.
   */
  private cleanupPartialInit(): void {
    const gl = this.gl;
    if (this.horizontalProgram) {
      gl.deleteProgram(this.horizontalProgram);
      this.horizontalProgram = null;
    }
    if (this.verticalProgram) {
      gl.deleteProgram(this.verticalProgram);
      this.verticalProgram = null;
    }
    if (this.quadVBO) {
      gl.deleteBuffer(this.quadVBO);
      this.quadVBO = null;
    }
    if (this.quadVAO) {
      gl.deleteVertexArray(this.quadVAO);
      this.quadVAO = null;
    }
    if (this.intermediateTarget) {
      this.disposeRenderTarget(this.intermediateTarget);
      this.intermediateTarget = null;
    }
  }

  private disposeRenderTarget(target: FramebufferRenderTarget): void {
    const gl = this.gl;
    gl.deleteTexture(target.texture);
    gl.deleteFramebuffer(target.framebuffer);
  }

  /**
   * Disposes all owned GPU resources (FBOs, textures, programs, buffers).
   */
  public dispose(): void {
    if (this.isDisposed) return;
    this.isDisposed = true;
    this.isInitialized = false;

    this.cleanupPartialInit();
  }
}
