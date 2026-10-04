import { renderHook, act } from "@testing-library/react";
import {
  useSeatAvailabilityPolling,
  DEFAULT_INITIAL_INTERVAL_MS,
  DEFAULT_MAX_INTERVAL_MS,
  computeSeatStatus,
} from "@/hooks/useSeatAvailabilityPolling";

describe("computeSeatStatus", () => {
  it("returns red if capacity is 0 or less", () => {
    expect(computeSeatStatus(0, 0)).toBe("red");
    expect(computeSeatStatus(2, -1)).toBe("red");
  });

  it("returns green when occupancy is low (< 60%)", () => {
    expect(computeSeatStatus(4, 10)).toBe("green");
    expect(computeSeatStatus(0, 8)).toBe("green");
  });

  it("returns yellow when occupancy is moderate (>= 60% and < 100%)", () => {
    expect(computeSeatStatus(6, 10)).toBe("yellow");
    expect(computeSeatStatus(9, 10)).toBe("yellow");
  });

  it("returns red when venue is at or exceeds capacity (>= 100%)", () => {
    expect(computeSeatStatus(10, 10)).toBe("red");
    expect(computeSeatStatus(12, 10)).toBe("red");
  });
});

describe("useSeatAvailabilityPolling", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
    Object.defineProperty(navigator, "onLine", {
      configurable: true,
      value: true,
    });
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  it("initializes with default interval and polls immediately on mount", async () => {
    const mockFetcher = jest.fn().mockResolvedValue({ count: 3, capacity: 10 });

    const { result } = renderHook(() =>
      useSeatAvailabilityPolling({
        venueId: "venue-1",
        fetcher: mockFetcher,
      }),
    );

    expect(result.current.currentIntervalMs).toBe(DEFAULT_INITIAL_INTERVAL_MS);
    expect(mockFetcher).toHaveBeenCalledWith("venue-1");

    // Wait for the async fetch to settle
    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.availability).toEqual({
      venueId: "venue-1",
      count: 3,
      capacity: 10,
      status: "green",
    });
    expect(result.current.isPolling).toBe(true);
    expect(result.current.currentIntervalMs).toBe(DEFAULT_INITIAL_INTERVAL_MS);
  });

  it("does not poll when venueId is missing or enabled is false", async () => {
    const mockFetcher = jest.fn().mockResolvedValue({ count: 2 });

    const { result, rerender } = renderHook(
      ({ enabled, venueId }) =>
        useSeatAvailabilityPolling({
          venueId,
          enabled,
          fetcher: mockFetcher,
        }),
      {
        initialProps: { enabled: false, venueId: "venue-1" },
      },
    );

    expect(mockFetcher).not.toHaveBeenCalled();
    expect(result.current.availability).toBeNull();
    expect(result.current.isPolling).toBe(false);

    // Re-enable hook
    rerender({ enabled: true, venueId: "venue-1" });
    expect(mockFetcher).toHaveBeenCalledWith("venue-1");
  });

  it("applies exponential backoff when seat count remains unchanged", async () => {
    const mockFetcher = jest.fn().mockResolvedValue({ count: 4, capacity: 10 });

    const { result } = renderHook(() =>
      useSeatAvailabilityPolling({
        venueId: "venue-1",
        initialIntervalMs: 5000,
        maxIntervalMs: 60000,
        backoffFactor: 2,
        fetcher: mockFetcher,
      }),
    );

    // Initial poll
    await act(async () => {
      await Promise.resolve();
    });
    expect(mockFetcher).toHaveBeenCalledTimes(1);
    expect(result.current.currentIntervalMs).toBe(5000);

    // 1st backoff step: after 5s, count unchanged -> interval doubles to 10s
    await act(async () => {
      jest.advanceTimersByTime(5000);
      await Promise.resolve();
    });
    expect(mockFetcher).toHaveBeenCalledTimes(2);
    expect(result.current.currentIntervalMs).toBe(10000);

    // 2nd backoff step: after 10s, count unchanged -> interval doubles to 20s
    await act(async () => {
      jest.advanceTimersByTime(10000);
      await Promise.resolve();
    });
    expect(mockFetcher).toHaveBeenCalledTimes(3);
    expect(result.current.currentIntervalMs).toBe(20000);

    // 3rd backoff step: after 20s, count unchanged -> interval doubles to 40s
    await act(async () => {
      jest.advanceTimersByTime(20000);
      await Promise.resolve();
    });
    expect(mockFetcher).toHaveBeenCalledTimes(4);
    expect(result.current.currentIntervalMs).toBe(40000);

    // 4th backoff step: after 40s, count unchanged -> interval capped at max (60s)
    await act(async () => {
      jest.advanceTimersByTime(40000);
      await Promise.resolve();
    });
    expect(mockFetcher).toHaveBeenCalledTimes(5);
    expect(result.current.currentIntervalMs).toBe(DEFAULT_MAX_INTERVAL_MS);
  });

  it("resets backoff to initial interval when seat count changes", async () => {
    let currentSeats = 3;
    const onChange = jest.fn();
    const mockFetcher = jest
      .fn()
      .mockImplementation(() => Promise.resolve({ count: currentSeats, capacity: 10 }));

    const { result } = renderHook(() =>
      useSeatAvailabilityPolling({
        venueId: "venue-1",
        initialIntervalMs: 5000,
        maxIntervalMs: 60000,
        backoffFactor: 2,
        fetcher: mockFetcher,
        onAvailabilityChange: onChange,
      }),
    );

    await act(async () => {
      await Promise.resolve();
    });

    // Advance to 10s backoff
    await act(async () => {
      jest.advanceTimersByTime(5000);
      await Promise.resolve();
    });
    expect(result.current.currentIntervalMs).toBe(10000);

    // Advance to 20s backoff
    await act(async () => {
      jest.advanceTimersByTime(10000);
      await Promise.resolve();
    });
    expect(result.current.currentIntervalMs).toBe(20000);

    // Seat count changes!
    currentSeats = 7;
    await act(async () => {
      jest.advanceTimersByTime(20000);
      await Promise.resolve();
    });

    expect(result.current.availability?.count).toBe(7);
    expect(result.current.availability?.status).toBe("yellow");
    expect(result.current.currentIntervalMs).toBe(5000);
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ count: 7, status: "yellow" }),
    );
  });

  it("pauses polling when tab is hidden and immediately refreshes when tab becomes visible", async () => {
    const mockFetcher = jest.fn().mockResolvedValue({ count: 2, capacity: 10 });

    const { result } = renderHook(() =>
      useSeatAvailabilityPolling({
        venueId: "venue-1",
        initialIntervalMs: 5000,
        fetcher: mockFetcher,
      }),
    );

    await act(async () => {
      await Promise.resolve();
    });
    expect(mockFetcher).toHaveBeenCalledTimes(1);

    // Tab becomes hidden
    act(() => {
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        value: "hidden",
      });
      document.dispatchEvent(new Event("visibilitychange"));
    });

    expect(result.current.isPolling).toBe(false);

    // Advancing timers while hidden should NOT trigger a poll
    await act(async () => {
      jest.advanceTimersByTime(30000);
      await Promise.resolve();
    });
    expect(mockFetcher).toHaveBeenCalledTimes(1);

    // Tab becomes visible again
    await act(async () => {
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        value: "visible",
      });
      document.dispatchEvent(new Event("visibilitychange"));
      await Promise.resolve();
    });

    // Should immediately poll and reset interval
    expect(mockFetcher).toHaveBeenCalledTimes(2);
    expect(result.current.currentIntervalMs).toBe(5000);
  });

  it("immediately refreshes when window receives focus", async () => {
    const mockFetcher = jest.fn().mockResolvedValue({ count: 2, capacity: 10 });

    const { result } = renderHook(() =>
      useSeatAvailabilityPolling({
        venueId: "venue-1",
        initialIntervalMs: 5000,
        fetcher: mockFetcher,
      }),
    );

    await act(async () => {
      await Promise.resolve();
    });
    expect(mockFetcher).toHaveBeenCalledTimes(1);

    // Focus window
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      await Promise.resolve();
    });

    expect(mockFetcher).toHaveBeenCalledTimes(2);
    expect(result.current.currentIntervalMs).toBe(5000);
  });

  it("pauses on offline event and immediately refreshes on online event", async () => {
    const mockFetcher = jest.fn().mockResolvedValue({ count: 3, capacity: 10 });

    const { result } = renderHook(() =>
      useSeatAvailabilityPolling({
        venueId: "venue-1",
        initialIntervalMs: 5000,
        fetcher: mockFetcher,
      }),
    );

    await act(async () => {
      await Promise.resolve();
    });
    expect(mockFetcher).toHaveBeenCalledTimes(1);

    // Go offline
    act(() => {
      Object.defineProperty(navigator, "onLine", {
        configurable: true,
        value: false,
      });
      window.dispatchEvent(new Event("offline"));
    });

    expect(result.current.isPolling).toBe(false);

    // Return online
    await act(async () => {
      Object.defineProperty(navigator, "onLine", {
        configurable: true,
        value: true,
      });
      window.dispatchEvent(new Event("online"));
      await Promise.resolve();
    });

    expect(mockFetcher).toHaveBeenCalledTimes(2);
    expect(result.current.currentIntervalMs).toBe(5000);
  });

  it("refetch() triggers immediate poll and resets backoff", async () => {
    const mockFetcher = jest.fn().mockResolvedValue({ count: 1, capacity: 10 });

    const { result } = renderHook(() =>
      useSeatAvailabilityPolling({
        venueId: "venue-1",
        initialIntervalMs: 5000,
        fetcher: mockFetcher,
      }),
    );

    await act(async () => {
      await Promise.resolve();
    });

    // Advance to 10s
    await act(async () => {
      jest.advanceTimersByTime(5000);
      await Promise.resolve();
    });
    expect(result.current.currentIntervalMs).toBe(10000);

    // Manual refetch
    await act(async () => {
      await result.current.refetch();
    });

    expect(result.current.currentIntervalMs).toBe(5000);
    expect(mockFetcher).toHaveBeenCalledTimes(3);
  });

  it("handles fetch errors gracefully with backoff", async () => {
    const mockFetcher = jest
      .fn()
      .mockRejectedValueOnce(new Error("Network timeout"))
      .mockResolvedValueOnce({ count: 5, capacity: 10 });

    const { result } = renderHook(() =>
      useSeatAvailabilityPolling({
        venueId: "venue-1",
        initialIntervalMs: 5000,
        fetcher: mockFetcher,
      }),
    );

    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.error?.message).toBe("Network timeout");
    expect(result.current.currentIntervalMs).toBe(10000);

    // Next poll recovers
    await act(async () => {
      jest.advanceTimersByTime(10000);
      await Promise.resolve();
    });

    expect(result.current.error).toBeNull();
    expect(result.current.availability?.count).toBe(5);
  });

  it("cleans up timers and aborts in-flight request on unmount", async () => {
    const mockFetcher = jest.fn().mockResolvedValue({ count: 2, capacity: 10 });

    const { unmount } = renderHook(() =>
      useSeatAvailabilityPolling({
        venueId: "venue-1",
        fetcher: mockFetcher,
      }),
    );

    await act(async () => {
      await Promise.resolve();
    });

    unmount();

    // Advancing timers after unmount should not call fetcher
    await act(async () => {
      jest.advanceTimersByTime(30000);
      await Promise.resolve();
    });

    expect(mockFetcher).toHaveBeenCalledTimes(1);
  });
});
