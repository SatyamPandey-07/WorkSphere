import {
  CHIME_DURATION_SECONDS,
  DEFAULT_VOLUME,
  ErgonomicChimeSynthesizer,
  FUNDAMENTAL_HZ,
  OVERTONE_HZ,
  clampVolume,
} from "@/lib/audio/ErgonomicChimeSynthesizer";

interface MockParam {
  value: number;
  setValueAtTime: jest.Mock;
  exponentialRampToValueAtTime: jest.Mock;
  cancelScheduledValues: jest.Mock;
}

interface MockOscillator {
  type: string;
  frequency: MockParam;
  connect: jest.Mock;
  disconnect: jest.Mock;
  start: jest.Mock;
  stop: jest.Mock;
  onended: (() => void) | null;
}

interface MockGain {
  gain: MockParam;
  connect: jest.Mock;
  disconnect: jest.Mock;
}

const START = 10;

function createParam(initial = 0): MockParam {
  return {
    value: initial,
    setValueAtTime: jest.fn(),
    exponentialRampToValueAtTime: jest.fn(),
    cancelScheduledValues: jest.fn(),
  };
}

function createMockContext(initialState: "running" | "suspended" = "running") {
  let state: string = initialState;
  const oscillators: MockOscillator[] = [];
  const gains: MockGain[] = [];
  const destination = { id: "destination" };

  const context = {
    currentTime: START,
    destination,
    get state() {
      return state;
    },
    resume: jest.fn(async () => {
      state = "running";
    }),
    close: jest.fn(async () => {
      state = "closed";
    }),
    createOscillator: jest.fn(() => {
      const oscillator: MockOscillator = {
        type: "sine",
        frequency: createParam(),
        connect: jest.fn(),
        disconnect: jest.fn(),
        start: jest.fn(),
        stop: jest.fn(),
        onended: null,
      };
      oscillators.push(oscillator);
      return oscillator;
    }),
    createGain: jest.fn(() => {
      const gain: MockGain = {
        gain: createParam(1),
        connect: jest.fn(),
        disconnect: jest.fn(),
      };
      gains.push(gain);
      return gain;
    }),
  };

  return {
    context,
    oscillators,
    gains,
    destination,
    asAudioContext: () => context as unknown as AudioContext,
  };
}

function createSynth(
  options: { volume?: number; muted?: boolean; durationSeconds?: number } = {},
  initialState: "running" | "suspended" = "running",
) {
  const mock = createMockContext(initialState);
  const factory = jest.fn(() => mock.asAudioContext());
  const synth = new ErgonomicChimeSynthesizer({
    ...options,
    audioContextFactory: factory,
  });
  return { synth, factory, ...mock };
}

describe("clampVolume", () => {
  it("keeps values inside 0-1", () => {
    expect(clampVolume(0.3)).toBe(0.3);
    expect(clampVolume(-1)).toBe(0);
    expect(clampVolume(5)).toBe(1);
  });

  it("returns the fallback for invalid input", () => {
    expect(clampVolume(NaN)).toBe(DEFAULT_VOLUME);
    expect(clampVolume(Infinity, 0.2)).toBe(0.2);
  });
});

describe("ErgonomicChimeSynthesizer sound design", () => {
  it("plays two sine oscillators at 432 Hz and 864 Hz", async () => {
    const { synth, oscillators } = createSynth();

    await expect(synth.play()).resolves.toBe(true);

    expect(oscillators).toHaveLength(2);
    expect(oscillators.map((o) => o.type)).toEqual(["sine", "sine"]);
    expect(oscillators[0].frequency.setValueAtTime).toHaveBeenCalledWith(
      FUNDAMENTAL_HZ,
      START,
    );
    expect(oscillators[1].frequency.setValueAtTime).toHaveBeenCalledWith(
      OVERTONE_HZ,
      START,
    );
    expect(FUNDAMENTAL_HZ).toBe(432);
    expect(OVERTONE_HZ).toBe(864);
  });

  it("shapes each voice with a soft attack and an exponential decay", async () => {
    const { synth, gains } = createSynth();
    await synth.play();

    // gains[0] is the master gain; voices follow.
    const fundamental = gains[1].gain;
    expect(fundamental.setValueAtTime).toHaveBeenCalledWith(0.0001, START);

    const [attack, decay] = fundamental.exponentialRampToValueAtTime.mock.calls;
    expect(attack[0]).toBeGreaterThan(0.0001);
    expect(attack[1]).toBeCloseTo(START + 0.02, 5);
    expect(decay[0]).toBe(0.0001);
    expect(decay[1]).toBeCloseTo(START + CHIME_DURATION_SECONDS, 5);
  });

  it("lets the overtone fade out before the fundamental", async () => {
    const { synth, gains } = createSynth();
    await synth.play();

    const fundamentalEnd =
      gains[1].gain.exponentialRampToValueAtTime.mock.calls[1][1];
    const overtoneEnd =
      gains[2].gain.exponentialRampToValueAtTime.mock.calls[1][1];
    expect(overtoneEnd).toBeLessThan(fundamentalEnd);
    expect(overtoneEnd).toBeCloseTo(START + CHIME_DURATION_SECONDS * 0.6, 5);
  });

  it("never ramps to exactly 0 (exponential ramps cannot reach it)", async () => {
    const { synth, gains } = createSynth();
    await synth.play();

    for (const voice of [gains[1], gains[2]]) {
      for (const [target] of voice.gain.exponentialRampToValueAtTime.mock
        .calls) {
        expect(target).toBeGreaterThan(0);
      }
    }
  });

  it("keeps the combined voice level below full scale", async () => {
    const { synth, gains } = createSynth();
    await synth.play();

    const peaks = [gains[1], gains[2]].map(
      (g) => g.gain.exponentialRampToValueAtTime.mock.calls[0][0] as number,
    );
    expect(peaks[0] + peaks[1]).toBeLessThan(1);
  });

  it("routes both voices through the master gain to the output", async () => {
    const { synth, gains, oscillators, destination } = createSynth();
    await synth.play();

    const [master, fundamental, overtone] = gains;
    expect(master.connect).toHaveBeenCalledWith(destination);
    expect(oscillators[0].connect).toHaveBeenCalledWith(fundamental);
    expect(oscillators[1].connect).toHaveBeenCalledWith(overtone);
    expect(fundamental.connect).toHaveBeenCalledWith(master);
    expect(overtone.connect).toHaveBeenCalledWith(master);
  });

  it("starts the oscillators now and stops them after the decay finishes", async () => {
    const { synth, oscillators } = createSynth();
    await synth.play();

    const fundamentalStop = oscillators[0].stop.mock.calls[0][0] as number;
    const overtoneStop = oscillators[1].stop.mock.calls[0][0] as number;
    expect(oscillators[0].start).toHaveBeenCalledWith(START);
    expect(oscillators[1].start).toHaveBeenCalledWith(START);
    expect(fundamentalStop).toBeGreaterThan(START + CHIME_DURATION_SECONDS);
    expect(overtoneStop).toBeGreaterThan(START + CHIME_DURATION_SECONDS * 0.6);
  });

  it("disconnects its nodes when an oscillator ends", async () => {
    const { synth, oscillators, gains } = createSynth();
    await synth.play();

    oscillators[0].onended?.();
    expect(oscillators[0].disconnect).toHaveBeenCalled();
    expect(gains[1].disconnect).toHaveBeenCalled();
  });

  it("honours a custom duration and falls back for invalid ones", async () => {
    const custom = createSynth({ durationSeconds: 8 });
    await custom.synth.play();
    expect(
      custom.gains[1].gain.exponentialRampToValueAtTime.mock.calls[1][1],
    ).toBeCloseTo(START + 8, 5);

    const invalid = createSynth({ durationSeconds: -3 });
    await invalid.synth.play();
    expect(
      invalid.gains[1].gain.exponentialRampToValueAtTime.mock.calls[1][1],
    ).toBeCloseTo(START + CHIME_DURATION_SECONDS, 5);
  });
});

describe("ErgonomicChimeSynthesizer volume", () => {
  it("defaults to a moderate volume", () => {
    const { synth } = createSynth();
    expect(synth.getVolume()).toBe(DEFAULT_VOLUME);
  });

  it("accepts an initial volume", () => {
    const { synth } = createSynth({ volume: 0.8 });
    expect(synth.getVolume()).toBe(0.8);
  });

  it("clamps the volume to 0-1 and ignores invalid values", () => {
    const { synth } = createSynth();
    synth.setVolume(2);
    expect(synth.getVolume()).toBe(1);
    synth.setVolume(-0.5);
    expect(synth.getVolume()).toBe(0);
    synth.setVolume(0.4);
    synth.setVolume(NaN);
    expect(synth.getVolume()).toBe(0.4);
  });

  it("applies the volume to the master gain", async () => {
    const { synth, gains } = createSynth({ volume: 0.3 });
    await synth.play();
    expect(gains[0].gain.setValueAtTime).toHaveBeenLastCalledWith(0.3, START);

    synth.setVolume(0.9);
    expect(gains[0].gain.setValueAtTime).toHaveBeenLastCalledWith(0.9, START);
  });

  it("does not play at zero volume", async () => {
    const { synth, factory } = createSynth({ volume: 0 });
    await expect(synth.play()).resolves.toBe(false);
    expect(factory).not.toHaveBeenCalled();
  });
});

describe("ErgonomicChimeSynthesizer mute", () => {
  it("does not play, or even create audio, while muted", async () => {
    const { synth, factory, oscillators } = createSynth({ muted: true });

    await expect(synth.play()).resolves.toBe(false);
    expect(factory).not.toHaveBeenCalled();
    expect(oscillators).toHaveLength(0);
  });

  it("toggles the mute state and reports the new value", () => {
    const { synth } = createSynth();
    expect(synth.isMuted()).toBe(false);
    expect(synth.toggleMute()).toBe(true);
    expect(synth.isMuted()).toBe(true);
    expect(synth.toggleMute()).toBe(false);
    expect(synth.isMuted()).toBe(false);
  });

  it("plays again after unmuting", async () => {
    const { synth, oscillators } = createSynth({ muted: true });
    await synth.play();
    synth.setMuted(false);

    await expect(synth.play()).resolves.toBe(true);
    expect(oscillators).toHaveLength(2);
  });

  it("silences a chime that is already ringing, and restores it on unmute", async () => {
    const { synth, gains } = createSynth({ volume: 0.6 });
    await synth.play();

    synth.setMuted(true);
    expect(gains[0].gain.setValueAtTime).toHaveBeenLastCalledWith(0, START);

    synth.setMuted(false);
    expect(gains[0].gain.setValueAtTime).toHaveBeenLastCalledWith(0.6, START);
  });
});

describe("ErgonomicChimeSynthesizer audio context handling", () => {
  it("resumes a suspended context before playing", async () => {
    const { synth, context, oscillators } = createSynth({}, "suspended");

    await expect(synth.play()).resolves.toBe(true);
    expect(context.resume).toHaveBeenCalledTimes(1);
    expect(oscillators).toHaveLength(2);
  });

  it("skips playback when the browser refuses to resume", async () => {
    const { synth, context, oscillators } = createSynth({}, "suspended");
    context.resume.mockRejectedValueOnce(new Error("blocked"));

    await expect(synth.play()).resolves.toBe(false);
    expect(oscillators).toHaveLength(0);
  });

  it("does not play if muted while the context was resuming", async () => {
    const { synth, context, oscillators } = createSynth({}, "suspended");
    context.resume.mockImplementationOnce(async () => {
      synth.setMuted(true);
    });

    await expect(synth.play()).resolves.toBe(false);
    expect(oscillators).toHaveLength(0);
  });

  it("returns false when Web Audio is unavailable", async () => {
    const synth = new ErgonomicChimeSynthesizer({
      audioContextFactory: () => null,
    });
    await expect(synth.play()).resolves.toBe(false);
  });

  it("returns false when creating the context throws", async () => {
    const synth = new ErgonomicChimeSynthesizer({
      audioContextFactory: () => {
        throw new Error("not allowed");
      },
    });
    await expect(synth.play()).resolves.toBe(false);
  });

  it("reuses one context across chimes", async () => {
    const { synth, factory } = createSynth();
    await synth.play();
    await synth.play();
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it("closes the context on dispose and creates a new one afterwards", async () => {
    const { synth, factory, context } = createSynth();
    await synth.play();

    await synth.dispose();
    expect(context.close).toHaveBeenCalledTimes(1);

    await synth.play();
    expect(factory).toHaveBeenCalledTimes(2);
  });

  it("can be disposed before it was ever played", async () => {
    const { synth } = createSynth();
    await expect(synth.dispose()).resolves.toBeUndefined();
  });

  it("uses the browser AudioContext by default", async () => {
    const mock = createMockContext();
    const ctor = jest.fn(() => mock.asAudioContext());
    Object.defineProperty(window, "AudioContext", {
      configurable: true,
      writable: true,
      value: ctor,
    });

    try {
      const synth = new ErgonomicChimeSynthesizer();
      await expect(synth.play()).resolves.toBe(true);
      expect(ctor).toHaveBeenCalledTimes(1);
      expect(mock.oscillators).toHaveLength(2);
    } finally {
      Reflect.deleteProperty(window, "AudioContext");
    }
  });
});
