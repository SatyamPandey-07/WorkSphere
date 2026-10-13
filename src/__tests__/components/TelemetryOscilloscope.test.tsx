import React from "react";
import { render, screen, act } from "@testing-library/react";
import "@testing-library/jest-dom";
import { TelemetryOscilloscope } from "@/components/admin/TelemetryOscilloscope";

describe("TelemetryOscilloscope Component (#6196)", () => {
  let mockContext: Record<string, jest.Mock>;
  let rafCallback: FrameRequestCallback | null = null;
  let rafId = 0;

  beforeEach(() => {
    jest.clearAllMocks();

    rafCallback = null;
    rafId = 0;

    globalThis.requestAnimationFrame = jest.fn((cb: FrameRequestCallback) => {
      rafCallback = cb;
      rafId += 1;
      return rafId;
    });

    globalThis.cancelAnimationFrame = jest.fn();

    mockContext = {
      fillRect: jest.fn(),
      beginPath: jest.fn(),
      moveTo: jest.fn(),
      lineTo: jest.fn(),
      stroke: jest.fn(),
      arc: jest.fn(),
      fill: jest.fn(),
      save: jest.fn(),
      restore: jest.fn(),
    };

    HTMLCanvasElement.prototype.getContext = jest.fn().mockImplementation((contextId: string) => {
      if (contextId === "2d") {
        return mockContext;
      }
      return null;
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("renders HTML5 2D canvas oscilloscope container with avionics indicators", () => {
    render(<TelemetryOscilloscope />);

    expect(screen.getByTestId("telemetry-oscilloscope")).toBeInTheDocument();
    expect(screen.getByTestId("oscilloscope-canvas")).toBeInTheDocument();
    expect(screen.getByText("Avionics Telemetry Oscilloscope")).toBeInTheDocument();
    expect(screen.getByText("30 FPS")).toBeInTheDocument();
    expect(screen.getByText("TB: 50ms/DIV")).toBeInTheDocument();
    expect(screen.getByText("VOLT: 100mV/DIV")).toBeInTheDocument();
    expect(screen.getByText("TRACE: CATHODE-RAY PHOSPHOR")).toBeInTheDocument();
  });

  it("initializes canvas context and executes glowing grid and phosphor persistence trail rendering", () => {
    render(<TelemetryOscilloscope />);

    expect(HTMLCanvasElement.prototype.getContext).toHaveBeenCalledWith("2d");
    expect(mockContext.fillRect).toHaveBeenCalled();

    // Trigger an animation frame
    expect(globalThis.requestAnimationFrame).toHaveBeenCalled();
    if (rafCallback) {
      act(() => {
        rafCallback!(40); // 40ms > 33.33ms (30fps interval)
      });
    }

    // Phosphor persistence decay fillRect called
    expect(mockContext.fillRect).toHaveBeenCalled();
    // Grid lines and waveform path drawn
    expect(mockContext.beginPath).toHaveBeenCalled();
    expect(mockContext.stroke).toHaveBeenCalled();
    // Glowing beam electron head arc called
    expect(mockContext.arc).toHaveBeenCalled();
    expect(mockContext.fill).toHaveBeenCalled();
  });

  it("caps rendering loop strictly at 30 FPS to conserve client CPU resources", () => {
    render(<TelemetryOscilloscope />);

    const initialFillRectCalls = mockContext.fillRect.mock.calls.length;

    // Simulate 120Hz monitor with frames arriving every 8ms
    act(() => {
      if (rafCallback) rafCallback(8); // Delta = 8ms (< 33.33ms) -> throttled
    });
    expect(mockContext.fillRect.mock.calls.length).toBe(initialFillRectCalls);

    act(() => {
      if (rafCallback) rafCallback(16); // Delta = 16ms (< 33.33ms) -> throttled
    });
    expect(mockContext.fillRect.mock.calls.length).toBe(initialFillRectCalls);

    act(() => {
      if (rafCallback) rafCallback(35); // Delta = 35ms (> 33.33ms) -> frame rendered
    });
    expect(mockContext.fillRect.mock.calls.length).toBeGreaterThan(initialFillRectCalls);
  });

  it("traces dynamic voltage blips when web vitals events are dispatched", () => {
    render(<TelemetryOscilloscope />);

    expect(screen.getByText("Heartbeat Avionics Baseline Active")).toBeInTheDocument();

    // Dispatch a Web Vital event on window
    act(() => {
      window.dispatchEvent(
        new CustomEvent("worksphere:web-vital-recorded", {
          detail: {
            name: "LCP",
            value: 1950,
            rating: "good",
            delta: 1950,
            route: "/dashboard",
          },
        }),
      );
    });

    expect(screen.getByText(/LCP:\s+1950ms/)).toBeInTheDocument();
    expect(screen.getByText("(good)")).toBeInTheDocument();
  });

  it("formats CLS score blips with 3 decimals and accepts latestMetric prop", () => {
    const { rerender } = render(<TelemetryOscilloscope />);

    act(() => {
      window.dispatchEvent(
        new CustomEvent("worksphere:web-vital-recorded", {
          detail: {
            name: "CLS",
            value: 0.045,
            rating: "good",
            delta: 0.045,
            route: "/",
          },
        }),
      );
    });

    expect(screen.getByText(/CLS:\s+0.045/)).toBeInTheDocument();

    // Rerender with latestMetric prop
    rerender(
      <TelemetryOscilloscope
        latestMetric={{
          name: "INP",
          value: 120,
          rating: "good",
        }}
      />,
    );

    expect(screen.getByText(/INP:\s+120ms/)).toBeInTheDocument();
  });

  it("cancels animation frame and removes event listeners on unmount", () => {
    const removeEventListenerSpy = jest.spyOn(window, "removeEventListener");
    const { unmount } = render(<TelemetryOscilloscope />);

    unmount();

    expect(globalThis.cancelAnimationFrame).toHaveBeenCalled();
    expect(removeEventListenerSpy).toHaveBeenCalledWith(
      "worksphere:web-vital-recorded",
      expect.any(Function),
    );
    expect(removeEventListenerSpy).toHaveBeenCalledWith(
      "web-vital-recorded",
      expect.any(Function),
    );
  });
});
