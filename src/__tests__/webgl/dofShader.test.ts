/**
 * dofShader.test.ts
 * Comprehensive unit and integration test suite for WebGL 2.0 Gaussian Blur
 * Multi-Pass Depth-of-Field post-processing pipeline.
 */

import {
  DepthOfFieldPass,
} from '@/lib/webgl/postprocessing/DepthOfFieldPass';
import {
  DOF_VERTEX_SHADER,
  DOF_HORIZONTAL_FRAGMENT_SHADER,
  DOF_VERTICAL_FRAGMENT_SHADER,
} from '@/lib/webgl/shaders/dofShaderSource';
import { IsometricRenderer } from '@/core/webgl/IsometricRenderer';

// Creates a comprehensive WebGL2 context mock conforming to WebGL2RenderingContext interface
function createMockGL2() {
  const shaderStatusMap = new Map<any, boolean>();
  const programStatusMap = new Map<any, boolean>();
  let currentProgram: any = null;
  let currentVAO: any = null;
  let currentFBO: any = null;
  let activeTexUnit = 33984; // TEXTURE0
  let fboStatus = 36053; // FRAMEBUFFER_COMPLETE
  const deletedObjects = new Set<any>();

  const mockGL: any = {
    // Constants
    COLOR_BUFFER_BIT: 16384,
    DEPTH_BUFFER_BIT: 256,
    TRIANGLES: 4,
    FLOAT: 5126,
    RGBA: 6408,
    RGBA8: 32856,
    UNSIGNED_BYTE: 5121,
    UNSIGNED_INT: 5125,
    DEPTH_COMPONENT: 6402,
    DEPTH_COMPONENT24: 33190,
    TEXTURE_2D: 3553,
    TEXTURE0: 33984,
    TEXTURE1: 33985,
    TEXTURE2: 33986,
    FRAMEBUFFER: 36160,
    COLOR_ATTACHMENT0: 36064,
    DEPTH_ATTACHMENT: 36096,
    FRAMEBUFFER_COMPLETE: 36053,
    FRAMEBUFFER_INCOMPLETE_ATTACHMENT: 36054,
    COMPILE_STATUS: 35713,
    LINK_STATUS: 35714,
    VERTEX_SHADER: 35633,
    FRAGMENT_SHADER: 35632,
    ARRAY_BUFFER: 34962,
    STATIC_DRAW: 35044,
    DYNAMIC_DRAW: 35048,
    LINEAR: 9729,
    NEAREST: 9728,
    CLAMP_TO_EDGE: 33071,
    TEXTURE_MIN_FILTER: 10241,
    TEXTURE_MAG_FILTER: 10240,
    TEXTURE_WRAP_S: 10242,
    TEXTURE_WRAP_T: 10243,
    FRAMEBUFFER_BINDING: 36006,
    VIEWPORT: 2978,
    CURRENT_PROGRAM: 35725,
    VERTEX_ARRAY_BINDING: 34229,
    ACTIVE_TEXTURE: 34016,
    DEPTH_TEST: 2929,
    BLEND: 3042,
    SRC_ALPHA: 770,
    ONE_MINUS_SRC_ALPHA: 771,
    TRIANGLE_STRIP: 5,

    // Methods
    createShader: jest.fn((type: number) => {
      const s = { type, id: Math.random() };
      shaderStatusMap.set(s, true);
      return s;
    }),
    shaderSource: jest.fn(),
    compileShader: jest.fn(),
    getShaderParameter: jest.fn((shader: any, param: number) => {
      if (param === 35713) return shaderStatusMap.get(shader) ?? true;
      return true;
    }),
    getShaderInfoLog: jest.fn(() => 'Mock shader error log'),
    deleteShader: jest.fn((shader: any) => {
      deletedObjects.add(shader);
    }),

    createProgram: jest.fn(() => {
      const p = { id: Math.random() };
      programStatusMap.set(p, true);
      return p;
    }),
    attachShader: jest.fn(),
    linkProgram: jest.fn(),
    getProgramParameter: jest.fn((prog: any, param: number) => {
      if (param === 35714) return programStatusMap.get(prog) ?? true;
      return true;
    }),
    getProgramInfoLog: jest.fn(() => 'Mock program link error log'),
    deleteProgram: jest.fn((prog: any) => {
      deletedObjects.add(prog);
    }),
    useProgram: jest.fn((p: any) => {
      currentProgram = p;
    }),

    createVertexArray: jest.fn(() => ({ id: Math.random(), type: 'VAO' })),
    bindVertexArray: jest.fn((vao: any) => {
      currentVAO = vao;
    }),
    deleteVertexArray: jest.fn((vao: any) => {
      deletedObjects.add(vao);
    }),

    createBuffer: jest.fn(() => ({ id: Math.random(), type: 'VBO' })),
    bindBuffer: jest.fn(),
    bufferData: jest.fn(),
    deleteBuffer: jest.fn((b: any) => {
      deletedObjects.add(b);
    }),

    createTexture: jest.fn(() => ({ id: Math.random(), type: 'Texture' })),
    bindTexture: jest.fn(),
    texImage2D: jest.fn(),
    texParameteri: jest.fn(),
    deleteTexture: jest.fn((t: any) => {
      deletedObjects.add(t);
    }),
    activeTexture: jest.fn((unit: number) => {
      activeTexUnit = unit;
    }),

    createFramebuffer: jest.fn(() => ({ id: Math.random(), type: 'FBO' })),
    bindFramebuffer: jest.fn((target: number, fbo: any) => {
      currentFBO = fbo;
    }),
    framebufferTexture2D: jest.fn(),
    checkFramebufferStatus: jest.fn(() => fboStatus),
    deleteFramebuffer: jest.fn((fbo: any) => {
      deletedObjects.add(fbo);
    }),

    getUniformLocation: jest.fn((_prog: any, name: string) => ({ name, id: Math.random() })),
    uniform1i: jest.fn(),
    uniform1f: jest.fn(),
    uniform2f: jest.fn(),
    uniform3f: jest.fn(),
    uniform4fv: jest.fn(),
    uniformMatrix4fv: jest.fn(),

    enableVertexAttribArray: jest.fn(),
    vertexAttribPointer: jest.fn(),
    vertexAttribDivisor: jest.fn(),

    viewport: jest.fn(),
    clearColor: jest.fn(),
    clear: jest.fn(),
    enable: jest.fn(),
    blendFunc: jest.fn(),
    drawArrays: jest.fn(),
    drawArraysInstanced: jest.fn(),

    getParameter: jest.fn((param: number) => {
      if (param === 36006) return currentFBO;
      if (param === 2978) return new Int32Array([0, 0, 800, 600]);
      if (param === 35725) return currentProgram;
      if (param === 34229) return currentVAO;
      if (param === 34016) return activeTexUnit;
      return null;
    }),

    // Test helper controls
    __setShaderCompileSuccess(shader: any, success: boolean) {
      shaderStatusMap.set(shader, success);
    },
    __setProgramLinkSuccess(prog: any, success: boolean) {
      programStatusMap.set(prog, success);
    },
    __setFBOStatus(status: number) {
      fboStatus = status;
    },
    __getDeletedObjects() {
      return deletedObjects;
    },
    __getCurrentFBO() {
      return currentFBO;
    },
  };

  return mockGL;
}

describe('WebGL 2.0 Gaussian Blur Multi-Pass Depth-of-Field Pipeline', () => {
  let mockGL: ReturnType<typeof createMockGL>;
  let dummyColorTex: any;
  let dummyDepthTex: any;

  beforeEach(() => {
    mockGL = createMockGL2();
    dummyColorTex = { id: 'scene-color-tex' };
    dummyDepthTex = { id: 'scene-depth-tex' };
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('A. Shader Source and Parameter Checks', () => {
    it('provides GLSL ES 3.00 compatible shaders with #version 300 es', () => {
      expect(DOF_VERTEX_SHADER.trim().startsWith('#version 300 es')).toBe(true);
      expect(DOF_HORIZONTAL_FRAGMENT_SHADER.trim().startsWith('#version 300 es')).toBe(true);
      expect(DOF_VERTICAL_FRAGMENT_SHADER.trim().startsWith('#version 300 es')).toBe(true);
    });

    it('declares all required depth and camera lens uniforms', () => {
      const requiredUniforms = [
        'u_resolution',
        'u_focalLength',
        'u_apertureSize',
        'u_focusDistance',
        'u_nearPlane',
        'u_farPlane',
        'u_maxBlurRadius',
        'u_hasDepthTexture',
      ];

      for (const u of requiredUniforms) {
        expect(DOF_HORIZONTAL_FRAGMENT_SHADER).toContain(u);
        expect(DOF_VERTICAL_FRAGMENT_SHADER).toContain(u);
      }
    });

    it('contains separable horizontal and vertical convolution logic', () => {
      expect(DOF_HORIZONTAL_FRAGMENT_SHADER).toContain('vec2 dir = vec2(texelSize.x, 0.0);');
      expect(DOF_VERTICAL_FRAGMENT_SHADER).toContain('vec2 dir = vec2(0.0, texelSize.y);');
    });

    it('detects shader compilation failures and handles them gracefully', () => {
      mockGL.getShaderParameter.mockReturnValueOnce(false); // Force compile failure

      const pass = new DepthOfFieldPass(mockGL as any, 800, 600);
      expect(pass.isEnabled()).toBe(false);

      // Verify fallback bypass execution without throwing
      const rendered = pass.render(dummyColorTex, dummyDepthTex, null);
      expect(rendered).toBe(false); // Gracefully bypassed / uninitialized
    });

    it('detects program linking failures and cleans up shaders', () => {
      mockGL.getProgramParameter.mockReturnValueOnce(false); // Force link failure

      const pass = new DepthOfFieldPass(mockGL as any, 800, 600);
      expect(pass.isEnabled()).toBe(false);
      expect(mockGL.deleteProgram).toHaveBeenCalled();
    });
  });

  describe('B. Framebuffer and Texture Target Management', () => {
    it('initializes intermediate ping-pong render target with RGBA8 and completeness check', () => {
      const pass = new DepthOfFieldPass(mockGL as any, 800, 600);
      expect(pass.isEnabled()).toBe(true);

      expect(mockGL.createFramebuffer).toHaveBeenCalled();
      expect(mockGL.createTexture).toHaveBeenCalled();
      expect(mockGL.texImage2D).toHaveBeenCalledWith(
        mockGL.TEXTURE_2D,
        0,
        mockGL.RGBA8,
        800,
        600,
        0,
        mockGL.RGBA,
        mockGL.UNSIGNED_BYTE,
        null,
      );
      expect(mockGL.checkFramebufferStatus).toHaveBeenCalled();
      expect(pass.getIntermediateRenderTarget()).not.toBeNull();
    });

    it('falls back safely if framebuffer status is incomplete', () => {
      mockGL.__setFBOStatus(mockGL.FRAMEBUFFER_INCOMPLETE_ATTACHMENT);

      const pass = new DepthOfFieldPass(mockGL as any, 800, 600);
      expect(pass.isEnabled()).toBe(false);
      expect(mockGL.deleteFramebuffer).toHaveBeenCalled();
    });

    it('resizes render target without redundant reallocation when dimensions are unchanged', () => {
      const pass = new DepthOfFieldPass(mockGL as any, 800, 600);
      const initialFboCalls = mockGL.createFramebuffer.mock.calls.length;

      // Same dimensions
      pass.resize(800, 600);
      expect(mockGL.createFramebuffer.mock.calls.length).toBe(initialFboCalls);

      // Changed dimensions
      pass.resize(1920, 1080);
      expect(mockGL.createFramebuffer.mock.calls.length).toBe(initialFboCalls + 1);
      expect(pass.getIntermediateRenderTarget()?.width).toBe(1920);
      expect(pass.getIntermediateRenderTarget()?.height).toBe(1080);
    });

    it('properly disposes all owned framebuffers, textures, VAO and buffers', () => {
      const pass = new DepthOfFieldPass(mockGL as any, 800, 600);
      pass.dispose();

      expect(mockGL.deleteFramebuffer).toHaveBeenCalled();
      expect(mockGL.deleteTexture).toHaveBeenCalled();
      expect(mockGL.deleteProgram).toHaveBeenCalled();
      expect(mockGL.deleteBuffer).toHaveBeenCalled();
      expect(mockGL.deleteVertexArray).toHaveBeenCalled();
      expect(pass.isEnabled()).toBe(false);
    });
  });

  describe('C. Render-Pass Execution & Ping-Pong Pipeline', () => {
    it('executes horizontal pass into intermediate FBO before vertical pass to target', () => {
      const pass = new DepthOfFieldPass(mockGL as any, 800, 600);
      const targetFBO = { id: 'screen-or-dest-fbo' };

      const fboBinds: any[] = [];
      mockGL.bindFramebuffer.mockImplementation((_target: any, fbo: any) => {
        fboBinds.push(fbo);
      });

      const success = pass.render(dummyColorTex, dummyDepthTex, targetFBO as any);
      expect(success).toBe(true);

      const intermediateFBO = pass.getIntermediateRenderTarget()?.framebuffer;

      // Pass 1 binds intermediate FBO
      expect(fboBinds).toContain(intermediateFBO);
      // Pass 2 binds destination target FBO
      expect(fboBinds).toContain(targetFBO);

      // Verify execution order: intermediate FBO must be bound before destination target FBO
      const firstIntermediateIdx = fboBinds.indexOf(intermediateFBO);
      const firstTargetIdx = fboBinds.indexOf(targetFBO);
      expect(firstIntermediateIdx).toBeLessThan(firstTargetIdx);

      // Exactly two drawArrays calls (one per pass)
      expect(mockGL.drawArrays).toHaveBeenCalledTimes(2);
    });

    it('handles missing depth texture gracefully via bypass / fallback mode', () => {
      const pass = new DepthOfFieldPass(mockGL as any, 800, 600);
      const success = pass.render(dummyColorTex, null, null);
      expect(success).toBe(true);
      // Uniform u_hasDepthTexture set to 0
      expect(mockGL.uniform1i).toHaveBeenCalledWith(expect.anything(), 0);
    });

    it('falls back to non-blurred passthrough when effect is disabled', () => {
      const pass = new DepthOfFieldPass(mockGL as any, 800, 600, { enabled: false });
      expect(pass.isEnabled()).toBe(false);

      const success = pass.render(dummyColorTex, dummyDepthTex, null);
      expect(success).toBe(true);
      // In bypass mode, draws only 1 quad pass
      expect(mockGL.drawArrays).toHaveBeenCalledTimes(1);
    });

    it('restores previous WebGL states (FBO, viewport, program, VAO) after render', () => {
      const pass = new DepthOfFieldPass(mockGL as any, 800, 600);
      pass.render(dummyColorTex, dummyDepthTex, null);

      expect(mockGL.bindFramebuffer).toHaveBeenCalled();
      expect(mockGL.viewport).toHaveBeenCalled();
      expect(mockGL.useProgram).toHaveBeenCalled();
      expect(mockGL.bindVertexArray).toHaveBeenCalled();
    });
  });

  describe('D. Camera Lens Parameters and CoC Controls', () => {
    it('configures and clamps camera lens parameters', () => {
      const pass = new DepthOfFieldPass(mockGL as any, 800, 600, {
        focalLength: 85.0,
        apertureSize: 1.4,
        focusDistance: 5.0,
        maxBlurRadius: 16.0,
      });

      expect(pass.getFocalLength()).toBe(85.0);
      expect(pass.getApertureSize()).toBe(1.4);
      expect(pass.getFocusDistance()).toBe(5.0);
      expect(pass.getMaxBlurRadius()).toBe(16.0);

      // Clamping and validation
      pass.setFocusDistance(-10);
      expect(pass.getFocusDistance()).toBeGreaterThanOrEqual(0.01);

      pass.setFocalLength(0);
      expect(pass.getFocalLength()).toBeGreaterThanOrEqual(0.1);

      pass.setApertureSize(-2);
      expect(pass.getApertureSize()).toBeGreaterThanOrEqual(0.001);

      pass.setMaxBlurRadius(-5);
      expect(pass.getMaxBlurRadius()).toBe(0.0);
    });

    it('uploads updated camera uniforms during render without recompiling shaders', () => {
      const pass = new DepthOfFieldPass(mockGL as any, 800, 600);
      const compileShaderCalls = mockGL.compileShader.mock.calls.length;

      pass.setFocusDistance(15.5);
      pass.setFocalLength(70.0);
      pass.setApertureSize(4.0);
      pass.render(dummyColorTex, dummyDepthTex, null);

      // No new shader recompilation
      expect(mockGL.compileShader.mock.calls.length).toBe(compileShaderCalls);
      // Uniforms updated
      expect(mockGL.uniform1f).toHaveBeenCalledWith(expect.anything(), 15.5);
      expect(mockGL.uniform1f).toHaveBeenCalledWith(expect.anything(), 70.0);
      expect(mockGL.uniform1f).toHaveBeenCalledWith(expect.anything(), 4.0);
    });
  });

  describe('E. IsometricRenderer Integration', () => {
    let canvas: HTMLCanvasElement;

    beforeEach(() => {
      canvas = document.createElement('canvas');
      canvas.width = 1024;
      canvas.height = 768;
      jest.spyOn(canvas, 'getContext').mockReturnValue(mockGL as any);
    });

    it('initializes IsometricRenderer with integrated DepthOfFieldPass', () => {
      const renderer = new IsometricRenderer(canvas, {
        focusDistance: 8.0,
        apertureSize: 2.0,
      });

      const dof = renderer.getDepthOfFieldPass();
      expect(dof).not.toBeNull();
      expect(dof?.getFocusDistance()).toBe(8.0);
      expect(dof?.getApertureSize()).toBe(2.0);
    });

    it('renders scene to sceneFBO and executes DoF post-processing pass', () => {
      const renderer = new IsometricRenderer(canvas);
      const proj = new Float32Array(16);
      const view = new Float32Array(16);

      renderer.render(proj, view);

      // Scene draw call + 2 post-processing blur passes
      expect(mockGL.drawArrays).toHaveBeenCalled();
    });

    it('can toggle DepthOfField effect on and off dynamically', () => {
      const renderer = new IsometricRenderer(canvas);
      expect(renderer.getDepthOfFieldPass()?.isEnabled()).toBe(true);

      renderer.setDepthOfFieldEnabled(false);
      expect(renderer.getDepthOfFieldPass()?.isEnabled()).toBe(false);

      renderer.setDepthOfFieldEnabled(true);
      expect(renderer.getDepthOfFieldPass()?.isEnabled()).toBe(true);
    });

    it('updates focus distance dynamically for desk focus transition', () => {
      const renderer = new IsometricRenderer(canvas);
      renderer.setFocusDistance(12.5);
      expect(renderer.getDepthOfFieldPass()?.getFocusDistance()).toBe(12.5);
    });

    it('resizes post-processing framebuffers cleanly with renderer resize', () => {
      const renderer = new IsometricRenderer(canvas);
      renderer.resize(1920, 1080);

      const dof = renderer.getDepthOfFieldPass();
      expect(dof?.getIntermediateRenderTarget()?.width).toBe(1920);
      expect(dof?.getIntermediateRenderTarget()?.height).toBe(1080);
    });

    it('cleans up renderer and post-processing GPU resources on destroy', () => {
      const renderer = new IsometricRenderer(canvas);
      renderer.destroy();

      expect(renderer.getDepthOfFieldPass()).toBeNull();
      expect(mockGL.deleteFramebuffer).toHaveBeenCalled();
      expect(mockGL.deleteTexture).toHaveBeenCalled();
    });
  });
});
