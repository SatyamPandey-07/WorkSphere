import { renderHook, act } from "@testing-library/react";
import { usePartySocket } from "@/hooks/usePartySocket";

const mockGetToken = jest.fn();
jest.mock("@clerk/nextjs", () => ({
  useAuth: () => ({
    getToken: mockGetToken,
  }),
}));

const mockSocketsCreated: any[] = [];

jest.mock("partysocket/react", () => ({
  __esModule: true,
  default: jest.fn((options: any) => {
    const listeners: Record<string, Function[]> = {};
    const socket = {
      options,
      query: { ...options?.query },
      send: jest.fn(),
      _connect: jest.fn(),
      _disconnect: jest.fn(),
      addEventListener: jest.fn((ev: string, fn: any) => {
        listeners[ev] = listeners[ev] || [];
        listeners[ev].push(fn);
      }),
      removeEventListener: jest.fn((ev: string, fn: any) => {
        if (listeners[ev]) {
          listeners[ev] = listeners[ev].filter((f) => f !== fn);
        }
      }),
      __trigger: (ev: string, data: any) => {
        if (listeners[ev]) {
          listeners[ev].forEach((fn) => fn(data));
        }
      },
    };
    mockSocketsCreated.push(socket);
    return socket;
  }),
}));

describe("usePartySocket BroadcastChannel Leader Election & Coordination (#3767)", () => {
  let channels: Map<string, Set<(ev: { data: any }) => void>>;
  const originalBroadcastChannel = global.BroadcastChannel;

  beforeEach(() => {
    jest.useFakeTimers();
    mockSocketsCreated.length = 0;
    channels = new Map();

    // Mock BroadcastChannel in Jest
    class MockBroadcastChannel {
      name: string;
      private listener: ((ev: { data: any }) => void) | null = null;

      constructor(name: string) {
        this.name = name;
        if (!channels.has(name)) {
          channels.set(name, new Set());
        }
      }

      addEventListener(event: string, cb: (ev: { data: any }) => void) {
        if (event === "message") {
          this.listener = cb;
          channels.get(this.name)?.add(cb);
        }
      }

      removeEventListener(event: string, cb: (ev: { data: any }) => void) {
        if (event === "message") {
          channels.get(this.name)?.delete(cb);
        }
      }

      postMessage(data: any) {
        const listeners = channels.get(this.name);
        if (listeners) {
          // Broadcast to all other listeners on this channel (excluding self)
          listeners.forEach((cb) => {
            if (cb !== this.listener) {
              cb({ data });
            }
          });
        }
      }

      close() {
        if (this.listener) {
          channels.get(this.name)?.delete(this.listener);
        }
      }
    }

    (global as any).BroadcastChannel = MockBroadcastChannel;
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
    (global as any).BroadcastChannel = originalBroadcastChannel;
  });

  it("elects the first tab as leader and opens active WebSocket connection", () => {
    const { result } = renderHook(() =>
      usePartySocket({ host: "localhost:1999", room: "seat-room" }),
    );

    // Advance timer past claim timeout
    act(() => {
      jest.advanceTimersByTime(300);
    });

    expect(result.current.isLeader).toBe(true);
    expect(mockSocketsCreated).toHaveLength(1);
    expect(mockSocketsCreated[0].options.startClosed).toBe(false);
  });

  it("coordinates multi-tabs so follower tab does not open redundant active WebSocket", () => {
    // Tab 1 (Leader)
    const tab1 = renderHook(() =>
      usePartySocket({ host: "localhost:1999", room: "shared-room" }),
    );

    act(() => {
      jest.advanceTimersByTime(300);
    });

    expect(tab1.result.current.isLeader).toBe(true);

    // Tab 2 (Follower) opened in another tab
    const tab2 = renderHook(() =>
      usePartySocket({ host: "localhost:1999", room: "shared-room" }),
    );

    // Leader sends heartbeats
    act(() => {
      jest.advanceTimersByTime(1100);
    });

    // Tab 2 recognizes Tab 1 as leader and remains a follower
    expect(tab2.result.current.isLeader).toBe(false);

    // Tab 2 socket is initialized with startClosed: true to avoid duplicate WebSocket
    expect(mockSocketsCreated[1].options.startClosed).toBe(true);
  });

  it("smoothly transfers leadership when primary leader tab is unmounted / closed", () => {
    // Tab 1 (Leader)
    const tab1 = renderHook(() =>
      usePartySocket({ host: "localhost:1999", room: "failover-room" }),
    );

    act(() => {
      jest.advanceTimersByTime(300);
    });
    expect(tab1.result.current.isLeader).toBe(true);

    // Tab 2 (Follower)
    const tab2 = renderHook(() =>
      usePartySocket({ host: "localhost:1999", room: "failover-room" }),
    );
    act(() => {
      jest.advanceTimersByTime(1100);
    });
    expect(tab2.result.current.isLeader).toBe(false);

    // Tab 1 is closed (unmounted)
    act(() => {
      tab1.unmount();
    });

    // Tab 2 should immediately take over leadership upon resignation
    expect(tab2.result.current.isLeader).toBe(true);
  });

  it("relays incoming messages from leader WebSocket to follower tabs locally", () => {
    const tab1 = renderHook(() =>
      usePartySocket({ host: "localhost:1999", room: "relay-room" }),
    );
    act(() => {
      jest.advanceTimersByTime(300);
    });

    const tab2 = renderHook(() =>
      usePartySocket({ host: "localhost:1999", room: "relay-room" }),
    );
    act(() => {
      jest.advanceTimersByTime(1100);
    });

    const followerMsgListener = jest.fn();
    tab2.result.current.addEventListener("message", followerMsgListener);

    // Leader receives incoming seat availability message from PartyKit
    const incomingData = JSON.stringify({
      type: "seat_update",
      venueId: "ven-123",
      count: 4,
    });

    act(() => {
      mockSocketsCreated[0].__trigger("message", { data: incomingData });
    });

    expect(followerMsgListener).toHaveBeenCalledWith(
      expect.objectContaining({ data: incomingData }),
    );
  });
});
