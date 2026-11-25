import { createElement } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import {
  calculateFrequencyBandEnergy,
  NoiseSpectrogram,
} from "@/components/audio/NoiseSpectrogram";

type MockAudioNode = {
  connect: jest.Mock;
  disconnect: jest.Mock;
};

function createAudioEnvironment(initialState: AudioContextState = "running") {
  let state = initialState;
  const source: MockAudioNode = {
    connect: jest.fn(),
    disconnect: jest.fn(),
  };
  const analyser = {
    connect: jest.fn(),
    disconnect: jest.fn(),
    fftSize: 0,
    smoothingTimeConstant: 0,
    frequencyBinCount: 1024,
    getByteFrequencyData: jest.fn((data: Uint8Array) => data.fill(128)),
    context: {
      get sampleRate() {
        return 48_000;
      },
    },
  };
  const filter = {
    connect: jest.fn(),
    disconnect: jest.fn(),
    type: "lowpass" as BiquadFilterType,
    frequency: { value: 350 },
    Q: { value: 1 },
  };
  const track = {
    stop: jest.fn(),
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
  };
  const stream = {
    getTracks: jest.fn(() => [track]),
  };
  const canvasContext = {
    fillStyle: "",
    fillRect: jest.fn(),
  };
  const context = {
    get state() {
      return state;
    },
    sampleRate: 48_000,
    resume: jest.fn(async () => {
      state = "running";
    }),
    close: jest.fn(async () => {
      state = "closed";
    }),
    createAnalyser: jest.fn(() => analyser),
    createMediaStreamSource: jest.fn(() => source),
    createBiquadFilter: jest.fn(() => filter),
  };
  const callbacks: FrameRequestCallback[] = [];

  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia: jest.fn().mockResolvedValue(stream) },
  });
  Object.defineProperty(window, "AudioContext", {
    configurable: true,
    value: jest.fn(() => context),
  });
  global.requestAnimationFrame = jest.fn((callback: FrameRequestCallback) => {
    callbacks.push(callback);
    return callbacks.length;
  });
  global.cancelAnimationFrame = jest.fn();
  HTMLCanvasElement.prototype.getContext = jest.fn(
    () => canvasContext as unknown as CanvasRenderingContext2D,
  ) as unknown as typeof HTMLCanvasElement.prototype.getContext;

  return {
    callbacks,
    context,
    filter,
    analyser,
    source,
    stream,
    track,
    canvasContext,
    suspend: () => {
      state = "suspended";
    },
  };
}

describe("NoiseSpectrogram", () => {
  it("aggregates bins into low, mid and high frequency bands", () => {
    const fftSize = 1024;
    const sampleRate = 48_000;
    const bins = new Uint8Array(fftSize / 2);

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

  it("renders the notch filter toggle in the off state", () => {
    createAudioEnvironment();
    render(createElement(NoiseSpectrogram));

    expect(
      screen.getByRole("button", { name: "Simulate Acoustic Notch Filter" }),
    ).toHaveAttribute("aria-pressed", "false");
  });

  it("creates and configures the notch route when enabled", async () => {
    const audio = createAudioEnvironment();
    render(createElement(NoiseSpectrogram));

    fireEvent.click(screen.getByRole("button", { name: "Start spectrum" }));
    await screen.findByRole("button", { name: "Stop spectrum" });
    fireEvent.click(
      screen.getByRole("button", { name: "Simulate Acoustic Notch Filter" }),
    );

    await waitFor(() => {
      expect(audio.filter.connect).toHaveBeenCalledWith(audio.analyser);
    });
    expect(audio.context.createBiquadFilter).toHaveBeenCalledTimes(1);
    expect(audio.filter.type).toBe("notch");
    expect(audio.filter.frequency.value).toBe(60);
    expect(audio.filter.Q.value).toBe(10);
    expect(audio.source.connect).toHaveBeenCalledWith(audio.filter);
    expect(audio.source.disconnect).toHaveBeenCalledWith(audio.analyser);
  });

  it("restores the original source-to-analyser route when disabled", async () => {
    const audio = createAudioEnvironment();
    render(createElement(NoiseSpectrogram));

    fireEvent.click(screen.getByRole("button", { name: "Start spectrum" }));
    await screen.findByRole("button", { name: "Stop spectrum" });
    const toggle = screen.getByRole("button", {
      name: "Simulate Acoustic Notch Filter",
    });
    fireEvent.click(toggle);
    await waitFor(() => {
      expect(audio.filter.connect).toHaveBeenCalledWith(audio.analyser);
    });

    fireEvent.click(toggle);

    await waitFor(() => {
      expect(audio.source.connect).toHaveBeenCalledTimes(3);
    });
    expect(audio.source.connect).toHaveBeenLastCalledWith(audio.analyser);
    expect(audio.source.disconnect).toHaveBeenCalledWith(audio.filter);
    expect(audio.filter.disconnect).toHaveBeenCalledWith(audio.analyser);
    expect(toggle).toHaveAttribute("aria-pressed", "false");
  });

  it("reuses the filter node across repeated toggles without duplicate edges", async () => {
    const audio = createAudioEnvironment();
    render(createElement(NoiseSpectrogram));

    fireEvent.click(screen.getByRole("button", { name: "Start spectrum" }));
    await screen.findByRole("button", { name: "Stop spectrum" });
    const toggle = screen.getByRole("button", {
      name: "Simulate Acoustic Notch Filter",
    });

    fireEvent.click(toggle);
    await waitFor(() => {
      expect(audio.filter.connect).toHaveBeenCalledTimes(1);
    });
    fireEvent.click(toggle);
    await waitFor(() => {
      expect(audio.source.connect).toHaveBeenCalledTimes(3);
    });
    fireEvent.click(toggle);

    await waitFor(() => {
      expect(audio.filter.connect).toHaveBeenCalledTimes(2);
    });
    expect(audio.context.createBiquadFilter).toHaveBeenCalledTimes(1);
    expect(audio.source.connect).toHaveBeenCalledTimes(4);
    expect(audio.source.disconnect).toHaveBeenCalledTimes(3);
  });

  it("resumes a suspended AudioContext before starting capture", async () => {
    const audio = createAudioEnvironment("suspended");
    render(createElement(NoiseSpectrogram));

    fireEvent.click(screen.getByRole("button", { name: "Start spectrum" }));

    await screen.findByRole("button", { name: "Stop spectrum" });
    expect(audio.context.resume).toHaveBeenCalledTimes(1);
  });

  it("resumes a suspended context before applying a live toggle", async () => {
    const audio = createAudioEnvironment();
    render(createElement(NoiseSpectrogram));

    fireEvent.click(screen.getByRole("button", { name: "Start spectrum" }));
    await screen.findByRole("button", { name: "Stop spectrum" });
    audio.suspend();
    fireEvent.click(
      screen.getByRole("button", { name: "Simulate Acoustic Notch Filter" }),
    );

    await waitFor(() => {
      expect(audio.filter.connect).toHaveBeenCalledWith(audio.analyser);
    });
    expect(audio.context.resume).toHaveBeenCalledTimes(1);
  });

  it("uses the latest state after rapid toggle interactions", async () => {
    const audio = createAudioEnvironment();
    render(createElement(NoiseSpectrogram));

    fireEvent.click(screen.getByRole("button", { name: "Start spectrum" }));
    await screen.findByRole("button", { name: "Stop spectrum" });
    audio.suspend();
    const toggle = screen.getByRole("button", {
      name: "Simulate Acoustic Notch Filter",
    });

    fireEvent.click(toggle);
    fireEvent.click(toggle);

    await waitFor(() => expect(toggle).toHaveAttribute("aria-pressed", "false"));
    expect(audio.context.resume).toHaveBeenCalledTimes(1);
    expect(audio.context.createBiquadFilter).not.toHaveBeenCalled();
    expect(audio.source.connect).toHaveBeenCalledTimes(1);
  });

  it("cleans up nodes and microphone tracks when stopped", async () => {
    const audio = createAudioEnvironment();
    render(createElement(NoiseSpectrogram));

    fireEvent.click(screen.getByRole("button", { name: "Start spectrum" }));
    await screen.findByRole("button", { name: "Stop spectrum" });
    fireEvent.click(
      screen.getByRole("button", { name: "Simulate Acoustic Notch Filter" }),
    );
    await waitFor(() => {
      expect(audio.filter.connect).toHaveBeenCalledWith(audio.analyser);
    });
    fireEvent.click(screen.getByRole("button", { name: "Stop spectrum" }));

    await waitFor(() => expect(audio.context.close).toHaveBeenCalledTimes(1));
    expect(audio.source.disconnect).toHaveBeenCalledTimes(2);
    expect(audio.filter.disconnect).toHaveBeenCalledTimes(1);
    expect(audio.analyser.disconnect).toHaveBeenCalledTimes(1);
    expect(audio.track.stop).toHaveBeenCalledTimes(1);
    expect(audio.track.removeEventListener).toHaveBeenCalledWith(
      "ended",
      expect.any(Function),
    );
  });

  it("releases active connections on unmount", async () => {
    const audio = createAudioEnvironment();
    const view = render(createElement(NoiseSpectrogram));

    fireEvent.click(screen.getByRole("button", { name: "Start spectrum" }));
    await screen.findByRole("button", { name: "Stop spectrum" });
    fireEvent.click(
      screen.getByRole("button", { name: "Simulate Acoustic Notch Filter" }),
    );
    await waitFor(() => {
      expect(audio.filter.connect).toHaveBeenCalledWith(audio.analyser);
    });

    view.unmount();

    expect(audio.source.disconnect).toHaveBeenCalledTimes(2);
    expect(audio.filter.disconnect).toHaveBeenCalledTimes(1);
    expect(audio.analyser.disconnect).toHaveBeenCalledTimes(1);
    expect(audio.track.stop).toHaveBeenCalledTimes(1);
    expect(audio.context.close).toHaveBeenCalledTimes(1);
  });

  it("renders spectrum data and the correctly positioned 60 Hz indicator", async () => {
    const audio = createAudioEnvironment();
    const { container } = render(createElement(NoiseSpectrogram));

    fireEvent.click(
      screen.getByRole("button", { name: "Simulate Acoustic Notch Filter" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Start spectrum" }));
    await screen.findByRole("button", { name: "Stop spectrum" });

    const canvas = screen.getByLabelText("Live frequency spectrum");
    expect(canvas).toBeInTheDocument();

    await act(async () => {
      audio.callbacks[0](0);
    });

    expect(audio.analyser.getByteFrequencyData).toHaveBeenCalled();
    expect(container.querySelector('[data-testid="spectrogram-band-low"]')).toBeInTheDocument();
    expect(audio.canvasContext.fillRect).toHaveBeenCalledWith(1.6, 0, 1, 96);

    audio.canvasContext.fillRect.mockClear();
    fireEvent.click(
      screen.getByRole("button", { name: "Simulate Acoustic Notch Filter" }),
    );
    await act(async () => {
      audio.callbacks[1](16);
    });
    expect(audio.canvasContext.fillRect).not.toHaveBeenCalledWith(
      1.6,
      0,
      1,
      96,
    );
  });

  it("stops capture when the microphone track terminates", async () => {
    const audio = createAudioEnvironment();
    render(createElement(NoiseSpectrogram));

    fireEvent.click(screen.getByRole("button", { name: "Start spectrum" }));
    await screen.findByRole("button", { name: "Stop spectrum" });
    const endedHandler = audio.track.addEventListener.mock.calls[0][1] as () => void;

    act(() => endedHandler());

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Start spectrum" })).toBeInTheDocument();
    });
    expect(audio.context.close).toHaveBeenCalledTimes(1);
  });
});
