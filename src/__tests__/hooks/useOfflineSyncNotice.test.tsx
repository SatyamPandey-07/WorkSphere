import {
  render,
  screen,
  act,
  fireEvent,
  renderHook,
} from "@testing-library/react";
import { useOfflineSyncNotice, OfflineSyncNotice } from "@/hooks/usePWA";
import "@testing-library/jest-dom";

describe("useOfflineSyncNotice & OfflineSyncNotice", () => {
  let messageListener: ((event: MessageEvent) => void) | null = null;
  let mockAddEventListener: jest.Mock;
  let mockRemoveEventListener: jest.Mock;

  beforeEach(() => {
    jest.useFakeTimers();
    messageListener = null;
    mockAddEventListener = jest.fn((evt: string, listener: EventListener) => {
      if (evt === "message") {
        messageListener = listener as (event: MessageEvent) => void;
      }
    });
    mockRemoveEventListener = jest.fn();

    Object.defineProperty(navigator, "serviceWorker", {
      value: {
        addEventListener: mockAddEventListener,
        removeEventListener: mockRemoveEventListener,
      },
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  test("attaches and detaches serviceWorker message listener", () => {
    const { unmount } = renderHook(() => useOfflineSyncNotice());

    expect(mockAddEventListener).toHaveBeenCalledWith(
      "message",
      expect.any(Function),
    );
    expect(messageListener).not.toBeNull();

    unmount();
    expect(mockRemoveEventListener).toHaveBeenCalledWith(
      "message",
      expect.any(Function),
    );
  });

  test("surfaces notice on OFFLINE_SYNC_FAILED message and auto-dismisses after 4000ms", () => {
    const { result } = renderHook(() => useOfflineSyncNotice());

    expect(result.current.notice).toBeNull();

    act(() => {
      messageListener?.({
        data: {
          type: "OFFLINE_SYNC_FAILED",
          venueId: "v123",
          action: "ADD",
          attempts: 3,
        },
      } as MessageEvent);
    });

    expect(result.current.notice).toEqual({
      type: "OFFLINE_SYNC_FAILED",
      venueId: "v123",
      action: "ADD",
      attempts: 3,
    });

    // Fast-forward 3999ms - notice should still be present
    act(() => {
      jest.advanceTimersByTime(3999);
    });
    expect(result.current.notice).not.toBeNull();

    // Fast-forward to 4000ms - notice should be auto-dismissed
    act(() => {
      jest.advanceTimersByTime(1);
    });
    expect(result.current.notice).toBeNull();
  });

  test("clears previous timeout when a new failure message arrives", () => {
    const { result } = renderHook(() => useOfflineSyncNotice());

    // First failure message arrives
    act(() => {
      messageListener?.({
        data: {
          type: "OFFLINE_SYNC_FAILED",
          venueId: "v1",
          action: "ADD",
          attempts: 3,
        },
      } as MessageEvent);
    });

    // 2 seconds elapse
    act(() => {
      jest.advanceTimersByTime(2000);
    });
    expect(result.current.notice?.venueId).toBe("v1");

    // Second failure message arrives at t=2000ms
    act(() => {
      messageListener?.({
        data: {
          type: "OFFLINE_SYNC_FAILED",
          venueId: "v2",
          action: "REMOVE",
          attempts: 5,
        },
      } as MessageEvent);
    });

    expect(result.current.notice?.venueId).toBe("v2");

    // Advance 2.5 seconds (t=4500ms total, 2500ms since second message)
    // If the first timer was not cleared, notice would have been cleared at t=4000ms.
    act(() => {
      jest.advanceTimersByTime(2500);
    });
    expect(result.current.notice?.venueId).toBe("v2");

    // Advance remaining 1500ms (t=4000ms since second message)
    act(() => {
      jest.advanceTimersByTime(1500);
    });
    expect(result.current.notice).toBeNull();
  });

  test("dismiss() cancels pending timeout and clears notice immediately", () => {
    const { result } = renderHook(() => useOfflineSyncNotice());

    act(() => {
      messageListener?.({
        data: {
          type: "OFFLINE_SYNC_FAILED",
          venueId: "v100",
          action: "ADD",
          attempts: 2,
        },
      } as MessageEvent);
    });

    expect(result.current.notice).not.toBeNull();

    // Manual dismiss at 1000ms
    act(() => {
      result.current.dismiss();
    });

    expect(result.current.notice).toBeNull();

    // Advancing past 4000ms should not cause any extra state updates or errors
    act(() => {
      jest.advanceTimersByTime(5000);
    });
    expect(result.current.notice).toBeNull();
  });

  test("clears timeout on unmount to prevent memory leaks and state updates on unmounted component", () => {
    const { result, unmount } = renderHook(() => useOfflineSyncNotice());

    act(() => {
      messageListener?.({
        data: {
          type: "OFFLINE_SYNC_FAILED",
          venueId: "v999",
          action: "ADD",
          attempts: 1,
        },
      } as MessageEvent);
    });

    expect(result.current.notice).not.toBeNull();

    // Unmount while 4s timer is pending
    unmount();

    // Fast-forward past 4000ms - no timer should throw or cause warnings
    expect(() => {
      act(() => {
        jest.advanceTimersByTime(5000);
      });
    }).not.toThrow();
  });

  test("renders OfflineSyncNotice component and handles user dismiss click", () => {
    render(<OfflineSyncNotice />);

    expect(
      screen.queryByText(/Couldn't sync your changes/i),
    ).not.toBeInTheDocument();

    // Trigger failure message
    act(() => {
      messageListener?.({
        data: {
          type: "OFFLINE_SYNC_FAILED",
          venueId: "venue-xyz",
          action: "ADD",
          attempts: 3,
        },
      } as MessageEvent);
    });

    expect(screen.getByText(/Couldn't sync your changes/i)).toBeInTheDocument();
    expect(
      screen.getByText(/We couldn't save that favorite after 3 attempts/i),
    ).toBeInTheDocument();

    // User clicks dismiss button
    const dismissBtn = screen.getByRole("button", { name: /Dismiss/i });
    fireEvent.click(dismissBtn);

    expect(
      screen.queryByText(/Couldn't sync your changes/i),
    ).not.toBeInTheDocument();
  });
});
