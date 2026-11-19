import { renderHook, act } from "@testing-library/react";
import {
  useStorageQuota,
  calculateStorageMetrics,
  bytesToMB,
} from "@/hooks/useStorageQuota";

describe("useStorageQuota Hook (#7946)", () => {
  const originalNavigator = global.navigator;

  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
    Object.defineProperty(global, "navigator", {
      value: originalNavigator,
      writable: true,
      configurable: true,
    });
  });

  describe("bytesToMB and calculateStorageMetrics unit tests", () => {
    it("converts bytes to MB correctly", () => {
      expect(bytesToMB(0)).toBe(0);
      expect(bytesToMB(-100)).toBe(0);
      expect(bytesToMB(NaN)).toBe(0);
      expect(bytesToMB(1024 * 1024)).toBe(1);
      expect(bytesToMB(1536 * 1024)).toBe(1.5);
      expect(bytesToMB(820 * 1024 * 1024)).toBe(820);
    });

    it("evaluates usage strictly below 80%", () => {
      const quota = 1000 * 1024 * 1024;
      const usage = 799 * 1024 * 1024; // 79.9%
      const result = calculateStorageMetrics(usage, quota);

      expect(result.usagePercentage).toBeCloseTo(79.9, 1);
      expect(result.isOverWarningThreshold).toBe(false);
      expect(result.remainingMB).toBe(201);
      expect(result.isEstimateAvailable).toBe(true);
    });

    it("evaluates usage at exactly 80% (does not warn, must be strictly greater than 80%)", () => {
      const quota = 1000 * 1024 * 1024;
      const usage = 800 * 1024 * 1024; // 80.0%
      const result = calculateStorageMetrics(usage, quota);

      expect(result.usagePercentage).toBe(80);
      expect(result.isOverWarningThreshold).toBe(false);
      expect(result.remainingMB).toBe(200);
      expect(result.isEstimateAvailable).toBe(true);
    });

    it("evaluates usage strictly above 80%", () => {
      const quota = 950 * 1024 * 1024;
      const usage = 820 * 1024 * 1024; // 86.315%
      const result = calculateStorageMetrics(usage, quota);

      expect(result.usagePercentage).toBeCloseTo(86.3, 1);
      expect(result.isOverWarningThreshold).toBe(true);
      expect(result.usageMB).toBe(820);
      expect(result.quotaMB).toBe(950);
      expect(result.remainingMB).toBe(130);
      expect(result.isEstimateAvailable).toBe(true);
    });

    it("handles zero quota safely without division by zero", () => {
      const result = calculateStorageMetrics(100, 0);
      expect(result.usagePercentage).toBe(0);
      expect(result.isOverWarningThreshold).toBe(false);
      expect(result.isEstimateAvailable).toBe(false);
      expect(result.remainingBytes).toBe(0);
      expect(result.remainingMB).toBe(0);
    });

    it("handles undefined or null usage and quota safely", () => {
      const result = calculateStorageMetrics(undefined, null);
      expect(result.usageBytes).toBe(0);
      expect(result.quotaBytes).toBe(0);
      expect(result.usagePercentage).toBe(0);
      expect(result.isOverWarningThreshold).toBe(false);
      expect(result.isEstimateAvailable).toBe(false);
    });

    it("calculates remaining capacity without negative values if usage exceeds quota", () => {
      const quota = 100 * 1024 * 1024;
      const usage = 150 * 1024 * 1024;
      const result = calculateStorageMetrics(usage, quota);

      expect(result.remainingBytes).toBe(0);
      expect(result.remainingMB).toBe(0);
      expect(result.usagePercentage).toBe(150);
      expect(result.isOverWarningThreshold).toBe(true);
    });
  });

  describe("useStorageQuota hook behavior", () => {
    it("handles missing navigator.storage gracefully", async () => {
      Object.defineProperty(global, "navigator", {
        value: {},
        writable: true,
        configurable: true,
      });

      const { result } = renderHook(() => useStorageQuota());
      expect(result.current.isEstimateAvailable).toBe(false);
      expect(result.current.isOverWarningThreshold).toBe(false);
    });

    it("handles missing navigator.storage.estimate gracefully", async () => {
      Object.defineProperty(global, "navigator", {
        value: { storage: {} },
        writable: true,
        configurable: true,
      });

      const { result } = renderHook(() => useStorageQuota());
      expect(result.current.isEstimateAvailable).toBe(false);
    });

    it("handles rejected navigator.storage.estimate safely without crashing", async () => {
      const mockEstimate = jest
        .fn()
        .mockRejectedValue(new Error("SecurityError: storage access denied"));
      Object.defineProperty(global, "navigator", {
        value: { storage: { estimate: mockEstimate } },
        writable: true,
        configurable: true,
      });

      const { result } = renderHook(() => useStorageQuota());

      await act(async () => {
        await Promise.resolve();
      });

      expect(result.current.isEstimateAvailable).toBe(false);
      expect(result.current.isOverWarningThreshold).toBe(false);
    });

    it("updates metrics when estimate resolves with quota exceeding 80%", async () => {
      const mockEstimate = jest.fn().mockResolvedValue({
        usage: 850 * 1024 * 1024,
        quota: 1000 * 1024 * 1024,
      });

      Object.defineProperty(global, "navigator", {
        value: { storage: { estimate: mockEstimate } },
        writable: true,
        configurable: true,
      });

      const { result } = renderHook(() => useStorageQuota());

      await act(async () => {
        await Promise.resolve();
      });

      expect(result.current.isOverWarningThreshold).toBe(true);
      expect(result.current.usageMB).toBe(850);
      expect(result.current.quotaMB).toBe(1000);
      expect(result.current.remainingMB).toBe(150);
      expect(result.current.usagePercentage).toBe(85);
    });

    it("prevents overlapping quota estimation requests (in-flight guard)", async () => {
      let resolvePromise: (value: any) => void;
      const pendingPromise = new Promise((resolve) => {
        resolvePromise = resolve;
      });

      const mockEstimate = jest.fn().mockImplementation(() => pendingPromise);

      Object.defineProperty(global, "navigator", {
        value: { storage: { estimate: mockEstimate } },
        writable: true,
        configurable: true,
      });

      const { result } = renderHook(() => useStorageQuota());

      // Trigger multiple refreshes while first is in flight
      act(() => {
        void result.current.refresh();
        void result.current.refresh();
      });

      expect(mockEstimate).toHaveBeenCalledTimes(1);

      // Resolve the initial promise
      await act(async () => {
        resolvePromise!({
          usage: 500 * 1024 * 1024,
          quota: 1000 * 1024 * 1024,
        });
        await pendingPromise;
      });

      expect(mockEstimate).toHaveBeenCalledTimes(1);
    });

    it("cleans up polling interval and idle callbacks on unmount", () => {
      const mockEstimate = jest.fn().mockResolvedValue({
        usage: 100,
        quota: 1000,
      });

      Object.defineProperty(global, "navigator", {
        value: { storage: { estimate: mockEstimate } },
        writable: true,
        configurable: true,
      });

      const clearIntervalSpy = jest.spyOn(global, "clearInterval");
      const { unmount } = renderHook(() =>
        useStorageQuota({ pollingIntervalMs: 30000 }),
      );

      unmount();
      expect(clearIntervalSpy).toHaveBeenCalled();
    });

    it("executes periodic polling check when interval fires", async () => {
      const mockEstimate = jest
        .fn()
        .mockResolvedValueOnce({
          usage: 500 * 1024 * 1024,
          quota: 1000 * 1024 * 1024,
        })
        .mockResolvedValueOnce({
          usage: 850 * 1024 * 1024,
          quota: 1000 * 1024 * 1024,
        });

      Object.defineProperty(global, "navigator", {
        value: { storage: { estimate: mockEstimate } },
        writable: true,
        configurable: true,
      });

      const { result } = renderHook(() =>
        useStorageQuota({ pollingIntervalMs: 10000 }),
      );

      await act(async () => {
        await Promise.resolve();
      });

      expect(result.current.isOverWarningThreshold).toBe(false);

      // Fast-forward interval
      await act(async () => {
        jest.advanceTimersByTime(10000);
        await Promise.resolve();
      });

      expect(mockEstimate).toHaveBeenCalledTimes(2);
      expect(result.current.isOverWarningThreshold).toBe(true);
    });
  });
});
