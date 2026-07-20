import { processAudioFrame, resetNoiseProcessor } from "@/lib/wasm/noiseProcessor";

const wasmBase64 = "AGFzbQEAAAABFARgAX8Bf2ACf38AYAJ/fwF9YAAAAwUEAAECAwUDAQABBgcBfwFBgAgLBzMFBm1lbW9yeQIABm1hbGxvYwAABGZyZWUAAQpjb21wdXRlUk1TAAIJcmVzZXRIZWFwAAMKdQQRAQF/IwAhASMAIABqJAAgAQsRACAAIAFqIwBGBEAgACQACwtHAwF9AX8BfUMAAAAAIQJBACEDAkADQCADIAFPDQEgACADQQJ0aioCACEEIAIgBCAElJIhAiADQQFqIQMMAAsLIAIgAbOVkQsHAEGACCQACwBPBG5hbWUCPAQAAgAEc2l6ZQEDcHRyAQIAA3B0cgEEc2l6ZQIFAANwdHIBBmxlbmd0aAIDc3VtAwFpBAZzYW1wbGUDAAcKAQAHaGVhcFB0cg==";

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64.replace(/\s/g, ""));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

const wasmBuffer = base64ToArrayBuffer(wasmBase64);
const mockFetch = global.fetch as jest.Mock;

beforeEach(() => {
  mockFetch.mockReset();
  mockFetch.mockResolvedValue({
    arrayBuffer: () => Promise.resolve(wasmBuffer),
  });
});

afterEach(async () => {
  await resetNoiseProcessor();
});

it("processes audio samples and returns RMS and dB values", async () => {
  const samples = new Float32Array([0.5, 0.3, 0.8, 0.2, 0.6, 0.1, 0.4, 0.7]);
  const result = await processAudioFrame(samples);

  expect(result.rms).toBeGreaterThan(0);
  expect(result.rms).toBeLessThanOrEqual(1);
  expect(result.db).toBeGreaterThan(20);
  expect(result.db).toBeLessThanOrEqual(120);
});

it("reuses fixed WASM memory pointer on subsequent calls", async () => {
  const small = new Float32Array(8);
  await processAudioFrame(small);

  const fetchCountBefore = mockFetch.mock.calls.length;

  const large = new Float32Array(2048);
  await processAudioFrame(large);

  const fetchCountAfter = mockFetch.mock.calls.length;
  expect(fetchCountAfter).toBe(fetchCountBefore);
});

it("processes 2048 samples (standard FFT size) with correct dB range", async () => {
  const samples = new Float32Array(2048);
  for (let i = 0; i < samples.length; i++) {
    samples[i] = Math.sin(i * 0.1) * 0.5;
  }

  const result = await processAudioFrame(samples);

  expect(result.rms).toBeGreaterThan(0);
  expect(result.rms).toBeLessThanOrEqual(1);
  expect(result.db).toBeGreaterThanOrEqual(20);
  expect(result.db).toBeLessThanOrEqual(120);
});

it("handles near-silent audio correctly (returns minimum dB)", async () => {
  const samples = new Float32Array(2048);

  const result = await processAudioFrame(samples);

  expect(result.rms).toBeLessThan(0.001);
  expect(result.db).toBe(20);
});

it("handles full-scale audio correctly", async () => {
  const samples = new Float32Array(2048);
  for (let i = 0; i < samples.length; i++) {
    samples[i] = 1.0;
  }

  const result = await processAudioFrame(samples);

  expect(result.rms).toBeGreaterThan(0.9);
  expect(result.db).toBeGreaterThanOrEqual(100);
});

it("can reset and reload WASM module", async () => {
  const samples = new Float32Array([0.5, 0.3]);
  const result1 = await processAudioFrame(samples);
  expect(result1.rms).toBeGreaterThan(0);

  await resetNoiseProcessor();
  mockFetch.mockClear();

  mockFetch.mockResolvedValue({
    arrayBuffer: () => Promise.resolve(wasmBuffer),
  });

  const result2 = await processAudioFrame(samples);
  expect(result2.rms).toBeGreaterThan(0);
  expect(mockFetch).toHaveBeenCalledTimes(1);
});
