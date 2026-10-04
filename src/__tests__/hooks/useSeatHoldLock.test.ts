import { renderHook, act } from "@testing-library/react";
import { useSeatHoldLock } from "@/hooks/useSeatHoldLock";

let mockSocketCallbacks: {
  onOpen?: () => void;
  onClose?: () => void;
  onMessage?: (event: { data: string }) => void;
} = {};

const mockSend = jest.fn();

jest.mock("@/hooks/usePartySocketReconnect", () => ({
  __esModule: true,
  default: jest.fn((options) => {
    mockSocketCallbacks = options;
    return {
      send: mockSend,
      close: jest.fn(),
      reconnect: jest.fn(),
    };
  }),
}));

jest.mock("@clerk/nextjs", () => ({
  useAuth: () => ({ userId: "user-alice" }),
  useUser: () => ({
    user: { firstName: "Alice", lastName: "Smith", username: "alice" },
  }),
}));

describe("useSeatHoldLock Hook (#3522)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    mockSocketCallbacks = {};
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  it("initializes and requests seat holds snapshot on open", () => {
    const { result } = renderHook(() =>
      useSeatHoldLock({ venueId: "venue-101" }),
    );

    expect(result.current.isConnected).toBe(false);

    act(() => {
      mockSocketCallbacks.onOpen?.();
    });

    expect(result.current.isConnected).toBe(true);
    expect(mockSend).toHaveBeenCalledWith(
      JSON.stringify({
        type: "request_seat_holds",
        venueId: "venue-101",
      }),
    );
  });

  it("populates activeHolds when receiving seat_holds_snapshot", () => {
    const { result } = renderHook(() =>
      useSeatHoldLock({ venueId: "venue-101" }),
    );

    const now = Date.now();
    const snapshotMsg = {
      type: "seat_holds_snapshot",
      venueId: "venue-101",
      holds: [
        {
          seatId: "seat-1",
          venueId: "venue-101",
          heldBy: "user-bob",
          heldByName: "Bob",
          expiresAt: now + 240_000,
        },
        {
          seatId: "seat-2",
          venueId: "venue-101",
          heldBy: "user-alice",
          heldByName: "Alice",
          expiresAt: now + 300_000,
        },
      ],
    };

    act(() => {
      mockSocketCallbacks.onMessage?.({ data: JSON.stringify(snapshotMsg) });
    });

    expect(result.current.isSeatHeldByOther("seat-1")).toBe(true);
    expect(result.current.isSeatHeldByMe("seat-2")).toBe(true);
    expect(result.current.myHeldSeatId).toBe("seat-2");
    expect(result.current.remainingSeconds).toBeGreaterThan(0);
  });

  it("updates state and fires callback when receiving seat_locked broadcast", () => {
    const onSeatLocked = jest.fn();
    const { result } = renderHook(() =>
      useSeatHoldLock({ venueId: "venue-101", onSeatLocked }),
    );

    const lockMsg = {
      type: "seat_locked",
      seatId: "seat-3",
      venueId: "venue-101",
      heldBy: "user-charlie",
      heldByName: "Charlie",
      expiresAt: Date.now() + 300_000,
    };

    act(() => {
      mockSocketCallbacks.onMessage?.({ data: JSON.stringify(lockMsg) });
    });

    expect(result.current.isSeatHeldByOther("seat-3")).toBe(true);
    expect(onSeatLocked).toHaveBeenCalledWith(
      "seat-3",
      "user-charlie",
      "Charlie",
    );
  });

  it("clears held seat when receiving seat_unlocked broadcast", () => {
    const onSeatUnlocked = jest.fn();
    const { result } = renderHook(() =>
      useSeatHoldLock({ venueId: "venue-101", onSeatUnlocked }),
    );

    // Lock seat-3
    act(() => {
      mockSocketCallbacks.onMessage?.({
        data: JSON.stringify({
          type: "seat_locked",
          seatId: "seat-3",
          venueId: "venue-101",
          heldBy: "user-charlie",
          expiresAt: Date.now() + 300_000,
        }),
      });
    });
    expect(result.current.isSeatHeldByOther("seat-3")).toBe(true);

    // Unlock seat-3
    act(() => {
      mockSocketCallbacks.onMessage?.({
        data: JSON.stringify({
          type: "seat_unlocked",
          seatId: "seat-3",
          venueId: "venue-101",
          reason: "RELEASED",
        }),
      });
    });

    expect(result.current.isSeatHeldByOther("seat-3")).toBe(false);
    expect(onSeatUnlocked).toHaveBeenCalledWith("seat-3", "RELEASED");
  });

  it("automatically releases expired holds on client ticker without page reload", () => {
    const onHoldExpired = jest.fn();
    const { result } = renderHook(() =>
      useSeatHoldLock({ venueId: "venue-101", onHoldExpired }),
    );

    const now = Date.now();
    // Alice holds seat-4 with 3 seconds remaining
    act(() => {
      mockSocketCallbacks.onMessage?.({
        data: JSON.stringify({
          type: "seat_hold_acquired",
          seatId: "seat-4",
          venueId: "venue-101",
          expiresAt: now + 3000,
        }),
      });
    });

    expect(result.current.myHeldSeatId).toBe("seat-4");
    expect(result.current.isSeatHeldByMe("seat-4")).toBe(true);

    // Advance 4 seconds: ticker sweeps expired hold
    act(() => {
      jest.advanceTimersByTime(4000);
    });

    expect(result.current.myHeldSeatId).toBeNull();
    expect(result.current.isSeatHeldByMe("seat-4")).toBe(false);
    expect(onHoldExpired).toHaveBeenCalledWith("seat-4");
  });

  it("sends seat_hold_request when calling acquireHold", async () => {
    const { result } = renderHook(() =>
      useSeatHoldLock({ venueId: "venue-101" }),
    );

    act(() => {
      mockSocketCallbacks.onOpen?.();
    });

    let holdPromise: Promise<boolean>;
    act(() => {
      holdPromise = result.current.acquireHold("seat-5");
    });

    expect(mockSend).toHaveBeenCalledWith(
      expect.stringContaining('"type":"seat_hold_request"'),
    );

    // Server responds with seat_hold_acquired
    act(() => {
      mockSocketCallbacks.onMessage?.({
        data: JSON.stringify({
          type: "seat_hold_acquired",
          seatId: "seat-5",
          venueId: "venue-101",
          expiresAt: Date.now() + 300_000,
        }),
      });
    });

    const acquired = await holdPromise!;
    expect(acquired).toBe(true);
    expect(result.current.myHeldSeatId).toBe("seat-5");
  });
});
