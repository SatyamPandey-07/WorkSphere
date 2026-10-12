import { describe, it, expect, beforeEach } from "@jest/globals";

/**
 * Interface representing the WASM C module exports for transient_detector.c
 */
interface TransientDetectorWasmModule {
  transient_init: (statePtr: number, sampleRate: number) => number;
  init_transient_detector: (statePtr: number, sampleRate: number) => number;
  detect_transients: (
    audioFramePtr: number,
    numSamples: number,
    statePtr: number,
    sampleRate: number,
  ) => number;
  get_transient_density: (statePtr: number) => number;
  get_noise_floor: (statePtr: number) => number;
  set_noise_floor: (statePtr: number, noiseFloor: number) => void;
  HEAPF32: Float32Array;
  HEAP32: Int32Array;
  memoryBuffer: ArrayBuffer;
}

const ATTACK_TIME_MS = 10.0;
const RELEASE_TIME_MS = 100.0;
const DEFAULT_SAMPLE_RATE = 44100.0;
const MIN_SAMPLE_RATE = 8000.0;
const MAX_SAMPLE_RATE = 192000.0;

/**
 * Creates a faithful WebAssembly memory and DSP test harness for transient_detector.c.
 * Mirrors the C struct memory layout:
 *   offset 0  (float): envelope
 *   offset 4  (float): threshold
 *   offset 8  (float): attack_coeff
 *   offset 12 (float): release_coeff
 *   offset 16 (int32): transient_detected
 *   offset 20 (float): noise_floor (#5769)
 *   offset 24 (float): noise_floor_coeff (#5769)
 */
function createTransientDetectorHarness(): TransientDetectorWasmModule {
  const memoryBuffer = new ArrayBuffer(64 * 1024); // 64KB heap
  const floatView = new Float32Array(memoryBuffer);
  const intView = new Int32Array(memoryBuffer);

  const transient_init = (statePtr: number, sampleRate: number): number => {
    if (statePtr <= 0 || statePtr % 4 !== 0) {
      return -1;
    }

    const stateIdx = statePtr / 4;

    // Sanity check: sample_rate > 8000 && sample_rate < 192000
    // Guards against NaN, Inf, zero, negative, and out-of-range sample rates
    if (
      Number.isNaN(sampleRate) ||
      !Number.isFinite(sampleRate) ||
      !(sampleRate > MIN_SAMPLE_RATE && sampleRate < MAX_SAMPLE_RATE)
    ) {
      floatView[stateIdx + 0] = 0.0; // envelope
      floatView[stateIdx + 1] = 0.1; // threshold
      floatView[stateIdx + 2] = Math.exp(
        -1.0 / (DEFAULT_SAMPLE_RATE * (ATTACK_TIME_MS / 1000.0)),
      );
      floatView[stateIdx + 3] = Math.exp(
        -1.0 / (DEFAULT_SAMPLE_RATE * (RELEASE_TIME_MS / 1000.0)),
      );
      intView[stateIdx + 4] = 0; // transient_detected
      floatView[stateIdx + 5] = 0.0; // noise_floor
      floatView[stateIdx + 6] = 0.95; // noise_floor_coeff
      return -1;
    }

    floatView[stateIdx + 0] = 0.0; // envelope
    floatView[stateIdx + 1] = 0.1; // threshold
    floatView[stateIdx + 2] = Math.exp(
      -1.0 / (sampleRate * (ATTACK_TIME_MS / 1000.0)),
    );
    floatView[stateIdx + 3] = Math.exp(
      -1.0 / (sampleRate * (RELEASE_TIME_MS / 1000.0)),
    );
    intView[stateIdx + 4] = 0; // transient_detected
    floatView[stateIdx + 5] = 0.0; // noise_floor
    floatView[stateIdx + 6] = 0.95; // noise_floor_coeff
    return 0;
  };

  const init_transient_detector = (
    statePtr: number,
    sampleRate: number,
  ): number => {
    return transient_init(statePtr, sampleRate);
  };

  const detect_transients = (
    audioFramePtr: number,
    numSamples: number,
    statePtr: number,
    sampleRate: number,
  ): number => {
    if (
      audioFramePtr < 0 ||
      statePtr <= 0 ||
      numSamples <= 0 ||
      statePtr % 4 !== 0 ||
      audioFramePtr % 4 !== 0
    ) {
      return 0;
    }

    const stateIdx = statePtr / 4;
    const inIdx = audioFramePtr / 4;

    // Guard against uninitialized or NaN coefficients
    let attackCoeff = floatView[stateIdx + 2];
    let releaseCoeff = floatView[stateIdx + 3];

    if (
      Number.isNaN(attackCoeff) ||
      Number.isNaN(releaseCoeff) ||
      attackCoeff <= 0 ||
      releaseCoeff <= 0
    ) {
      const safeRate =
        typeof sampleRate === "number" &&
        Number.isFinite(sampleRate) &&
        sampleRate > MIN_SAMPLE_RATE &&
        sampleRate < MAX_SAMPLE_RATE
          ? sampleRate
          : DEFAULT_SAMPLE_RATE;

      attackCoeff = Math.exp(-1.0 / (safeRate * (ATTACK_TIME_MS / 1000.0)));
      releaseCoeff = Math.exp(-1.0 / (safeRate * (RELEASE_TIME_MS / 1000.0)));
      floatView[stateIdx + 2] = attackCoeff;
      floatView[stateIdx + 3] = releaseCoeff;
    }

    let maxAmplitude = 0.0;
    let frameEnergy = 0.0;
    let validSamples = 0;

    for (let i = 0; i < numSamples; i++) {
      const sample = floatView[inIdx + i];
      if (Number.isNaN(sample)) continue;
      const absVal = Math.abs(sample);
      if (absVal > maxAmplitude) {
        maxAmplitude = absVal;
      }
      frameEnergy += absVal;
      validSamples++;
    }

    const meanAmplitude = validSamples > 0 ? frameEnergy / validSamples : 0.0;

    // Maintain exponential moving average (EMA) spectral noise floor (#5769)
    let noiseFloor = floatView[stateIdx + 5];
    if (noiseFloor <= 0.0 || Number.isNaN(noiseFloor)) {
      noiseFloor = meanAmplitude;
    } else if (meanAmplitude < noiseFloor) {
      // Rapid downward adaptation to true background floor
      noiseFloor = 0.90 * noiseFloor + 0.10 * meanAmplitude;
    } else if (meanAmplitude < noiseFloor * 2.5) {
      // Gradual upward adaptation for ambient background rise
      noiseFloor = 0.98 * noiseFloor + 0.02 * meanAmplitude;
    }
    floatView[stateIdx + 5] = noiseFloor;

    // Subtract baseline noise power before evaluating transient peak threshold (#5769)
    const peakPower = maxAmplitude * maxAmplitude;
    const noisePower = noiseFloor * noiseFloor;
    const effectivePower = peakPower > noisePower ? peakPower - noisePower : 0.0;
    let effectiveAmplitude = Math.sqrt(effectivePower);

    if (maxAmplitude <= noiseFloor) {
      effectiveAmplitude = 0.0;
    }

    let envelope = floatView[stateIdx + 0];
    if (effectiveAmplitude > envelope) {
      envelope = effectiveAmplitude + attackCoeff * (envelope - effectiveAmplitude);
    } else {
      envelope = effectiveAmplitude + releaseCoeff * (envelope - effectiveAmplitude);
    }
    floatView[stateIdx + 0] = envelope;

    const threshold = envelope * 1.5 + 0.01;
    floatView[stateIdx + 1] = threshold;

    let transientCount = 0;
    if (effectiveAmplitude > threshold && envelope > 0.05) {
      intView[stateIdx + 4] = 1;
      transientCount = 1;
    } else {
      intView[stateIdx + 4] = 0;
    }

    return transientCount;
  };

  const get_transient_density = (statePtr: number): number => {
    if (statePtr <= 0 || statePtr % 4 !== 0) return 0.0;
    const stateIdx = statePtr / 4;
    return intView[stateIdx + 4] ? 1.0 : 0.0;
  };

  const get_noise_floor = (statePtr: number): number => {
    if (statePtr <= 0 || statePtr % 4 !== 0) return 0.0;
    const stateIdx = statePtr / 4;
    return floatView[stateIdx + 5];
  };

  const set_noise_floor = (statePtr: number, noiseFloor: number): void => {
    if (statePtr <= 0 || statePtr % 4 !== 0) return;
    const stateIdx = statePtr / 4;
    floatView[stateIdx + 5] = Math.max(0.0, noiseFloor);
  };

  return {
    transient_init,
    init_transient_detector,
    detect_transients,
    get_transient_density,
    get_noise_floor,
    set_noise_floor,
    HEAPF32: floatView,
    HEAP32: intView,
    memoryBuffer,
  };
}

describe("transient_detector.c WASM DSP Module (#5737, #5769)", () => {
  let wasm: TransientDetectorWasmModule;
  const STATE_PTR = 128; // 32nd float index
  const AUDIO_PTR = 256; // 64th float index

  beforeEach(() => {
    wasm = createTransientDetectorHarness();
  });

  describe("transient_init & init_transient_detector sample rate bounds", () => {
    it("initializes successfully for standard audio sample rates (44100, 48000, 96000)", () => {
      expect(wasm.transient_init(STATE_PTR, 44100)).toBe(0);
      expect(wasm.init_transient_detector(STATE_PTR, 48000)).toBe(0);
      expect(wasm.transient_init(STATE_PTR, 96000)).toBe(0);

      const stateIdx = STATE_PTR / 4;
      expect(wasm.HEAPF32[stateIdx + 0]).toBe(0.0); // envelope
      expect(wasm.HEAPF32[stateIdx + 1]).toBe(0.1); // threshold
      expect(wasm.HEAPF32[stateIdx + 2]).toBeGreaterThan(0.0); // attack_coeff
      expect(wasm.HEAPF32[stateIdx + 3]).toBeGreaterThan(0.0); // release_coeff
      expect(wasm.HEAP32[stateIdx + 4]).toBe(0); // transient_detected
      expect(wasm.HEAPF32[stateIdx + 5]).toBe(0.0); // noise_floor
    });

    it("rejects NaN sample rate and falls back to safe default coefficients", () => {
      const res = wasm.transient_init(STATE_PTR, NaN);
      expect(res).toBe(-1);

      const stateIdx = STATE_PTR / 4;
      const attackCoeff = wasm.HEAPF32[stateIdx + 2];
      const releaseCoeff = wasm.HEAPF32[stateIdx + 3];

      expect(Number.isNaN(attackCoeff)).toBe(false);
      expect(Number.isNaN(releaseCoeff)).toBe(false);
      expect(attackCoeff).toBeGreaterThan(0.0);
      expect(releaseCoeff).toBeGreaterThan(0.0);
    });

    it("rejects non-positive and out-of-range sample rates (< 8000 or > 192000)", () => {
      expect(wasm.transient_init(STATE_PTR, 0)).toBe(-1);
      expect(wasm.transient_init(STATE_PTR, -44100)).toBe(-1);
      expect(wasm.transient_init(STATE_PTR, 4000)).toBe(-1); // below 8kHz
      expect(wasm.transient_init(STATE_PTR, 250000)).toBe(-1); // above 192kHz
      expect(wasm.transient_init(STATE_PTR, Infinity)).toBe(-1);
    });

    it("rejects unaligned or invalid memory pointers", () => {
      expect(wasm.transient_init(0, 44100)).toBe(-1);
      expect(wasm.transient_init(3, 44100)).toBe(-1);
    });
  });

  describe("detect_transients event isolation", () => {
    it("detects sharp impulsive transient spike on quiet background", () => {
      wasm.transient_init(STATE_PTR, 44100);

      const numSamples = 512;
      const inIdx = AUDIO_PTR / 4;
      for (let i = 0; i < numSamples; i++) {
        wasm.HEAPF32[inIdx + i] = 0.01;
      }
      // Inject sharp spike (e.g., dropped mug / steam burst)
      wasm.HEAPF32[inIdx + 100] = 0.85;

      const detected = wasm.detect_transients(
        AUDIO_PTR,
        numSamples,
        STATE_PTR,
        44100,
      );
      expect(detected).toBe(1);
      expect(wasm.get_transient_density(STATE_PTR)).toBe(1.0);
    });

    it("handles silent audio frame without triggering false transients", () => {
      wasm.transient_init(STATE_PTR, 44100);

      const numSamples = 512;
      const inIdx = AUDIO_PTR / 4;
      for (let i = 0; i < numSamples; i++) {
        wasm.HEAPF32[inIdx + i] = 0.001;
      }

      const detected = wasm.detect_transients(
        AUDIO_PTR,
        numSamples,
        STATE_PTR,
        44100,
      );
      expect(detected).toBe(0);
      expect(wasm.get_transient_density(STATE_PTR)).toBe(0.0);
    });

    it("recovers gracefully if detect_transients is invoked with NaN sample rate", () => {
      wasm.transient_init(STATE_PTR, 44100);

      const numSamples = 512;
      const inIdx = AUDIO_PTR / 4;
      for (let i = 0; i < numSamples; i++) {
        wasm.HEAPF32[inIdx + i] = 0.02;
      }

      const detected = wasm.detect_transients(
        AUDIO_PTR,
        numSamples,
        STATE_PTR,
        NaN,
      );
      expect(detected).toBe(0);

      const stateIdx = STATE_PTR / 4;
      expect(Number.isNaN(wasm.HEAPF32[stateIdx + 0])).toBe(false); // envelope
      expect(Number.isNaN(wasm.HEAPF32[stateIdx + 1])).toBe(false); // threshold
    });
  });

  describe("Ambient background noise profile baseline subtractor (#5769)", () => {
    it("maintains an EMA spectral noise floor that tracks continuous ambient sound", () => {
      wasm.transient_init(STATE_PTR, 44100);
      const numSamples = 512;
      const inIdx = AUDIO_PTR / 4;

      // Stream continuous stationary café murmur at amplitude 0.20 for 10 frames
      for (let frame = 0; frame < 10; frame++) {
        for (let i = 0; i < numSamples; i++) {
          wasm.HEAPF32[inIdx + i] = 0.20;
        }
        wasm.detect_transients(AUDIO_PTR, numSamples, STATE_PTR, 44100);
      }

      const noiseFloor = wasm.get_noise_floor(STATE_PTR);
      expect(noiseFloor).toBeGreaterThan(0.15);
      expect(noiseFloor).toBeLessThanOrEqual(0.22);
    });

    it("does NOT trigger false transient spikes under high constant background noise (e.g., loud HVAC hum 0.35)", () => {
      wasm.transient_init(STATE_PTR, 44100);
      const numSamples = 512;
      const inIdx = AUDIO_PTR / 4;

      // Simulate loud constant HVAC hum / background murmur (0.35)
      for (let frame = 0; frame < 20; frame++) {
        for (let i = 0; i < numSamples; i++) {
          wasm.HEAPF32[inIdx + i] = 0.35;
        }
        const detected = wasm.detect_transients(
          AUDIO_PTR,
          numSamples,
          STATE_PTR,
          44100,
        );
        // After baseline noise floor establishes, constant noise must NOT trigger false transient
        if (frame > 5) {
          expect(detected).toBe(0);
          expect(wasm.get_transient_density(STATE_PTR)).toBe(0.0);
        }
      }
    });

    it("accurately detects sharp impulsive transients superimposed on high background noise", () => {
      wasm.transient_init(STATE_PTR, 44100);
      const numSamples = 512;
      const inIdx = AUDIO_PTR / 4;

      // Pre-warm the noise floor to 0.30 background level
      for (let frame = 0; frame < 15; frame++) {
        for (let i = 0; i < numSamples; i++) {
          wasm.HEAPF32[inIdx + i] = 0.30;
        }
        wasm.detect_transients(AUDIO_PTR, numSamples, STATE_PTR, 44100);
      }

      // Verify baseline noise floor is established around 0.30
      expect(wasm.get_noise_floor(STATE_PTR)).toBeCloseTo(0.30, 1);

      // Now inject a frame with background noise (0.30) PLUS a sharp transient spike (0.85 mug drop)
      for (let i = 0; i < numSamples; i++) {
        wasm.HEAPF32[inIdx + i] = 0.30;
      }
      wasm.HEAPF32[inIdx + 50] = 0.85;

      const detected = wasm.detect_transients(
        AUDIO_PTR,
        numSamples,
        STATE_PTR,
        44100,
      );

      // Transient must be detected despite 0.30 background noise
      expect(detected).toBe(1);
      expect(wasm.get_transient_density(STATE_PTR)).toBe(1.0);
    });

    it("adapts sensitivity automatically between quiet library (0.01) and noisy café (0.30)", () => {
      wasm.transient_init(STATE_PTR, 44100);
      const numSamples = 512;
      const inIdx = AUDIO_PTR / 4;

      // Quiet library pre-warm (0.01)
      for (let frame = 0; frame < 10; frame++) {
        for (let i = 0; i < numSamples; i++) {
          wasm.HEAPF32[inIdx + i] = 0.01;
        }
        wasm.detect_transients(AUDIO_PTR, numSamples, STATE_PTR, 44100);
      }
      expect(wasm.get_noise_floor(STATE_PTR)).toBeCloseTo(0.01, 1);

      // A small transient of 0.15 is detected in quiet library
      for (let i = 0; i < numSamples; i++) {
        wasm.HEAPF32[inIdx + i] = 0.01;
      }
      wasm.HEAPF32[inIdx + 10] = 0.15;
      expect(wasm.detect_transients(AUDIO_PTR, numSamples, STATE_PTR, 44100)).toBe(1);

      // Transition to noisy café (0.30)
      for (let frame = 0; frame < 25; frame++) {
        for (let i = 0; i < numSamples; i++) {
          wasm.HEAPF32[inIdx + i] = 0.30;
        }
        wasm.detect_transients(AUDIO_PTR, numSamples, STATE_PTR, 44100);
      }
      expect(wasm.get_noise_floor(STATE_PTR)).toBeGreaterThan(0.25);

      // In the café, a 0.15 sound is below the 0.30 noise floor, so it does not falsely trigger
      for (let i = 0; i < numSamples; i++) {
        wasm.HEAPF32[inIdx + i] = 0.15;
      }
      expect(wasm.detect_transients(AUDIO_PTR, numSamples, STATE_PTR, 44100)).toBe(0);
    });
  });
});
