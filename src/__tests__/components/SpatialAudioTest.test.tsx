import React from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";
import "@testing-library/jest-dom";
import SpatialAudioTest from "@/components/SpatialAudioTest";

jest.mock("@/lib/spatial/SPSCRingBuffer", () => ({
  SPSCRingBuffer: jest.fn().mockImplementation(() => ({
    getSharedBuffer: jest.fn().mockReturnValue(new ArrayBuffer(1024)),
    push: jest.fn(),
    fillLevel: jest.fn().mockReturnValue(0.5),
  })),
}));

const mockPannerNode = {
  panningModel: "equalpower",
  distanceModel: "linear",
  positionX: { value: 0 },
  positionY: { value: 0 },
  positionZ: { value: 0 },
  orientationX: { value: 0 },
  orientationY: { value: 0 },
  orientationZ: { value: 0 },
  connect: jest.fn(),
  disconnect: jest.fn(),
};

Object.defineProperty(globalThis, "PannerNode", {
  value: jest.fn(() => mockPannerNode),
});

describe("SpatialAudioTest Interpolator (3D Coordinates)", () => {
  let mockPostMessage: jest.Mock;
  let mockGainNode: any;
  let mockCompressorNode: any;
  let mockAnalyserNode: any;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();

    mockPostMessage = jest.fn();

    const mockAudioListener = {
      positionX: { value: 0 },
      positionY: { value: 0 },
      positionZ: { value: 0 },
      forwardX: { value: 0 },
      forwardY: { value: 0 },
      forwardZ: { value: -1 },
      upX: { value: 0 },
      upY: { value: 1 },
      upZ: { value: 0 },
    };

    mockGainNode = {
      gain: {
        value: 1.0,
        setValueAtTime: jest.fn(),
      },
      connect: jest.fn(),
      disconnect: jest.fn(),
    };

    mockCompressorNode = {
      threshold: { value: -24 },
      knee: { value: 30 },
      ratio: { value: 12 },
      attack: { value: 0.003 },
      release: { value: 0.25 },
      connect: jest.fn(),
      disconnect: jest.fn(),
    };

    mockAnalyserNode = {
      fftSize: 256,
      frequencyBinCount: 128,
      getByteTimeDomainData: jest.fn((arr: Uint8Array) => arr.fill(128)),
      connect: jest.fn(),
      disconnect: jest.fn(),
    };

    Object.defineProperty(global, "AudioContext", {
      value: jest.fn().mockImplementation(() => ({
        audioWorklet: {
          addModule: jest.fn().mockResolvedValue(undefined),
        },
        listener: mockAudioListener,
        currentTime: 0,
        destination: {},
        close: jest.fn().mockResolvedValue(undefined),
        createGain: jest.fn(() => mockGainNode),
        createDynamicsCompressor: jest.fn(() => mockCompressorNode),
        createAnalyser: jest.fn(() => mockAnalyserNode),
      })),
      writable: true,
    });

    Object.defineProperty(global, "AudioWorkletNode", {
      value: jest.fn().mockImplementation(() => ({
        port: {
          postMessage: mockPostMessage,
          onmessage: null,
        },
        connect: jest.fn(),
        disconnect: jest.fn(),
      })),
      writable: true,
    });

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: jest.fn().mockResolvedValue(new ArrayBuffer(8)),
    }) as jest.Mock;

    Element.prototype.getBoundingClientRect = jest.fn().mockReturnValue({
      left: 100,
      top: 100,
      width: 200,
      height: 200,
    });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("updates 3D audio coordinates correctly when the user avatar moves", async () => {
    const { unmount } = render(<SpatialAudioTest />);

    const startButton = screen.getByRole("button", {
      name: /Start Spatializer/i,
    });
    await act(async () => {
      fireEvent.click(startButton);
    });

    await act(async () => {
      jest.advanceTimersByTime(200); // Flush any internal intervals/timeouts like preBufferAudio
    });

    const stopButton = await screen.findByRole("button", {
      name: /Stop Spatializer/i,
    });
    expect(stopButton).toBeInTheDocument();

    const mapHeading = screen.getByText(/Workspace co-worker map/i);
    const mapContainer = mapHeading.nextElementSibling as HTMLElement;

    await act(async () => {
      fireEvent.mouseDown(mapContainer, { clientX: 250, clientY: 150 });
    });

    expect(mockPostMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "UPDATE_SPATIAL",
        azimuth: expect.any(Number),
        elevation: expect.any(Number),
        distance: expect.any(Number),
      }),
    );

    const updateCalls = mockPostMessage.mock.calls.filter(
      (call) => call[0].type === "UPDATE_SPATIAL",
    );
    const lastCall = updateCalls[updateCalls.length - 1][0];

    expect(lastCall.distance).toBeGreaterThan(0);
    expect(lastCall.distance).toBeCloseTo(5.66, 1);
    expect(lastCall.azimuth).toBe(45);

    unmount();
  });

  describe("Input Gain Clamping, DynamicsCompressor, and Peak Meter", () => {
    it("renders input gain slider clamped between 0.01 (-40dB) and 2.0 (+6dB)", () => {
      const { unmount } = render(<SpatialAudioTest />);

      const slider = screen.getByTestId(
        "input-gain-slider",
      ) as HTMLInputElement;
      expect(slider).toBeInTheDocument();
      expect(slider.min).toBe("0.01");
      expect(slider.max).toBe("2");
      expect(slider.step).toBe("0.01");
      expect(slider.value).toBe("1");

      // Verify bounds text
      expect(screen.getByText(/-40 dB/)).toBeInTheDocument();
      expect(screen.getByText(/\+6 dB/)).toBeInTheDocument();

      unmount();
    });

    it("inserts DynamicsCompressorNode with -3dB threshold into the audio graph", async () => {
      const { unmount } = render(<SpatialAudioTest />);

      const startButton = screen.getByRole("button", {
        name: /Start Spatializer/i,
      });
      await act(async () => {
        fireEvent.click(startButton);
      });

      await act(async () => {
        jest.advanceTimersByTime(200);
      });

      expect(mockCompressorNode.threshold.value).toBe(-3);
      expect(mockCompressorNode.connect).toHaveBeenCalled();

      unmount();
    });

    it("displays visual peak meter indicator and triggers red zone warning when gain is amplified", async () => {
      const { unmount } = render(<SpatialAudioTest />);

      // Peak meter indicator should be rendered
      const peakMeter = screen.getByTestId("peak-meter-indicator");
      expect(peakMeter).toBeInTheDocument();

      // Initially at normal gain (1.0), no red zone warning
      expect(
        screen.queryByTestId("peak-meter-warning"),
      ).not.toBeInTheDocument();

      // Increase input gain to 1.8 (+5.1 dB), entering red zone
      const slider = screen.getByTestId("input-gain-slider");
      await act(async () => {
        fireEvent.change(slider, { target: { value: "1.8" } });
      });

      // Warning should now be visible
      const warning = screen.getByTestId("peak-meter-warning");
      expect(warning).toBeInTheDocument();
      expect(warning).toHaveTextContent(/red zone/i);
      expect(warning).toHaveTextContent(/-3dB/i);

      unmount();
    });
  });
});
