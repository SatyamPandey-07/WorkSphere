import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import {
  AmbientNoiseSpectrumVisualizer,
  sanitizeDecibels,
} from "@/components/noise/AmbientNoiseSpectrumVisualizer";

describe("AmbientNoiseSpectrumVisualizer - WebGL Spectrogram Waterfall", () => {
  let mockGl: {
    createShader: jest.Mock;
    shaderSource: jest.Mock;
    compileShader: jest.Mock;
    getShaderParameter: jest.Mock;
    getShaderInfoLog: jest.Mock;
    deleteShader: jest.Mock;
    createProgram: jest.Mock;
    attachShader: jest.Mock;
    linkProgram: jest.Mock;
    getProgramParameter: jest.Mock;
    getProgramInfoLog: jest.Mock;
    deleteProgram: jest.Mock;
    useProgram: jest.Mock;
    createBuffer: jest.Mock;
    bindBuffer: jest.Mock;
    bufferData: jest.Mock;
    deleteBuffer: jest.Mock;
    getAttribLocation: jest.Mock;
    enableVertexAttribArray: jest.Mock;
    vertexAttribPointer: jest.Mock;
    createTexture: jest.Mock;
    bindTexture: jest.Mock;
    texParameteri: jest.Mock;
    texImage2D: jest.Mock;
    texSubImage2D: jest.Mock;
    deleteTexture: jest.Mock;
    getUniformLocation: jest.Mock;
    uniform1i: jest.Mock;
    uniform1f: jest.Mock;
    drawArrays: jest.Mock;
    viewport: jest.Mock;
    VERTEX_SHADER: number;
    FRAGMENT_SHADER: number;
    COMPILE_STATUS: number;
    LINK_STATUS: number;
    ARRAY_BUFFER: number;
    STATIC_DRAW: number;
    FLOAT: number;
    TEXTURE_2D: number;
    TEXTURE_WRAP_S: number;
    TEXTURE_WRAP_T: number;
    TEXTURE_MIN_FILTER: number;
    TEXTURE_MAG_FILTER: number;
    CLAMP_TO_EDGE: number;
    REPEAT: number;
    LINEAR: number;
    LUMINANCE: number;
    UNSIGNED_BYTE: number;
    TRIANGLES: number;
  };

  beforeEach(() => {
    jest.clearAllMocks();

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
      getUniformLocation: jest.fn((_, name) => ({ name })),
      uniform1i: jest.fn(),
      uniform1f: jest.fn(),
      drawArrays: jest.fn(),
      viewport: jest.fn(),
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
      CLAMP_TO_EDGE: 33071,
      REPEAT: 10497,
      LINEAR: 9729,
      LUMINANCE: 6409,
      UNSIGNED_BYTE: 5121,
      TRIANGLES: 4,
    };

    HTMLCanvasElement.prototype.getContext = jest.fn((contextId: string) => {
      if (contextId === "webgl" || contextId === "experimental-webgl") {
        return mockGl as unknown as WebGLRenderingContext;
      }
      return null;
    }) as any;
  });

  it("renders the visualizer with the WebGL waterfall spectrogram canvas by default", () => {
    render(<AmbientNoiseSpectrumVisualizer venueName="Blue Bottle Cafe" />);

    expect(
      screen.getByText(/Ambient Noise Spectrum · Blue Bottle Cafe/i),
    ).toBeInTheDocument();
    expect(screen.getByTestId("spectral-waterfall-canvas")).toBeInTheDocument();
    expect(
      screen.getByLabelText(/Spectral Waterfall Spectrogram/i),
    ).toBeInTheDocument();
  });

  it("sets up WebGL canvas with dynamic texture backing and compiles temperature colormap shaders", () => {
    render(<AmbientNoiseSpectrumVisualizer />);

    // Verify WebGL shaders compiled
    expect(mockGl.createShader).toHaveBeenCalledWith(mockGl.VERTEX_SHADER);
    expect(mockGl.createShader).toHaveBeenCalledWith(mockGl.FRAGMENT_SHADER);
    expect(mockGl.createProgram).toHaveBeenCalled();
    expect(mockGl.linkProgram).toHaveBeenCalled();

    // Verify dynamic 2D texture backing initialized
    expect(mockGl.createTexture).toHaveBeenCalled();
    expect(mockGl.bindTexture).toHaveBeenCalledWith(
      mockGl.TEXTURE_2D,
      expect.anything(),
    );
    expect(mockGl.texImage2D).toHaveBeenCalledWith(
      mockGl.TEXTURE_2D,
      0,
      mockGl.LUMINANCE,
      128,
      128,
      0,
      mockGl.LUMINANCE,
      mockGl.UNSIGNED_BYTE,
      expect.any(Uint8Array),
    );
  });

  it("pushes FFT frequency byte data each frame via texSubImage2D and draws triangles", async () => {
    render(<AmbientNoiseSpectrumVisualizer />);

    await waitFor(() => {
      expect(mockGl.texSubImage2D).toHaveBeenCalledWith(
        mockGl.TEXTURE_2D,
        0,
        0,
        expect.any(Number),
        128,
        1,
        mockGl.LUMINANCE,
        mockGl.UNSIGNED_BYTE,
        expect.any(Uint8Array),
      );
    });

    expect(mockGl.drawArrays).toHaveBeenCalledWith(mockGl.TRIANGLES, 0, 6);
  });

  it("allows switching between Waterfall, Bars, and Split view modes", () => {
    render(<AmbientNoiseSpectrumVisualizer initialViewMode="waterfall" />);

    // In waterfall mode, canvas is present
    expect(screen.getByTestId("spectral-waterfall-canvas")).toBeInTheDocument();
    expect(
      screen.queryByLabelText(/Noise Frequency Spectrum Bars/i),
    ).not.toBeInTheDocument();

    // Switch to bars
    fireEvent.click(screen.getByRole("button", { name: /View 24-band bars/i }));
    expect(
      screen.queryByTestId("spectral-waterfall-canvas"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByLabelText(/Noise Frequency Spectrum Bars/i),
    ).toBeInTheDocument();

    // Switch to split (both)
    fireEvent.click(
      screen.getByRole("button", { name: /View split visualizer/i }),
    );
    expect(screen.getByTestId("spectral-waterfall-canvas")).toBeInTheDocument();
    expect(
      screen.getByLabelText(/Noise Frequency Spectrum Bars/i),
    ).toBeInTheDocument();
  });

  it("toggles between Turbo and Viridis colormap in the shader", () => {
    render(<AmbientNoiseSpectrumVisualizer initialColormap="turbo" />);

    expect(screen.getByText(/Turbo Colormap/i)).toBeInTheDocument();

    const colormapBtn = screen.getByTestId("toggle-colormap-btn");
    fireEvent.click(colormapBtn);

    expect(screen.getByText(/Viridis Colormap/i)).toBeInTheDocument();
  });

  it("cleans up WebGL texture, program, and buffers on unmount", () => {
    const { unmount } = render(<AmbientNoiseSpectrumVisualizer />);
    unmount();

    expect(mockGl.deleteTexture).toHaveBeenCalled();
    expect(mockGl.deleteProgram).toHaveBeenCalled();
    expect(mockGl.deleteBuffer).toHaveBeenCalled();
  });

  describe("sanitizeDecibels telemetry validation helper", () => {
    it("returns normal valid decibel reading unchanged when within range", () => {
      expect(sanitizeDecibels(55)).toBe(55);
      expect(sanitizeDecibels(42.5)).toBe(42.5);
      expect(sanitizeDecibels(85)).toBe(85);
    });

    it("sanitizes NaN input by falling back to safe default", () => {
      expect(sanitizeDecibels(NaN, 56)).toBe(56);
      expect(sanitizeDecibels(Number.NaN, 42)).toBe(42);
    });

    it("sanitizes -Infinity input (such as muted/silent microphone) by falling back to default", () => {
      expect(sanitizeDecibels(-Infinity, 30)).toBe(30);
      expect(sanitizeDecibels(Number.NEGATIVE_INFINITY, 56)).toBe(56);
    });

    it("sanitizes +Infinity input by falling back to safe default", () => {
      expect(sanitizeDecibels(Infinity, 56)).toBe(56);
      expect(sanitizeDecibels(Number.POSITIVE_INFINITY, 74)).toBe(74);
    });

    it("clamps negative decibel input below the supported range to min bound", () => {
      expect(sanitizeDecibels(-10, 56, 0, 140)).toBe(0);
      expect(sanitizeDecibels(-999, 56, 0, 140)).toBe(0);
    });

    it("clamps extremely high decibel input above the supported range to max bound", () => {
      expect(sanitizeDecibels(180, 56, 0, 140)).toBe(140);
      expect(sanitizeDecibels(300, 56, 0, 140)).toBe(140);
    });

    it("handles non-number types gracefully with fallback", () => {
      expect(sanitizeDecibels(null, 56)).toBe(56);
      expect(sanitizeDecibels(undefined, 56)).toBe(56);
      expect(sanitizeDecibels("65", 56)).toBe(56);
    });
  });

  describe("Noise Visualizer out-of-range & corrupt telemetry rendering resilience", () => {
    it("renders properly with NaN decibelBaseline and does not falsely classify as loud", () => {
      render(
        <AmbientNoiseSpectrumVisualizer
          decibelBaseline={NaN}
          noiseLevel="quiet"
        />,
      );

      // Should fall back to quiet baseline (42 dB ± 2 dB jitter) instead of falsely labelling as loud
      expect(screen.getByText(/Deep Focus/i)).toBeInTheDocument();
      const text = screen.getByTestId("decibel-reading-value").textContent || "";
      const parsed = parseInt(text, 10);
      expect(parsed).toBeGreaterThanOrEqual(40);
      expect(parsed).toBeLessThanOrEqual(44);
      expect(text).toContain("dBA");
      expect(
        screen.queryByText(/Energetic \/ High Energy \(Loud\)/i),
      ).not.toBeInTheDocument();
    });

    it("handles -Infinity decibelBaseline gracefully (muted mic) with quiet status", () => {
      render(
        <AmbientNoiseSpectrumVisualizer
          decibelBaseline={-Infinity}
          noiseLevel="quiet"
        />,
      );

      expect(screen.getByText(/Deep Focus/i)).toBeInTheDocument();
      const text = screen.getByTestId("decibel-reading-value").textContent || "";
      const parsed = parseInt(text, 10);
      expect(parsed).toBeGreaterThanOrEqual(40);
      expect(parsed).toBeLessThanOrEqual(44);
      expect(text).toContain("dBA");
      expect(
        screen.queryByText(/Energetic \/ High Energy \(Loud\)/i),
      ).not.toBeInTheDocument();
    });

    it("clamps extremely high decibelBaseline to maximum range bound", () => {
      render(
        <AmbientNoiseSpectrumVisualizer
          decibelBaseline={250}
          noiseLevel="loud"
        />,
      );

      // Clamped to 140 dB baseline (with subtle jitter bounded within [0, 140])
      const text = screen.getByTestId("decibel-reading-value").textContent || "";
      const parsed = parseInt(text, 10);
      expect(parsed).toBeGreaterThanOrEqual(136);
      expect(parsed).toBeLessThanOrEqual(140);
      expect(text).toContain("dBA");
    });

    it("clamps negative decibelBaseline to minimum range bound", () => {
      render(
        <AmbientNoiseSpectrumVisualizer
          decibelBaseline={-50}
          noiseLevel="quiet"
        />,
      );

      // Clamped to 0 dB baseline (with subtle jitter bounded >= 0)
      const text = screen.getByTestId("decibel-reading-value").textContent || "";
      const parsed = parseInt(text, 10);
      expect(parsed).toBeGreaterThanOrEqual(0);
      expect(parsed).toBeLessThanOrEqual(4);
      expect(text).toContain("dBA");
    });

    it("renders 24-band frequency bars without invalid CSS percentages or NaN styles", () => {
      const { container } = render(
        <AmbientNoiseSpectrumVisualizer
          initialViewMode="bars"
          decibelBaseline={NaN}
        />,
      );

      // Inspect all frequency bars in the container
      const dynamicBars = container.querySelectorAll("[style*='height']");
      expect(dynamicBars.length).toBeGreaterThan(0);

      dynamicBars.forEach((bar) => {
        const styleAttr = bar.getAttribute("style") || "";
        expect(styleAttr).not.toContain("NaN");
        expect(styleAttr).not.toContain("Infinity");
        expect(styleAttr).toMatch(/height:\s*\d+(\.\d+)?%/);
      });

      const peakTicks = container.querySelectorAll("[style*='bottom']");
      peakTicks.forEach((tick) => {
        const styleAttr = tick.getAttribute("style") || "";
        expect(styleAttr).not.toContain("NaN");
        expect(styleAttr).not.toContain("Infinity");
        expect(styleAttr).toMatch(/bottom:\s*\d+(\.\d+)?%/);
      });
    });
  });
});
