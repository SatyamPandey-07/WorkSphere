import { render, screen, fireEvent, act } from "@testing-library/react";
import "@testing-library/jest-dom";
import { NoiseMeter } from "@/components/noise/NoiseMeter";

const mockProcessAudioFrame = jest
  .fn()
  .mockResolvedValue({ rms: 0.5, db: 80.5 });
const mockResetNoiseProcessor = jest.fn();

jest.mock("@/lib/wasm/noiseProcessor", () => ({
  processAudioFrame: (...args: unknown[]) => mockProcessAudioFrame(...args),
  resetNoiseProcessor: (...args: unknown[]) => mockResetNoiseProcessor(...args),
}));

const mockGetUserMedia = jest.fn();
let rafCallback: FrameRequestCallback | null = null;
let rafId = 0;

beforeAll(() => {
  Object.defineProperty(global, "navigator", {
    value: {
      mediaDevices: {
        getUserMedia: mockGetUserMedia,
      },
    },
    configurable: true,
  });
});

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();

  rafCallback = null;
  rafId = 0;

  global.requestAnimationFrame = jest.fn((cb: FrameRequestCallback) => {
    rafCallback = cb;
    rafId++;
    return rafId;
  });

  global.cancelAnimationFrame = jest.fn();

  const mockStream = { getTracks: () => [{ stop: jest.fn() }] };
  mockGetUserMedia.mockResolvedValue(mockStream);

  Object.defineProperty(global, "AudioContext", {
    value: jest.fn().mockImplementation(() => ({
      createMediaStreamSource: jest.fn().mockReturnValue({
        connect: jest.fn(),
      }),
      createAnalyser: jest.fn().mockReturnValue({
        fftSize: 2048,
        smoothingTimeConstant: 0.25,
        getFloatTimeDomainData: jest.fn((arr: Float32Array) => {
          for (let i = 0; i < arr.length; i++) {
            arr[i] = 0.5 * Math.sin(i * 0.1);
          }
        }),
      }),
      close: jest.fn().mockResolvedValue(undefined),
    })),
    writable: true,
  });

  HTMLCanvasElement.prototype.getContext = jest.fn().mockReturnValue({
    clearRect: jest.fn(),
    beginPath: jest.fn(),
    moveTo: jest.fn(),
    lineTo: jest.fn(),
    stroke: jest.fn(),
  });
});

afterEach(() => {
  jest.useRealTimers();
});

it("renders idle state with measure button", () => {
  render(<NoiseMeter onMeasured={jest.fn()} />);

  expect(screen.getByText("Measure Ambient Noise")).toBeInTheDocument();
  expect(screen.getByText("⚡ Decibel Noise Monitor")).toBeInTheDocument();
});

it("shows measuring state when button is clicked", async () => {
  render(<NoiseMeter onMeasured={jest.fn()} />);

  await act(async () => {
    fireEvent.click(screen.getByText("Measure Ambient Noise"));
    await jest.advanceTimersByTimeAsync(50);
  });

  expect(screen.getByText(/LIVE FREQ/i)).toBeInTheDocument();
});

it("shows error state when getUserMedia fails", async () => {
  mockGetUserMedia.mockRejectedValue(new Error("Permission denied"));

  render(<NoiseMeter onMeasured={jest.fn()} />);

  await act(async () => {
    fireEvent.click(screen.getByText("Measure Ambient Noise"));
  });

  expect(screen.getByText(/Microphone access failed/i)).toBeInTheDocument();
});

it("calls onMeasured after measurement completes", async () => {
  const onMeasured = jest.fn();
  render(<NoiseMeter onMeasured={onMeasured} />);

  await act(async () => {
    fireEvent.click(screen.getByText("Measure Ambient Noise"));
    await jest.advanceTimersByTimeAsync(50);
  });

  expect(rafCallback).not.toBeNull();

  await act(async () => {
    if (rafCallback) {
      rafCallback(performance.now());
    }
    await jest.advanceTimersByTimeAsync(5000);
  });

  expect(onMeasured).toHaveBeenCalledWith(
    expect.objectContaining({
      averageDb: expect.any(Number),
      peakDb: expect.any(Number),
    }),
  );
});

it("shows result state after measurement", async () => {
  render(<NoiseMeter onMeasured={jest.fn()} />);

  await act(async () => {
    fireEvent.click(screen.getByText("Measure Ambient Noise"));
    await jest.advanceTimersByTimeAsync(50);
  });

  if (rafCallback) {
    await act(async () => {
      rafCallback!(performance.now());
      await jest.advanceTimersByTimeAsync(5000);
    });
  }

  expect(screen.getByText(/Measure again/i)).toBeInTheDocument();
});

it("calls cleanup on unmount during measurement", async () => {
  const { unmount } = render(<NoiseMeter onMeasured={jest.fn()} />);

  await act(async () => {
    fireEvent.click(screen.getByText("Measure Ambient Noise"));
    await jest.advanceTimersByTimeAsync(50);
  });

  unmount();

  expect(global.cancelAnimationFrame).toHaveBeenCalled();
});

it("renders measuring UI with decibel reading and progress bar", async () => {
  render(<NoiseMeter onMeasured={jest.fn()} />);

  await act(async () => {
    fireEvent.click(screen.getByText("Measure Ambient Noise"));
    await jest.advanceTimersByTimeAsync(50);
  });

  expect(screen.getAllByText(/dB/).length).toBeGreaterThanOrEqual(1);
  expect(screen.getByText(/Vibe Classification/i)).toBeInTheDocument();
  expect(screen.getByText(/Measuring/i)).toBeInTheDocument();
});
