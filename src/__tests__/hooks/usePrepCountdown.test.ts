import { renderHook, act } from "@testing-library/react";
import { usePrepCountdown } from "@/hooks/usePrepCountdown";

const MINUTE = 60_000;

describe("usePrepCountdown", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-10-14T10:00:00Z"));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("returns the minutes remaining, rounded up", () => {
    const readyAt = Date.now() + 4 * MINUTE - 1_000;
    const { result } = renderHook(() => usePrepCountdown(readyAt));
    expect(result.current).toBe(4);
  });

  it("counts down by one each minute", () => {
    const readyAt = Date.now() + 4 * MINUTE;
    const { result } = renderHook(() => usePrepCountdown(readyAt));
    expect(result.current).toBe(4);

    act(() => {
      jest.advanceTimersByTime(MINUTE);
    });
    expect(result.current).toBe(3);

    act(() => {
      jest.advanceTimersByTime(MINUTE);
    });
    expect(result.current).toBe(2);
  });

  it("stops at zero", () => {
    const readyAt = Date.now() + 2 * MINUTE;
    const { result } = renderHook(() => usePrepCountdown(readyAt));

    act(() => {
      jest.advanceTimersByTime(5 * MINUTE);
    });
    expect(result.current).toBe(0);
  });

  it("catches up from the clock after a long pause", () => {
    const readyAt = Date.now() + 10 * MINUTE;
    const { result } = renderHook(() => usePrepCountdown(readyAt));
    expect(result.current).toBe(10);

    // The tab was asleep for 3 minutes; only one tick fires when it wakes.
    act(() => {
      jest.setSystemTime(Date.now() + 3 * MINUTE);
      jest.advanceTimersByTime(MINUTE);
    });
    expect(result.current).toBe(6);
  });

  it("returns null without a ready time or when disabled", () => {
    const { result: none } = renderHook(() => usePrepCountdown(null));
    expect(none.current).toBeNull();

    const readyAt = Date.now() + 4 * MINUTE;
    const { result: off } = renderHook(() => usePrepCountdown(readyAt, false));
    expect(off.current).toBeNull();
  });

  it("clears its timer on unmount", () => {
    const readyAt = Date.now() + 4 * MINUTE;
    const { unmount } = renderHook(() => usePrepCountdown(readyAt));
    expect(jest.getTimerCount()).toBe(1);

    unmount();
    expect(jest.getTimerCount()).toBe(0);
  });
});
