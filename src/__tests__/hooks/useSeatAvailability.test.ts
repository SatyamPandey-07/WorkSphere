import { renderHook, act } from "@testing-library/react";
import { useSeatAvailability } from "@/hooks/useSeatAvailability";

// Mock the partysocket hook
let mockOnMessage: (event: { data: string }) => void;

jest.mock("partysocket/react", () => {
  return {
    __esModule: true,
    default: jest.fn().mockImplementation((config) => {
      mockOnMessage = config.onMessage;
      return {
        send: jest.fn(),
        readyState: 1, // WebSocket.OPEN
      };
    }),
  };
});

jest.mock("@clerk/nextjs", () => ({
  useAuth: () => ({
    getToken: jest.fn().mockResolvedValue("test-token"),
  }),
}));

jest.mock("@/components/ui/Toast", () => ({
  useToast: () => ({ toast: jest.fn() }),
}));

jest.mock("@/lib/offlineStore", () => ({
  queueOfflineCheckIn: jest.fn().mockResolvedValue(undefined),
  getQueuedCheckIns: jest.fn().mockResolvedValue([]),
  dequeueOfflineCheckIn: jest.fn().mockResolvedValue(undefined),
  incrementCheckInRetryCount: jest.fn().mockResolvedValue(undefined),
}));

describe("useSeatAvailability", () => {
  it("initializes with default state", () => {
    const { result } = renderHook(() => useSeatAvailability());
    expect(result.current.availability).toEqual({});
  });

  it("accepts a snapshot with a new epoch and populates availability", () => {
    const { result } = renderHook(() => useSeatAvailability());

    act(() => {
      mockOnMessage({
        data: JSON.stringify({
          type: "seat_snapshot",
          epoch: 100,
          sequenceId: 1,
          venues: [
            { venueId: "venue-1", count: 5, capacity: 10, status: "green" },
          ],
        }),
      });
    });

    expect(result.current.getAvailability("venue-1").count).toBe(5);
  });

  it("rejects a stale packet with a lower epoch", () => {
    const { result } = renderHook(() => useSeatAvailability());

    act(() => {
      // First, a new snapshot arrives
      mockOnMessage({
        data: JSON.stringify({
          type: "seat_snapshot",
          epoch: 100,
          sequenceId: 1,
          venues: [
            { venueId: "venue-1", count: 5, capacity: 10, status: "green" },
          ],
        }),
      });
    });

    act(() => {
      // Then, a delayed packet from an older epoch arrives
      mockOnMessage({
        data: JSON.stringify({
          type: "seat_update",
          epoch: 90,
          sequenceId: 50,
          venueId: "venue-1",
          count: 2,
          capacity: 10,
          status: "green",
        }),
      });
    });

    // The count should remain 5, ignoring the stale packet
    expect(result.current.getAvailability("venue-1").count).toBe(5);
  });

  it("accepts an update with the same epoch but higher sequence", () => {
    const { result } = renderHook(() => useSeatAvailability());

    act(() => {
      mockOnMessage({
        data: JSON.stringify({
          type: "seat_snapshot",
          epoch: 100,
          sequenceId: 1,
          venues: [
            { venueId: "venue-1", count: 5, capacity: 10, status: "green" },
          ],
        }),
      });
    });

    act(() => {
      mockOnMessage({
        data: JSON.stringify({
          type: "seat_update",
          epoch: 100,
          sequenceId: 2,
          venueId: "venue-1",
          count: 6,
          capacity: 10,
          status: "yellow",
        }),
      });
    });

    expect(result.current.getAvailability("venue-1").count).toBe(6);
  });

  it("rejects an update with the same epoch and lower sequence (reordering)", () => {
    const { result } = renderHook(() => useSeatAvailability());

    act(() => {
      mockOnMessage({
        data: JSON.stringify({
          type: "seat_snapshot",
          epoch: 100,
          sequenceId: 5,
          venues: [
            { venueId: "venue-1", count: 5, capacity: 10, status: "green" },
          ],
        }),
      });
    });

    act(() => {
      mockOnMessage({
        data: JSON.stringify({
          type: "seat_update",
          epoch: 100,
          sequenceId: 2, // lower sequence than 5
          venueId: "venue-1",
          count: 2,
          capacity: 10,
          status: "green",
        }),
      });
    });

    // The count should remain 5, ignoring the out-of-order packet
    expect(result.current.getAvailability("venue-1").count).toBe(5);
  });
});
