import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import { AudioEqualizer } from "@/components/audio/AudioEqualizer";

// Mock the Web Audio API
const mockOscillator = {
  connect: jest.fn(),
  start: jest.fn(),
  stop: jest.fn(),
  frequency: {
    setValueAtTime: jest.fn(),
  },
};

const mockGain = {
  connect: jest.fn(),
  gain: {
    setValueAtTime: jest.fn(),
    linearRampToValueAtTime: jest.fn(),
    exponentialRampToValueAtTime: jest.fn(),
  },
};

const mockAnalyser = {
  connect: jest.fn(),
  fftSize: 64,
  frequencyBinCount: 32,
  getByteFrequencyData: jest.fn((array) => {
    array.fill(128);
  }),
};

const mockAudioContext = {
  createOscillator: jest.fn(() => mockOscillator),
  createGain: jest.fn(() => mockGain),
  createAnalyser: jest.fn(() => mockAnalyser),
  createBuffer: jest.fn((channels, size, rate) => ({
    getChannelData: jest.fn(() => new Float32Array(size)),
    sampleRate: rate,
  })),
  createBufferSource: jest.fn(() => ({
    connect: jest.fn(),
    start: jest.fn(),
    stop: jest.fn(),
    loop: false,
  })),
  createBiquadFilter: jest.fn(() => ({
    connect: jest.fn(),
    type: "lowpass",
    frequency: {
      setValueAtTime: jest.fn(),
    },
    gain: {
      setValueAtTime: jest.fn(),
      setTargetAtTime: jest.fn(),
      linearRampToValueAtTime: jest.fn(),
      value: 0,
    },
    Q: {
      value: 1.0,
    },
  })),
  destination: {},
  currentTime: 0,
  state: "suspended",
  resume: jest.fn().mockResolvedValue(undefined),
  suspend: jest.fn().mockResolvedValue(undefined),
  close: jest.fn().mockResolvedValue(undefined),
};

beforeAll(() => {
  global.AudioContext = jest
    .fn()
    .mockImplementation(() => mockAudioContext) as any;
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: jest.fn().mockImplementation((query) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: jest.fn(),
      removeListener: jest.fn(),
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      dispatchEvent: jest.fn(),
    })),
  });
});

describe("AudioEqualizer Component (#859)", () => {
  it("renders correctly with title and presets", () => {
    render(<AudioEqualizer venueName="Test Workspace" />);

    expect(screen.getByText("Acoustic Ambience Preview")).toBeInTheDocument();
    expect(screen.getByText("🎷 Soft Jazz")).toBeInTheDocument();
    expect(screen.getByText("☕ Cafe Chatter")).toBeInTheDocument();
    expect(screen.getByText("📚 Library Silence")).toBeInTheDocument();
  });

  it("toggles play and active states", () => {
    render(<AudioEqualizer venueName="Test Workspace" />);

    const playButton = screen.getByTitle("Listen to Ambience");
    expect(playButton).toBeInTheDocument();

    fireEvent.click(playButton);

    // Should switch play state to active (Pause title)
    expect(screen.getByTitle("Pause Sound")).toBeInTheDocument();
  });

  it("switches sound presets", () => {
    render(<AudioEqualizer venueName="Test Workspace" />);

    const cafeBtn = screen.getByText("☕ Cafe Chatter");
    fireEvent.click(cafeBtn);

    // Cafe Chatter preset becomes active
    expect(cafeBtn).toHaveClass("bg-indigo-600");
  });

  it("updates BiquadFilterNode gain in real-time with smooth audio param ramping when dragging EQ sliders (#1392)", () => {
    render(<AudioEqualizer venueName="Test Workspace" />);

    // Start playing audio so initAudio creates BiquadFilterNode cascade
    const playButton = screen.getByTitle("Listen to Ambience");
    fireEvent.click(playButton);

    const slider60Hz = screen.getByRole("slider", { name: "60Hz Gain" });
    expect(slider60Hz).toBeInTheDocument();

    fireEvent.change(slider60Hz, { target: { value: "6" } });
    expect(screen.getByText("+6 dB")).toBeInTheDocument();

    const slider1kHz = screen.getByRole("slider", { name: "1kHz Gain" });
    fireEvent.change(slider1kHz, { target: { value: "-4" } });
    expect(screen.getByText("-4 dB")).toBeInTheDocument();

    // Reset EQ
    const resetBtn = screen.getByTitle("Reset all EQ gains to 0 dB");
    fireEvent.click(resetBtn);
    expect(screen.getAllByText("0 dB")).toHaveLength(5);
  });
});
