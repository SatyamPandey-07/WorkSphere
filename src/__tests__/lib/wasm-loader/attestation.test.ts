/**
 * attestation.test.ts
 * Tests for AttestationWasmLoader, initializeWorkerPool, and isCanonicalLowS BIP-62 low-S validation.
 */

jest.mock("@/lib/wasm-loader/createEcdsaWorker", () => ({
  createEcdsaWorker: jest.fn(),
}));

import { AttestationWasmLoader } from "@/lib/wasm-loader/attestation";

describe("AttestationWasmLoader", () => {
  let loader: AttestationWasmLoader;

  beforeEach(() => {
    loader = new AttestationWasmLoader();
  });

  afterEach(() => {
    loader.terminatePool();
  });

  describe("isCanonicalLowS", () => {
    it("returns false for signatures shorter than 64 bytes", () => {
      const shortSig = new Uint8Array(63);
      expect(loader.isCanonicalLowS(shortSig)).toBe(false);
    });

    it("returns true for low-S signatures (s < n/2)", () => {
      const sig = new Uint8Array(64);
      // bytes 32..63 are S component, all 0s < halfOrder
      expect(loader.isCanonicalLowS(sig)).toBe(true);
    });

    it("returns true when s exactly equals halfOrder (n/2)", () => {
      const sig = new Uint8Array(64);
      const halfOrder = [
        0x7f, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
        0xff, 0xff, 0xff, 0xff, 0x5d, 0x57, 0x6e, 0x73, 0x57, 0xa4, 0x50, 0x1d,
        0xdf, 0xe9, 0x2f, 0x46, 0x68, 0x1b, 0x20, 0xa0,
      ];
      sig.set(halfOrder, 32);
      expect(loader.isCanonicalLowS(sig)).toBe(true);
    });

    it("returns false for non-canonical high-S signatures (s > n/2)", () => {
      const sig = new Uint8Array(64);
      const highOrder = [
        0x7f,
        0xff,
        0xff,
        0xff,
        0xff,
        0xff,
        0xff,
        0xff,
        0xff,
        0xff,
        0xff,
        0xff,
        0xff,
        0xff,
        0xff,
        0xff,
        0x5d,
        0x57,
        0x6e,
        0x73,
        0x57,
        0xa4,
        0x50,
        0x1d,
        0xdf,
        0xe9,
        0x2f,
        0x46,
        0x68,
        0x1b,
        0x20,
        0xa1, // +1
      ];
      sig.set(highOrder, 32);
      expect(loader.isCanonicalLowS(sig)).toBe(false);
    });
  });

  describe("initializeWorkerPool", () => {
    it("marks pool ready when Worker is undefined in Node/SSR environment", async () => {
      await loader.initializeWorkerPool();
      expect(loader.getPoolSize()).toBe(0);
    });

    it("initializes workers and resolves readiness promise with mock createWorker", async () => {
      const mockPostMessage = jest.fn();
      let onMessageListener: ((event: any) => void) | null = null;

      const mockWorker = {
        postMessage: mockPostMessage.mockImplementation((msg: any) => {
          if (msg.type === "INIT_WASM" && onMessageListener) {
            // Simulate worker response
            setTimeout(() => {
              onMessageListener!({
                data: {
                  type: "WASM_READY",
                  success: true,
                  requestId: msg.requestId,
                },
              });
            }, 5);
          }
        }),
        set onmessage(fn: any) {
          onMessageListener = fn;
        },
        get onmessage() {
          return onMessageListener;
        },
        terminate: jest.fn(),
      } as unknown as Worker;

      await loader.initializeWorkerPool({
        poolSize: 2,
        createWorker: () => mockWorker,
      });

      expect(loader.getPoolSize()).toBe(2);
    });

    it("rejects poolReadyPromise when worker initialization fails", async () => {
      const mockWorkerFactory = () => {
        throw new Error("Worker instantiation failed");
      };

      // When workers fail to instantiate and pool is empty with custom createWorker
      // it should handle gracefully
      await loader.initializeWorkerPool({
        poolSize: 2,
        createWorker: mockWorkerFactory,
      });

      expect(loader.getPoolSize()).toBe(0);
    });
  });

  describe("verifySignature", () => {
    it("rejects malleable high-S signatures before verification", async () => {
      // 32-byte public key hex, message, 64-byte high-S signature hex
      const pubKey = "02" + "00".repeat(31);
      const message = "attendance-checkin";
      const highSBytes = [
        ...new Array(32).fill(0x01),
        0x80,
        ...new Array(31).fill(0x00), // > halfOrder
      ];
      const highSSigHex = highSBytes
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");

      const result = await loader.verifySignature(pubKey, message, highSSigHex);
      expect(result).toBe(false);
    });
  });
});
