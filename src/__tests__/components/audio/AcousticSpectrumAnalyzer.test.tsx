import React from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";
import {
  AcousticSpectrumAnalyzer,
  NUM_FREQUENCY_BARS,
  FREQUENCY_BANDS_32,
} from "@/components/audio/AcousticSpectrumAnalyzer";

describe("AcousticSpectrumAnalyzer Component", () => {
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

    jest.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});

    mockCtx = {
      clearRect: jest.fn(),
      fillRect: jest.fn(),
      beginPath: jest.fn(),
      moveTo: jest.fn(),
      lineTo: jest.fn(),
      stroke: jest.fn(),
      fill: jest.fn(),
      save: jest.fn(),
      restore: jest.fn(),
      scale: jest.fn(),
      fillText: jest.fn(),
      createLinearGradient: jest.fn().mockReturnValue({
        addColorStop: jest.fn(),
      }),
      setLineDash: jest.fn(),
      fillStyle: "",
      strokeStyle: "",
      lineWidth: 1,
      shadowColor: "",
      shadowBlur: 0,
      font: "",
      textAlign: "",
      textBaseline: "",
    };

    HTMLCanvasElement.prototype.getContext = jest.fn((contextId) => {
      if (contextId === "2d") return mockCtx;
      return null;
    }) as any;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("renders container, canvas, 32-band badge, and 20 dB/s decay badge", () => {
    render(<AcousticSpectrumAnalyzer />);

    expect(screen.getByTestId("acoustic-spectrum-analyzer")).toBeInTheDocument();
    expect(screen.getByTestId("acoustic-spectrum-canvas")).toBeInTheDocument();
    expect(screen.getByTestId("spectrum-bars-badge")).toHaveTextContent("32 BANDS");
    expect(screen.getByTestId("spectrum-decay-badge")).toHaveTextContent("20 dB/s DECAY");
  });

  it("exports 32 frequency bands matching the acoustic specification", () => {
    expect(NUM_FREQUENCY_BARS).toBe(32);
    expect(FREQUENCY_BANDS_32).toHaveLength(32);
    expect(FREQUENCY_BANDS_32[0]).toBe(20);
    expect(FREQUENCY_BANDS_32[31]).toBe(20000);
  });

  it("toggles pause and resume when pause button is clicked", () => {
    const onPauseChange = jest.fn();
    render(<AcousticSpectrumAnalyzer onPauseChange={onPauseChange} />);

    const pauseBtn = screen.getByTestId("spectrum-pause-button");
    expect(pauseBtn).toHaveTextContent("Pause");

    fireEvent.click(pauseBtn);
    expect(pauseBtn).toHaveTextContent("Resume");
    expect(onPauseChange).toHaveBeenCalledWith(true);

    fireEvent.click(pauseBtn);
    expect(pauseBtn).toHaveTextContent("Pause");
    expect(onPauseChange).toHaveBeenCalledWith(false);
  });

  it("toggles full-screen expansion modal and supports keyboard dismissal", () => {
    const onExpandChange = jest.fn();
    render(<AcousticSpectrumAnalyzer onExpandChange={onExpandChange} />);

    const expandBtn = screen.getByTestId("spectrum-expand-button");
    fireEvent.click(expandBtn);

    expect(onExpandChange).toHaveBeenCalledWith(true);
    expect(screen.getByTestId("spectrum-modal-overlay")).toBeInTheDocument();
    expect(screen.getByTestId("acoustic-spectrum-modal-canvas")).toBeInTheDocument();

    // Dismiss with close button
    const closeBtn = screen.getByTestId("spectrum-modal-close");
    fireEvent.click(closeBtn);

    expect(onExpandChange).toHaveBeenCalledWith(false);
    expect(screen.queryByTestId("spectrum-modal-overlay")).not.toBeInTheDocument();
  });

  it("handles spacebar shortcut to pause and resume", () => {
    const onPauseChange = jest.fn();
    render(<AcousticSpectrumAnalyzer onPauseChange={onPauseChange} />);

    fireEvent.keyDown(window, { code: "Space" });
    expect(onPauseChange).toHaveBeenCalledWith(true);

    fireEvent.keyDown(window, { code: "Space" });
    expect(onPauseChange).toHaveBeenCalledWith(false);
  });

  it("resets peak hold values when reset button is clicked", () => {
    render(<AcousticSpectrumAnalyzer />);

    const resetBtn = screen.getByTestId("spectrum-reset-peaks-button");
    expect(resetBtn).toBeInTheDocument();
    fireEvent.click(resetBtn);
  });
});
