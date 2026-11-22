import React from "react";
import { fireEvent, render, screen, act } from "@testing-library/react";
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

      rerender(<RadarSweepHUD currentDb={65} noiseHistory={[35, 40, 42, 65]} />);
      expect(screen.getByTestId("radar-status-badge")).toHaveTextContent("Moderate");
      expect(screen.getByTestId("radar-status-badge")).toHaveClass("text-amber-400");
      expect(screen.getByTestId("radar-current-db")).toHaveTextContent("65");

      rerender(<RadarSweepHUD currentDb={75} noiseHistory={[35, 40, 42, 65, 75]} />);
      expect(screen.getByTestId("radar-status-badge")).toHaveTextContent("Loud");
      expect(screen.getByTestId("radar-status-badge")).toHaveClass("text-rose-400");
      expect(screen.getByTestId("radar-current-db")).toHaveTextContent("75");
    });
  });

  describe("B. Keyboard Shortcuts and Tooltips", () => {
    it("cycles radar range through 500m -> 1km -> 2km -> 5km -> 500m on pressing R", () => {
      const onRangeChange = jest.fn();
      render(<RadarSweepHUD initialRange={500} onRangeChange={onRangeChange} />);

      expect(screen.getByTestId("radar-sweep-hud")).toHaveAttribute("data-range", "500");

      fireEvent.keyDown(window, { key: "r" });
      expect(screen.getByTestId("radar-sweep-hud")).toHaveAttribute("data-range", "1000");
      expect(onRangeChange).toHaveBeenLastCalledWith(1000);

      fireEvent.keyDown(window, { key: "R" });
      expect(screen.getByTestId("radar-sweep-hud")).toHaveAttribute("data-range", "2000");
      expect(onRangeChange).toHaveBeenLastCalledWith(2000);

      fireEvent.keyDown(window, { key: "r" });
      expect(screen.getByTestId("radar-sweep-hud")).toHaveAttribute("data-range", "5000");
      expect(onRangeChange).toHaveBeenLastCalledWith(5000);

      fireEvent.keyDown(window, { key: "r" });
      expect(screen.getByTestId("radar-sweep-hud")).toHaveAttribute("data-range", "500");
      expect(onRangeChange).toHaveBeenLastCalledWith(500);
    });

    it("toggles colleague tracking on pressing T", () => {
      const onToggleTracking = jest.fn();
      render(
        <RadarSweepHUD
          initialTrackingEnabled={false}
          onToggleTracking={onToggleTracking}
        />,
      );

      expect(screen.getByTestId("radar-sweep-hud")).toHaveAttribute("data-tracking", "off");

      fireEvent.keyDown(window, { key: "t" });
      expect(screen.getByTestId("radar-sweep-hud")).toHaveAttribute("data-tracking", "on");
      expect(onToggleTracking).toHaveBeenCalledWith(true);

      fireEvent.keyDown(window, { key: "T" });
      expect(screen.getByTestId("radar-sweep-hud")).toHaveAttribute("data-tracking", "off");
      expect(onToggleTracking).toHaveBeenCalledWith(false);
    });

    it("toggles HUD grid and telemetry overlay visibility on pressing H", () => {
      const onToggleHudOverlay = jest.fn();
      render(
        <RadarSweepHUD
          initialHudOverlayVisible={true}
          onToggleHudOverlay={onToggleHudOverlay}
        />,
      );

      expect(screen.getByTestId("radar-hud-overlay")).toBeInTheDocument();

      fireEvent.keyDown(window, { key: "h" });
      expect(screen.queryByTestId("radar-hud-overlay")).not.toBeInTheDocument();
      expect(onToggleHudOverlay).toHaveBeenCalledWith(false);

      fireEvent.keyDown(window, { key: "H" });
      expect(screen.getByTestId("radar-hud-overlay")).toBeInTheDocument();
      expect(onToggleHudOverlay).toHaveBeenCalledWith(true);
    });

    it("triggers Escape handler and calls onClose when provided", () => {
      const onClose = jest.fn();
      const onToggleHudOverlay = jest.fn();

      render(
        <RadarSweepHUD
          onClose={onClose}
          onToggleHudOverlay={onToggleHudOverlay}
        />,
      );

      fireEvent.keyDown(window, { key: "Escape" });
      expect(onClose).toHaveBeenCalledTimes(1);
      expect(onToggleHudOverlay).toHaveBeenCalledWith(false);
    });

    it("renders discoverable <kbd> badges inside control tooltips", () => {
      render(<RadarSweepHUD />);

      const tooltips = screen.getAllByRole("tooltip");
      const kbdLabels = tooltips.flatMap((tooltip) =>
        Array.from(tooltip.querySelectorAll("kbd")).map((el) => el.textContent),
      );

      expect(kbdLabels).toEqual(expect.arrayContaining(["R", "T", "H", "Esc"]));
    });

    it("ignores hotkeys when typing in input, textarea, or contentEditable elements", () => {
      const onRangeChange = jest.fn();
      const onToggleTracking = jest.fn();
      const onToggleHudOverlay = jest.fn();
      const onClose = jest.fn();

      render(
        <div>
          <input aria-label="Search input" />
          <textarea aria-label="Notes textarea" />
          <div contentEditable="true" aria-label="Rich editor" />
          <RadarSweepHUD
            onRangeChange={onRangeChange}
            onToggleTracking={onToggleTracking}
            onToggleHudOverlay={onToggleHudOverlay}
            onClose={onClose}
          />
        </div>,
      );

      const input = screen.getByLabelText("Search input");
      const textarea = screen.getByLabelText("Notes textarea");
      const editor = screen.getByLabelText("Rich editor");

      fireEvent.keyDown(input, { key: "r" });
      fireEvent.keyDown(textarea, { key: "t" });
      fireEvent.keyDown(editor, { key: "h" });
      fireEvent.keyDown(input, { key: "Escape" });

      expect(onRangeChange).not.toHaveBeenCalled();
      expect(onToggleTracking).not.toHaveBeenCalled();
      expect(onToggleHudOverlay).not.toHaveBeenCalled();
      expect(onClose).not.toHaveBeenCalled();
    });
  });
});
