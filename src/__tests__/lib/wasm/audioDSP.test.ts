import {
  align16,
  is16ByteAligned,
  initAudioDSP,
} from "@/lib/wasm/audioDSPManager";

// Mock Web Audio API and AudioWorklet
const mockPostMessage = jest.fn();

class MockAudioWorkletNode {
  port = {
    postMessage: mockPostMessage,
    onmessage: null as ((ev: any) => void) | null,
  };
  connect = jest.fn();
}

class MockAudioContext {
  state = "running";
  audioWorklet = {
    addModule: jest.fn().mockResolvedValue(undefined),
  };
  createMediaStreamSource = jest.fn().mockReturnValue({
    connect: jest.fn(),
  });
  destination = {};
  resume = jest.fn().mockResolvedValue(undefined);
}

beforeAll(() => {
  (global as any).window = global;
  (global as any).AudioContext = MockAudioContext;
  (global as any).AudioWorkletNode = MockAudioWorkletNode;
  (global as any).fetch = jest.fn().mockResolvedValue({
    ok: true,
    arrayBuffer: () => Promise.resolve(new ArrayBuffer(1024)),
  });
});

describe("AudioDSP Manager & WASM SIMD Alignment (Issue #1080)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("align16 correctly rounds byte counts to 16-byte boundaries", () => {
    expect(align16(0)).toBe(0);
    expect(align16(1)).toBe(16);
    expect(align16(15)).toBe(16);
    expect(align16(16)).toBe(16);
    expect(align16(17)).toBe(32);
    expect(align16(1024)).toBe(1024);
    expect(align16(1025)).toBe(1040);
  });

  test("is16ByteAligned correctly verifies 128-bit vector alignment", () => {
    expect(is16ByteAligned(0)).toBe(true);
    expect(is16ByteAligned(16)).toBe(true);
    expect(is16ByteAligned(32)).toBe(true);
    expect(is16ByteAligned(48)).toBe(true);

    expect(is16ByteAligned(4)).toBe(false);
    expect(is16ByteAligned(8)).toBe(false);
    expect(is16ByteAligned(12)).toBe(false);
  });

  test("initAudioDSP initializes AudioWorklet and sends WASM binary", async () => {
    await expect(initAudioDSP()).resolves.not.toThrow();

    expect(mockPostMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "init",
        wasmBinary: expect.any(ArrayBuffer),
      }),
    );
  });
});
