import React from "react";
import { render, screen, fireEvent, act, cleanup } from "@testing-library/react";
import FocusTimerOverlay, {
  formatClock,
  playJetDecelerationSound,
  StarfieldCanvas,
} from "@/components/sessions/FocusTimerOverlay";

describe("FocusTimerOverlay & Audio/Visual Subsystems", () => {
  const mockClose = jest.fn().mockResolvedValue(undefined);
  const mockSetValueAtTime = jest.fn();
  const mockExponentialRampToValueAtTime = jest.fn();
  const mockConnect = jest.fn().mockReturnThis();
  const mockStart = jest.fn();
  const mockStop = jest.fn();

  class MockAudioContext {
    state = "running";
    currentTime = 0;
    sampleRate = 44100;
    destination = {};
    createOscillator() {
      return {
        type: "sawtooth",
        frequency: {
          setValueAtTime: mockSetValueAtTime,
          exponentialRampToValueAtTime: mockExponentialRampToValueAtTime,
        },
        connect: mockConnect,
        start: mockStart,
        stop: mockStop,
        onended: null as (() => void) | null,
      };
    }
    createGain() {
      return {
        gain: {
          setValueAtTime: mockSetValueAtTime,
          exponentialRampToValueAtTime: mockExponentialRampToValueAtTime,
        },
        connect: mockConnect,
      };
    }
    createBiquadFilter() {
      return {
        type: "lowpass",
        frequency: {
          setValueAtTime: mockSetValueAtTime,
          exponentialRampToValueAtTime: mockExponentialRampToValueAtTime,
        },
        Q: { value: 1 },
        connect: mockConnect,
      };
    }
    createBuffer(channels: number, length: number) {
      return {
        getChannelData: jest.fn().mockReturnValue(new Float32Array(length)),
      };
    }
    createBufferSource() {
      return {
        buffer: null,
        connect: mockConnect,
        start: mockStart,
        stop: mockStop,
      };
    }
    close() {
      this.state = "closed";
      mockClose();
      return Promise.resolve();
    }
  }

  const mockCtx2d = {
    clearRect: jest.fn(),
    fillRect: jest.fn(),
    setTransform: jest.fn(),
    beginPath: jest.fn(),
    moveTo: jest.fn(),
    lineTo: jest.fn(),
    stroke: jest.fn(),
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 1,
    globalAlpha: 1,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();

    (window as unknown as { AudioContext: typeof MockAudioContext }).AudioContext = MockAudioContext;

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

    HTMLCanvasElement.prototype.getContext = jest.fn().mockReturnValue(mockCtx2d);
  });

  afterEach(() => {
    act(() => {
      cleanup();
      jest.clearAllTimers();
    });
    jest.useRealTimers();
  });

  describe("formatClock helper", () => {
    it("formats minutes and seconds correctly", () => {
      expect(formatClock(125)).toBe("02:05");
      expect(formatClock(60)).toBe("01:00");
      expect(formatClock(9)).toBe("00:09");
    });

    it("formats hours, minutes, and seconds when exceeding 3600", () => {
      expect(formatClock(3665)).toBe("1:01:05");
      expect(formatClock(7200)).toBe("2:00:00");
    });

    it("guards safely against zero, negative, and NaN inputs", () => {
      expect(formatClock(0)).toBe("00:00");
      expect(formatClock(-100)).toBe("00:00");
      expect(formatClock(NaN)).toBe("00:00");
      expect(formatClock(Infinity)).toBe("00:00");
    });
  });

  describe("playJetDecelerationSound synthesizer", () => {
    it("synthesizes deceleration tone with master gain and ramp envelopes", () => {
      playJetDecelerationSound(0.8);
      expect(mockSetValueAtTime).toHaveBeenCalled();
      expect(mockExponentialRampToValueAtTime).toHaveBeenCalled();
      expect(mockStart).toHaveBeenCalled();
    });

    it("early exits when volume is non-positive or NaN", () => {
      playJetDecelerationSound(0);
      expect(mockSetValueAtTime).not.toHaveBeenCalled();

      playJetDecelerationSound(-0.5);
      expect(mockSetValueAtTime).not.toHaveBeenCalled();

      playJetDecelerationSound(NaN);
      expect(mockSetValueAtTime).not.toHaveBeenCalled();
    });

    it("triggers safety teardown timer and closes AudioContext when onended does not fire", () => {
      playJetDecelerationSound(1);
      expect(mockClose).not.toHaveBeenCalled();

      act(() => {
        jest.advanceTimersByTime(3100);
      });

      expect(mockClose).toHaveBeenCalled();
    });
  });

  describe("StarfieldCanvas component", () => {
    it("renders canvas and handles normal streak animation frame", () => {
      const { container } = render(
        <StarfieldCanvas motion="full" active={true} />,
      );

      const canvas = container.querySelector("canvas");
      expect(canvas).toBeInTheDocument();

      act(() => {
        jest.advanceTimersByTime(50);
      });

      expect(mockCtx2d.fillRect).toHaveBeenCalled();
    });

    it("renders static stars without continuous animation loop when prefers-reduced-motion is active", () => {
      window.matchMedia = jest.fn().mockImplementation((query: string) => ({
        matches: query.includes("prefers-reduced-motion"),
        media: query,
        onchange: null,
        addListener: jest.fn(),
        removeListener: jest.fn(),
        addEventListener: jest.fn(),
        removeEventListener: jest.fn(),
        dispatchEvent: jest.fn(),
      }));

      const { container } = render(
        <StarfieldCanvas motion="full" active={true} />,
      );

      expect(container.querySelector("canvas")).toBeInTheDocument();
      expect(mockCtx2d.fillRect).toHaveBeenCalled();
    });
  });

  describe("FocusTimerOverlay component", () => {
    it("renders countdown clock and progress accurately for a 1500s session", () => {
      render(
        <FocusTimerOverlay
          durationSeconds={1500}
          isRunning={false}
        />,
      );

      expect(screen.getByTestId("focus-timer-clock")).toHaveTextContent("25:00");
      expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "0");
    });

    it("counts down every second while running and pauses on button click", () => {
      render(
        <FocusTimerOverlay
          durationSeconds={30}
          isRunning={true}
        />,
      );

      expect(screen.getByTestId("focus-timer-clock")).toHaveTextContent("00:30");

      act(() => {
        jest.advanceTimersByTime(5000);
      });

      expect(screen.getByTestId("focus-timer-clock")).toHaveTextContent("00:25");

      const pauseBtn = screen.getByRole("button", { name: /pause/i });
      fireEvent.click(pauseBtn);

      act(() => {
        jest.advanceTimersByTime(3000);
      });

      // Still 25 seconds because paused
      expect(screen.getByTestId("focus-timer-clock")).toHaveTextContent("00:25");
    });

    it("restarts session back to initial duration on Restart button click", () => {
      render(
        <FocusTimerOverlay
          durationSeconds={10}
          isRunning={true}
        />,
      );

      act(() => {
        jest.advanceTimersByTime(4000);
      });

      expect(screen.getByTestId("focus-timer-clock")).toHaveTextContent("00:06");

      const restartBtn = screen.getByRole("button", { name: /restart/i });
      fireEvent.click(restartBtn);

      expect(screen.getByTestId("focus-timer-clock")).toHaveTextContent("00:10");
    });

    it("completes session and invokes onComplete and sound when countdown finishes", () => {
      const onCompleteMock = jest.fn();

      render(
        <FocusTimerOverlay
          durationSeconds={2}
          isRunning={true}
          onComplete={onCompleteMock}
        />,
      );

      act(() => {
        jest.advanceTimersByTime(2500);
      });

      expect(screen.getByTestId("focus-timer-clock")).toHaveTextContent("00:00");
      expect(screen.getByRole("status")).toHaveTextContent(/Session complete/i);
      expect(onCompleteMock).toHaveBeenCalledTimes(1);
      expect(mockSetValueAtTime).toHaveBeenCalled();
    });

    it("renders mach-lock starfield backdrop and respects theme prop", () => {
      render(
        <FocusTimerOverlay
          durationSeconds={60}
          isRunning={true}
          theme="mach-lock"
        />,
      );

      expect(screen.getByTestId("mach-lock-starfield")).toBeInTheDocument();
      expect(screen.getByText(/Mission Clock — Mach Lock/i)).toBeInTheDocument();
    });

    it("toggles sound state to off and suppresses audio on completion", () => {
      const onCompleteMock = jest.fn();

      render(
        <FocusTimerOverlay
          durationSeconds={2}
          isRunning={true}
          onComplete={onCompleteMock}
        />,
      );

      const soundBtn = screen.getByRole("button", { name: /sound/i });
      fireEvent.click(soundBtn); // Sound off

      act(() => {
        jest.advanceTimersByTime(2500);
      });

      expect(onCompleteMock).toHaveBeenCalledTimes(1);
      expect(mockSetValueAtTime).not.toHaveBeenCalled();
    });

    it("handles zero or NaN durationSeconds safely", () => {
      render(
        <FocusTimerOverlay
          durationSeconds={NaN}
          isRunning={true}
        />,
      );

      expect(screen.getByTestId("focus-timer-clock")).toHaveTextContent("00:00");
      expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "0");
    });
  });
});
