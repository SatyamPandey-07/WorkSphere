import { renderHook, act } from "@testing-library/react";
import { useAFKLaptopWatch } from "@/hooks/useAFKLaptopWatch";

function createMockSocket(): WebSocket & {
  _trigger: (data: unknown) => void;
} {
  const listeners: ((e: MessageEvent) => void)[] = [];
  return {
    readyState: WebSocket.OPEN,
    send: jest.fn(),
    addEventListener: jest.fn((event, cb) => {
      if (event === "message") listeners.push(cb as (e: MessageEvent) => void);
    }),
    removeEventListener: jest.fn(),
    close: jest.fn(),
    _trigger: (data: unknown) => {
      listeners.forEach((cb) =>
        cb(new MessageEvent("message", { data: JSON.stringify(data) })),
      );
    },
  } as unknown as WebSocket & { _trigger: (d: unknown) => void };
}

const VENUE_ID = "venue-123";
const USER_ID = "user-abc";

describe("useAFKLaptopWatch", () => {
  it("starts with afkStatus='available'", () => {
    const socket = createMockSocket();
    const { result } = renderHook(() =>
      useAFKLaptopWatch({ venueId: VENUE_ID, userId: USER_ID, socket }),
    );
    expect(result.current.afkStatus).toBe("available");
    expect(result.current.incomingRequest).toBeNull();
  });

  it("requestWatch sends correct message and sets status to 'unavailable'", () => {
    const socket = createMockSocket();
    const { result } = renderHook(() =>
      useAFKLaptopWatch({ venueId: VENUE_ID, userId: USER_ID, socket }),
    );

    act(() => {
      result.current.requestWatch();
    });

    expect(socket.send).toHaveBeenCalledWith(
      expect.stringContaining("laptop-watch-request"),
    );
    expect(result.current.afkStatus).toBe("unavailable");
  });

  it("receives incoming request from another user", () => {
    const socket = createMockSocket();
    const { result } = renderHook(() =>
      useAFKLaptopWatch({ venueId: VENUE_ID, userId: USER_ID, socket }),
    );

    act(() => {
      (socket as any)._trigger({
        type: "laptop-watch-request",
        venueId: VENUE_ID,
        fromUserId: "other-user",
        fromName: "Alice",
      });
    });

    expect(result.current.incomingRequest).not.toBeNull();
    expect(result.current.incomingRequest!.fromName).toBe("Alice");
  });

  it("does not set incoming request from own userId", () => {
    const socket = createMockSocket();
    const { result } = renderHook(() =>
      useAFKLaptopWatch({ venueId: VENUE_ID, userId: USER_ID, socket }),
    );

    act(() => {
      (socket as any)._trigger({
        type: "laptop-watch-request",
        venueId: VENUE_ID,
        fromUserId: USER_ID, // same user
        fromName: "Me",
      });
    });

    expect(result.current.incomingRequest).toBeNull();
  });

  it("acceptRequest sends accept message and clears incomingRequest", () => {
    const socket = createMockSocket();
    const { result } = renderHook(() =>
      useAFKLaptopWatch({ venueId: VENUE_ID, userId: USER_ID, socket }),
    );

    act(() => {
      (socket as any)._trigger({
        type: "laptop-watch-request",
        venueId: VENUE_ID,
        fromUserId: "other-user",
        fromName: "Bob",
      });
    });

    act(() => {
      result.current.acceptRequest();
    });

    expect(socket.send).toHaveBeenCalledWith(
      expect.stringContaining("laptop-watch-accept"),
    );
    expect(result.current.incomingRequest).toBeNull();
  });

  it("declineRequest clears incomingRequest", () => {
    const socket = createMockSocket();
    const { result } = renderHook(() =>
      useAFKLaptopWatch({ venueId: VENUE_ID, userId: USER_ID, socket }),
    );

    act(() => {
      (socket as any)._trigger({
        type: "laptop-watch-request",
        venueId: VENUE_ID,
        fromUserId: "other-user",
        fromName: "Carol",
      });
    });

    act(() => {
      result.current.declineRequest();
    });

    expect(socket.send).toHaveBeenCalledWith(
      expect.stringContaining("laptop-watch-decline"),
    );
    expect(result.current.incomingRequest).toBeNull();
  });

  it("ignores messages from a different venueId", () => {
    const socket = createMockSocket();
    const { result } = renderHook(() =>
      useAFKLaptopWatch({ venueId: VENUE_ID, userId: USER_ID, socket }),
    );

    act(() => {
      (socket as any)._trigger({
        type: "laptop-watch-request",
        venueId: "different-venue",
        fromUserId: "other-user",
        fromName: "Dave",
      });
    });

    expect(result.current.incomingRequest).toBeNull();
  });
});
