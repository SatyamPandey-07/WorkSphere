import React from "react";
import { render, screen, act } from "@testing-library/react";
import "@testing-library/jest-dom";
import {
  RadarSweepHUD,
  getDecibelStatusTier,
} from "@/components/ui/RadarSweepHUD";

describe("RadarSweepHUD Component", () => {
  let mockIntersectionObserver: jest.Mock;
  let mockDisconnect: jest.Mock;
  let intersectionCallbacks: ((entries: IntersectionObserverEntry[]) => void)[] = [];

  let mockCancelAnimationFrame: jest.SpyInstance;
  let mockRequestAnimationFrame: jest.SpyInstance;

  beforeEach(() => {
    intersectionCallbacks = [];
    mockDisconnect = jest.fn();

    mockIntersectionObserver = jest.fn().mockImplementation((cb) => {
      intersectionCallbacks.push(cb);
      return {
        observe: jest.fn(),
        unobserve: jest.fn(),
        disconnect: mockDisconnect,
      };
    });
    global.IntersectionObserver = mockIntersectionObserver as any;

    mockRequestAnimationFrame = jest
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation((_cb: FrameRequestCallback) => {
        return 123;
      });

    mockCancelAnimationFrame = jest
      .spyOn(window, "cancelAnimationFrame")
      .mockImplementation((_id: number) => {});

    // Mock HTMLCanvasElement.prototype.getContext
    HTMLCanvasElement.prototype.getContext = jest.fn().mockImplementation(() => {
      return {
        clearRect: jest.fn(),
        beginPath: jest.fn(),
        arc: jest.fn(),
        fill: jest.fn(),
        stroke: jest.fn(),
        moveTo: jest.fn(),
        lineTo: jest.fn(),
        closePath: jest.fn(),
        createRadialGradient: jest.fn().mockReturnValue({
          addColorStop: jest.fn(),
        }),
        save: jest.fn(),
        restore: jest.fn(),
        setLineDash: jest.fn(),
      } as any;
    });
  });

  afterEach(() => {
    mockRequestAnimationFrame.mockRestore();
    mockCancelAnimationFrame.mockRestore();
    jest.clearAllMocks();
  });

  describe("A. Threshold Calculations & Reactive Decibel Color Coding", () => {
    it("returns Green tier below 50 dB", () => {
      const tier49 = getDecibelStatusTier(49.9);
      expect(tier49.tier).toBe("green");
      expect(tier49.label).toBe("Quiet");
      expect(tier49.colorHex).toBe("#10b981");

      const tier30 = getDecibelStatusTier(30);
      expect(tier30.tier).toBe("green");
    });

    it("returns Amber tier at exactly 50 dB", () => {
      const tier50 = getDecibelStatusTier(50);
      expect(tier50.tier).toBe("amber");
      expect(tier50.label).toBe("Moderate");
      expect(tier50.colorHex).toBe("#f59e0b");
    });

    it("returns Amber tier at exactly 70 dB", () => {
      const tier70 = getDecibelStatusTier(70);
      expect(tier70.tier).toBe("amber");
      expect(tier70.label).toBe("Moderate");
      expect(tier70.colorHex).toBe("#f59e0b");
    });

    it("returns Red tier above 70 dB", () => {
      const tier71 = getDecibelStatusTier(70.1);
      expect(tier71.tier).toBe("red");
      expect(tier71.label).toBe("Loud");
      expect(tier71.colorHex).toBe("#ef4444");

      const tier85 = getDecibelStatusTier(85);
      expect(tier85.tier).toBe("red");
    });

    it("reacts immediately when currentDb prop changes across thresholds", () => {
      const { rerender } = render(
        <RadarSweepHUD currentDb={42} noiseHistory={[35, 40, 42]} />,
      );

      expect(screen.getByTestId("radar-status-badge")).toHaveTextContent("Quiet");
      expect(screen.getByTestId("radar-status-badge")).toHaveClass("text-emerald-400");
      expect(screen.getByTestId("radar-current-db")).toHaveTextContent("42");

      // Rerender with 65 dB (Amber)
      rerender(<RadarSweepHUD currentDb={65} noiseHistory={[35, 40, 42, 65]} />);
      expect(screen.getByTestId("radar-status-badge")).toHaveTextContent("Moderate");
      expect(screen.getByTestId("radar-status-badge")).toHaveClass("text-amber-400");
      expect(screen.getByTestId("radar-current-db")).toHaveTextContent("65");

      // Rerender with 75 dB (Red)
      rerender(<RadarSweepHUD currentDb={75} noiseHistory={[35, 40, 42, 65, 75]} />);
      expect(screen.getByTestId("radar-status-badge")).toHaveTextContent("Loud");
      expect(screen.getByTestId("radar-status-badge")).toHaveClass("text-rose-400");
      expect(screen.getByTestId("radar-current-db")).toHaveTextContent("75");
    });
  });

  describe("B. Noise History & Edge Values Handling", () => {
    it("handles empty noiseHistory array gracefully", () => {
      render(<RadarSweepHUD currentDb={45} noiseHistory={[]} />);

      expect(screen.getByTestId("radar-sample-count")).toHaveTextContent("0");
      expect(screen.getByTestId("radar-current-db")).toHaveTextContent("45");
    });

    it("handles short noiseHistory array gracefully", () => {
      render(<RadarSweepHUD currentDb={48} noiseHistory={[42]} />);

      expect(screen.getByTestId("radar-sample-count")).toHaveTextContent("1");
      expect(screen.getByTestId("radar-current-db")).toHaveTextContent("48");
    });

    it("handles invalid or non-finite decibel values safely without crashing", () => {
      render(
        <RadarSweepHUD
          currentDb={NaN}
          noiseHistory={[NaN, Infinity, -10, 50]}
        />,
      );

      expect(screen.getByTestId("radar-status-badge")).toHaveTextContent("Quiet");
      expect(screen.getByTestId("radar-current-db")).toHaveTextContent("--");
      expect(screen.getByTestId("radar-sample-count")).toHaveTextContent("4");
    });
  });

  describe("C. Animation Loop & Offscreen IntersectionObserver Pause", () => {
    it("starts requestAnimationFrame loop when HUD is visible", () => {
      render(<RadarSweepHUD currentDb={45} noiseHistory={[40, 45]} />);

      expect(mockRequestAnimationFrame).toHaveBeenCalled();
    });

    it("pauses animation when HUD scrolls offscreen and resumes when returning", () => {
      render(<RadarSweepHUD currentDb={45} noiseHistory={[40, 45]} />);

      expect(mockRequestAnimationFrame).toHaveBeenCalled();
      const initialCalls = mockRequestAnimationFrame.mock.calls.length;

      // Simulate offscreen
      act(() => {
        if (intersectionCallbacks[0]) {
          intersectionCallbacks[0]([
            { isIntersecting: false } as IntersectionObserverEntry,
          ]);
        }
      });

      expect(mockCancelAnimationFrame).toHaveBeenCalled();

      // Simulate returning to viewport
      act(() => {
        if (intersectionCallbacks[0]) {
          intersectionCallbacks[0]([
            { isIntersecting: true } as IntersectionObserverEntry,
          ]);
        }
      });

      expect(mockRequestAnimationFrame.mock.calls.length).toBeGreaterThan(
        initialCalls,
      );
    });

    it("cleans up animation frames and disconnects observer on unmount", () => {
      const { unmount } = render(
        <RadarSweepHUD currentDb={45} noiseHistory={[40, 45]} />,
      );

      unmount();

      expect(mockCancelAnimationFrame).toHaveBeenCalled();
      expect(mockDisconnect).toHaveBeenCalled();
    });
  });

  describe("D. Reduced Motion Compliance", () => {
    it("renders in static mode without continuous loop when reducedMotion is true", () => {
      render(
        <RadarSweepHUD
          currentDb={55}
          noiseHistory={[50, 55]}
          reducedMotion={true}
        />,
      );

      expect(screen.getByText("STATIC")).toBeInTheDocument();
      // Animation frame loop is NOT scheduled in reducedMotion mode
      expect(mockRequestAnimationFrame).not.toHaveBeenCalled();
    });
  });

  describe("E. Accessibility", () => {
    it("provides accessible screen reader announcement and hides canvas decoration", () => {
      render(<RadarSweepHUD currentDb={45} noiseHistory={[40, 45]} />);

      const canvas = screen.getByTestId("radar-canvas");
      expect(canvas).toHaveAttribute("aria-hidden", "true");

      const statusEl = screen.getByRole("status");
      expect(statusEl).toHaveTextContent(
        "Current ambient noise level is 45 decibels, classified as Quiet.",
      );
    });
  });
});
