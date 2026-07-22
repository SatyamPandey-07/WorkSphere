import {
  initEqualizer,
  updateBand,
  processAudioBlock,
  getFrequencyResponse,
  resetEqualizer,
} from "@/lib/wasm/audioEqualizer";

const wasmBase64 =
  "AGFzbQEAAAABLghgAX8Bf2ACf38AYAAAYAF/AGAGf319fX19AGACf30BfWACfX8BfWAEf39/fwADCQgAAQIDBAUGBwUDAQABBgwCfwFBgAgLfwFBAAsHZQgGbWVtb3J5AgAGbWFsbG9jAAAEZnJlZQABCXJlc2V0SGVhcAACC3NldEJhbmRzUHRyAAMPaW5pdEJpcXVhZFN0YXRlAAQNcHJvY2Vzc1NhbXBsZQAGDHByb2Nlc3NCbG9jawAHCvMDCBEBAX8jACEBIwAgAGokACABCxEAIAAgAWojAEYEQCAAJAALCwcAQYAIJAALBgAgACQBC3EBAX8jASAAQSRsaiEGIAZDAAAAADgCACAGQQRqQwAAAAA4AgAgBkEIakMAAAAAOAIAIAZBDGpDAAAAADgCACAGQRBqIAE4AgAgBkEUaiACOAIAIAZBGGogAzgCACAGQRxqIAQ4AgAgBkEgaiAFOAIAC6EBAQp9IAAqAgAhAiAAQQRqKgIAIQMgAEEIaioCACEEIABBDGoqAgAhBSAAQRBqKgIAIQYgAEEUaioCACEHIABBGGoqAgAhCCAAQRxqKgIAIQkgAEEgaioCACEKIAYgAZQgByAClJIgCCADlJIgCSAElCAKIAWUkpMhCyAAQQxqIAQ4AgAgAEEIaiALOAIAIABBBGogAjgCACAAIAE4AgAgCws6AwF/AX0BfyAAIQNBACECAkADQCACIAFPDQEjASACQSRsaiEEIAQgAxAFIQMgAkEBaiECDAALCyADC24EAX8CfQJ/AX1BACEEAkADQCAEIAJPDQEgACAEQQJ0aioCACEFIAUhCUEAIQcCQANAIAcgA08NASMBIAdBJGxqIQggCCAJEAUhCSAHQQFqIQcMAAsLIAEgBEECdGogCTgCACAEQQFqIQQMAAsLCwCsAgRuYW1lAQ4BBQtwcm9jZXNzQmFuZAL+AQgAAgAEc2l6ZQEDcHRyAQIAA3B0cgEEc2l6ZQIAAwEAA3B0cgQHAAliYW5kSW5kZXgBAmIwAgJiMQMCYjIEAmExBQJhMgYDcHRyBQwAA3B0cgEFaW5wdXQCAngxAwJ4MgQCeTEFAnkyBgJiMAcCYjEIAmIyCQJhMQoCYTILBm91dHB1dAYFAAVpbnB1dAEIbnVtQmFuZHMCAWkDBm91dHB1dAQHYmFuZFB0cgcKAAhpbnB1dFB0cgEJb3V0cHV0UHRyAgZsZW5ndGgDCG51bUJhbmRzBAFpBQVpbnB1dAYGb3V0cHV0BwFqCAdiYW5kUHRyCQpiYW5kT3V0cHV0BxQCAAdoZWFwUHRyAQhiYW5kc1B0cg==";

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
  await resetEqualizer();
});

const testBands = [
  { frequency: 200, q: 1.0, gain: 5 },
  { frequency: 1000, q: 1.0, gain: -3 },
  { frequency: 5000, q: 1.5, gain: 2 },
];

it("initializes equalizer with band configuration", async () => {
  await initEqualizer(testBands, 44100);
  const output = await processAudioBlock(new Float32Array([1.0, -0.5, 0.3]));
  expect(output.length).toBe(3);
  expect(output[0]).not.toBe(1.0);
});

it("processes audio differently from input (filtering applied)", async () => {
  await initEqualizer(testBands, 44100);
  const input = new Float32Array([0.5, -0.3, 0.8, -0.2, 0.6, -0.1, 0.4, -0.7]);
  const output = await processAudioBlock(input);

  expect(output.length).toBe(input.length);
  let differs = false;
  for (let i = 0; i < input.length; i++) {
    if (Math.abs(output[i] - input[i]) > 0.001) {
      differs = true;
      break;
    }
  }
  expect(differs).toBe(true);
});

it("returns frequency response with correct structure", async () => {
  const resp = await getFrequencyResponse(testBands, 44100, 128);
  expect(resp.frequencies.length).toBe(128);
  expect(resp.magnitudes.length).toBe(128);
  expect(resp.frequencies[0]).toBeCloseTo(20, -1);
  expect(resp.frequencies[resp.frequencies.length - 1]).toBeCloseTo(20000, -3);
});

it("updates a single band and changes output", async () => {
  await initEqualizer(testBands, 44100);
  const input = new Float32Array([0.5, -0.3, 0.8]);
  const before = await processAudioBlock(input);

  await updateBand(0, 200, 1.0, 12);
  const after = await processAudioBlock(input);

  let differs = false;
  for (let i = 0; i < input.length; i++) {
    if (Math.abs(after[i] - before[i]) > 0.001) {
      differs = true;
      break;
    }
  }
  expect(differs).toBe(true);
});

it("resets and re-initializes correctly", async () => {
  await initEqualizer(testBands, 44100);
  await resetEqualizer();

  mockFetch.mockClear();
  mockFetch.mockResolvedValue({
    arrayBuffer: () => Promise.resolve(wasmBuffer),
  });

  await initEqualizer(testBands, 44100);
  const output = await processAudioBlock(new Float32Array([0.5]));
  expect(output.length).toBe(1);
});

it("initializes with default 10 bands and processes", async () => {
  const defaultBands = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000].map(
    (frequency) => ({ frequency, q: 0.707, gain: 0 }),
  );

  await initEqualizer(defaultBands, 44100);
  const input = new Float32Array(128);
  for (let i = 0; i < input.length; i++) {
    input[i] = Math.sin(i * 0.1) * 0.5;
  }
  const output = await processAudioBlock(input);
  expect(output.length).toBe(128);

  let hasEnergy = false;
  for (let i = 0; i < output.length; i++) {
    if (Math.abs(output[i]) > 0.01) {
      hasEnergy = true;
      break;
    }
  }
  expect(hasEnergy).toBe(true);
});
