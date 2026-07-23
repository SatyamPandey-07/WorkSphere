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
    Q: {
      setValueAtTime: jest.fn(),
    },
    gain: {
      setValueAtTime: jest.fn(),
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
  global.AudioContext = jest.fn().mockImplementation(() => mockAudioContext) as any;
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

  it("renders EQ preset selector with default Flat", () => {
    render(<AudioEqualizer venueName="Test Workspace" />);

    const select = screen.getByTitle("Equalizer Preset") as HTMLSelectElement;
    expect(select).toBeInTheDocument();
    expect(select.value).toBe("flat");
  });

  it("contains all EQ presets in dropdown", () => {
    render(<AudioEqualizer venueName="Test Workspace" />);

    const select = screen.getByTitle("Equalizer Preset") as HTMLSelectElement;
    const options = Array.from(select.options).map((o) => o.value);

    expect(options).toContain("flat");
    expect(options).toContain("bass-boost");
    expect(options).toContain("vocal-enhancer");
    expect(options).toContain("treble-boost");
    expect(options).toContain("warm");
    expect(options).toHaveLength(5);
  });

  it("updates EQ preset on selection", () => {
    render(<AudioEqualizer venueName="Test Workspace" />);

    const select = screen.getByTitle("Equalizer Preset") as HTMLSelectElement;

    fireEvent.change(select, { target: { value: "bass-boost" } });
    expect(select.value).toBe("bass-boost");

    fireEvent.change(select, { target: { value: "vocal-enhancer" } });
    expect(select.value).toBe("vocal-enhancer");
  });

  it("displays correct label for each EQ preset option", () => {
    render(<AudioEqualizer venueName="Test Workspace" />);

    const select = screen.getByTitle("Equalizer Preset") as HTMLSelectElement;
    const optionLabels = Array.from(select.options).map((o) => o.text);

    expect(optionLabels).toContain("Flat");
    expect(optionLabels).toContain("Bass Boost");
    expect(optionLabels).toContain("Vocal Enhancer");
    expect(optionLabels).toContain("Treble Boost");
    expect(optionLabels).toContain("Warm");
  });
});
