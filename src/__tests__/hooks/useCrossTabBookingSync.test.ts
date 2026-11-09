import { renderHook, act } from "@testing-library/react";
import {
  useCrossTabBookingSync,
  BOOKING_SYNC_CHANNEL_NAME,
  type BookingSyncMessage,
} from "@/hooks/useCrossTabBookingSync";

// In-memory BroadcastChannel simulator for cross-tab multi-channel testing
class MockBroadcastChannel {
  name: string;
  private listeners: Set<(event: MessageEvent<any>) => void> = new Set();
  static channels: Map<string, Set<MockBroadcastChannel>> = new Map();

  constructor(name: string) {
    this.name = name;
    if (!MockBroadcastChannel.channels.has(name)) {
      MockBroadcastChannel.channels.set(name, new Set());
    }
    MockBroadcastChannel.channels.get(name)!.add(this);
  }

  postMessage(data: any): void {
    const peers = MockBroadcastChannel.channels.get(this.name);
    if (!peers) return;

    for (const peer of peers) {
      if (peer !== this) {
        const event = new MessageEvent("message", { data });
        peer.listeners.forEach((listener) => listener(event));
      }
    }
  }

  addEventListener(type: string, listener: any): void {
    if (type === "message") {
      this.listeners.add(listener);
    }
  }

  removeEventListener(type: string, listener: any): void {
    if (type === "message") {
      this.listeners.delete(listener);
    }
  }

  close(): void {
    const peers = MockBroadcastChannel.channels.get(this.name);
    if (peers) {
      peers.delete(this);
    }
    this.listeners.clear();
  }
}

describe("useCrossTabBookingSync (Cross-Tab BroadcastChannel Booking Sync)", () => {
  const originalBroadcastChannel = global.BroadcastChannel;

  beforeEach(() => {
    MockBroadcastChannel.channels.clear();
    (global as any).BroadcastChannel = MockBroadcastChannel;
  });

  afterEach(() => {
    (global as any).BroadcastChannel = originalBroadcastChannel;
  });

  it("synchronizes CHECK_IN across tabs", () => {
    // Tab A (Initiator)
    const { result: tabA } = renderHook(() =>
      useCrossTabBookingSync({ bookingId: "book-100", initialStatus: "active" }),
    );

    // Tab B (Receiver)
    const onCheckIn = jest.fn();
    const { result: tabB } = renderHook(() =>
      useCrossTabBookingSync({
        bookingId: "book-100",
        initialStatus: "active",
        onCheckIn,
      }),
    );

    expect(tabA.current.status).toBe("active");
    expect(tabB.current.status).toBe("active");

    // Tab A checks in
    act(() => {
      tabA.current.checkIn();
    });

    expect(tabA.current.status).toBe("checked_in");
    expect(tabB.current.status).toBe("checked_in");
    expect(onCheckIn).toHaveBeenCalledWith("book-100", expect.any(Number));
    expect(tabB.current.lastMessage).toMatchObject({
      type: "CHECK_IN",
      bookingId: "book-100",
      timestamp: expect.any(Number),
    });
  });

  it("synchronizes EXTEND across tabs with updated expiration", () => {
    const now = Date.now();
    const initialExpiry = now + 15 * 60 * 1000; // 15 mins

    // Tab A
    const { result: tabA } = renderHook(() =>
      useCrossTabBookingSync({
        bookingId: "book-200",
        initialExpiresAt: initialExpiry,
      }),
    );

    // Tab B
    const onExtend = jest.fn();
    const { result: tabB } = renderHook(() =>
      useCrossTabBookingSync({
        bookingId: "book-200",
        initialExpiresAt: initialExpiry,
        onExtend,
      }),
    );

    // Extend by 30 minutes in Tab A
    act(() => {
      tabA.current.extendBooking(30);
    });

    expect(tabA.current.expiresAt).toBeGreaterThan(initialExpiry);
    expect(tabB.current.expiresAt).toBe(tabA.current.expiresAt);
    expect(onExtend).toHaveBeenCalledWith(
      "book-200",
      tabA.current.expiresAt,
      expect.any(Number),
    );
    expect(tabB.current.lastMessage).toMatchObject({
      type: "EXTEND",
      bookingId: "book-200",
      extendedMinutes: 30,
    });
  });

  it("synchronizes CANCEL and clears remaining countdown timer", () => {
    const futureExpiry = Date.now() + 60 * 60 * 1000;

    // Tab A
    const { result: tabA } = renderHook(() =>
      useCrossTabBookingSync({
        bookingId: "book-300",
        initialExpiresAt: futureExpiry,
        initialStatus: "active",
      }),
    );

    // Tab B
    const onCancel = jest.fn();
    const { result: tabB } = renderHook(() =>
      useCrossTabBookingSync({
        bookingId: "book-300",
        initialExpiresAt: futureExpiry,
        initialStatus: "active",
        onCancel,
      }),
    );

    act(() => {
      tabA.current.cancelBooking();
    });

    expect(tabA.current.status).toBe("cancelled");
    expect(tabA.current.timeRemainingSeconds).toBe(0);

    expect(tabB.current.status).toBe("cancelled");
    expect(tabB.current.timeRemainingSeconds).toBe(0);
    expect(onCancel).toHaveBeenCalledWith("book-300", expect.any(Number));
  });

  it("ignores messages intended for a different bookingId", () => {
    // Tab for booking 1
    const { result: tabA } = renderHook(() =>
      useCrossTabBookingSync({ bookingId: "book-400", initialStatus: "active" }),
    );

    // Tab for booking 2
    const { result: tabB } = renderHook(() =>
      useCrossTabBookingSync({ bookingId: "book-500", initialStatus: "active" }),
    );

    // Cancel booking 400 in Tab A
    act(() => {
      tabA.current.cancelBooking();
    });

    expect(tabA.current.status).toBe("cancelled");
    // Tab B should remain unaffected
    expect(tabB.current.status).toBe("active");
    expect(tabB.current.lastMessage).toBeNull();
  });

  it("closes BroadcastChannel on unmount", () => {
    const { unmount } = renderHook(() =>
      useCrossTabBookingSync({ bookingId: "book-600" }),
    );

    const channels = MockBroadcastChannel.channels.get(
      BOOKING_SYNC_CHANNEL_NAME,
    );
    expect(channels?.size).toBe(1);

    unmount();
    expect(channels?.size).toBe(0);
  });
});
