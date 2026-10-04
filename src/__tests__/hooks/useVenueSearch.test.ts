import { renderHook, act } from "@testing-library/react";
import { useVenueSearch } from "@/hooks/useVenueSearch";

describe("useVenueSearch (#3513)", () => {
  const originalFetch = global.fetch;

  let mockFetch: jest.Mock;

  beforeEach(() => {
    jest.useFakeTimers();
    mockFetch = jest.fn();
    global.fetch = mockFetch;
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
    global.fetch = originalFetch;
    jest.clearAllMocks();
  });

  it("initializes with default idle state", () => {
    const { result } = renderHook(() => useVenueSearch());

    expect(result.current.query).toBe("");
    expect(result.current.venues).toEqual([]);
    expect(result.current.results).toEqual([]);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("debounces rapid keystrokes by 250ms and fires at most one request", async () => {
    const mockVenues = [
      { id: "v1", name: "Central Cafe", category: "cafe" },
      { id: "v2", name: "Central Library", category: "library" },
    ];

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ venues: mockVenues }),
    });

    const { result } = renderHook(() => useVenueSearch());

    // Rapid keystroke simulation (typing 'central' with 50ms intervals between strokes)
    act(() => {
      result.current.setQuery("c");
    });
    act(() => {
      jest.advanceTimersByTime(50);
    });
    act(() => {
      result.current.setQuery("ce");
    });
    act(() => {
      jest.advanceTimersByTime(50);
    });
    act(() => {
      result.current.setQuery("cen");
    });
    act(() => {
      jest.advanceTimersByTime(50);
    });
    act(() => {
      result.current.setQuery("cent");
    });
    act(() => {
      jest.advanceTimersByTime(50);
    });
    act(() => {
      result.current.setQuery("central");
    });

    // Advance 249ms: Still no request should have been dispatched
    act(() => {
      jest.advanceTimersByTime(249);
    });
    expect(mockFetch).not.toHaveBeenCalled();

    // Advance final 1ms (reaching 250ms debounce threshold): Only 'central' should be queried
    await act(async () => {
      jest.advanceTimersByTime(1);
    });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledWith(
      "/api/venues?query=central",
      expect.objectContaining({
        signal: expect.any(AbortSignal),
      }),
    );
    expect(result.current.venues).toEqual(mockVenues);
  });

  it("cancels pending debounce timers on rapid keystrokes", async () => {
    const mockVenues = [
      { id: "v2", name: "Central Library", category: "library", latitude: 15, longitude: 25 },
    ];
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ venues: mockVenues }),
    });

    const { result } = renderHook(() => useVenueSearch());

    // Rapid typing simulation
    act(() => {
      result.current.setQuery("c");
    });
    act(() => {
      jest.advanceTimersByTime(80);
    });
    act(() => {
      result.current.setQuery("ce");
    });
    act(() => {
      jest.advanceTimersByTime(80);
    });
    act(() => {
      result.current.setQuery("cen");
    });
    act(() => {
      jest.advanceTimersByTime(80);
    });
    act(() => {
      result.current.setQuery("central");
    });

    // Advance 249ms: Still no request should have been dispatched
    act(() => {
      jest.advanceTimersByTime(249);
    });
    expect(mockFetch).not.toHaveBeenCalled();

    // Advance final 1ms (reaching 250ms debounce threshold): Only 'central' should be queried
    await act(async () => {
      jest.advanceTimersByTime(1);
    });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledWith(
      "/api/venues?query=central",
      expect.objectContaining({
        signal: expect.any(AbortSignal),
      }),
    );
    expect(result.current.venues).toEqual(mockVenues);
  });

  it("aborts the in-flight HTTP request prior to dispatching a new search request", async () => {
    let firstSignal: AbortSignal | undefined;
    let secondSignal: AbortSignal | undefined;

    mockFetch
      .mockImplementationOnce((_url, options) => {
        firstSignal = options?.signal;
        return new Promise(() => {
          // Never resolves to simulate slow in-flight request
        });
      })
      .mockImplementationOnce((_url, options) => {
        secondSignal = options?.signal;
        return Promise.resolve({
          ok: true,
          json: async () => ({
            venues: [{ id: "v3", name: "Fast Cafe" }],
          }),
        });
      });

    const { result } = renderHook(() => useVenueSearch());

    // Dispatch first query
    act(() => {
      result.current.setQuery("slow");
    });
    act(() => {
      jest.advanceTimersByTime(300);
    });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(firstSignal).toBeDefined();
    expect(firstSignal?.aborted).toBe(false);

    // Dispatch second query while first is still pending
    act(() => {
      result.current.setQuery("fast");
    });
    await act(async () => {
      jest.advanceTimersByTime(300);
    });

    // Verify first request was aborted
    expect(firstSignal?.aborted).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(secondSignal?.aborted).toBe(false);
    expect(result.current.venues).toEqual([{ id: "v3", name: "Fast Cafe" }]);
  });

  it("prevents out-of-order race conditions when an earlier slow query resolves after a faster newer query", async () => {
    let resolveFirstQuery: ((value: unknown) => void) | undefined;

    mockFetch
      .mockImplementationOnce(() => {
        return new Promise((resolve) => {
          resolveFirstQuery = resolve;
        });
      })
      .mockImplementationOnce(() => {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            venues: [{ id: "v-new", name: "New Venue Search Result" }],
          }),
        });
      });

    const { result } = renderHook(() => useVenueSearch());

    // 1. Trigger query 1 (slow)
    act(() => {
      result.current.setQuery("query1");
    });
    act(() => {
      jest.advanceTimersByTime(300);
    });
    expect(mockFetch).toHaveBeenCalledTimes(1);

    // 2. Trigger query 2 (fast)
    act(() => {
      result.current.setQuery("query2");
    });
    await act(async () => {
      jest.advanceTimersByTime(300);
    });
    expect(mockFetch).toHaveBeenCalledTimes(2);

    // Result should show query 2's data
    expect(result.current.venues).toEqual([
      { id: "v-new", name: "New Venue Search Result" },
    ]);

    // 3. Stale query 1 resolves later with out-of-date data
    await act(async () => {
      resolveFirstQuery?.({
        ok: true,
        json: async () => ({
          venues: [{ id: "v-old", name: "Stale Venue Search Result" }],
        }),
      });
    });

    // The stale query 1 must NOT overwrite query 2's data!
    expect(result.current.venues).toEqual([
      { id: "v-new", name: "New Venue Search Result" },
    ]);
  });

  it("catches AbortError silently without setting error banner or resetting results", async () => {
    const abortError = new Error("The user aborted a request.");
    abortError.name = "AbortError";

    mockFetch.mockRejectedValueOnce(abortError);

    const { result } = renderHook(() => useVenueSearch());

    act(() => {
      result.current.setQuery("aborted-query");
    });

    await act(async () => {
      jest.advanceTimersByTime(300);
    });

    // Should not throw or set error state
    expect(result.current.error).toBeNull();
  });

  it("catches DOMException with ABORT_ERR / code 20 silently", async () => {
    const domException = new DOMException("Request was aborted", "AbortError");

    mockFetch.mockRejectedValueOnce(domException);

    const { result } = renderHook(() => useVenueSearch());

    act(() => {
      result.current.setQuery("dom-aborted");
    });

    await act(async () => {
      jest.advanceTimersByTime(300);
    });

    expect(result.current.error).toBeNull();
  });

  it("handles non-abort HTTP errors appropriately by updating error state", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
    });

    const { result } = renderHook(() => useVenueSearch());

    act(() => {
      result.current.setQuery("trigger-server-error");
    });

    await act(async () => {
      jest.advanceTimersByTime(300);
    });

    expect(result.current.error).toContain("status 500");
    expect(result.current.isLoading).toBe(false);
  });

  it("handles network failure errors by setting error message", async () => {
    mockFetch.mockRejectedValueOnce(new Error("Network connection failed"));

    const { result } = renderHook(() => useVenueSearch());

    act(() => {
      result.current.setQuery("network-failure");
    });

    await act(async () => {
      jest.advanceTimersByTime(300);
    });

    expect(result.current.error).toBe("Network connection failed");
    expect(result.current.isLoading).toBe(false);
  });

  it("clears results and aborts ongoing requests when query is emptied or clear() is called", async () => {
    let capturedSignal: AbortSignal | undefined;
    mockFetch.mockImplementationOnce((_url, options) => {
      capturedSignal = options?.signal;
      return new Promise(() => {});
    });

    const { result } = renderHook(() => useVenueSearch());

    act(() => {
      result.current.setQuery("some query");
    });
    act(() => {
      jest.advanceTimersByTime(300);
    });

    expect(capturedSignal?.aborted).toBe(false);

    // Call clear
    act(() => {
      result.current.clear();
    });

    expect(capturedSignal?.aborted).toBe(true);
    expect(result.current.venues).toEqual([]);
    expect(result.current.query).toBe("");
    expect(result.current.isLoading).toBe(false);
  });

  it("aborts pending requests on unmount", () => {
    let capturedSignal: AbortSignal | undefined;
    mockFetch.mockImplementationOnce((_url, options) => {
      capturedSignal = options?.signal;
      return new Promise(() => {});
    });

    const { result, unmount } = renderHook(() => useVenueSearch());

    act(() => {
      result.current.setQuery("pending query");
    });
    act(() => {
      jest.advanceTimersByTime(300);
    });

    expect(capturedSignal?.aborted).toBe(false);

    unmount();

    expect(capturedSignal?.aborted).toBe(true);
  });

  it("works with controlled query prop updates", async () => {
    const mockVenues = [{ id: "v10", name: "Prop Venue" }];
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ venues: mockVenues }),
    });

    const { result, rerender } = renderHook(
      ({ query }) => useVenueSearch({ query }),
      { initialProps: { query: "" } },
    );

    expect(result.current.venues).toEqual([]);

    rerender({ query: "prop-search" });

    await act(async () => {
      jest.advanceTimersByTime(300);
    });

    expect(mockFetch).toHaveBeenCalledWith(
      "/api/venues?query=prop-search",
      expect.any(Object),
    );
    expect(result.current.venues).toEqual(mockVenues);
  });
});