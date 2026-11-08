import { renderHook, act } from "@testing-library/react";
import { useIdleSession } from "@/hooks/useIdleSession";

// Mock next/navigation
const mockPush = jest.fn();
const mockRefresh = jest.fn();
jest.mock("next/navigation", () => ({
  useRouter: () => ({
    push: mockPush,
    refresh: mockRefresh,
  }),
}));

// Mock global fetch
const originalFetch = global.fetch;

describe("useIdleSession Hook", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockPush.mockClear();
    mockRefresh.mockClear();
    localStorage.clear();

    global.fetch = jest.fn().mockImplementation((url) => {
      if (url === "/api/auth/session/refresh") {
        return Promise.resolve({
          ok: true,
          json: async () => ({ success: true }),
        });
      }
      if (url === "/api/auth/session/logout") {
        return Promise.resolve({
          ok: true,
          json: async () => ({ success: true }),
        });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
    global.fetch = originalFetch;
  });

  it("initializes in active state without warning", () => {
    const { result } = renderHook(() =>
      useIdleSession({ idleTimeoutMs: 10000, warningDurationMs: 5000 }),
    );

    expect(result.current.showWarning).toBe(false);
    expect(result.current.remainingSeconds).toBe(5);
  });

  it("shows warning dialog when idle timeout is reached", () => {
    const onWarning = jest.fn();
    const { result } = renderHook(() =>
      useIdleSession({
        idleTimeoutMs: 10000,
        warningDurationMs: 5000,
        onWarning,
      }),
    );

    expect(result.current.showWarning).toBe(false);

    // Advance timers past idleTimeoutMs (10s)
    act(() => {
      jest.advanceTimersByTime(11000);
    });

    expect(result.current.showWarning).toBe(true);
    expect(onWarning).toHaveBeenCalledTimes(1);
  });

  it("extends session and dismisses warning when extendSession is called", async () => {
    const { result } = renderHook(() =>
      useIdleSession({ idleTimeoutMs: 10000, warningDurationMs: 5000 }),
    );

    act(() => {
      jest.advanceTimersByTime(11000);
    });
    expect(result.current.showWarning).toBe(true);

    await act(async () => {
      await result.current.extendSession();
    });

    expect(result.current.showWarning).toBe(false);
    expect(global.fetch).toHaveBeenCalledWith(
      "/api/auth/session/refresh",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("automatically signs out and redirects to /sign-in after warning countdown expires", async () => {
    const onExpired = jest.fn();
    const { result } = renderHook(() =>
      useIdleSession({
        idleTimeoutMs: 10000,
        warningDurationMs: 5000,
        redirectUrl: "/sign-in",
        onExpired,
      }),
    );

    // Reach warning
    act(() => {
      jest.advanceTimersByTime(10500);
    });
    expect(result.current.showWarning).toBe(true);

    // Wait for warning duration to elapse (5s)
    await act(async () => {
      jest.advanceTimersByTime(6000);
    });

    expect(onExpired).toHaveBeenCalledTimes(1);
    expect(global.fetch).toHaveBeenCalledWith(
      "/api/auth/session/logout",
      expect.objectContaining({ method: "POST" }),
    );
    expect(mockPush).toHaveBeenCalledWith("/sign-in");
  });

  it("resets idle timer on user activity", () => {
    const { result } = renderHook(() =>
      useIdleSession({ idleTimeoutMs: 10000, warningDurationMs: 5000 }),
    );

    // Advance 6 seconds
    act(() => {
      jest.advanceTimersByTime(6000);
    });

    // Simulate user movement
    act(() => {
      window.dispatchEvent(new Event("mousemove"));
      jest.advanceTimersByTime(3000);
    });

    // Still shouldn't show warning because activity reset the timer
    expect(result.current.showWarning).toBe(false);
  });
});
