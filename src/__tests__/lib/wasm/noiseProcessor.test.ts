import {
  processAudioFrame,
  resetNoiseProcessor,
} from "@/lib/wasm/noiseProcessor";

const mockMalloc = jest.fn();
const mockFree = jest.fn();
const mockComputeRMS = jest.fn();

// Mock WebAssembly environment
beforeAll(() => {
  global.fetch = jest.fn(() =>
    Promise.resolve({
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),
    }),
  ) as jest.Mock;

  global.WebAssembly = {
    compile: jest.fn(() => Promise.resolve({})),
    instantiate: jest.fn(() =>
      Promise.resolve({
        exports: {
          memory: {
            buffer: new ArrayBuffer(1024),
          },
          malloc: mockMalloc,
          free: mockFree,
          computeRMS: mockComputeRMS,
          resetHeap: jest.fn(),
        },
      }),
    ),
  } as unknown as typeof WebAssembly;
});

beforeEach(() => {
  jest.clearAllMocks();
  mockMalloc.mockReturnValue(8); // return 8-byte aligned ptr by default
  mockComputeRMS.mockReturnValue(0.5);
});

afterEach(async () => {
  await resetNoiseProcessor();
});

describe("noiseProcessor", () => {
  it("processes audio frame correctly", async () => {
    const samples = new Float32Array([0.1, -0.2, 0.3, -0.4]);

    const result = await processAudioFrame(samples);

    expect(result.rms).toBe(0.5);
    expect(result.db).toBeGreaterThan(0);
    expect(mockMalloc).toHaveBeenCalledWith(16); // 4 samples * 4 bytes = 16 bytes (which is 8-byte aligned)
    expect(mockComputeRMS).toHaveBeenCalledWith(8, 4);
  });

  it("rounds allocation size to 8 bytes", async () => {
    // 5 samples * 4 = 20 bytes -> should round to 24
    const samples = new Float32Array(5);

    await processAudioFrame(samples);

    expect(mockMalloc).toHaveBeenCalledWith(24);
  });

  it("throws RangeError if malloc returns unaligned pointer", async () => {
    mockMalloc.mockReturnValue(5); // 5 is not 4-byte aligned

    const samples = new Float32Array([0.1, -0.2]);

    await expect(processAudioFrame(samples)).rejects.toThrow(RangeError);
    await expect(processAudioFrame(samples)).rejects.toThrow(
      "is not 4-byte aligned",
    );
  });

  it("reuses cached buffer if size is sufficient", async () => {
    const samples = new Float32Array(4); // 16 bytes

    await processAudioFrame(samples);
    expect(mockMalloc).toHaveBeenCalledTimes(1);

    await processAudioFrame(samples);
    expect(mockMalloc).toHaveBeenCalledTimes(1); // not called again
  });

  it("allocates new buffer if size increases", async () => {
    const smallSamples = new Float32Array(4); // 16 bytes
    await processAudioFrame(smallSamples);

    expect(mockMalloc).toHaveBeenCalledTimes(1);
    expect(mockFree).not.toHaveBeenCalled();

    const largeSamples = new Float32Array(8); // 32 bytes
    await processAudioFrame(largeSamples);

    expect(mockFree).toHaveBeenCalledWith(8, 16);
    expect(mockMalloc).toHaveBeenCalledTimes(2);
    expect(mockMalloc).toHaveBeenLastCalledWith(32);
  });
});
