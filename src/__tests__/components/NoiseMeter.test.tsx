import React from "react";
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

describe("NoiseMeter Component & 60fps Audio Throttling", () => {
  const mockOnMeasured = jest.fn();
  const mockGetUserMedia = jest.fn();
  let rafCallback: FrameRequestCallback | null = null;
  let rafId = 0;

  beforeAll(() => {
    Object.defineProperty(global, "navigator", {
      value: {
        mediaDevices: {
          getUserMedia: mockGetUserMedia,
          addEventListener: jest.fn(),
          removeEventListener: jest.fn(),
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
          disconnect: jest.fn(),
        }),
        createAnalyser: jest.fn().mockReturnValue({
          fftSize: 2048,
          smoothingTimeConstant: 0.25,
          disconnect: jest.fn(),
          getFloatTimeDomainData: jest.fn((arr: Float32Array) => {
            for (let i = 0; i < arr.length; i++) {
              arr[i] = 0.5 * Math.sin(i * 0.1);
            }
          }),
        }),
        close: jest.fn().mockResolvedValue(undefined),
        state: "running",
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
    render(<NoiseMeter onMeasured={mockOnMeasured} />);

    expect(
      screen.getByRole("button", { name: /Measure Ambient Noise/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Decibel Noise Monitor/i)).toBeInTheDocument();
  });

  it("shows measuring state when button is clicked", async () => {
    render(<NoiseMeter onMeasured={mockOnMeasured} />);

    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: /Measure Ambient Noise/i }),
      );
      await jest.advanceTimersByTimeAsync(50);
    });

    expect(screen.getByText(/LIVE FREQ/i)).toBeInTheDocument();
  });

  it("shows error state when getUserMedia fails", async () => {
    mockGetUserMedia.mockRejectedValue(new Error("Permission denied"));

    render(<NoiseMeter onMeasured={mockOnMeasured} />);

    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: /Measure Ambient Noise/i }),
      );
    });

    expect(screen.getByText(/Microphone access failed/i)).toBeInTheDocument();
  });

  it("calls onMeasured after measurement completes", async () => {
    const onMeasured = jest.fn();
    render(<NoiseMeter onMeasured={onMeasured} />);

    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: /Measure Ambient Noise/i }),
      );
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

  it("throttles rAF calls spaced closer than 16.67ms (60fps cap)", () => {
    let lastTickTime: number | null = null;
    const targetFrameInterval = 1000 / 60; // ~16.67ms
    let getFloatTimeDomainDataCalls = 0;

    const mockAnalyser = {
      getFloatTimeDomainData: () => {
        getFloatTimeDomainDataCalls++;
      },
    };

    const tick = (timestamp: number) => {
      const now = timestamp;
      if (lastTickTime !== null) {
        const delta = now - lastTickTime;
        if (delta < targetFrameInterval) {
          return; // Throttled
        }
        lastTickTime = now - (delta % targetFrameInterval);
      } else {
        lastTickTime = now;
      }
      mockAnalyser.getFloatTimeDomainData();
    };

    // Frame 1: 0ms -> Executes
    tick(0);
    expect(getFloatTimeDomainDataCalls).toBe(1);

    // Frame 2: 8.33ms (120Hz frame) -> Should be THROTTLED
    tick(8.33);
    expect(getFloatTimeDomainDataCalls).toBe(1);

    // Frame 3: 16.67ms -> Should EXECUTE (60fps threshold reached)
    tick(16.67);
    expect(getFloatTimeDomainDataCalls).toBe(2);

    // Frame 4: 25ms (120Hz frame) -> Should be THROTTLED
    tick(25.0);
    expect(getFloatTimeDomainDataCalls).toBe(2);

    // Frame 5: 33.34ms -> Should EXECUTE
    tick(33.34);
    expect(getFloatTimeDomainDataCalls).toBe(3);
  });

  it("handles devicechange by resuming AudioContext and re-acquiring stream if ended", async () => {
    let deviceChangeCb: EventListener | null = null;
    const mockResume = jest.fn().mockResolvedValue(undefined);

    const mockTrack = { stop: jest.fn(), readyState: "live" };
    const mockStream = {
      getAudioTracks: () => [mockTrack],
      getTracks: () => [mockTrack],
    };
    mockGetUserMedia.mockResolvedValue(mockStream);

    global.navigator.mediaDevices.addEventListener = jest.fn((evt, cb) => {
      if (evt === "devicechange") deviceChangeCb = cb as any;
    });

    const mockAudioContext = {
      createMediaStreamSource: jest
        .fn()
        .mockReturnValue({ connect: jest.fn(), disconnect: jest.fn() }),
      createAnalyser: jest
        .fn()
        .mockReturnValue({
          fftSize: 2048,
          smoothingTimeConstant: 0.25,
          disconnect: jest.fn(),
          getFloatTimeDomainData: jest.fn(),
        }),
      close: jest.fn().mockResolvedValue(undefined),
      resume: mockResume,
      state: "suspended",
    };

    Object.defineProperty(global, "AudioContext", {
      value: jest.fn().mockImplementation(() => mockAudioContext),
      writable: true,
    });

    render(<NoiseMeter onMeasured={mockOnMeasured} />);

    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: /Measure Ambient Noise/i }),
      );
      await jest.advanceTimersByTimeAsync(50);
    });

    expect(deviceChangeCb).not.toBeNull();

    // Trigger devicechange (context suspended -> calls resume)
    await act(async () => {
      if (deviceChangeCb) {
        await (deviceChangeCb as EventListener)(new Event("devicechange"));
      }
    });

    expect(mockResume).toHaveBeenCalled();

    // Trigger devicechange with ended track (requires re-acquiring stream)
    mockTrack.readyState = "ended";
    const mockTrack2 = { stop: jest.fn(), readyState: "live" };
    const newMockStream = {
      getAudioTracks: () => [mockTrack2],
      getTracks: () => [mockTrack2],
    };
    mockGetUserMedia.mockResolvedValueOnce(newMockStream);

    await act(async () => {
      if (deviceChangeCb) {
        await (deviceChangeCb as EventListener)(new Event("devicechange"));
      }
    });

    expect(mockGetUserMedia).toHaveBeenCalledTimes(2);

    await act(async () => {
      await jest.advanceTimersByTimeAsync(5000);
    });
  });
});
