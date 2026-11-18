/**
 * @jest-environment jsdom
 */
import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import {
  AudioEqualizer,
  CHATTER_SHIELD_FREQUENCY_HZ,
  CHATTER_SHIELD_GAIN_DB,
  CHATTER_SHIELD_Q,
  CHATTER_SHIELD_RAMP_TIME_CONSTANT,
  CHATTER_SHIELD_STORAGE_KEY,
} from "@/components/audio/AudioEqualizer";

type MockParam = {
  value: number;
  setValueAtTime: jest.Mock;
  setTargetAtTime: jest.Mock;
  linearRampToValueAtTime: jest.Mock;
  exponentialRampToValueAtTime: jest.Mock;
  cancelScheduledValues: jest.Mock;
};

type MockBiquad = {
  connect: jest.Mock;
  disconnect: jest.Mock;
  type: string;
  frequency: MockParam;
  Q: MockParam;
  gain: MockParam;
};

type MockGainNode = {
  connect: jest.Mock;
  disconnect: jest.Mock;
  gain: MockParam;
};

function makeParam(initial: number): MockParam {
  return {
    value: initial,
    setValueAtTime: jest.fn(),
    setTargetAtTime: jest.fn(),
    linearRampToValueAtTime: jest.fn(),
    exponentialRampToValueAtTime: jest.fn(),
    cancelScheduledValues: jest.fn(),
  };
}

const CURRENT_TIME = 1.5;

let createdFilters: MockBiquad[];
let createdGains: MockGainNode[];
let audioContext: Record<string, unknown>;

function createMockAudioContext() {
  createdFilters = [];
  createdGains = [];

  const makeFilter = (): MockBiquad => {
    const node: MockBiquad = {
      connect: jest.fn(),
      disconnect: jest.fn(),
      type: "lowpass",
      frequency: makeParam(350),
      Q: makeParam(1),
      gain: makeParam(0),
    };
    createdFilters.push(node);
    return node;
  };

  const makeGain = (): MockGainNode => {
    const node: MockGainNode = {
      connect: jest.fn(),
      disconnect: jest.fn(),
      gain: makeParam(1),
    };
    createdGains.push(node);
    return node;
  };

  audioContext = {
    createBiquadFilter: jest.fn(makeFilter),
    createGain: jest.fn(makeGain),
    createAnalyser: jest.fn(() => ({
      connect: jest.fn(),
      disconnect: jest.fn(),
      fftSize: 64,
      frequencyBinCount: 32,
      getByteFrequencyData: jest.fn(),
    })),
    createBuffer: jest.fn((_channels: number, size: number, rate: number) => ({
      getChannelData: jest.fn(() => new Float32Array(size)),
      sampleRate: rate,
    })),
    createBufferSource: jest.fn(() => ({
      connect: jest.fn(),
      disconnect: jest.fn(),
      start: jest.fn(),
      stop: jest.fn(),
      buffer: null,
      loop: false,
    })),
    createOscillator: jest.fn(() => ({
      connect: jest.fn(),
      disconnect: jest.fn(),
      start: jest.fn(),
      stop: jest.fn(),
      type: "sine",
      frequency: makeParam(440),
    })),
    destination: {},
    currentTime: CURRENT_TIME,
    sampleRate: 44100,
    state: "running",
    resume: jest.fn().mockResolvedValue(undefined),
    suspend: jest.fn().mockResolvedValue(undefined),
    close: jest.fn().mockResolvedValue(undefined),
  };

  return audioContext;
}

/** The chatter filter is created after the five EQ bands during initAudio. */
function chatterFilter(): MockBiquad {
  const filter = createdFilters.find(
    (node) =>
      node.type === "peaking" &&
      node.frequency.setValueAtTime.mock.calls.some(
        ([hz]) => hz === CHATTER_SHIELD_FREQUENCY_HZ,
      ),
  );
  if (!filter) throw new Error("chatter shield filter was not created");
  return filter;
}

function startAudio() {
  fireEvent.click(screen.getByText("☕ Cafe Chatter"));
  fireEvent.click(screen.getByTitle("Listen to Ambience"));
}

beforeAll(() => {
  global.AudioContext = jest.fn(
    () => audioContext,
  ) as unknown as typeof AudioContext;

  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: jest.fn().mockImplementation((query: string) => ({
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

beforeEach(() => {
  createMockAudioContext();
  (global.AudioContext as unknown as jest.Mock).mockImplementation(
    () => audioContext,
  );
  window.localStorage.clear();
});

describe("AudioEqualizer Ambient Chatter Shield (#7733)", () => {
  it("chains a Q=1.5 peaking cut between the EQ cascade and the master gain", () => {
    render(<AudioEqualizer venueName="Test Workspace" />);
    startAudio();

    const shield = chatterFilter();
    expect(shield.type).toBe("peaking");
    expect(shield.frequency.setValueAtTime).toHaveBeenCalledWith(
      CHATTER_SHIELD_FREQUENCY_HZ,
      CURRENT_TIME,
    );
    expect(shield.Q.setValueAtTime).toHaveBeenCalledWith(
      CHATTER_SHIELD_Q,
      CURRENT_TIME,
    );

    // Bypassed by default, and wired after the fifth EQ band into master gain.
    expect(shield.gain.setValueAtTime).toHaveBeenCalledWith(0, CURRENT_TIME);
    const lastEqBand = createdFilters[4];
    expect(lastEqBand.connect).toHaveBeenCalledWith(shield);
    expect(shield.connect).toHaveBeenCalledWith(createdGains[0]);

    const toggle = screen.getByTestId("chatter-shield-toggle");
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByLabelText("Ambient Chatter Shield")).toBe(toggle);
  });

  it("ramps the filter gain with setTargetAtTime in both directions", () => {
    render(<AudioEqualizer venueName="Test Workspace" />);
    startAudio();
    const shield = chatterFilter();
    const toggle = screen.getByTestId("chatter-shield-toggle");

    fireEvent.click(toggle);

    expect(shield.gain.setTargetAtTime).toHaveBeenCalledWith(
      CHATTER_SHIELD_GAIN_DB,
      CURRENT_TIME,
      CHATTER_SHIELD_RAMP_TIME_CONSTANT,
    );
    // Ramping is what keeps the transition click-free: the parameter is never
    // assigned a new value directly.
    expect(shield.gain.value).toBe(0);
    expect(shield.gain.setValueAtTime).not.toHaveBeenCalledWith(
      CHATTER_SHIELD_GAIN_DB,
      expect.anything(),
    );
    expect(toggle).toHaveAttribute("aria-pressed", "true");
    expect(window.localStorage.getItem(CHATTER_SHIELD_STORAGE_KEY)).toBe("1");

    fireEvent.click(toggle);

    expect(shield.gain.setTargetAtTime).toHaveBeenLastCalledWith(
      0,
      CURRENT_TIME,
      CHATTER_SHIELD_RAMP_TIME_CONSTANT,
    );
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    expect(window.localStorage.getItem(CHATTER_SHIELD_STORAGE_KEY)).toBe("0");
  });

  it("persists the preference and seeds the filter before first playback", () => {
    render(<AudioEqualizer venueName="Test Workspace" />);

    fireEvent.click(screen.getByTestId("chatter-shield-toggle"));
    expect(window.localStorage.getItem(CHATTER_SHIELD_STORAGE_KEY)).toBe("1");
    // No AudioContext exists yet, so no node should have been created.
    expect(createdFilters).toHaveLength(0);

    startAudio();

    const shield = chatterFilter();
    expect(shield.gain.setValueAtTime).toHaveBeenCalledWith(
      CHATTER_SHIELD_GAIN_DB,
      CURRENT_TIME,
    );
    expect(shield.gain.setTargetAtTime).not.toHaveBeenCalled();
  });

  it("restores a persisted preference on mount", async () => {
    window.localStorage.setItem(CHATTER_SHIELD_STORAGE_KEY, "1");

    render(<AudioEqualizer venueName="Test Workspace" />);

    await waitFor(() =>
      expect(screen.getByTestId("chatter-shield-toggle")).toHaveAttribute(
        "aria-pressed",
        "true",
      ),
    );

    startAudio();
    expect(chatterFilter().gain.setValueAtTime).toHaveBeenCalledWith(
      CHATTER_SHIELD_GAIN_DB,
      CURRENT_TIME,
    );
  });

  it("does not expose the toggle when an external call graph is supplied", () => {
    const externalContext = createMockAudioContext();
    const sourceNode = {
      connect: jest.fn(),
      disconnect: jest.fn(),
    } as unknown as AudioNode;
    const destinationNode = {
      connect: jest.fn(),
      disconnect: jest.fn(),
    } as unknown as AudioNode;

    render(
      <AudioEqualizer
        venueName="Test Workspace"
        audioContext={externalContext as unknown as AudioContext}
        sourceNode={sourceNode}
        destinationNode={destinationNode}
      />,
    );

    expect(screen.queryByTestId("chatter-shield-toggle")).toBeNull();
  });
});
