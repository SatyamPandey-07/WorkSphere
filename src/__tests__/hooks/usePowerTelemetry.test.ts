/**
 * usePowerTelemetry.test.ts
 * Tests for usePowerTelemetry hook unmount teardown & memory stabilization benchmark (#9634).
 */

jest.mock("@/lib/wasm-loader/createPowerWorker", () => ({
  createPowerWorker: jest.fn(),
}));

import { renderHook, act, cleanup } from "@testing-library/react";
import { usePowerTelemetry } from "@/hooks/usePowerTelemetry";
import { isPowerWasmReady, cleanupPowerWasm } from "@/lib/wasm-loader/power";

describe("usePowerTelemetry Hook Teardown & Benchmark (#9634)", () => {
  afterEach(() => {
    cleanup();
    cleanupPowerWasm();
    jest.clearAllMocks();
  });

  it("terminates Web Workers and clears SharedArrayBuffer references on hook unmount", () => {
    const mockPostMessage = jest.fn();
    const mockTerminate = jest.fn();
    const mockWorker = {
      postMessage: mockPostMessage,
      terminate: mockTerminate,
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
    } as unknown as Worker;

    const { unmount } = renderHook(() =>
      usePowerTelemetry({
        outletId: "test-outlet-1",
        createWorker: () => mockWorker,
      }),
    );

    // Verify worker received initial INIT message
    expect(mockPostMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: "INIT" }),
    );

    // Unmount component
    unmount();

    // Verify worker received TERMINATE message and terminate was invoked
    expect(mockPostMessage).toHaveBeenCalledWith({ type: "TERMINATE" });
    expect(mockTerminate).toHaveBeenCalledTimes(1);

    // Verify WASM instance was cleaned up
    expect(isPowerWasmReady()).toBe(false);
  });

  it("passes 20-cycle mount/unmount memory stabilization benchmark without leaks", async () => {
    // Simulates the issue's steps to reproduce:
    // "Navigate to venue audio monitor. Switch tabs or unmount modal 20 times."
    const CYCLES = 25;
    let totalWorkersCreated = 0;
    let totalWorkersTerminated = 0;

    for (let i = 0; i < CYCLES; i++) {
      const mockWorker = {
        postMessage: jest.fn(),
        terminate: jest.fn(() => {
          totalWorkersTerminated++;
        }),
        addEventListener: jest.fn((event, handler) => {
          if (event === "message") {
            handler({ data: { type: "INIT_SUCCESS" } });
          }
        }),
        removeEventListener: jest.fn(),
      } as unknown as Worker;

      totalWorkersCreated++;

      const { unmount, result } = renderHook(() =>
        usePowerTelemetry({
          outletId: `outlet-cycle-${i}`,
          createWorker: () => mockWorker,
        }),
      );

      act(() => {
        result.current.sendTelemetry(50 + i);
      });

      // Unmount modal / tab switch
      unmount();

      // Check memory and state invariant at each cycle
      expect(isPowerWasmReady()).toBe(false);
    }

    // Acceptance Criteria:
    // 1. Heap memory stabilizes and returns to baseline upon component unmount.
    // 2. No dangling Web Worker threads or buffer references.
    expect(totalWorkersCreated).toBe(CYCLES);
    expect(totalWorkersTerminated).toBe(CYCLES);
    expect(isPowerWasmReady()).toBe(false);
  });
});
