/**
 * ambientLightWorker.test.ts
 * Integration tests verifying ambient light worker operates seamlessly in non-isolated environments
 * (lacking COOP/COEP headers) and falls back to transferable ArrayBuffers without ReferenceErrors.
 */

import {
  isCrossOriginIsolated,
  isSharedArrayBufferSupported,
  allocateFrameBuffer,
  handleWorkerMessage,
} from "@/workers/ambientLightWorker";

describe("ambientLightWorker - Cross-Origin Isolation & SharedArrayBuffer Guard", () => {
  const originalCrossOriginIsolated = (globalThis as any).crossOriginIsolated;
  const originalSharedArrayBuffer = (globalThis as any).SharedArrayBuffer;

  afterEach(() => {
    (globalThis as any).crossOriginIsolated = originalCrossOriginIsolated;
    (globalThis as any).SharedArrayBuffer = originalSharedArrayBuffer;
    jest.clearAllMocks();
  });

  describe("Capability Detection", () => {
    it("detects cross-origin isolated environment correctly", () => {
      (globalThis as any).crossOriginIsolated = true;
      expect(isCrossOriginIsolated()).toBe(true);

      (globalThis as any).crossOriginIsolated = false;
      expect(isCrossOriginIsolated()).toBe(false);

      delete (globalThis as any).crossOriginIsolated;
      expect(isCrossOriginIsolated()).toBe(false);
    });

    it("guards SharedArrayBuffer when crossOriginIsolated is false", () => {
      // SharedArrayBuffer defined, but crossOriginIsolated is false (missing COOP/COEP)
      (globalThis as any).crossOriginIsolated = false;
      (globalThis as any).SharedArrayBuffer = ArrayBuffer;

      expect(isSharedArrayBufferSupported()).toBe(false);
    });

    it("guards SharedArrayBuffer when SharedArrayBuffer is undefined", () => {
      (globalThis as any).crossOriginIsolated = true;
      delete (globalThis as any).SharedArrayBuffer;

      expect(isSharedArrayBufferSupported()).toBe(false);
    });

    it("allows SharedArrayBuffer only when crossOriginIsolated is true and defined", () => {
      (globalThis as any).crossOriginIsolated = true;
      (globalThis as any).SharedArrayBuffer = ArrayBuffer;

      expect(isSharedArrayBufferSupported()).toBe(true);
    });
  });

  describe("Buffer Allocation Fallback", () => {
    it("allocates standard ArrayBuffer when crossOriginIsolated is false without throwing ReferenceError", () => {
      (globalThis as any).crossOriginIsolated = false;
      delete (globalThis as any).SharedArrayBuffer;

      expect(() => {
        const { buffer, isShared } = allocateFrameBuffer(2048);
        expect(isShared).toBe(false);
        expect(buffer).toBeInstanceOf(ArrayBuffer);
        expect(buffer.byteLength).toBe(2048);
      }).not.toThrow();
    });

    it("allocates SharedArrayBuffer when cross-origin isolation is enabled", () => {
      (globalThis as any).crossOriginIsolated = true;

      // Mock SharedArrayBuffer in Node environment if needed
      class MockSharedArrayBuffer extends ArrayBuffer {}
      (globalThis as any).SharedArrayBuffer = MockSharedArrayBuffer;

      const { buffer, isShared } = allocateFrameBuffer(1024);
      expect(isShared).toBe(true);
      expect(buffer).toBeInstanceOf(MockSharedArrayBuffer);
      expect(buffer.byteLength).toBe(1024);
    });
  });

  describe("Worker Message Handling in Non-Isolated Environment", () => {
    let postMessageSpy: jest.Mock;

    beforeEach(() => {
      (globalThis as any).crossOriginIsolated = false;
      delete (globalThis as any).SharedArrayBuffer;

      postMessageSpy = jest.fn();
      (globalThis as any).self = {
        postMessage: postMessageSpy,
      };
    });

    afterEach(() => {
      delete (globalThis as any).self;
    });

    it("initializes worker in transferable mode when non-isolated", async () => {
      const event = {
        data: {
          type: "INIT",
          payload: {},
        },
      } as MessageEvent;

      await handleWorkerMessage(event);

      expect(postMessageSpy).toHaveBeenCalledWith({
        type: "READY",
        success: true,
        mode: "transferable",
        isShared: false,
      });
    });

    it("falls back seamlessly to postMessage([buffer], [buffer]) transferable array when allocating buffer", async () => {
      const event = {
        data: {
          type: "ALLOCATE_BUFFER",
          payload: { size: 512 },
        },
      } as MessageEvent;

      await handleWorkerMessage(event);

      expect(postMessageSpy).toHaveBeenCalledTimes(1);
      const call = postMessageSpy.mock.calls[0];
      const message = call[0];
      const transferList = call[1];

      // Verify postMessage([buffer], [buffer]) transferable array format
      expect(Array.isArray(message)).toBe(true);
      expect(message[0]).toBeInstanceOf(ArrayBuffer);
      expect(message[0].byteLength).toBe(512);
      expect(Array.isArray(transferList)).toBe(true);
      expect(transferList[0]).toBe(message[0]);
    });

    it("handles direct transferable array communication: postMessage([buffer], [buffer])", async () => {
      const inputBuffer = new ArrayBuffer(256);
      const event = {
        data: [inputBuffer],
      } as unknown as MessageEvent;

      await handleWorkerMessage(event);

      expect(postMessageSpy).toHaveBeenCalledWith([inputBuffer], [inputBuffer]);
    });

    it("processes frame analysis and returns result without ReferenceError in non-isolated environments", async () => {
      const width = 2;
      const height = 2;
      const rgbData = new Uint8Array([
        255, 200, 150, 255, 210, 160, 240, 190, 140, 230, 180, 130,
      ]);

      const event = {
        data: {
          type: "ANALYZE_FRAME",
          payload: { rgbData, width, height },
        },
      } as MessageEvent;

      await handleWorkerMessage(event);

      expect(postMessageSpy).toHaveBeenCalledWith({
        type: "ANALYSIS_RESULT",
        payload: {
          cct: expect.any(Number),
          lux: expect.any(Number),
        },
      });
    });

    it("supports transferResult option to transfer result buffer in non-isolated environments", async () => {
      const rgbData = new Uint8Array([200, 200, 200]);
      const event = {
        data: {
          type: "ANALYZE_FRAME",
          payload: { rgbData, width: 1, height: 1, transferResult: true },
        },
      } as MessageEvent;

      await handleWorkerMessage(event);

      expect(postMessageSpy).toHaveBeenCalledTimes(1);
      const call = postMessageSpy.mock.calls[0];
      const message = call[0];
      const transferList = call[1];

      expect(Array.isArray(message)).toBe(true);
      expect(message[0]).toBeInstanceOf(ArrayBuffer);
      expect(transferList).toEqual([message[0]]);
    });
  });
});
