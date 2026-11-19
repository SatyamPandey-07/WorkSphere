import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import {
  NoiseVisualizer,
  classifyDecibels,
  computeDecibelsFromTimeDomain,
} from "@/components/venues/NoiseVisualizer";

describe("NoiseVisualizer", () => {
  const mockStopTrack = jest.fn();
  const mockCloseContext = jest.fn().mockResolvedValue(undefined);
  const mockGetFloatTimeDomainData = jest.fn();
  const mockConnect = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();

    mockGetFloatTimeDomainData.mockImplementation((array: Float32Array) => {
      // Populate buffer with moderate ~0.03 RMS amplitude (~64 dB)
      array.fill(0.03);
    });

    const mockStream = {
      getTracks: () => [{ stop: mockStopTrack }],
    } as unknown as MediaStream;

    Object.defineProperty(global.navigator, "mediaDevices", {
      writable: true,
      value: {
        getUserMedia: jest.fn().mockResolvedValue(mockStream),
      },
    });

    const MockAudioContext = jest.fn().mockImplementation(() => ({
      state: "running",
      close: mockCloseContext,
      createMediaStreamSource: jest.fn(() => ({ connect: mockConnect })),
      createAnalyser: jest.fn(() => ({
        fftSize: 1024,
        smoothingTimeConstant: 0.8,
        getFloatTimeDomainData: mockGetFloatTimeDomainData,
      })),
    }));

    Object.defineProperty(window, "AudioContext", {
      writable: true,
      value: MockAudioContext,
    });
  });

  it("classifies decibels into Quiet (<45), Moderate (45-65), and Loud (>65) bands", () => {
    expect(classifyDecibels(38).label).toBe("Quiet");
    expect(classifyDecibels(38).strokeClass).toContain("emerald");

    expect(classifyDecibels(55).label).toBe("Moderate");
    expect(classifyDecibels(55).strokeClass).toContain("amber");

    expect(classifyDecibels(74).label).toBe("Loud");
    expect(classifyDecibels(74).strokeClass).toContain("rose");
  });

  it("computes decibels accurately from RMS time-domain samples", () => {
    const silentBuffer = new Float32Array(128).fill(0);
    expect(computeDecibelsFromTimeDomain(silentBuffer)).toBe(30);

    const loudBuffer = new Float32Array(128).fill(0.2);
    expect(computeDecibelsFromTimeDomain(loudBuffer)).toBeGreaterThan(65);
  });

  it("samples microphone audio and cleans up tracks and AudioContext on close/unmount", async () => {
    const { rerender } = render(<NoiseVisualizer isActive={true} />);

    fireEvent.click(screen.getByRole("button", { name: /start noise check/i }));

    await waitFor(() => {
      expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledWith({
        audio: true,
      });
      expect(screen.getByRole("button", { name: /stop/i })).toBeInTheDocument();
    });

    // Simulate modal dismissal by setting isActive={false}
    rerender(<NoiseVisualizer isActive={false} />);

    expect(mockStopTrack).toHaveBeenCalledTimes(1);
    expect(mockCloseContext).toHaveBeenCalledTimes(1);
  });

  it("displays a clear error alert when microphone permission is denied", async () => {
    const deniedError = new Error("Permission denied");
    deniedError.name = "NotAllowedError";
    (navigator.mediaDevices.getUserMedia as jest.Mock).mockRejectedValueOnce(
      deniedError,
    );

    render(<NoiseVisualizer isActive={true} />);

    fireEvent.click(screen.getByRole("button", { name: /start noise check/i }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(
        /microphone permission denied/i,
      );
    });
  });
});
