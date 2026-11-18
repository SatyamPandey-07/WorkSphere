import React from "react";
import { render, screen, act } from "@testing-library/react";
import "@testing-library/jest-dom";
import {
  AudioLevelIndicator,
  lerpDecay,
  calculatePeakHold,
  DEFAULT_DECAY_FACTOR,
  PEAK_HOLD_DURATION_MS,
} from "@/components/audio/AudioLevelIndicator";

describe("AudioLevelIndicator decay and peak hold", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  describe("lerpDecay function", () => {
    it("smooths current level towards target level with decay factor (~0.05 per frame)", () => {
      const current = 1.0;
      const target = 0.0;
      const decayed = lerpDecay(current, target, DEFAULT_DECAY_FACTOR);
      expect(decayed).toBeCloseTo(0.95);
    });

    it("does not change level when current equals target", () => {
      expect(lerpDecay(0.5, 0.5, 0.05)).toBe(0.5);
    });
  });

  describe("calculatePeakHold function", () => {
    it("updates peak immediately when new level exceeds current peak", () => {
      const now = 1000;
      const result = calculatePeakHold(0.5, 0.8, 500, now, PEAK_HOLD_DURATION_MS);
      expect(result.peak).toBe(0.8);
      expect(result.peakTime).toBe(now);
    });

    it("holds peak level during 800ms hold duration", () => {
      const peakTime = 1000;
      const now = 1500; // 500ms elapsed (< 800ms)
      const result = calculatePeakHold(0.8, 0.2, peakTime, now, 800);
      expect(result.peak).toBe(0.8);
      expect(result.peakTime).toBe(peakTime);
    });

    it("descends peak after 800ms has elapsed", () => {
      const peakTime = 1000;
      const now = 1900; // 900ms elapsed (> 800ms)
      const result = calculatePeakHold(0.8, 0.2, peakTime, now, 800, 0.05);
      expect(result.peak).toBeCloseTo(0.75);
    });
  });

  describe("AudioLevelIndicator Component", () => {
    it("renders meter role with aria-valuenow and aria-label", () => {
      render(<AudioLevelIndicator level={0.75} size={60} />);
      const meter = screen.getByRole("meter");
      expect(meter).toBeInTheDocument();
      expect(meter).toHaveAttribute("aria-valuenow", "75");
    });

    it("renders peak hold indicator dot when audio is active", () => {
      render(<AudioLevelIndicator level={0.8} showPeakHold={true} />);
      const dot = screen.getByTestId("peak-hold-dot");
      expect(dot).toBeInTheDocument();
    });

    it("does not render peak hold dot when muted", () => {
      render(<AudioLevelIndicator level={0.8} muted={true} showPeakHold={true} />);
      expect(screen.queryByTestId("peak-hold-dot")).not.toBeInTheDocument();
    });

    it("cancels animation frame on unmount without errors", () => {
      const { unmount } = render(<AudioLevelIndicator level={0.5} />);
      expect(() => unmount()).not.toThrow();
    });
  });
});
