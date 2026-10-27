import React from "react";
import { render, screen, act } from "@testing-library/react";
import {
  SpectralWaterfallCanvas,
  compileShader,
  createSpectralProgram,
  VERTEX_SHADER_SOURCE,
  FRAGMENT_SHADER_SOURCE,
} from "@/components/audio/SpectralWaterfallCanvas";

describe("SpectralWaterfallCanvas (WebGL 2D Audio Spectrum Visualizer)", () => {
  let mockGl: any;

  beforeEach(() => {
    mockGl = {
      createShader: jest.fn(() => ({})),
      shaderSource: jest.fn(),
      compileShader: jest.fn(),
      getShaderParameter: jest.fn(() => true),
      getShaderInfoLog: jest.fn(() => ""),
      deleteShader: jest.fn(),
      createProgram: jest.fn(() => ({})),
      attachShader: jest.fn(),
      linkProgram: jest.fn(),
      getProgramParameter: jest.fn(() => true),
      getProgramInfoLog: jest.fn(() => ""),
      deleteProgram: jest.fn(),
      useProgram: jest.fn(),
      createBuffer: jest.fn(() => ({})),
      bindBuffer: jest.fn(),
      bufferData: jest.fn(),
      deleteBuffer: jest.fn(),
      getAttribLocation: jest.fn(() => 0),
      enableVertexAttribArray: jest.fn(),
      vertexAttribPointer: jest.fn(),
      createTexture: jest.fn(() => ({})),
      bindTexture: jest.fn(),
      texParameteri: jest.fn(),
      texImage2D: jest.fn(),
      texSubImage2D: jest.fn(),
      deleteTexture: jest.fn(),
      getUniformLocation: jest.fn(() => ({})),
      uniform1i: jest.fn(),
      uniform1f: jest.fn(),
      viewport: jest.fn(),
      drawArrays: jest.fn(),
      canvas: { width: 640, height: 240 },
      VERTEX_SHADER: 35633,
      FRAGMENT_SHADER: 35632,
      COMPILE_STATUS: 35713,
      LINK_STATUS: 35714,
      ARRAY_BUFFER: 34962,
      STATIC_DRAW: 35044,
      FLOAT: 5126,
      TEXTURE_2D: 3553,
      TEXTURE_WRAP_S: 10242,
      TEXTURE_WRAP_T: 10243,
      TEXTURE_MIN_FILTER: 10241,
      TEXTURE_MAG_FILTER: 10240,
      LINEAR: 9729,
      CLAMP_TO_EDGE: 33071,
      LUMINANCE: 6409,
      UNSIGNED_BYTE: 5121,
      TRIANGLES: 4,
    };

    HTMLCanvasElement.prototype.getContext = jest.fn((contextId) => {
      if (contextId === "webgl" || contextId === "experimental-webgl") {
        return mockGl;
      }
      return null;
    }) as any;

    jest.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
      const timer = setTimeout(cb, 16);
      (timer as any)?.unref?.();
      return timer as unknown as number;
    });
    jest.spyOn(window, "cancelAnimationFrame").mockImplementation((id) => {
      clearTimeout(id as any);
    });
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.restoreAllMocks();
  });

  describe("Shader Compilation & Pipeline", () => {
    it("compiles vertex and fragment shaders successfully", () => {
      const vs = compileShader(mockGl, mockGl.VERTEX_SHADER, VERTEX_SHADER_SOURCE);
      expect(mockGl.createShader).toHaveBeenCalledWith(mockGl.VERTEX_SHADER);
      expect(mockGl.compileShader).toHaveBeenCalled();
      expect(vs).toBeDefined();

      const fs = compileShader(mockGl, mockGl.FRAGMENT_SHADER, FRAGMENT_SHADER_SOURCE);
      expect(mockGl.createShader).toHaveBeenCalledWith(mockGl.FRAGMENT_SHADER);
      expect(fs).toBeDefined();
    });

    it("creates linked WebGL spectral shader program", () => {
      const program = createSpectralProgram(mockGl);
      expect(mockGl.createProgram).toHaveBeenCalled();
      expect(mockGl.linkProgram).toHaveBeenCalled();
      expect(mockGl.deleteShader).toHaveBeenCalledTimes(2);
      expect(program).toBeDefined();
    });

    it("cleans up vertex shader if fragment compilation fails", () => {
      mockGl.getShaderParameter
        .mockImplementationOnce(() => true)
        .mockImplementationOnce(() => false);
      const program = createSpectralProgram(mockGl);
      expect(program).toBeNull();
      expect(mockGl.deleteShader).toHaveBeenCalled();
    });

    it("fragment shader includes glowing cyan-to-emerald gradient mapping", () => {
      expect(FRAGMENT_SHADER_SOURCE).toContain("getSpectralColor");
      expect(FRAGMENT_SHADER_SOURCE).toContain("uGain");
      expect(FRAGMENT_SHADER_SOURCE).toContain("uTexture");
    });
  });

  describe("Canvas & Audio AnalyserNode Hook", () => {
    it("renders canvas with frequency range markings", () => {
      render(<SpectralWaterfallCanvas width={640} height={240} />);

      expect(screen.getByTestId("spectral-waterfall-canvas")).toBeInTheDocument();
      expect(screen.getByText("0Hz")).toBeInTheDocument();
      expect(screen.getByText("1kHz")).toBeInTheDocument();
      expect(screen.getByText("20kHz")).toBeInTheDocument();
    });

    it("hooks into Web Audio AnalyserNode to get frequency data", () => {
      const mockAnalyser = {
        frequencyBinCount: 128,
        getByteFrequencyData: jest.fn((array: Uint8Array) => {
          array.fill(180);
        }),
      } as unknown as AnalyserNode;

      render(<SpectralWaterfallCanvas analyserNode={mockAnalyser} />);

      expect(mockAnalyser.getByteFrequencyData).toHaveBeenCalled();
      expect(mockGl.texSubImage2D).toHaveBeenCalled();
      expect(mockGl.drawArrays).toHaveBeenCalledWith(mockGl.TRIANGLES, 0, 6);
    });

    it("accepts direct fftData buffer prop", () => {
      const customFFT = new Uint8Array(256).fill(200);
      render(<SpectralWaterfallCanvas fftData={customFFT} />);

      expect(mockGl.texSubImage2D).toHaveBeenCalled();
      expect(mockGl.drawArrays).toHaveBeenCalled();
    });
  });

  describe("Context Loss & Restoration Handling", () => {
    it("handles webglcontextlost by preventing default and stopping loop", () => {
      const onLost = jest.fn();
      render(<SpectralWaterfallCanvas onContextLost={onLost} />);

      const canvas = screen.getByTestId("spectral-waterfall-canvas");
      const lostEvent = new Event("webglcontextlost");
      jest.spyOn(lostEvent, "preventDefault");

      act(() => {
        canvas.dispatchEvent(lostEvent);
      });

      expect(lostEvent.preventDefault).toHaveBeenCalled();
      expect(onLost).toHaveBeenCalled();
    });

    it("handles webglcontextrestored by recovering WebGL resources", () => {
      const onRestored = jest.fn();
      render(<SpectralWaterfallCanvas onContextRestored={onRestored} />);

      const canvas = screen.getByTestId("spectral-waterfall-canvas");
      act(() => {
        canvas.dispatchEvent(new Event("webglcontextrestored"));
      });

      expect(onRestored).toHaveBeenCalled();
      expect(mockGl.createProgram).toHaveBeenCalled();
    });
  });

  describe("Input Sanitization & Boundary Handling", () => {
    it("sanitizes speed and gain under NaN, negative, and out-of-bound values", () => {
      render(
        <SpectralWaterfallCanvas
          speed={NaN}
          gain={NaN}
          width={0}
          height={-100}
        />,
      );
      const canvas = screen.getByTestId("spectral-waterfall-canvas");
      expect(canvas).toHaveAttribute("width", "640");
      expect(canvas).toHaveAttribute("height", "240");
      expect(mockGl.uniform1f).toHaveBeenCalledWith(expect.anything(), 1.0);
    });

    it("clamps extreme speed values within [1, 127]", () => {
      render(
        <SpectralWaterfallCanvas
          speed={9999}
          gain={2.5}
        />,
      );
      expect(mockGl.uniform1f).toHaveBeenCalledWith(expect.anything(), 2.5);
    });
  });
});