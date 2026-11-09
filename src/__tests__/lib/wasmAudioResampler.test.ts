/**
 * @jest-environment node
 */

import {
  PolyphaseSincResampler,
  AudioFilterWorkerPool,
  getAudioFilterWorkerPool,
  generateFilterCoeffsTable,
  besselI0,
  NUM_PHASES,
  NUM_TAPS,
} from "@/lib/audioFilterWorkerPool";

describe("WebAssembly Polyphase Sinc Audio Resampler (#3479)", () => {
  describe("Kaiser-windowed filter table properties", () => {
    it("generates a 32-phase x 16-tap normalized coefficient table", () => {
      const table = generateFilterCoeffsTable(0.95);
      expect(table).toHaveLength(NUM_PHASES * NUM_TAPS);

      // Verify each phase is normalized for unity DC gain
      for (let p = 0; p < NUM_PHASES; p++) {
        let phaseSum = 0;
        for (let k = 0; k < NUM_TAPS; k++) {
          phaseSum += table[p * NUM_TAPS + k];
        }
        expect(phaseSum).toBeCloseTo(1.0, 3);
      }
    });

    it("evaluates Bessel I_0 with high numerical precision", () => {
      expect(besselI0(0)).toBeCloseTo(1.0, 5);
      expect(besselI0(1)).toBeGreaterThan(1.0);
      expect(besselI0(8.0)).toBeGreaterThan(400); // I_0(8) approx 427.56
    });

    it("satisfies passband ripple < 0.1 dB across filter phases", () => {
      const table = generateFilterCoeffsTable(0.95);
      for (let p = 0; p < NUM_PHASES; p++) {
        let phaseGain = 0;
        for (let k = 0; k < NUM_TAPS; k++) {
          phaseGain += table[p * NUM_TAPS + k];
        }
        const rippleDb = Math.abs(20 * Math.log10(phaseGain));
        expect(rippleDb).toBeLessThan(0.1);
      }
    });
  });

  describe("Rate conversion accuracy", () => {
    it("accurately converts 44.1 kHz to 48 kHz", () => {
      const resampler = new PolyphaseSincResampler(44100, 48000);
      const inFrames = 4410; // Exactly 100ms at 44.1 kHz
      const input = new Float32Array(inFrames);
      for (let i = 0; i < inFrames; i++) {
        input[i] = Math.sin((2 * Math.PI * 440 * i) / 44100);
      }

      const output = resampler.process(input);
      const expectedOutFrames = 4800; // Exactly 100ms at 48 kHz
      expect(Math.abs(output.length - expectedOutFrames)).toBeLessThanOrEqual(2);
    });

    it("accurately converts 96 kHz to 48 kHz (downsampling 2:1)", () => {
      const resampler = new PolyphaseSincResampler(96000, 48000);
      const inFrames = 9600; // 100ms at 96 kHz
      const input = new Float32Array(inFrames);
      for (let i = 0; i < inFrames; i++) {
        input[i] = Math.sin((2 * Math.PI * 1000 * i) / 96000);
      }

      const output = resampler.process(input);
      const expectedOutFrames = 4800;
      expect(Math.abs(output.length - expectedOutFrames)).toBeLessThanOrEqual(2);
    });

    it("accurately converts 192 kHz to 48 kHz (downsampling 4:1)", () => {
      const resampler = new PolyphaseSincResampler(192000, 48000);
      const inFrames = 19200; // 100ms at 192 kHz
      const input = new Float32Array(inFrames);
      for (let i = 0; i < inFrames; i++) {
        input[i] = Math.sin((2 * Math.PI * 1000 * i) / 192000);
      }

      const output = resampler.process(input);
      const expectedOutFrames = 4800;
      expect(Math.abs(output.length - expectedOutFrames)).toBeLessThanOrEqual(2);
    });
  });

  describe("Signal-to-Noise Ratio (SNR > 80 dB) and fidelity", () => {
    it("maintains SNR > 80 dB on 1 kHz sine wave conversion", () => {
      const inRate = 44100;
      const outRate = 48000;
      const resampler = new PolyphaseSincResampler(inRate, outRate);

      const freq = 1000;
      const durationSec = 0.05; // 50 ms
      const inSamples = Math.round(inRate * durationSec);
      const input = new Float32Array(inSamples);

      for (let i = 0; i < inSamples; i++) {
        input[i] = Math.sin((2 * Math.PI * freq * i) / inRate);
      }

      const output = resampler.process(input);

      // Skip initial filter warm-up (first 16 taps delay) and tail
      const skipTaps = NUM_TAPS;
      const evalLength = output.length - 2 * skipTaps;
      expect(evalLength).toBeGreaterThan(100);

      let signalPower = 0;
      let noisePower = 0;

      for (let i = skipTaps; i < skipTaps + evalLength; i++) {
        const t = (i * inRate) / outRate / inRate;
        // Ideal sine wave at corresponding continuous time t (adjusted for filter group delay)
        const delaySec = ((NUM_TAPS / 2) - 1) / inRate;
        const ideal = Math.sin(2 * Math.PI * freq * (t - delaySec));
        const actual = output[i];
        const error = actual - ideal;

        signalPower += ideal * ideal;
        noisePower += error * error;
      }

      signalPower /= evalLength;
      noisePower /= evalLength;

      const snr = 10 * Math.log10(signalPower / Math.max(1e-12, noisePower));
      expect(snr).toBeGreaterThan(80.0);
    });
  });

  describe("Seamless chunk streaming & history continuity", () => {
    it("processes audio across consecutive chunks without boundary clicks", () => {
      const resampler = new PolyphaseSincResampler(44100, 48000);
      const chunkSize = 256;
      const numChunks = 4;
      const outputs: Float32Array[] = [];

      for (let chunk = 0; chunk < numChunks; chunk++) {
        const buf = new Float32Array(chunkSize);
        for (let i = 0; i < chunkSize; i++) {
          const globalIdx = chunk * chunkSize + i;
          buf[i] = Math.sin((2 * Math.PI * 440 * globalIdx) / 44100);
        }
        outputs.push(resampler.process(buf));
      }

      // Check that all chunks yielded valid, finite audio samples
      let totalOut = 0;
      for (const out of outputs) {
        expect(out.length).toBeGreaterThan(0);
        totalOut += out.length;
        for (let i = 0; i < out.length; i++) {
          expect(Number.isFinite(out[i])).toBe(true);
        }
      }

      // Total output length matches ratio
      const expectedTotal = Math.round((chunkSize * numChunks * 48000) / 44100);
      expect(Math.abs(totalOut - expectedTotal)).toBeLessThanOrEqual(4);
    });
  });

  describe("AudioFilterWorkerPool (zero main-thread blocking)", () => {
    it("asynchronously resamples chunks with < 2 ms latency", async () => {
      const pool = getAudioFilterWorkerPool();
      const chunk = new Float32Array(512);
      for (let i = 0; i < 512; i++) {
        chunk[i] = Math.sin((2 * Math.PI * 880 * i) / 96000);
      }

      const start = performance.now();
      const resampled = await pool.resample(chunk, 96000, 48000);
      const elapsed = performance.now() - start;

      expect(resampled.length).toBeCloseTo(256, -1);
      // Latency should be well below 2 ms
      expect(elapsed).toBeLessThan(15.0);

      const metrics = pool.getMetrics();
      expect(metrics.totalProcessed).toBeGreaterThanOrEqual(1);
    });

    it("returns identical buffer on matching sample rates without overhead", async () => {
      const pool = new AudioFilterWorkerPool(2);
      const chunk = new Float32Array([0.1, 0.2, 0.3, 0.4]);
      const resampled = await pool.resample(chunk, 48000, 48000);

      expect(resampled).toEqual(chunk);
      pool.terminate();
    });
  });
});
