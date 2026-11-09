import React from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";
import "@testing-library/jest-dom";
import {
  EnhancedNoiseMeter,
  MIN_DB,
  MAX_DB,
  sanitizeDecibel,
  calculateNeedlePosition,
  frequencyDataToDb,
  rmsToDb,
} from "@/components/noise/EnhancedNoiseMeter";

const mockStartAudioProcessing = jest.fn();
const mockInitAudioDSP = jest.fn().mockResolvedValue(undefined);
const mockSetSensitivity = jest.fn();
const mockResetCalibration = jest.fn();

jest.mock("@/lib/wasm/audioDSPManager", () => ({
  initAudioDSP: () => mockInitAudioDSP(),
  startAudioProcessing: (
    onRms: (rms: number) => void,
    options?: Record<string, unknown>,
  ) => mockStartAudioProcessing(onRms, options),
  setSensitivity: (val: number) => mockSetSensitivity(val),
  resetCalibration: () => mockResetCalibration(),
}));

describe("EnhancedNoiseMeter - Decibel Clamping & Sanitization", () => {
  describe("sanitizeDecibel()", () => {
    it("returns MIN_DB (30) for -Infinity, NaN, null, and undefined", () => {
      expect(sanitizeDecibel(-Infinity)).toBe(MIN_DB);
      expect(sanitizeDecibel(NaN)).toBe(MIN_DB);
      expect(sanitizeDecibel(null)).toBe(MIN_DB);
      expect(sanitizeDecibel(undefined)).toBe(MIN_DB);
    });

    it("clamps negative values and readings below 30 dB to MIN_DB (30)", () => {
      expect(sanitizeDecibel(-100)).toBe(MIN_DB);
      expect(sanitizeDecibel(-1)).toBe(MIN_DB);
      expect(sanitizeDecibel(0)).toBe(MIN_DB);
      expect(sanitizeDecibel(15)).toBe(MIN_DB);
      expect(sanitizeDecibel(29.9)).toBe(MIN_DB);
    });

    it("clamps readings above 120 dB and +Infinity to MAX_DB (120)", () => {
      expect(sanitizeDecibel(120.1)).toBe(MAX_DB);
      expect(sanitizeDecibel(150)).toBe(MAX_DB);
      expect(sanitizeDecibel(Infinity)).toBe(MAX_DB);
    });

    it("preserves valid values between 30 and 120 dB", () => {
      expect(sanitizeDecibel(30)).toBe(30);
      expect(sanitizeDecibel(55.44)).toBe(55.4);
      expect(sanitizeDecibel(75)).toBe(75);
      expect(sanitizeDecibel(120)).toBe(120);
    });
  });

  describe("calculateNeedlePosition()", () => {
    it("clamps needle percentage to 0% for out-of-bounds low or non-finite inputs", () => {
      expect(calculateNeedlePosition(-Infinity)).toBe(0);
      expect(calculateNeedlePosition(NaN)).toBe(0);
      expect(calculateNeedlePosition(-50)).toBe(0);
      expect(calculateNeedlePosition(0)).toBe(0);
      expect(calculateNeedlePosition(30)).toBe(0);
    });

    it("clamps needle percentage to 100% for inputs >= 120 dB", () => {
      expect(calculateNeedlePosition(120)).toBe(100);
      expect(calculateNeedlePosition(140)).toBe(100);
      expect(calculateNeedlePosition(Infinity)).toBe(100);
    });

    it("accurately calculates mid-range percentages", () => {
      // 75 dB is midway between 30 dB and 120 dB ((75 - 30) / 90 * 100 = 50%)
      expect(calculateNeedlePosition(75)).toBe(50);
      // 48 dB -> (48 - 30) / 90 * 100 = 20%
      expect(calculateNeedlePosition(48)).toBe(20);
    });
  });

  describe("frequencyDataToDb()", () => {
    it("filters out -Infinity, NaN, and anomalous values from frequency arrays", () => {
      const allSilent = new Float32Array([-Infinity, -Infinity, -Infinity]);
      expect(frequencyDataToDb(allSilent)).toBe(MIN_DB);

      const nanArray = [NaN, -Infinity];
      expect(frequencyDataToDb(nanArray)).toBe(MIN_DB);

      const empty = new Float32Array([]);
      expect(frequencyDataToDb(empty)).toBe(MIN_DB);
    });

    it("averages valid bins and clamps to safe decibel range", () => {
      // Valid bins: -40 dBFS and -60 dBFS -> average -50 dBFS -> + 100 = 50 dB SPL
      const mixedBins = [-Infinity, -40, NaN, -60, -Infinity];
      expect(frequencyDataToDb(mixedBins)).toBe(50);
    });
  });

  describe("rmsToDb()", () => {
    it("returns MIN_DB (30) for zero, negative, or non-finite RMS values", () => {
      expect(rmsToDb(0)).toBe(MIN_DB);
      expect(rmsToDb(-0.5)).toBe(MIN_DB);
      expect(rmsToDb(NaN)).toBe(MIN_DB);
      expect(rmsToDb(-Infinity)).toBe(MIN_DB);
      expect(rmsToDb(0.000005)).toBe(MIN_DB);
    });

    it("converts RMS to clamped decibels accurately", () => {
      // rms = 1 -> 20 * log10(1) + 100 = 100 dB
      expect(rmsToDb(1)).toBe(100);
      // Large rms -> clamped to 120 dB
      expect(rmsToDb(100)).toBe(MAX_DB);
    });
  });
});

describe("EnhancedNoiseMeter Component", () => {
  const mockOnMeasured = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();

    HTMLCanvasElement.prototype.getContext = jest.fn().mockReturnValue({
      clearRect: jest.fn(),
      beginPath: jest.fn(),
      moveTo: jest.fn(),
      lineTo: jest.fn(),
      stroke: jest.fn(),
    });
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  it("renders idle state with 'Measure Noise' button", async () => {
    await act(async () => {
      render(<EnhancedNoiseMeter onMeasured={mockOnMeasured} />);
    });

    expect(
      screen.getByRole("button", { name: /Measure Noise/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/WASM SIMD Noise Analyzer/i)).toBeInTheDocument();
  });

  it("renders needle with ease-out timing and clamped gauge limits when measuring", async () => {
    await act(async () => {
      render(
        <EnhancedNoiseMeter
          onMeasured={mockOnMeasured}
          initialStatus="measuring"
          initialDb={75}
        />,
      );
    });

    expect(screen.getByText("30 dB")).toBeInTheDocument();
    expect(screen.getByText("120 dB")).toBeInTheDocument();

    const needle = screen.getByTestId("meter-needle");
    expect(needle).toBeInTheDocument();
    expect(needle).toHaveClass("ease-out");
    expect(needle.style.transitionTimingFunction).toBe("ease-out");
    // At 75 dB, needle should be at 50%
    expect(needle.style.left).toBe("50%");
  });

  it("clamps needle to gauge boundaries (0% and 100%) even for extreme initial readings", async () => {
    const { unmount } = await act(async () => {
      return render(
        <EnhancedNoiseMeter
          onMeasured={mockOnMeasured}
          initialStatus="measuring"
          initialDb={-Infinity}
        />,
      );
    });

    const needleLow = screen.getByTestId("meter-needle");
    expect(needleLow.style.left).toBe("0%");

    unmount();

    await act(async () => {
      render(
        <EnhancedNoiseMeter
          onMeasured={mockOnMeasured}
          initialStatus="measuring"
          initialDb={200}
        />,
      );
    });

    const needleHigh = screen.getByTestId("meter-needle");
    expect(needleHigh.style.left).toBe("100%");
  });

  it("performs audio measurement, handles stream spikes, and returns clamped results", async () => {
    let capturedRmsCallback: ((rms: number) => void) | null = null;
    const cleanupMock = jest.fn();

    mockStartAudioProcessing.mockImplementation(
      async (onRms: (rms: number) => void) => {
        capturedRmsCallback = onRms;
        return cleanupMock;
      },
    );

    await act(async () => {
      render(<EnhancedNoiseMeter onMeasured={mockOnMeasured} />);
    });

    const measureButton = screen.getByRole("button", {
      name: /Measure Noise/i,
    });
    await act(async () => {
      fireEvent.click(measureButton);
    });

    // Component is now measuring
    expect(screen.getByText(/Analyzing\.\.\./i)).toBeInTheDocument();
    expect(capturedRmsCallback).not.toBeNull();

    // Send anomalous spikes and -Infinity / 0 RMS values
    act(() => {
      capturedRmsCallback?.(0); // -> clamped to 30 dB
      capturedRmsCallback?.(-1); // -> clamped to 30 dB
      capturedRmsCallback?.(1); // 100 dB
      capturedRmsCallback?.(999); // extreme spike -> clamped to 120 dB
    });

    const needle = screen.getByTestId("meter-needle");
    expect(needle).toBeInTheDocument();
    expect(needle).toHaveClass("ease-out");

    // Advance 5-second countdown to finish measurement
    await act(async () => {
      jest.advanceTimersByTime(5000);
    });

    expect(cleanupMock).toHaveBeenCalled();
    expect(mockOnMeasured).toHaveBeenCalledTimes(1);

    const result = mockOnMeasured.mock.calls[0][0];
    expect(result.averageDb).toBeGreaterThanOrEqual(30);
    expect(result.averageDb).toBeLessThanOrEqual(120);
    expect(result.peakDb).toBe(120); // Clamped maximum
  });
});
