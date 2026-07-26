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

    Object.defineProperty(global, "AudioContext", {
      value: jest.fn().mockImplementation(() => ({
        audioWorklet: {
          addModule: jest.fn().mockResolvedValue(undefined),
        },
        listener: mockAudioListener,
        currentTime: 0,
        destination: {},
        close: jest.fn().mockResolvedValue(undefined),
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
});
