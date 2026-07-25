import {
  computeFFTJS,
  processAudioNoiseFrame,
  benchmarkNoiseEngine,
  resetNoiseFFTEngine,
} from "@/lib/wasm/noiseFFT";

const mockWasmMalloc = jest.fn();
const mockWasmFree = jest.fn();
const mockComputeRMS = jest.fn();
const mockRmsToDb = jest.fn();
const mockProcessNoiseFrame = jest.fn();

describe("WebAssembly Noise Engine & Web Worker Fallback (#1629)", () => {
  beforeAll(() => {
    global.fetch = jest.fn().mockImplementation(() =>
      Promise.resolve({
        ok: true,
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(64)),
      }),
    );

    global.WebAssembly = {
      compile: jest.fn().mockResolvedValue({}),
      instantiate: jest.fn().mockResolvedValue({
        exports: {
          memory: { buffer: new ArrayBuffer(4096) },
          wasm_malloc: mockWasmMalloc,
          wasm_free: mockWasmFree,
          compute_rms: mockComputeRMS,
          rms_to_db: mockRmsToDb,
          process_noise_frame: mockProcessNoiseFrame,
        },
      }),
    } as unknown as typeof WebAssembly;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    resetNoiseFFTEngine();
    (global.fetch as jest.Mock).mockImplementation(() =>
      Promise.resolve({
        ok: true,
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(64)),
      }),
    );
  });

  it("calculates accurate decibels and FFT spectrum using JS fallback engine", () => {
    const samples = new Float32Array([
      0.1, -0.2, 0.3, -0.4, 0.5, -0.6, 0.7, -0.8,
    ]);

    const result = computeFFTJS(samples, 8);

    expect(result.rms).toBeGreaterThan(0);
    expect(result.averageDb).toBeGreaterThan(20);
    expect(result.peakDb).toBeGreaterThanOrEqual(result.averageDb);
    expect(result.spectrum).toBeInstanceOf(Float32Array);
    expect(result.spectrum.length).toBe(4);
  });

  it("processes audio frame via WASM when WASM module is loaded", async () => {
    const samples = new Float32Array([0.2, -0.3, 0.4, -0.5]);

    const result = await processAudioNoiseFrame(samples, 4);

    expect(result.mode).toBe("wasm");
    expect(mockWasmMalloc).toHaveBeenCalled();
    expect(mockProcessNoiseFrame).toHaveBeenCalled();
    expect(mockWasmFree).toHaveBeenCalled();
  });

  it("falls back to JS audio processing if WASM instantiation fails", async () => {
    (global.fetch as jest.Mock).mockRejectedValueOnce(
      new Error("WASM file not found"),
    );

    const samples = new Float32Array([0.1, 0.2, 0.3]);

    const result = await processAudioNoiseFrame(samples);

    expect(result.mode).toBe("javascript");
    expect(result.averageDb).toBeGreaterThan(0);
  });

  it("benchmarks CPU execution time reduction between WASM and JS modes", async () => {
    const samples = new Float32Array(512).fill(0.1);

    const benchmark = await benchmarkNoiseEngine(samples, 10);

    expect(benchmark.jsTimeMs).toBeGreaterThanOrEqual(0);
    expect(benchmark.wasmTimeMs).toBeGreaterThanOrEqual(0);
    expect(benchmark.cpuReductionPercent).toBeGreaterThanOrEqual(0);
    expect(["wasm", "javascript"]).toContain(benchmark.recommendedMode);
    expect(benchmark.iterations).toBe(10);
  });
});
