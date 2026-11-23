/**
 * power.test.ts
 * Unit tests & memory stabilization benchmark for Power Anomaly Detection WASM Loader & Worker (#9634).
 */

jest.mock("@/lib/wasm-loader/createPowerWorker", () => ({
  createPowerWorker: jest.fn(),
}));

import {
  initPowerWasm,
  analyzePowerDraw,
  resetStats,
  cleanupPowerWasm,
  isPowerWasmReady,
  getPowerWasmInstance,
  getPowerWasmMemory,
  PowerTelemetryLoader,
} from "@/lib/wasm-loader/power";
import {
  handleWorkerMessage,
  getWorkerState,
  cleanupWorkerListeners,
} from "@/workers/powerTelemetryWorker";

describe("Power WASM Loader & Memory Lifecycle (#9634)", () => {
  afterEach(() => {
    cleanupPowerWasm();
    jest.clearAllMocks();
  });

  afterAll(() => {
    cleanupWorkerListeners();
  });

  describe("Lifecycle Initialization & Cleanup", () => {
    it("starts in an uninitialized state", () => {
      expect(isPowerWasmReady()).toBe(false);
      expect(getPowerWasmInstance()).toBeNull();
      expect(getPowerWasmMemory()).toBeNull();
    });

    it("throws if analyzePowerDraw is called before initPowerWasm", () => {
      expect(() => analyzePowerDraw(50)).toThrow(
        "WASM module not initialized. Call initPowerWasm() first.",
      );
    });

    it("initializes WASM module and sets up moving statistics", async () => {
      await initPowerWasm();
      expect(isPowerWasmReady()).toBe(true);
      expect(getPowerWasmInstance()).not.toBeNull();
      expect(getPowerWasmMemory()).not.toBeNull();

      const result = analyzePowerDraw(45);
      expect(result.status).toBe("NORMAL");
      expect(result.rawDraw).toBe(45);
    });

    it("handles multiple concurrent initPowerWasm calls safely", async () => {
      await Promise.all([initPowerWasm(), initPowerWasm(), initPowerWasm()]);
      expect(isPowerWasmReady()).toBe(true);
    });

    it("explicitly deallocates WASM instance and memory on cleanupPowerWasm", async () => {
      await initPowerWasm();
      expect(isPowerWasmReady()).toBe(true);

      cleanupPowerWasm();
      expect(isPowerWasmReady()).toBe(false);
      expect(getPowerWasmInstance()).toBeNull();
      expect(getPowerWasmMemory()).toBeNull();

      // Subsequent call must throw until re-initialized
      expect(() => analyzePowerDraw(60)).toThrow(
        "WASM module not initialized. Call initPowerWasm() first.",
      );
    });

    it("allows re-initialization after cleanup", async () => {
      await initPowerWasm();
      cleanupPowerWasm();
      expect(isPowerWasmReady()).toBe(false);

      await initPowerWasm();
      expect(isPowerWasmReady()).toBe(true);
      expect(analyzePowerDraw(40).status).toBe("NORMAL");
    });
  });

  describe("Power Anomaly Statistical Detection", () => {
    beforeEach(async () => {
      await initPowerWasm();
    });

    it("returns NORMAL when baseline variance is stable", () => {
      for (let i = 0; i < 10; i++) {
        const res = analyzePowerDraw(50 + (i % 2));
        expect(res.status).toBe("NORMAL");
      }
    });

    it("detects SPIKE anomaly when power draw surges above Z_SCORE_THRESHOLD", () => {
      // Feed 15 steady samples
      for (let i = 0; i < 15; i++) {
        analyzePowerDraw(50);
      }
      // Inject a massive surge
      const spikeRes = analyzePowerDraw(500);
      expect(spikeRes.status).toBe("SPIKE");
      expect(spikeRes.rawDraw).toBe(500);
    });

    it("detects DROP anomaly when power draw plummets below moving average", () => {
      // Feed steady higher values
      for (let i = 0; i < 15; i++) {
        analyzePowerDraw(200);
      }
      // Inject sudden disconnect/drop
      const dropRes = analyzePowerDraw(1);
      expect(dropRes.status).toBe("DROP");
    });

    it("resets statistics buffer via resetStats", () => {
      for (let i = 0; i < 10; i++) {
        analyzePowerDraw(100);
      }
      resetStats();
      // After reset, moving average resets
      const freshRes = analyzePowerDraw(25);
      expect(freshRes.movingAverage).toBe(25);
    });
  });

  describe("PowerTelemetryLoader Class", () => {
    it("manages main thread fallback lifecycle cleanly", async () => {
      const loader = new PowerTelemetryLoader();
      expect(loader.isInitialized()).toBe(false);

      await loader.initialize();
      expect(loader.isInitialized()).toBe(true);

      const result = loader.analyzePowerDraw(40);
      expect(result.status).toBe("NORMAL");

      loader.terminate();
      expect(loader.isInitialized()).toBe(false);
      expect(isPowerWasmReady()).toBe(false);
    });

    it("terminates worker and clears shared buffer on terminate", async () => {
      const mockWorker = {
        postMessage: jest.fn(),
        terminate: jest.fn(),
        addEventListener: jest.fn((event, handler) => {
          if (event === "message") {
            queueMicrotask(() => {
              handler({ data: { type: "INIT_SUCCESS" } });
            });
          }
        }),
        removeEventListener: jest.fn(),
      } as unknown as Worker;

      const loader = new PowerTelemetryLoader(undefined, () => mockWorker);
      await loader.initialize();
      expect(loader.isInitialized()).toBe(true);

      const mockBuffer = new ArrayBuffer(64);
      loader.setSharedBuffer(mockBuffer);
      expect(loader.getSharedBuffer()).toBe(mockBuffer);

      loader.terminate();

      expect(mockWorker.postMessage).toHaveBeenCalledWith({
        type: "TERMINATE",
      });
      expect(mockWorker.terminate).toHaveBeenCalled();
      expect(loader.getWorker()).toBeNull();
      expect(loader.getSharedBuffer()).toBeNull();
      expect(loader.isInitialized()).toBe(false);
    });

    it("passes 25-cycle loader initialization and termination benchmark without leaks", async () => {
      const CYCLES = 25;
      for (let i = 0; i < CYCLES; i++) {
        const loader = new PowerTelemetryLoader();
        await loader.initialize();
        expect(isPowerWasmReady()).toBe(true);
        loader.analyzePowerDraw(50 + i);
        loader.terminate();
        expect(isPowerWasmReady()).toBe(false);
        expect(getPowerWasmInstance()).toBeNull();
        expect(getPowerWasmMemory()).toBeNull();
      }
      expect(isPowerWasmReady()).toBe(false);
    });
  });

  describe("Power Telemetry Worker Message Handling", () => {
    let originalPostMessage: any;
    let originalClose: any;
    let postedMessages: any[] = [];
    let isClosed = false;

    beforeEach(() => {
      postedMessages = [];
      isClosed = false;
      originalPostMessage = (globalThis as any).self.postMessage;
      originalClose = (globalThis as any).self.close;

      (globalThis as any).self.postMessage = jest.fn((msg) => {
        postedMessages.push(msg);
      });
      (globalThis as any).self.close = jest.fn(() => {
        isClosed = true;
      });
    });

    afterEach(() => {
      (globalThis as any).self.postMessage = originalPostMessage;
      (globalThis as any).self.close = originalClose;
      cleanupPowerWasm();
    });

    it("handles INIT message and responds with INIT_SUCCESS", async () => {
      await handleWorkerMessage({
        data: { type: "INIT" },
      } as MessageEvent);

      expect(postedMessages).toContainEqual({ type: "INIT_SUCCESS" });
      expect(getWorkerState().isWasmReady).toBe(true);
    });

    it("handles TELEMETRY_STREAM and detects spikes", async () => {
      await handleWorkerMessage({
        data: { type: "INIT" },
      } as MessageEvent);

      for (let i = 0; i < 15; i++) {
        await handleWorkerMessage({
          data: {
            type: "TELEMETRY_STREAM",
            payload: {
              outletId: "outlet-1",
              drawValue: 40,
              timestamp: 1000 + i,
            },
          },
        } as MessageEvent);
      }

      await handleWorkerMessage({
        data: {
          type: "TELEMETRY_STREAM",
          payload: { outletId: "outlet-1", drawValue: 900, timestamp: 2000 },
        },
      } as MessageEvent);

      const anomaly = postedMessages.find((m) => m.type === "ANOMALY_DETECTED");
      expect(anomaly).toBeDefined();
      expect(anomaly.payload.status).toBe("SPIKE");
    });

    it("handles TERMINATE / CLEANUP message, clears state, and closes worker", async () => {
      await handleWorkerMessage({
        data: {
          type: "INIT",
          payload: { sharedBuffer: new ArrayBuffer(32) },
        },
      } as MessageEvent);

      expect(getWorkerState().isWasmReady).toBe(true);
      expect(getWorkerState().hasSharedBuffer).toBe(true);

      await handleWorkerMessage({
        data: { type: "TERMINATE" },
      } as MessageEvent);

      expect(postedMessages).toContainEqual({ type: "CLEANUP_SUCCESS" });
      expect(getWorkerState().isWasmReady).toBe(false);
      expect(getWorkerState().hasSharedBuffer).toBe(false);
      expect(isClosed).toBe(true);
      expect(isPowerWasmReady()).toBe(false);
    });
  });
});
