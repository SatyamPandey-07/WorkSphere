import React from "react";
import { render, screen, fireEvent, act, cleanup } from "@testing-library/react";
import {
  TacticalTargetReticle,
  stepSpring,
  sanitizeRect,
} from "@/components/ui/TacticalTargetReticle";

describe("TacticalTargetReticle", () => {
  const mockClose = jest.fn().mockResolvedValue(undefined);
  const mockResume = jest.fn().mockResolvedValue(undefined);
  const mockSetValueAtTime = jest.fn();
  const mockExponentialRampToValueAtTime = jest.fn();
  const mockConnect = jest.fn();
  const mockDisconnect = jest.fn();
  const mockStart = jest.fn();
  const mockStop = jest.fn();

  class MockAudioContext {
    state = "running";
    currentTime = 0;
    destination = {};
    createOscillator() {
      return {
        type: "sine",
        frequency: { setValueAtTime: mockSetValueAtTime },
        connect: mockConnect,
        disconnect: mockDisconnect,
        start: mockStart,
        stop: mockStop,
      };
    }
    createGain() {
      return {
        gain: {
          setValueAtTime: mockSetValueAtTime,
          exponentialRampToValueAtTime: mockExponentialRampToValueAtTime,
        },
        connect: mockConnect,
        disconnect: mockDisconnect,
      };
    }
    close() {
      this.state = "closed";
      mockClose();
      return Promise.resolve();
    }
    resume() {
      mockResume();
      return Promise.resolve();
    }
  }

  const mockCtx2d = {
    clearRect: jest.fn(),
    setTransform: jest.fn(),
    save: jest.fn(),
    restore: jest.fn(),
    beginPath: jest.fn(),
    moveTo: jest.fn(),
    lineTo: jest.fn(),
    arc: jest.fn(),
    stroke: jest.fn(),
    fill: jest.fn(),
    strokeStyle: "",
    fillStyle: "",
    lineWidth: 1,
    lineCap: "round",
    shadowColor: "",
    shadowBlur: 0,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();

    (window as unknown as { AudioContext: typeof MockAudioContext }).AudioContext = MockAudioContext;

    window.matchMedia = jest.fn().mockImplementation((query: string) => ({
      matches: true,
      media: query,
      onchange: null,
      addListener: jest.fn(),
      removeListener: jest.fn(),
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      dispatchEvent: jest.fn(),
    }));

    Object.defineProperty(window, "innerWidth", {
      writable: true,
      configurable: true,
      value: 1200,
    });

    Object.defineProperty(window, "innerHeight", {
      writable: true,
      configurable: true,
      value: 800,
    });

    HTMLCanvasElement.prototype.getContext = jest.fn().mockReturnValue(mockCtx2d);
  });

  afterEach(() => {
    act(() => {
      cleanup();
      jest.clearAllTimers();
    });
    jest.useRealTimers();
  });

  describe("stepSpring physics helper", () => {
    it("integrates velocity and position toward target smoothly", () => {
      const [pos1, vel1] = stepSpring(0, 0, 100, 0.016);
      expect(pos1).toBeGreaterThan(0);
      expect(vel1).toBeGreaterThan(0);

      const [pos2, vel2] = stepSpring(pos1, vel1, 100, 0.016);
      expect(pos2).toBeGreaterThan(pos1);
      expect(Number.isFinite(pos2)).toBe(true);
      expect(Number.isFinite(vel2)).toBe(true);
    });

    it("safely handles NaN and non-finite inputs without propagating NaN", () => {
      const [pos, vel] = stepSpring(NaN, 0, 100, 0.016);
      expect(pos).toBe(100);
      expect(vel).toBe(0);

      const [posTargetNan, velTargetNan] = stepSpring(50, 10, NaN, 0.016);
      expect(posTargetNan).toBe(50);
      expect(velTargetNan).toBe(0);

      const [posDtInvalid, velDtInvalid] = stepSpring(50, 10, 100, -1);
      expect(posDtInvalid).toBe(100);
      expect(velDtInvalid).toBe(0);
    });
  });

  describe("sanitizeRect helper", () => {
    it("preserves valid bounding boxes", () => {
      const rect = sanitizeRect({ x: 10, y: 20, w: 300, h: 200 });
      expect(rect).toEqual({ x: 10, y: 20, w: 300, h: 200 });
    });

    it("sanitizes negative dimensions and NaN values to zero", () => {
      const rect = sanitizeRect({ x: NaN, y: -10, w: -50, h: NaN });
      expect(rect).toEqual({ x: 0, y: -10, w: 0, h: 0 });
    });

    it("handles null or undefined safely", () => {
      expect(sanitizeRect(null)).toEqual({ x: 0, y: 0, w: 0, h: 0 });
      expect(sanitizeRect(undefined)).toEqual({ x: 0, y: 0, w: 0, h: 0 });
    });
  });

  describe("TacticalTargetReticle component", () => {
    it("renders children and desktop canvas overlay", () => {
      const { container } = render(
        <TacticalTargetReticle>
          <div data-testid="card-1" data-reticle-target>
            Card Content
          </div>
        </TacticalTargetReticle>,
      );

      expect(screen.getByTestId("card-1")).toBeInTheDocument();
      expect(container.querySelector("canvas")).toBeInTheDocument();
    });

    it("does not render canvas when viewport is mobile or touch", () => {
      window.matchMedia = jest.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: jest.fn(),
        removeListener: jest.fn(),
        addEventListener: jest.fn(),
        removeEventListener: jest.fn(),
        dispatchEvent: jest.fn(),
      }));

      const { container } = render(
        <TacticalTargetReticle>
          <div data-testid="card-mobile" data-reticle-target>
            Card Mobile
          </div>
        </TacticalTargetReticle>,
      );

      expect(screen.getByTestId("card-mobile")).toBeInTheDocument();
      expect(container.querySelector("canvas")).toBeNull();
    });

    it("activates target lock on pointer movement and parses distance attribute", () => {
      render(
        <TacticalTargetReticle toneFrequency={880} soundEnabled={true}>
          <div
            data-testid="target-card"
            data-reticle-target
            data-reticle-range="3.5"
            style={{ width: "200px", height: "100px" }}
          >
            Target Venue Card
          </div>
        </TacticalTargetReticle>,
      );

      const card = screen.getByTestId("target-card");
      card.getBoundingClientRect = jest.fn().mockReturnValue({
        left: 100,
        top: 150,
        width: 200,
        height: 100,
        right: 300,
        bottom: 250,
      });

      act(() => {
        fireEvent.mouseMove(card, { clientX: 120, clientY: 160 });
      });

      expect(screen.getByTestId("reticle-rangefinder")).toHaveTextContent("RNG 3.5 KM");

      // Advance timer for audio teardown
      act(() => {
        jest.advanceTimersByTime(500);
      });
      expect(mockDisconnect).toHaveBeenCalled();
    });

    it("falls back to pseudo-distance when range attribute is missing or NaN", () => {
      render(
        <TacticalTargetReticle toneFrequency={880} soundEnabled={true}>
          <div
            data-testid="fallback-card"
            data-reticle-target
            data-reticle-range="invalid"
            style={{ width: "200px", height: "100px" }}
          >
            Fallback Venue
          </div>
        </TacticalTargetReticle>,
      );

      const card = screen.getByTestId("fallback-card");
      card.getBoundingClientRect = jest.fn().mockReturnValue({
        left: 50,
        top: 80,
        width: 150,
        height: 90,
      });

      act(() => {
        fireEvent.mouseMove(card, { clientX: 60, clientY: 90 });
      });

      expect(screen.getByTestId("reticle-rangefinder").textContent).toMatch(/RNG \d+\.\d+ KM/);
    });

    it("suppresses lock sound when soundEnabled is false", () => {
      render(
        <TacticalTargetReticle soundEnabled={false}>
          <div data-testid="quiet-card" data-reticle-target>
            Quiet Card
          </div>
        </TacticalTargetReticle>,
      );

      const card = screen.getByTestId("quiet-card");
      card.getBoundingClientRect = jest.fn().mockReturnValue({
        left: 10,
        top: 20,
        width: 100,
        height: 100,
      });

      act(() => {
        fireEvent.mouseMove(card, { clientX: 20, clientY: 30 });
      });

      expect(mockSetValueAtTime).not.toHaveBeenCalled();
    });

    it("safely closes AudioContext and cancels frame loop on unmount", () => {
      const { unmount } = render(
        <TacticalTargetReticle soundEnabled={true}>
          <div data-testid="unmount-card" data-reticle-target>
            Unmount Test
          </div>
        </TacticalTargetReticle>,
      );

      const card = screen.getByTestId("unmount-card");
      card.getBoundingClientRect = jest.fn().mockReturnValue({
        left: 10,
        top: 20,
        width: 100,
        height: 100,
      });

      act(() => {
        fireEvent.mouseMove(card, { clientX: 20, clientY: 30 });
      });

      unmount();
      expect(mockClose).toHaveBeenCalled();
    });
  });
});
