import React from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";
import {
  AmbientSoundscapeGenerator,
  AMBIENT_STORAGE_KEY,
  validatePreferences,
  loadSavedPreferences,
  savePreferences,
  type AmbientPreferences,
} from "@/components/wellness/AmbientSoundscapeGenerator";

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
      () => new Float32Array(length)
    );
  }

  getChannelData(channel: number) {
    return this.channels[channel];
  }
}

class MockGainNode {
  gain = {
    value: 1,
    setValueAtTime: jest.fn(function (this: any, val: number) {
      this.value = val;
    }),
    setTargetAtTime: jest.fn(function (this: any, val: number) {
      this.value = val;
    }),
    linearRampToValueAtTime: jest.fn(function (this: any, val: number) {
      this.value = val;
    }),
    cancelScheduledValues: jest.fn(),
  };
  connect = jest.fn();
  disconnect = jest.fn();
}

class MockAudioBufferSourceNode {
  buffer: MockAudioBuffer | null = null;
  loop = false;
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

  createGain = jest.fn(() => new MockGainNode());
  createBuffer = jest.fn(
    (channels: number, length: number, sampleRate: number) =>
      new MockAudioBuffer(channels, length, sampleRate)
  );
  createBufferSource = jest.fn(() => new MockAudioBufferSourceNode());
  resume = jest.fn(async () => {
    this.state = "running";
  });
  close = jest.fn(async () => {
    this.state = "closed";
  });
}

describe("AmbientSoundscapeGenerator Component (#7226)", () => {
  let originalAudioContext: any;
  let originalMatchMedia: any;

  beforeEach(() => {
    window.localStorage.clear();
    originalAudioContext = (window as any).AudioContext;
    (window as any).AudioContext = MockAudioContext;

    originalMatchMedia = window.matchMedia;
    window.matchMedia = jest.fn().mockImplementation((query) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: jest.fn(),
      removeListener: jest.fn(),
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      dispatchEvent: jest.fn(),
    }));
  });

  afterEach(() => {
    (window as any).AudioContext = originalAudioContext;
    window.matchMedia = originalMatchMedia;
    window.localStorage.clear();
    jest.clearAllMocks();
  });

  describe("Validation & Preference Utilities", () => {
    it("validates malformed or non-object localStorage data with safe defaults", () => {
      expect(validatePreferences(null)).toEqual({
        version: 1,
        layers: {
          rain: { enabled: false, volume: 65 },
          coffee_shop: { enabled: false, volume: 60 },
          pink_noise: { enabled: false, volume: 50 },
        },
        masterMuted: false,
        masterVolume: 80,
      });

      expect(validatePreferences("not json")).toHaveProperty("version", 1);
    });

    it("clamps invalid and out-of-bounds volume values", () => {
      const parsed = validatePreferences({
        version: 1,
        layers: {
          rain: { enabled: true, volume: 999 },
          coffee_shop: { enabled: false, volume: -50 },
          pink_noise: { enabled: true, volume: NaN },
        },
        masterMuted: true,
        masterVolume: -20,
      });

      expect(parsed.layers.rain?.volume).toBe(100);
      expect(parsed.layers.coffee_shop?.volume).toBe(0);
      expect(parsed.layers.pink_noise?.volume).toBe(50);
      expect(parsed.masterVolume).toBe(0);
      expect(parsed.masterMuted).toBe(true);
    });

    it("loads saved preferences correctly from localStorage", () => {
      const testPref: AmbientPreferences = {
        version: 1,
        layers: {
          rain: { enabled: true, volume: 88 },
          coffee_shop: { enabled: false, volume: 45 },
          pink_noise: { enabled: false, volume: 30 },
        },
        masterMuted: true,
        masterVolume: 75,
      };
      savePreferences(testPref);

      const loaded = loadSavedPreferences();
      expect(loaded.layers.rain?.volume).toBe(88);
      expect(loaded.masterMuted).toBe(true);
      expect(loaded.masterVolume).toBe(75);
    });
  });

  describe("UI Rendering & Layer Interactions", () => {
    it("renders the main region and three sound layer controls", () => {
      render(<AmbientSoundscapeGenerator />);

      expect(
        screen.getByRole("region", { name: "Ambient Soundscape Generator" })
      ).toBeInTheDocument();
      expect(screen.getByText("Gentle Rain")).toBeInTheDocument();
      expect(screen.getByText("Busy Coffee Shop")).toBeInTheDocument();
      expect(screen.getByText("Pink Noise")).toBeInTheDocument();
    });

    it("does not automatically start audio playback on initial mount even if saved as enabled", () => {
      window.localStorage.setItem(
        AMBIENT_STORAGE_KEY,
        JSON.stringify({
          version: 1,
          layers: {
            rain: { enabled: true, volume: 70 },
            coffee_shop: { enabled: true, volume: 60 },
            pink_noise: { enabled: true, volume: 50 },
          },
          masterMuted: false,
          masterVolume: 80,
        })
      );

      render(<AmbientSoundscapeGenerator />);

      // Play buttons should not be in active/pressed state on initial page load (no autoplay)
      const rainToggle = screen.getByRole("button", { name: /Enable Gentle Rain/i });
      expect(rainToggle).toHaveAttribute("aria-pressed", "false");
    });

    it("enables and disables individual sound layers on click", async () => {
      render(<AmbientSoundscapeGenerator />);

      const rainToggle = screen.getByRole("button", { name: /Enable Gentle Rain/i });
      await act(async () => {
        fireEvent.click(rainToggle);
      });

      expect(screen.getByRole("button", { name: /Disable Gentle Rain/i })).toHaveAttribute(
        "aria-pressed",
        "true"
      );

      // Disable it
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: /Disable Gentle Rain/i }));
      });

      expect(screen.getByRole("button", { name: /Enable Gentle Rain/i })).toHaveAttribute(
        "aria-pressed",
        "false"
      );
    });

    it("adjusts layer volume independently with slider and persists changes", () => {
      render(<AmbientSoundscapeGenerator />);

      const rainSlider = screen.getByLabelText("Gentle Rain volume slider");
      fireEvent.change(rainSlider, { target: { value: "85" } });

      expect(screen.getByLabelText("Gentle Rain volume slider")).toHaveValue("85");
      const stored = JSON.parse(window.localStorage.getItem(AMBIENT_STORAGE_KEY) || "{}");
      expect(stored.layers?.rain?.volume).toBe(85);
    });

    it("toggles master mute and unmute while preserving layer volumes", async () => {
      render(<AmbientSoundscapeGenerator />);

      const muteBtn = screen.getByRole("button", { name: /Mute all soundscapes/i });
      await act(async () => {
        fireEvent.click(muteBtn);
      });

      expect(
        screen.getByRole("button", { name: /Unmute all soundscapes/i })
      ).toHaveAttribute("aria-pressed", "true");

      // Verify localStorage was updated
      let stored = JSON.parse(window.localStorage.getItem(AMBIENT_STORAGE_KEY) || "{}");
      expect(stored.masterMuted).toBe(true);

      // Unmute
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: /Unmute all soundscapes/i }));
      });

      expect(
        screen.getByRole("button", { name: /Mute all soundscapes/i })
      ).toHaveAttribute("aria-pressed", "false");
      stored = JSON.parse(window.localStorage.getItem(AMBIENT_STORAGE_KEY) || "{}");
      expect(stored.masterMuted).toBe(false);
    });

    it("adjusts master volume with slider and updates aria attributes", () => {
      render(<AmbientSoundscapeGenerator />);

      const masterSlider = screen.getByLabelText("Master volume slider");
      fireEvent.change(masterSlider, { target: { value: "92" } });

      expect(masterSlider).toHaveValue("92");
      expect(masterSlider).toHaveAttribute("aria-valuenow", "92");
    });

    it("stops all active layers with the Reset button", async () => {
      render(<AmbientSoundscapeGenerator />);

      const rainToggle = screen.getByRole("button", { name: /Enable Gentle Rain/i });
      await act(async () => {
        fireEvent.click(rainToggle);
      });

      const resetBtn = screen.getByRole("button", { name: /Stop all sound layers/i });
      expect(resetBtn).not.toBeDisabled();

      await act(async () => {
        fireEvent.click(resetBtn);
      });

      expect(screen.getByRole("button", { name: /Enable Gentle Rain/i })).toHaveAttribute(
        "aria-pressed",
        "false"
      );
    });

    it("displays an alert message when Web Audio API is unsupported", () => {
      delete (window as any).AudioContext;
      render(<AmbientSoundscapeGenerator />);

      expect(screen.getByRole("alert")).toBeInTheDocument();
      expect(
        screen.getByText(/The Web Audio API is not supported/i)
      ).toBeInTheDocument();
    });

    it("respects prefers-reduced-motion media query", () => {
      window.matchMedia = jest.fn().mockImplementation((query) => ({
        matches: query.includes("prefers-reduced-motion: reduce"),
        media: query,
        addListener: jest.fn(),
        removeListener: jest.fn(),
        addEventListener: jest.fn(),
        removeEventListener: jest.fn(),
      }));

      render(<AmbientSoundscapeGenerator />);
      expect(
        screen.getByRole("region", { name: "Ambient Soundscape Generator" })
      ).toBeInTheDocument();
    });
  });
});
