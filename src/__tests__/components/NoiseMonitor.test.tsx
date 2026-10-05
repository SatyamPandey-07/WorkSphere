import React from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";
import "@testing-library/jest-dom";
import { NoiseMonitor } from "@/components/noise/NoiseMonitor";

describe("NoiseMonitor", () => {
  let mockGetUserMedia: jest.Mock;
  let mockAudioContext: any;

  beforeEach(() => {
    mockGetUserMedia = jest.fn().mockResolvedValue({
      getTracks: () => [{ stop: jest.fn() }],
    });

    Object.defineProperty(global.navigator, "mediaDevices", {
      value: {
        getUserMedia: mockGetUserMedia,
      },
      writable: true,
      configurable: true,
    });

    mockAudioContext = jest.fn().mockImplementation(() => ({
      state: "running",
      resume: jest.fn().mockResolvedValue(undefined),
      createAnalyser: jest.fn().mockReturnValue({
        fftSize: 1024,
        smoothingTimeConstant: 0.3,
        getFloatTimeDomainData: jest.fn((buffer: Float32Array) => {
          // Fill with loud amplitude (approx 80dB)
          buffer.fill(0.3);
        }),
      }),
      createMediaStreamSource: jest.fn().mockReturnValue({
        connect: jest.fn(),
      }),
      close: jest.fn().mockResolvedValue(undefined),
    }));

    (window as any).AudioContext = mockAudioContext;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it("renders idle state with initial dB values", () => {
    render(<NoiseMonitor initialDb={52} thresholdDb={75} />);

    expect(screen.getByText("Ambient Noise Monitor")).toBeInTheDocument();
    expect(screen.getAllByText("52").length).toBeGreaterThan(0);
    expect(screen.getByTestId("rolling-avg-db")).toHaveTextContent("52 dB");
    expect(
      screen.queryByTestId("decibel-threshold-alert"),
    ).not.toBeInTheDocument();
  });

  it("starts monitoring and triggers loud noise alert banner when sound is sustained above threshold", async () => {
    jest.useFakeTimers();
    const onAlertTriggered = jest.fn();

    render(
      <NoiseMonitor
        thresholdDb={75}
        windowSeconds={5}
        initialDb={50}
        onAlertTriggered={onAlertTriggered}
      />,
    );

    const startBtn = screen.getByTestId("toggle-monitoring-btn");
    await act(async () => {
      fireEvent.click(startBtn);
    });

    // Advance timers for multiple frames/samples
    for (let i = 0; i < 6; i++) {
      act(() => {
        jest.advanceTimersByTime(300);
      });
    }

    // Now alert banner should appear
    expect(screen.getByTestId("decibel-threshold-alert")).toBeInTheDocument();
    expect(screen.getByText("Loud Environment Detected")).toBeInTheDocument();
    expect(screen.getByTestId("warning-badge")).toBeInTheDocument();
    expect(screen.getByText("Find Quiet Workspaces")).toBeInTheDocument();

    // Dismiss alert banner
    const dismissBtn = screen.getByTestId("dismiss-alert-btn");
    act(() => {
      fireEvent.click(dismissBtn);
    });

    expect(
      screen.queryByTestId("decibel-threshold-alert"),
    ).not.toBeInTheDocument();

    jest.useRealTimers();
  });
});
