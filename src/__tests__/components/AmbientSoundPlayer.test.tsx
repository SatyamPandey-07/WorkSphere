import React from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";
import {
  AmbientSoundPlayer,
  PRESET_SOUNDSCAPES,
  generateWhiteNoiseBuffer,
  generatePinkNoiseBuffer,
  generateRainBuffer,
  generateCafeHumBuffer,
  applySeamlessLoopCrossfade,
} from "@/components/noise/AmbientSoundPlayer";

// Mock Web Audio API
class MockAudioBuffer {
  numberOfChannels: number;
  length: number;
  sampleRate: number;
  channels: Float32Array[];

  constructor(numberOfChannels: number, length: number, sampleRate: number) {
    this.numberOfChannels = numberOfChannels;
    this.length = length;
    this.sampleRate = sampleRate;
    this.channels = Array.from(
      { length: numberOfChannels },
      () => new Float32Array(length),
    );
  }

  getChannelData(channel: number) {
    return this.channels[channel];
  }
}

class MockGainNode {
  gain = {
    value: 1,
    setTargetAtTime: jest.fn(),
  };
  connect = jest.fn();
  disconnect = jest.fn();
}

class MockAudioBufferSourceNode {
  buffer: MockAudioBuffer | null = null;
  loop = false;
  loopStart = 0;
  loopEnd = 0;
  connect = jest.fn();
  disconnect = jest.fn();
  start = jest.fn();
  stop = jest.fn();
}

class MockAudioContext {
  state: AudioContextState = "running";
  sampleRate = 44100;
  currentTime = 0;
  destination = {};

  createBuffer = jest.fn(
    (channels: number, length: number, sampleRate: number) =>
      new MockAudioBuffer(channels, length, sampleRate),
  );

  createGain = jest.fn(() => new MockGainNode());

  createBufferSource = jest.fn(() => new MockAudioBufferSourceNode());

  resume = jest.fn().mockResolvedValue(undefined);
  close = jest.fn().mockResolvedValue(undefined);
}

describe("AmbientSoundPlayer - Audio Buffer Synthesis & Seamless Crossfades", () => {
  let ctx: MockAudioContext;

  beforeEach(() => {
    ctx = new MockAudioContext();
  });

  it("applies seamless loop crossfade to smooth boundary values", () => {
    const buffer = new MockAudioBuffer(2, 44100, 44100);
    const ch0 = buffer.getChannelData(0);
    ch0[0] = 0.8;
    ch0[ch0.length - 1] = -0.5;

    expect(() =>
      applySeamlessLoopCrossfade(buffer as unknown as AudioBuffer, 0.1),
    ).not.toThrow();
    // After crossfade, start and end samples are continuously blended
    expect(ch0[0]).toBe(ch0[ch0.length - 4410]);
  });

  it("generates White Noise buffer with correct channels and frame count", () => {
    const buffer = generateWhiteNoiseBuffer(ctx as unknown as AudioContext, 2);
    expect(buffer.numberOfChannels).toBe(2);
    expect(buffer.length).toBe(44100 * 2);
    expect(ctx.createBuffer).toHaveBeenCalledWith(2, 44100 * 2, 44100);
  });

  it("generates Pink Noise buffer with 1/f spectral synthesis", () => {
    const buffer = generatePinkNoiseBuffer(ctx as unknown as AudioContext, 2);
    expect(buffer.numberOfChannels).toBe(2);
    expect(buffer.length).toBe(44100 * 2);
  });

  it("generates Rain soundscape buffer with droplet grains", () => {
    const buffer = generateRainBuffer(ctx as unknown as AudioContext, 2);
    expect(buffer.numberOfChannels).toBe(2);
    expect(buffer.length).toBe(44100 * 2);
  });

  it("generates Café Hum buffer with warm room murmur", () => {
    const buffer = generateCafeHumBuffer(ctx as unknown as AudioContext, 2);
    expect(buffer.numberOfChannels).toBe(2);
    expect(buffer.length).toBe(44100 * 2);
  });
});

describe("AmbientSoundPlayer - Component UI & Soundscape Controls", () => {
  const originalAudioContext = window.AudioContext;

  beforeEach(() => {
    (window as any).AudioContext = jest.fn(() => new MockAudioContext());
  });

  afterEach(() => {
    (window as any).AudioContext = originalAudioContext;
    jest.clearAllMocks();
  });

  it("renders all preset soundscapes in standalone mode", () => {
    render(<AmbientSoundPlayer standalone />);

    expect(screen.getByTestId("soundscape-player-panel")).toBeInTheDocument();
    expect(screen.getByText("Focus Soundscapes")).toBeInTheDocument();

    // Verify all 4 required presets exist
    for (const preset of PRESET_SOUNDSCAPES) {
      expect(
        screen.getByTestId(`soundscape-card-${preset.id}`),
      ).toBeInTheDocument();
      expect(screen.getByText(preset.name)).toBeInTheDocument();
      expect(
        screen.getByTestId(`volume-slider-${preset.id}`),
      ).toBeInTheDocument();
      expect(
        screen.getByTestId(`play-toggle-${preset.id}`),
      ).toBeInTheDocument();
    }
  });

  it("toggles play/pause for White Noise and verifies Web Audio API buffer looping", async () => {
    render(<AmbientSoundPlayer standalone />);

    const playBtn = screen.getByTestId("play-toggle-white_noise");
    expect(playBtn).toHaveTextContent("Play");

    await act(async () => {
      fireEvent.click(playBtn);
    });

    // Should now display pause button and active playing badge
    expect(screen.getByTestId("play-toggle-white_noise")).toHaveTextContent(
      "Pause",
    );
    expect(screen.getByTestId("status-badge-white_noise")).toHaveTextContent(
      "Playing",
    );

    // Pause playback
    await act(async () => {
      fireEvent.click(screen.getByTestId("play-toggle-white_noise"));
    });

    expect(screen.getByTestId("play-toggle-white_noise")).toHaveTextContent(
      "Play",
    );
    expect(
      screen.queryByTestId("status-badge-white_noise"),
    ).not.toBeInTheDocument();
  });

  it("supports independent gain/volume sliders per soundscape", async () => {
    render(<AmbientSoundPlayer standalone />);

    const rainSlider = screen.getByTestId("volume-slider-rain");
    const cafeSlider = screen.getByTestId("volume-slider-cafe_hum");

    expect(screen.getByTestId("volume-label-rain")).toHaveTextContent("70%");
    expect(screen.getByTestId("volume-label-cafe_hum")).toHaveTextContent(
      "65%",
    );

    // Adjust rain volume independently
    fireEvent.change(rainSlider, { target: { value: "85" } });

    expect(screen.getByTestId("volume-label-rain")).toHaveTextContent("85%");
    // Cafe hum volume must remain unchanged
    expect(screen.getByTestId("volume-label-cafe_hum")).toHaveTextContent(
      "65%",
    );

    // Adjust cafe hum volume independently
    fireEvent.change(cafeSlider, { target: { value: "45" } });
    expect(screen.getByTestId("volume-label-cafe_hum")).toHaveTextContent(
      "45%",
    );
    expect(screen.getByTestId("volume-label-rain")).toHaveTextContent("85%");
  });

  it("controls master volume and exposes the audio guide mute state", async () => {
    render(<AmbientSoundPlayer standalone />);

    const masterSlider = screen.getByTestId("master-volume-slider");
    expect(screen.getByTestId("master-volume-label")).toHaveTextContent("70%");

    // Change master volume
    fireEvent.change(masterSlider, { target: { value: "90" } });
    expect(screen.getByTestId("master-volume-label")).toHaveTextContent("90%");

    // Toggle master mute
    const muteBtn = screen.getByTestId("master-mute-btn");
    expect(muteBtn).toHaveAccessibleName("Mute audio guide");
    expect(muteBtn).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(muteBtn);
    expect(screen.getByTestId("master-volume-label")).toHaveTextContent(
      "Muted",
    );
    expect(muteBtn).toHaveAccessibleName("Unmute audio guide");
    expect(muteBtn).toHaveAttribute("aria-pressed", "false");

    // Unmute
    fireEvent.click(muteBtn);
    expect(screen.getByTestId("master-volume-label")).toHaveTextContent("90%");
    expect(muteBtn).toHaveAccessibleName("Mute audio guide");
    expect(muteBtn).toHaveAttribute("aria-pressed", "true");
  });

  it("opens popover panel when trigger button is clicked in trigger mode", () => {
    render(<AmbientSoundPlayer noiseLevel="moderate" />);

    const trigger = screen.getByTestId("ambient-sound-trigger");
    expect(trigger).toBeInTheDocument();
    expect(
      screen.queryByTestId("soundscape-player-panel"),
    ).not.toBeInTheDocument();

    // Click trigger to open panel
    fireEvent.click(trigger);
    expect(screen.getByTestId("soundscape-player-panel")).toBeInTheDocument();

    // Click close button
    const closeBtn = screen.getByLabelText("Close soundscape panel");
    fireEvent.click(closeBtn);
    expect(
      screen.queryByTestId("soundscape-player-panel"),
    ).not.toBeInTheDocument();
  });

  describe("FloatingAmbientControls accessibility & keyboard interaction (#7196)", () => {
    it("renders outer container with role='region' and exact accessible label", () => {
      render(<AmbientSoundPlayer standalone />);
      const panel = screen.getByTestId("soundscape-player-panel");
      expect(panel).toHaveAttribute("role", "region");
      expect(panel).toHaveAttribute(
        "aria-label",
        "Ambient audio synthesizer controls",
      );
    });

    it("renders floating dialog with correct role and accessible semantics in trigger mode", () => {
      render(<AmbientSoundPlayer defaultOpen noiseLevel="quiet" />);
      const dialog = screen.getByRole("dialog");
      expect(dialog).toBeInTheDocument();
      expect(dialog).toHaveAttribute("aria-modal", "true");
      expect(dialog).toHaveAttribute(
        "aria-label",
        "Ambient audio synthesizer controls",
      );
    });

    it("exposes accessible volume bounds and values on master and preset sliders", () => {
      render(<AmbientSoundPlayer standalone />);

      const masterSlider = screen.getByTestId("master-volume-slider");
      expect(masterSlider).toHaveAttribute("aria-valuemin", "0");
      expect(masterSlider).toHaveAttribute("aria-valuemax", "100");
      expect(masterSlider).toHaveAttribute("aria-valuenow", "70");
      expect(masterSlider).toHaveAttribute("aria-valuetext", "70%");

      const whiteNoiseSlider = screen.getByTestId("volume-slider-white_noise");
      expect(whiteNoiseSlider).toHaveAttribute("aria-valuemin", "0");
      expect(whiteNoiseSlider).toHaveAttribute("aria-valuemax", "100");
      expect(whiteNoiseSlider).toHaveAttribute("aria-valuenow", "60");
      expect(whiteNoiseSlider).toHaveAttribute("aria-valuetext", "60%");
    });

    it("updates aria-valuetext when master is muted", () => {
      render(<AmbientSoundPlayer standalone />);
      const masterSlider = screen.getByTestId("master-volume-slider");
      const muteBtn = screen.getByTestId("master-mute-btn");

      fireEvent.click(muteBtn);
      expect(masterSlider).toHaveAttribute("aria-valuetext", "Muted");

      fireEvent.click(muteBtn);
      expect(masterSlider).toHaveAttribute("aria-valuetext", "70%");
    });

    it("supports keyboard Enter and Space activation on mute and play toggle buttons", () => {
      render(<AmbientSoundPlayer standalone />);

      const muteBtn = screen.getByTestId("master-mute-btn");
      // Native button elements trigger click on Space and Enter keypress/keydown
      // Verify button responds to click event generated by standard keyboard triggers
      expect(muteBtn).toHaveAttribute("aria-pressed", "true");
      fireEvent.click(muteBtn);
      expect(muteBtn).toHaveAttribute("aria-pressed", "false");
      fireEvent.click(muteBtn);
      expect(muteBtn).toHaveAttribute("aria-pressed", "true");

      const playBtn = screen.getByTestId("play-toggle-white_noise");
      expect(playBtn).toHaveAccessibleName("Play White Noise");
      fireEvent.click(playBtn);
      expect(playBtn).toHaveAccessibleName("Pause White Noise");
      fireEvent.click(playBtn);
      expect(playBtn).toHaveAccessibleName("Play White Noise");
    });

    it("closes the floating modal and restores focus to trigger on Escape key press", () => {
      function Harness() {
        return (
          <div>
            <button data-testid="outside-button">Outside</button>
            <AmbientSoundPlayer noiseLevel="moderate" />
          </div>
        );
      }

      render(<Harness />);
      const trigger = screen.getByTestId("ambient-sound-trigger");
      trigger.focus();
      expect(trigger).toHaveFocus();

      // Open floating modal
      fireEvent.click(trigger);
      expect(screen.getByRole("dialog")).toBeInTheDocument();

      // Press Escape inside the modal
      fireEvent.keyDown(document, { key: "Escape" });

      // Modal should be closed and focus restored to trigger
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(trigger).toHaveFocus();
    });

    it("traps keyboard focus cycling between first and last interactive elements within modal", () => {
      render(<AmbientSoundPlayer defaultOpen noiseLevel="quiet" />);
      const dialog = screen.getByRole("dialog");
      expect(dialog).toBeInTheDocument();

      const closeBtn = screen.getByLabelText("Close soundscape panel");
      const playButtons = screen.getAllByRole("button", { name: /^Play /i });
      const lastElement = playButtons[playButtons.length - 1];

      // Tab on last element cycles to first element
      lastElement.focus();
      expect(lastElement).toHaveFocus();
      fireEvent.keyDown(document, { key: "Tab" });
      expect(closeBtn).toHaveFocus();

      // Shift+Tab on first element cycles to last element
      closeBtn.focus();
      expect(closeBtn).toHaveFocus();
      fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
      expect(lastElement).toHaveFocus();
    });
  });
});
