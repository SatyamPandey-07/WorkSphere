/** @jest-environment jsdom */
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NoiseSpectrogram } from "@/components/noise/NoiseSpectrogram";

describe("NoiseSpectrogram", () => {
  const mockGetUserMedia = jest.fn();
  const mockGetFloatFrequencyData = jest.fn((arr: Float32Array) => {
    arr.fill(-60);
    arr[10] = -35;
  });

  beforeEach(() => {
    jest.clearAllMocks();

    Object.defineProperty(global.navigator, "mediaDevices", {
      value: {
        getUserMedia: mockGetUserMedia,
      },
      configurable: true,
    });

    const mockAnalyser = {
      fftSize: 0,
      smoothingTimeConstant: 0,
      minDecibels: 0,
      maxDecibels: 0,
      frequencyBinCount: 1024,
      connect: jest.fn(),
      disconnect: jest.fn(),
      getFloatFrequencyData: mockGetFloatFrequencyData,
    };

    const mockSource = {
      connect: jest.fn(),
      disconnect: jest.fn(),
    };

    const mockAudioContext = {
      state: "running",
      resume: jest.fn().mockResolvedValue(undefined),
      close: jest.fn().mockResolvedValue(undefined),
      createMediaStreamSource: jest.fn(() => mockSource),
      createAnalyser: jest.fn(() => mockAnalyser),
    };

    Object.defineProperty(global, "AudioContext", {
      value: jest.fn(() => mockAudioContext),
      configurable: true,
    });

    mockGetUserMedia.mockResolvedValue({
      getTracks: () => [{ stop: jest.fn() }],
    });

    HTMLCanvasElement.prototype.getContext = jest.fn(() => ({
      fillRect: jest.fn(),
      fillStyle: "",
      getImageData: jest.fn(() => ({
        data: new Uint8ClampedArray(4),
        width: 1,
        height: 1,
      })),
      putImageData: jest.fn(),
      createImageData: jest.fn(() => ({
        data: new Uint8ClampedArray(640),
        width: 1,
        height: 160,
      })),
    })) as unknown as typeof HTMLCanvasElement.prototype.getContext;

    let rafId = 0;
    global.requestAnimationFrame = jest.fn((cb: FrameRequestCallback) => {
      rafId += 1;
      // don't auto-loop forever
      setTimeout(() => cb(performance.now()), 0);
      return rafId;
    });
    global.cancelAnimationFrame = jest.fn();
  });

  it("renders the spectrogram chrome", () => {
    render(<NoiseSpectrogram />);
    expect(screen.getByText(/FFT Noise Spectrogram/i)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Start spectrogram/i }),
    ).toBeInTheDocument();
  });

  it("wires the mic to AnalyserNode with fftSize 2048", async () => {
    render(<NoiseSpectrogram />);
    fireEvent.click(screen.getByRole("button", { name: /Start spectrogram/i }));

    await waitFor(() => {
      expect(mockGetUserMedia).toHaveBeenCalled();
    });

    const ctxInstance = (global.AudioContext as jest.Mock).mock.results[0]
      .value;
    const analyser = ctxInstance.createAnalyser.mock.results[0].value;
    expect(analyser.fftSize).toBe(2048);

    await waitFor(() => {
      expect(screen.getByLabelText(/Frequency spectrum bar chart/i)).toBeInTheDocument();
      expect(
        screen.getByLabelText(/Rolling spectrogram waterfall/i),
      ).toBeInTheDocument();
    });
  });
});
