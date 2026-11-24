import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import {
  calculateFrequencyBandEnergy,
  NoiseSpectrogram,
} from "@/components/audio/NoiseSpectrogram";

describe("calculateFrequencyBandEnergy", () => {
  it("aggregates bins into low, mid and high frequency bands", () => {
    const fftSize = 1024;
    const sampleRate = 48_000;
    const bins = new Uint8Array(fftSize / 2);

    // A 46.875 Hz bin spacing places indices 0–5 below 300 Hz,
    // indices 7–63 between 300 Hz and 3000 Hz, and the rest above.
    bins.fill(255, 0, 7);
    bins.fill(128, 7, 65);
    bins.fill(64, 65);

    const result = calculateFrequencyBandEnergy(bins, sampleRate, fftSize);

    expect(result.low).toBe(100);
    expect(result.mid).toBeCloseTo((128 / 255) * 100, 5);
    expect(result.high).toBeCloseTo((64 / 255) * 100, 5);
  });

  it("returns zero energy for empty frequency data", () => {
    expect(
      calculateFrequencyBandEnergy(new Uint8Array(0), 48_000, 1024),
    ).toEqual({ low: 0, mid: 0, high: 0 });
  });

  it("rejects invalid sampling parameters", () => {
    expect(() =>
      calculateFrequencyBandEnergy(new Uint8Array([10]), 0, 1024),
    ).toThrow("positive finite numbers");
  });
});

describe("NoiseSpectrogram acoustic notch filter", () => {
  let filter: {
    type: string;
    frequency: {
      value: number;
      setTargetAtTime: jest.Mock;
    };
    Q: { value: number };
    connect: jest.Mock;
    disconnect: jest.Mock;
  };
  let source: {
    connect: jest.Mock;
    disconnect: jest.Mock;
  };
  let analyser: {
    fftSize: number;
    frequencyBinCount: number;
    smoothingTimeConstant: number;
    context: { sampleRate: number };
    getByteFrequencyData: jest.Mock;
    connect: jest.Mock;
    disconnect: jest.Mock;
  };
  let context: {
    state: string;
    currentTime: number;
    sampleRate: number;
    resume: jest.Mock;
    createAnalyser: jest.Mock;
    createMediaStreamSource: jest.Mock;
    createBiquadFilter: jest.Mock;
    close: jest.Mock;
  };
  let activeStopTrack: jest.Mock;
  let activeStream: MediaStream;
  let animationCallbacks: FrameRequestCallback[];
  let cancelledAnimationFrameIds: number[];
  let originalAudioContext: typeof AudioContext | undefined;
  let originalGetUserMedia:
    | MediaDevices["getUserMedia"]
    | undefined;

  beforeEach(() => {
    jest.useFakeTimers();
    animationCallbacks = [];
    cancelledAnimationFrameIds = [];
    activeStopTrack = jest.fn();
    activeStream = {
      getTracks: jest.fn(() => [{ stop: activeStopTrack }]),
    } as unknown as MediaStream;
    originalAudioContext = window.AudioContext;
    originalGetUserMedia = navigator.mediaDevices?.getUserMedia;

    filter = {
      type: "",
      frequency: { value: 60, setTargetAtTime: jest.fn() },
      Q: { value: 0 },
      connect: jest.fn(),
      disconnect: jest.fn(),
    };
    source = { connect: jest.fn(), disconnect: jest.fn() };
    analyser = {
      fftSize: 2048,
      frequencyBinCount: 1024,
      smoothingTimeConstant: 0,
      context: { sampleRate: 48000 },
      getByteFrequencyData: jest.fn((buffer: Uint8Array) => buffer.fill(0)),
      connect: jest.fn(),
      disconnect: jest.fn(),
    };
    context = {
      state: "running",
      currentTime: 0,
      sampleRate: 48000,
      resume: jest.fn().mockResolvedValue(undefined),
      createAnalyser: jest.fn(() => analyser),
      createMediaStreamSource: jest.fn(() => source),
      createBiquadFilter: jest.fn(() => filter),
      close: jest.fn().mockResolvedValue(undefined),
    };

    Object.defineProperty(window, "AudioContext", {
      configurable: true,
      value: jest.fn(() => context),
    });
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: jest.fn().mockResolvedValue(activeStream),
      },
    });
    jest.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      animationCallbacks.push(callback);
      return animationCallbacks.length;
    });
    jest
      .spyOn(window, "cancelAnimationFrame")
      .mockImplementation((id) => {
        cancelledAnimationFrameIds.push(id);
      });
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
    jest.restoreAllMocks();
    if (originalAudioContext) {
      Object.defineProperty(window, "AudioContext", {
        configurable: true,
        value: originalAudioContext,
      });
    } else {
      delete (window as typeof window & { AudioContext?: typeof AudioContext })
        .AudioContext;
    }
    if (originalGetUserMedia) {
      Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
        configurable: true,
        value: originalGetUserMedia,
      });
    }
  });

  async function startSpectrogram() {
    render(React.createElement(NoiseSpectrogram));
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Start spectrum" }),
      );
    });
  }

  it("renders disabled controls with 60 Hz default", async () => {
    render(React.createElement(NoiseSpectrogram));

    expect(
      screen.getByRole("switch", { name: "Simulate Acoustic Notch Filter" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("switch", { name: "Simulate Acoustic Notch Filter" }),
    ).toHaveAttribute("aria-checked", "false");
    expect(
      screen.getByRole("combobox", { name: "Notch filter frequency" }),
    ).toHaveValue("60");
  });

  it("creates a notch filter and connects source-filter-analyser", async () => {
    await startSpectrogram();

    const toggle = screen.getByRole("switch", {
      name: "Simulate Acoustic Notch Filter",
    });
    expect(toggle).not.toBeDisabled();

    fireEvent.click(toggle);

    expect(context.createBiquadFilter).toHaveBeenCalledTimes(1);
    expect(filter.type).toBe("notch");
    expect(filter.frequency.value).toBe(60);
    expect(filter.Q.value).toBe(10);
    expect(source.disconnect).toHaveBeenCalled();
    expect(source.connect).toHaveBeenCalledWith(filter);
    expect(filter.connect).toHaveBeenCalledWith(analyser);
  });

  it("updates 1 kHz selection and restores direct graph when disabled", async () => {
    await startSpectrogram();

    const toggle = screen.getByRole("switch", {
      name: "Simulate Acoustic Notch Filter",
    });
    fireEvent.click(toggle);
    fireEvent.change(
      screen.getByRole("combobox", { name: "Notch filter frequency" }),
      { target: { value: "1000" } },
    );

    expect(filter.frequency.setTargetAtTime).toHaveBeenCalledWith(
      1000,
      0,
      0.01,
    );
    expect(toggle).toHaveAttribute("aria-checked", "true");

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-checked", "false");
    expect(source.connect).toHaveBeenCalledWith(analyser);
  });

  it("does not create duplicate filter nodes or stop tracks when toggled", async () => {
    await startSpectrogram();

    const toggle = screen.getByRole("switch", {
      name: "Simulate Acoustic Notch Filter",
    });
    fireEvent.click(toggle);
    fireEvent.click(toggle);
    fireEvent.click(toggle);

    expect(context.createBiquadFilter).toHaveBeenCalledTimes(1);
    expect(activeStopTrack).not.toHaveBeenCalled();
  });

  it("stops the microphone track only when recording stops", async () => {
    await startSpectrogram();
    const toggle = screen.getByRole("switch", {
      name: "Simulate Acoustic Notch Filter",
    });

    fireEvent.click(toggle);
    fireEvent.click(toggle);
    expect(activeStopTrack).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Stop spectrum" }));
    expect(activeStopTrack).toHaveBeenCalledTimes(1);
  });

  it("stops the microphone track on unmount", async () => {
    const { unmount } = render(React.createElement(NoiseSpectrogram));
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Start spectrum" }),
      );
    });

    unmount();
    expect(activeStopTrack).toHaveBeenCalledTimes(1);
  });

  it("cleans up filter and nodes on unmount", async () => {
    const { unmount } = render(React.createElement(NoiseSpectrogram));
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Start spectrum" }),
      );
    });
    fireEvent.click(
      screen.getByRole("switch", {
        name: "Simulate Acoustic Notch Filter",
      }),
    );

    unmount();

    expect(filter.disconnect).toHaveBeenCalled();
    expect(source.disconnect).toHaveBeenCalled();
    expect(analyser.disconnect).toHaveBeenCalled();
    expect(context.close).toHaveBeenCalled();
  });

  it("stops an acquired stream when unmounted while getUserMedia is pending", async () => {
    let resolveStream!: (stream: MediaStream) => void;
    const pendingStream = new Promise<MediaStream>((resolve) => {
      resolveStream = resolve;
    });
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: jest.fn(() => pendingStream) },
    });

    const { unmount } = render(React.createElement(NoiseSpectrogram));
    fireEvent.click(screen.getByRole("button", { name: "Start spectrum" }));
    unmount();

    await act(async () => {
      resolveStream(activeStream);
      await pendingStream;
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(activeStopTrack).toHaveBeenCalledTimes(1);
    expect(window.AudioContext).not.toHaveBeenCalled();
  });

  it("closes the context when unmounted while AudioContext.resume is pending", async () => {
    let resolveResume!: () => void;
    context.state = "suspended";
    context.resume = jest.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveResume = resolve;
        }),
    );

    const { unmount } = render(React.createElement(NoiseSpectrogram));
    fireEvent.click(screen.getByRole("button", { name: "Start spectrum" }));
    await act(async () => {
      await Promise.resolve();
    });
    unmount();

    await act(async () => {
      context.state = "running";
      resolveResume();
      await Promise.resolve();
    });

    expect(activeStopTrack).toHaveBeenCalledTimes(1);
    expect(context.close).toHaveBeenCalledTimes(1);
  });

  it("does not let an obsolete Start clear a newer request's in-flight guard", async () => {
    let resolveA!: (stream: MediaStream) => void;
    let resolveB!: (stream: MediaStream) => void;
    const streamA = new Promise<MediaStream>((resolve) => {
      resolveA = resolve;
    });
    const streamB = new Promise<MediaStream>((resolve) => {
      resolveB = resolve;
    });
    const getUserMedia = jest
      .fn()
      .mockImplementationOnce(() => streamA)
      .mockImplementationOnce(() => streamB);
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia },
    });

    render(React.createElement(NoiseSpectrogram));

    fireEvent.click(screen.getByRole("button", { name: "Start spectrum" }));
    expect(getUserMedia).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Stop spectrum" }));

    fireEvent.click(screen.getByRole("button", { name: "Start spectrum" }));
    expect(getUserMedia).toHaveBeenCalledTimes(2);

    await act(async () => {
      resolveA(activeStream);
      await streamA;
      await Promise.resolve();
    });
    expect(activeStopTrack).toHaveBeenCalledTimes(1);
    expect(getUserMedia).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("button", { name: "Stop spectrum" })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Start spectrum" }),
    ).not.toBeInTheDocument();

    await act(async () => {
      resolveB(activeStream);
      await streamB;
      await Promise.resolve();
    });
    expect(window.AudioContext).toHaveBeenCalledTimes(1);
  });

  it("ignores duplicate rapid Start clicks", async () => {
    let resolveStream!: (stream: MediaStream) => void;
    const pendingStream = new Promise<MediaStream>((resolve) => {
      resolveStream = resolve;
    });
    const getUserMedia = jest.fn(() => pendingStream);
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia },
    });

    render(React.createElement(NoiseSpectrogram));
    const startButton = screen.getByRole("button", { name: "Start spectrum" });
    act(() => {
      startButton.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true }),
      );
      startButton.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true }),
      );
    });

    expect(getUserMedia).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveStream(activeStream);
      await pendingStream;
      await Promise.resolve();
    });
    expect(window.AudioContext).toHaveBeenCalledTimes(1);
  });

  it("handles resume rejection and permits retry", async () => {
    context.state = "suspended";
    context.resume = jest.fn().mockRejectedValue(new Error("Resume failed"));

    render(React.createElement(NoiseSpectrogram));
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Start spectrum" }),
      );
      await Promise.resolve();
    });

    expect(screen.getByRole("alert")).toHaveTextContent("Resume failed");
    expect(activeStopTrack).toHaveBeenCalledTimes(1);

    context.state = "running";
    context.resume = jest.fn().mockResolvedValue(undefined);
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Start spectrum" }),
      );
      await Promise.resolve();
    });
    expect(context.createAnalyser).toHaveBeenCalled();
  });

  it("cleans stream and context when graph initialization fails", async () => {
    context.createAnalyser = jest.fn(() => {
      throw new Error("Analyser initialization failed");
    });

    render(React.createElement(NoiseSpectrogram));
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Start spectrum" }),
      );
      await Promise.resolve();
    });

    expect(activeStopTrack).toHaveBeenCalledTimes(1);
    expect(context.close).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Analyser initialization failed",
    );
  });

  it("cancels animation frames and prevents further callbacks after unmount", async () => {
    const { unmount } = render(React.createElement(NoiseSpectrogram));
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Start spectrum" }),
      );
      await Promise.resolve();
    });

    expect(animationCallbacks.length).toBeGreaterThan(0);
    unmount();

    expect(cancelledAnimationFrameIds.length).toBeGreaterThan(0);
  });

  it("mounts and cleans up safely in React Strict Mode", async () => {
    const { unmount } = render(
      React.createElement(
        React.StrictMode,
        null,
        React.createElement(NoiseSpectrogram),
      ),
    );
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Start spectrum" }),
      );
      await Promise.resolve();
    });

    unmount();
    expect(context.close).toHaveBeenCalled();
  });

  it("shows a canvas label for 60 Hz and 1 kHz while enabled", async () => {
    await startSpectrogram();
    const toggle = screen.getByRole("switch", {
      name: "Simulate Acoustic Notch Filter",
    });
    fireEvent.click(toggle);

    expect(
      screen.getByTestId("noise-spectrogram-canvas"),
    ).toHaveAttribute(
      "aria-label",
      "Filtered spectrogram with a notch at 60 Hz",
    );

    fireEvent.change(
      screen.getByRole("combobox", { name: "Notch filter frequency" }),
      { target: { value: "1000" } },
    );
    expect(
      screen.getByTestId("noise-spectrogram-canvas"),
    ).toHaveAttribute(
      "aria-label",
      "Filtered spectrogram with a notch at 1 kHz",
    );

    fireEvent.click(toggle);
    expect(
      screen.getByTestId("noise-spectrogram-canvas"),
    ).toHaveAttribute("aria-label", "Live audio spectrogram");
  });
});
