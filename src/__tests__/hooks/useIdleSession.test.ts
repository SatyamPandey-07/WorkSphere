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

// Mock Clerk
const mockClerkSignOut = jest.fn().mockResolvedValue(undefined);
const mockTouch = jest.fn().mockResolvedValue(undefined);
const mockGetToken = jest.fn().mockResolvedValue("mock-token");

let mockIsLoaded = true;
let mockIsSignedIn = true;
let mockSession: { touch: jest.Mock; getToken: jest.Mock } | null = {
  touch: mockTouch,
  getToken: mockGetToken,
};

jest.mock("@clerk/nextjs", () => ({
  useSession: () => ({
    isLoaded: mockIsLoaded,
    isSignedIn: mockIsSignedIn,
    session: mockSession,
  }),
  useClerk: () => ({
    signOut: mockClerkSignOut,
  }),
}));

describe("useIdleSession Hook (Clerk-native)", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockPush.mockClear();
    mockRefresh.mockClear();
    mockClerkSignOut.mockClear();
    mockTouch.mockClear();
    mockGetToken.mockClear();
    localStorage.clear();

    mockIsLoaded = true;
    mockIsSignedIn = true;
    mockSession = {
      touch: mockTouch,
      getToken: mockGetToken,
    };
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  it("does not trigger warning or countdown for anonymous/signed-out users", () => {
    mockIsSignedIn = false;
    mockSession = null;

    const onWarning = jest.fn();
    const { result } = renderHook(() =>
      useIdleSession({
        idleTimeoutMs: 10000,
        warningDurationMs: 5000,
        onWarning,
      }),
    );

    expect(result.current.showWarning).toBe(false);

    act(() => {
      jest.advanceTimersByTime(20000);
    });

    expect(result.current.showWarning).toBe(false);
    expect(onWarning).not.toHaveBeenCalled();
    expect(mockClerkSignOut).not.toHaveBeenCalled();
  });

  it("initializes in active state without warning for authenticated users", () => {
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

    // Advance past idleTimeoutMs (10s)
    act(() => {
      jest.advanceTimersByTime(11000);
    });

    expect(result.current.showWarning).toBe(true);
    expect(onWarning).toHaveBeenCalledTimes(1);
  });

  it("extends session and touches Clerk session when extendSession is called", async () => {
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
    expect(mockTouch).toHaveBeenCalledTimes(1);
  });

  it("automatically signs out via Clerk after warning countdown expires", async () => {
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

    // Wait for warning countdown (5s) to elapse
    await act(async () => {
      jest.advanceTimersByTime(6000);
    });

    expect(onExpired).toHaveBeenCalledTimes(1);
    expect(mockClerkSignOut).toHaveBeenCalledWith({ redirectUrl: "/sign-in" });
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

  it("handles explicit signOut call gracefully", async () => {
    const onExpired = jest.fn();
    const { result } = renderHook(() =>
      useIdleSession({
        idleTimeoutMs: 10000,
        warningDurationMs: 5000,
        redirectUrl: "/custom-sign-in",
        onExpired,
      }),
    );

    await act(async () => {
      await result.current.signOut();
    });

    expect(onExpired).toHaveBeenCalledTimes(1);
    expect(mockClerkSignOut).toHaveBeenCalledWith({
      redirectUrl: "/custom-sign-in",
    });
  });
});
