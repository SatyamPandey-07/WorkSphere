import { renderHook, act } from "@testing-library/react";
import { useVenueSearch } from "@/hooks/useVenueSearch";

/** `isDebouncing` tells the UI that a search is waiting for the user to stop typing (#7673). */
describe("useVenueSearch isDebouncing (#7673)", () => {
  const originalFetch = global.fetch;
  let mockFetch: jest.Mock;

  beforeEach(() => {
    jest.useFakeTimers();
    mockFetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ venues: [] }),
    });
    global.fetch = mockFetch;
  });

  afterEach(async () => {
    await act(async () => {
      jest.runOnlyPendingTimers();
    });
    jest.useRealTimers();
    global.fetch = originalFetch;
    jest.clearAllMocks();
  });

  it("is false when idle", () => {
    const { result } = renderHook(() => useVenueSearch());
    expect(result.current.isDebouncing).toBe(false);
  });

  it("is true from the keystroke until the debounce fires, then false", async () => {
    const { result } = renderHook(() => useVenueSearch({ debounceMs: 300 }));

    act(() => {
      result.current.setQuery("cafe");
    });
    expect(result.current.isDebouncing).toBe(true);

    await act(async () => {
      jest.advanceTimersByTime(299);
    });
    expect(result.current.isDebouncing).toBe(true);
    expect(mockFetch).not.toHaveBeenCalled();

    await act(async () => {
      jest.advanceTimersByTime(1);
    });
    expect(result.current.isDebouncing).toBe(false);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("stays true while the user keeps typing", async () => {
    const { result } = renderHook(() => useVenueSearch({ debounceMs: 300 }));

    for (const text of ["ca", "caf", "cafe"]) {
      act(() => {
        result.current.setQuery(text);
      });
      await act(async () => {
        jest.advanceTimersByTime(200);
      });
      expect(result.current.isDebouncing).toBe(true);
    }
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("is false for a query shorter than minQueryLength", () => {
    const { result } = renderHook(() =>
      useVenueSearch({ debounceMs: 300, minQueryLength: 2 }),
    );

    act(() => {
      result.current.setQuery("a");
    });
    expect(result.current.isDebouncing).toBe(false);
  });

  it("drops back to false when the query is emptied", () => {
    const { result } = renderHook(() => useVenueSearch({ debounceMs: 300 }));

    act(() => {
      result.current.setQuery("cafe");
    });
    expect(result.current.isDebouncing).toBe(true);

    act(() => {
      result.current.setQuery("");
    });
    expect(result.current.isDebouncing).toBe(false);
  });

  it("is false after an explicit search() (Enter), which sends one request at once", async () => {
    const { result } = renderHook(() => useVenueSearch({ debounceMs: 300 }));

    act(() => {
      result.current.setQuery("cafe");
    });
    expect(result.current.isDebouncing).toBe(true);

    await act(async () => {
      await result.current.search();
    });
    expect(result.current.isDebouncing).toBe(false);
    expect(mockFetch).toHaveBeenCalledTimes(1);

    await act(async () => {
      jest.advanceTimersByTime(1000);
    });
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("is false after clear()", () => {
    const { result } = renderHook(() => useVenueSearch({ debounceMs: 300 }));

    act(() => {
      result.current.setQuery("cafe");
    });
    act(() => {
      result.current.clear();
    });
    expect(result.current.isDebouncing).toBe(false);
  });

  it("is never true when debounceMs is 0", async () => {
    const { result } = renderHook(() => useVenueSearch({ debounceMs: 0 }));

    await act(async () => {
      result.current.setQuery("cafe");
    });
    expect(result.current.isDebouncing).toBe(false);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});
