import {
  AvionicsSynthesizer,
  type RadarToneMode,
} from "@/lib/audio/AvionicsSynthesizer";

interface MockAudioParam {
  value: number;
  setValueAtTime: jest.Mock;
  linearRampToValueAtTime: jest.Mock;
  exponentialRampToValueAtTime: jest.Mock;
  cancelScheduledValues: jest.Mock;
}

interface MockOscillator {
  type: string;
  frequency: MockAudioParam;
  detune: MockAudioParam;
  connect: jest.Mock;
  disconnect: jest.Mock;
  start: jest.Mock;
  stop: jest.Mock;
  onended: (() => void) | null;
}

interface MockGain {
  gain: MockAudioParam;
  connect: jest.Mock;
  disconnect: jest.Mock;
}

interface MockBiquadFilter {
  type: string;
  frequency: MockAudioParam;
  Q: MockAudioParam;
  gain: MockAudioParam;
  connect: jest.Mock;
  disconnect: jest.Mock;
}

interface MockBufferSource {
  buffer: AudioBuffer | null;
  loop: boolean;
  connect: jest.Mock;
  disconnect: jest.Mock;
  start: jest.Mock;
  stop: jest.Mock;
  onended: (() => void) | null;
}

function createParam(initial = 0): MockAudioParam {
  return {
    value: initial,
    setValueAtTime: jest.fn(function (val: number) {
      (this as any).value = val;
    }),
    linearRampToValueAtTime: jest.fn(function (val: number) {
      (this as any).value = val;
    }),
    exponentialRampToValueAtTime: jest.fn(function (val: number) {
      (this as any).value = val;
    }),
    cancelScheduledValues: jest.fn(),
  };
}

function createMockAudioContext(initialState: "running" | "suspended" = "running") {
  let state: string = initialState;
  const oscillators: MockOscillator[] = [];
  const gains: MockGain[] = [];
  const filters: MockBiquadFilter[] = [];
  const bufferSources: MockBufferSource[] = [];
  const destination = { id: "destination" };

  const context = {
    currentTime: 10,
    sampleRate: 44100,
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
        frequency: createParam(440),
        detune: createParam(0),
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
    createBiquadFilter: jest.fn(() => {
      const filter: MockBiquadFilter = {
        type: "lowpass",
        frequency: createParam(1000),
        Q: createParam(1),
        gain: createParam(0),
        connect: jest.fn(),
        disconnect: jest.fn(),
      };
      filters.push(filter);
      return filter;
    }),
    createBufferSource: jest.fn(() => {
      const source: MockBufferSource = {
        buffer: null,
        loop: false,
        connect: jest.fn(),
        disconnect: jest.fn(),
        start: jest.fn(),
        stop: jest.fn(),
        onended: null,
      };
      bufferSources.push(source);
      return source;
    }),
    createBuffer: jest.fn((channels: number, length: number, sampleRate: number) => {
      const channelData = new Float32Array(length);
      return {
        numberOfChannels: channels,
        length,
        sampleRate,
        duration: length / sampleRate,
        getChannelData: jest.fn(() => channelData),
      } as unknown as AudioBuffer;
    }),
  };

  return {
    context,
    oscillators,
    gains,
    filters,
    bufferSources,
    destination,
    asAudioContext: () => context as unknown as AudioContext,
  };
}

describe("AvionicsSynthesizer Procedural Audio Engine (#6328)", () => {
  let mockEnv: ReturnType<typeof createMockAudioContext>;
  let synth: AvionicsSynthesizer;

  beforeEach(() => {
    mockEnv = createMockAudioContext();
    synth = new AvionicsSynthesizer({
      audioContextFactory: () => mockEnv.asAudioContext(),
    });
  });

  describe("Lifecycle and Audio Context Management", () => {
    it("initializes master gain node and routes it to destination", () => {
      const ctx = synth.ensureContext();
      expect(ctx).toBeDefined();
      expect(mockEnv.gains[0].connect).toHaveBeenCalledWith(mockEnv.destination);
      expect(synth.getMasterGain()).toBeDefined();
      expect(synth.getMasterVolume()).toBe(0.7);
    });

    it("supports setting master volume and clamping between 0 and 1", () => {
      synth.ensureContext();
      synth.setMasterVolume(0.9);
      expect(synth.getMasterVolume()).toBe(0.9);
      expect(mockEnv.gains[0].gain.setValueAtTime).toHaveBeenCalledWith(0.9, 10);

      synth.setMasterVolume(1.5);
      expect(synth.getMasterVolume()).toBe(1.0);

      synth.setMasterVolume(-0.2);
      expect(synth.getMasterVolume()).toBe(0.0);
    });

    it("handles mute and unmute transitions", () => {
      synth.ensureContext();
      expect(synth.getMuted()).toBe(false);

      synth.setMuted(true);
      expect(synth.getMuted()).toBe(true);
      expect(mockEnv.gains[0].gain.setValueAtTime).toHaveBeenLastCalledWith(0, 10);

      synth.setMuted(false);
      expect(synth.getMuted()).toBe(false);
      expect(mockEnv.gains[0].gain.setValueAtTime).toHaveBeenLastCalledWith(0.7, 10);
    });

    it("resumes suspended audio context when starting engine", () => {
      const suspendedEnv = createMockAudioContext("suspended");
      const suspendedSynth = new AvionicsSynthesizer({
        audioContextFactory: () => suspendedEnv.asAudioContext(),
      });

      suspendedSynth.startEngine();
      expect(suspendedEnv.context.resume).toHaveBeenCalled();
    });

    it("gracefully shuts down audio nodes and closes context on dispose", async () => {
      synth.startEngine();
      expect(synth.isRunning()).toBe(true);

      await synth.dispose();
      expect(synth.isRunning()).toBe(false);
      expect(mockEnv.context.close).toHaveBeenCalled();
    });
  });

  describe("Turbine FM Synthesis & Engine Sound Loop", () => {
    it("starts engine with carrier, modulator, and pink noise air friction graph", () => {
      const started = synth.startEngine({ throttle: 0.5, velocityKnots: 400 });
      expect(started).toBe(true);
      expect(synth.isRunning()).toBe(true);

      // Carrier & Modulator oscillators created
      expect(mockEnv.oscillators).toHaveLength(2);
      const [carrier, modulator] = mockEnv.oscillators;

      expect(carrier.type).toBe("sawtooth");
      expect(modulator.type).toBe("sine");

      // Modulator connects to turbineModGain, and modGain connects to carrier frequency AudioParam
      const modGain = mockEnv.gains[2];
      expect(modulator.connect).toHaveBeenCalledWith(modGain);
      expect(modGain.connect).toHaveBeenCalledWith(carrier.frequency);

      // Carrier starts immediately
      expect(carrier.start).toHaveBeenCalledWith(10);
      expect(modulator.start).toHaveBeenCalledWith(10);

      // BufferSource created for air friction pink noise
      expect(mockEnv.bufferSources).toHaveLength(1);
      const noiseSource = mockEnv.bufferSources[0];
      expect(noiseSource.loop).toBe(true);
      expect(noiseSource.start).toHaveBeenCalledWith(10);
    });

    it("does not recreate engine nodes when startEngine is invoked repeatedly", () => {
      synth.startEngine();
      const oscCount = mockEnv.oscillators.length;
      synth.startEngine();
      expect(mockEnv.oscillators.length).toBe(oscCount);
    });

    it("stops all engine oscillators and disconnects audio graph on stopEngine", () => {
      synth.startEngine();
      synth.stopEngine();

      expect(synth.isRunning()).toBe(false);
      mockEnv.oscillators.forEach((osc) => {
        expect(osc.stop).toHaveBeenCalled();
        expect(osc.disconnect).toHaveBeenCalled();
      });
      mockEnv.bufferSources.forEach((src) => {
        expect(src.stop).toHaveBeenCalled();
        expect(src.disconnect).toHaveBeenCalled();
      });
    });
  });

  describe("Dynamic Flight Parameter Modulation (Throttle, Velocity, Distance)", () => {
    it("smoothly ramps FM turbine frequencies when throttle changes", () => {
      synth.startEngine({ throttle: 0.2 });

      const [carrier, modulator] = mockEnv.oscillators;
      const modGain = mockEnv.gains[2];
      const turbineGain = mockEnv.gains[3];

      // Update to full afterburner throttle (1.0)
      synth.updateTelemetry({ throttle: 1.0 }, 0.1);

      const telemetry = synth.getTelemetry();
      expect(telemetry.throttle).toBe(1.0);

      // Carrier frequency ramp: 400 + 1.0 * 1600 = 2000Hz
      expect(carrier.frequency.linearRampToValueAtTime).toHaveBeenCalledWith(
        2000,
        expect.closeTo(10.1, 2),
      );

      // Modulator frequency ramp: 80 + 1.0 * 320 = 400Hz
      expect(modulator.frequency.linearRampToValueAtTime).toHaveBeenCalledWith(
        400,
        expect.closeTo(10.1, 2),
      );

      // FM Modulation depth ramp: 120 + 1.0 * 400 = 520
      expect(modGain.gain.linearRampToValueAtTime).toHaveBeenCalledWith(
        520,
        expect.closeTo(10.1, 2),
      );

      // Volume ramp
      expect(turbineGain.gain.linearRampToValueAtTime).toHaveBeenCalledWith(
        expect.closeTo(0.6, 2),
        expect.closeTo(10.1, 2),
      );
    });

    it("modulates resonant air friction filter cutoff and resonance with supersonic velocity", () => {
      synth.startEngine({ velocityKnots: 200 });

      const frictionFilter = mockEnv.filters[0];
      const frictionGain = mockEnv.gains[4];

      // Accelerate to supersonic speed (800 knots)
      synth.updateTelemetry({ velocityKnots: 800 }, 0.05);

      expect(frictionFilter.frequency.cancelScheduledValues).toHaveBeenCalledWith(10);
      expect(frictionFilter.frequency.linearRampToValueAtTime).toHaveBeenCalled();
      expect(frictionFilter.Q.linearRampToValueAtTime).toHaveBeenCalled();
      expect(frictionGain.gain.linearRampToValueAtTime).toHaveBeenCalled();
    });

    it("attenuates engine sound with observer distance", () => {
      synth.startEngine({ distanceMeters: 50 });
      const distanceGainNode = mockEnv.gains[1];

      // Move observer further away (200 meters)
      synth.updateTelemetry({ distanceMeters: 200 }, 0.05);

      // 50 / 200 = 0.25 gain
      expect(distanceGainNode.gain.linearRampToValueAtTime).toHaveBeenCalledWith(
        0.25,
        expect.closeTo(10.05, 2),
      );
    });
  });

  describe("Cockpit RWR Radar Warning Receiver Chirps", () => {
    it.each<RadarToneMode>(["search", "track", "lock"])(
      "synthesizes radar audio chirp for %s mode",
      (mode) => {
        const success = synth.triggerRadarWarning(mode);
        expect(success).toBe(true);

        const lastOsc = mockEnv.oscillators[mockEnv.oscillators.length - 1];
        expect(lastOsc.start).toHaveBeenCalledWith(10);
        expect(lastOsc.stop).toHaveBeenCalled();

        // Cleanup callback onended
        lastOsc.onended?.();
        expect(lastOsc.disconnect).toHaveBeenCalled();
      },
    );

    it("does not play radar chirp if muted", () => {
      synth.setMuted(true);
      const success = synth.triggerRadarWarning("search");
      expect(success).toBe(false);
    });
  });

  describe("Sonic Boom Pressure Pulse", () => {
    it("synthesizes twin shockwave and sub-bass pressure pulse", () => {
      const success = synth.triggerSonicBoom(1.0);
      expect(success).toBe(true);

      // Sub-bass oscillator and noise buffer shockwave created
      const subOsc = mockEnv.oscillators[mockEnv.oscillators.length - 1];
      expect(subOsc.type).toBe("sine");
      expect(subOsc.frequency.setValueAtTime).toHaveBeenCalledWith(80, 10);
      expect(subOsc.frequency.exponentialRampToValueAtTime).toHaveBeenCalledWith(
        25,
        expect.closeTo(11.2, 1),
      );

      // Twin shockwave buffer source created
      const shockSource = mockEnv.bufferSources[mockEnv.bufferSources.length - 1];
      expect(shockSource.start).toHaveBeenCalledWith(10);
      expect(shockSource.stop).toHaveBeenCalledWith(expect.closeTo(11.5, 1));

      // Disconnects on termination
      subOsc.onended?.();
      expect(subOsc.disconnect).toHaveBeenCalled();
      expect(shockSource.disconnect).toHaveBeenCalled();
    });

    it("clamps intensity parameter between 0.1 and 1.0", () => {
      expect(synth.triggerSonicBoom(2.5)).toBe(true);
      expect(synth.triggerSonicBoom(-0.5)).toBe(true);
    });

    it("does not trigger sonic boom if muted", () => {
      synth.setMuted(true);
      expect(synth.triggerSonicBoom()).toBe(false);
    });
  });

  describe("Lantern Hard-Light Energy Pulse", () => {
    it("synthesizes multi-oscillator emerald resonance with bandpass filter sweep", () => {
      const success = synth.triggerLanternPulse(1.0);
      expect(success).toBe(true);

      // 3 detuned oscillators created for shimmering construct
      const newOscs = mockEnv.oscillators.slice(-3);
      expect(newOscs).toHaveLength(3);

      expect(newOscs[0].frequency.setValueAtTime).toHaveBeenCalledWith(528, 10);
      expect(newOscs[1].frequency.setValueAtTime).toHaveBeenCalledWith(528 * 1.5, 10);
      expect(newOscs[2].frequency.setValueAtTime).toHaveBeenCalledWith(528 * 2.0, 10);

      // Resonant bandpass filter sweep
      const sweepFilter = mockEnv.filters[mockEnv.filters.length - 1];
      expect(sweepFilter.type).toBe("bandpass");
      expect(sweepFilter.frequency.exponentialRampToValueAtTime).toHaveBeenCalledWith(
        3200,
        expect.closeTo(10.4, 1),
      );

      // Cleanup
      newOscs[0].onended?.();
      expect(newOscs[0].disconnect).toHaveBeenCalled();
      expect(sweepFilter.disconnect).toHaveBeenCalled();
    });

    it("modulates filter sweep by willpower power level", () => {
      synth.triggerLanternPulse(1.2);
      const sweepFilter = mockEnv.filters[mockEnv.filters.length - 1];
      expect(sweepFilter.frequency.exponentialRampToValueAtTime).toHaveBeenCalledWith(
        3200 * 1.2,
        expect.closeTo(10.4, 1),
      );
    });

    it("does not trigger lantern pulse when muted", () => {
      synth.setMuted(true);
      expect(synth.triggerLanternPulse()).toBe(false);
    });
  });
});
