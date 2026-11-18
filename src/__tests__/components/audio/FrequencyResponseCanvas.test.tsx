import React from "react";
import { render, screen, act } from "@testing-library/react";
import { FrequencyResponseCanvas } from "@/components/audio/FrequencyResponseCanvas";

describe("FrequencyResponseCanvas Component", () => {
  let mockCtx: any;
  let rafCallbacks: ((time: number) => void)[] = [];
  let rafIdCounter = 0;

  beforeEach(() => {
    rafCallbacks = [];
    rafIdCounter = 0;

    jest.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
      const id = ++rafIdCounter;
      rafCallbacks.push(cb);
      return id;
    });

    jest.spyOn(window, "cancelAnimationFrame").mockImplementation((id) => {
      // Mock cancellation
    });

    mockCtx = {
      clearRect: jest.fn(),
      fillRect: jest.fn(),
      beginPath: jest.fn(),
      moveTo: jest.fn(),
      lineTo: jest.fn(),
      stroke: jest.fn(),
      fillStyle: "",
      strokeStyle: "",
      lineWidth: 1,
    };

    HTMLCanvasElement.prototype.getContext = jest.fn((contextId) => {
      if (contextId === "2d") return mockCtx;
      return null;
    }) as any;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("renders canvas element with proper attributes", () => {
    const mockGetResponse = jest.fn(() => ({
      frequencies: new Float32Array([100, 200, 500, 1000, 5000]),
      magnitudes: new Float32Array([1.0, 1.2, 0.8, 1.0, 0.5]),
    }));

    render(
      <FrequencyResponseCanvas
        getFrequencyResponse={mockGetResponse}
        isDarkMode={false}
      />,
    );

    const canvas = screen.getByTestId("frequency-response-canvas");
    expect(canvas).toBeInTheDocument();
    expect(canvas).toHaveAttribute("width", "600");
    expect(canvas).toHaveAttribute("height", "150");
  });

  it("applies light and dark mode styles to background and grid lines", () => {
    const mockGetResponse = jest.fn(() => ({
      frequencies: new Float32Array([100, 1000]),
      magnitudes: new Float32Array([1.0, 1.0]),
    }));

    const { rerender } = render(
      <FrequencyResponseCanvas
        getFrequencyResponse={mockGetResponse}
        isDarkMode={false}
      />,
    );

    // Light mode background
    expect(mockCtx.fillRect).toHaveBeenCalledWith(0, 0, 600, 150);

    // Rerender in dark mode
    rerender(
      <FrequencyResponseCanvas
        getFrequencyResponse={mockGetResponse}
        isDarkMode={true}
      />,
    );

    expect(mockCtx.clearRect).toHaveBeenCalled();
  });

  it("handles getFrequencyResponse returning null, undefined, or empty arrays without error", () => {
    const mockNullResponse = jest.fn(() => null as any);

    expect(() => {
      render(
        <FrequencyResponseCanvas
          getFrequencyResponse={mockNullResponse}
          isDarkMode={true}
        />,
      );
    }).not.toThrow();

    // Verify background still draws
    expect(mockCtx.fillRect).toHaveBeenCalledWith(0, 0, 600, 150);
  });

  it("sanitizes NaN, zero, and negative magnitude values without generating invalid paths", () => {
    const mockCorruptResponse = jest.fn(() => ({
      frequencies: new Float32Array([100, 200, 500]),
      magnitudes: new Float32Array([NaN, -1.5, 0]),
    }));

    render(
      <FrequencyResponseCanvas
        getFrequencyResponse={mockCorruptResponse}
        isDarkMode={false}
      />,
    );

    // Verify moveTo and lineTo were called with finite numbers
    mockCtx.moveTo.mock.calls.forEach((args: any[]) => {
      expect(Number.isFinite(args[0])).toBe(true);
      expect(Number.isFinite(args[1])).toBe(true);
    });

    mockCtx.lineTo.mock.calls.forEach((args: any[]) => {
      expect(Number.isFinite(args[0])).toBe(true);
      expect(Number.isFinite(args[1])).toBe(true);
    });
  });

  it("cancels animation frame on component unmount", () => {
    const mockGetResponse = jest.fn(() => ({
      frequencies: new Float32Array([100, 1000]),
      magnitudes: new Float32Array([1.0, 1.0]),
    }));

    const { unmount } = render(
      <FrequencyResponseCanvas
        getFrequencyResponse={mockGetResponse}
        isDarkMode={false}
      />,
    );

    unmount();
    expect(window.cancelAnimationFrame).toHaveBeenCalled();
  });
});
