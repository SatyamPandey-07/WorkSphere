import { renderHook, act } from "@testing-library/react";
import usePartySocket, {
  calculateJitteredBackoff,
} from "@/hooks/usePartySocket";

describe("calculateJitteredBackoff (#3769)", () => {
  it("returns 0 for initial connect (attempt <= 0)", () => {
    expect(calculateJitteredBackoff(0)).toBe(0);
    expect(calculateJitteredBackoff(-1)).toBe(0);
  });

  it("calculates exponential backoff with jitter within [0.8, 1.2] bounds", () => {
    // Attempt 1: base = 1000
    const delayMin = calculateJitteredBackoff(1, { random: () => 0 });
    const delayMid = calculateJitteredBackoff(1, { random: () => 0.5 });
    const delayMax = calculateJitteredBackoff(1, { random: () => 1 });

    expect(delayMin).toBe(800); // 1000 * 0.8
    expect(delayMid).toBe(1000); // 1000 * 1.0
    expect(delayMax).toBe(1200); // 1000 * 1.2
  });

  it("scales exponentially on subsequent retry attempts", () => {
    // Attempt 2: base = 1000 * 2^1 = 2000
    const delay2Mid = calculateJitteredBackoff(2, { random: () => 0.5 });
    expect(delay2Mid).toBe(2000);

    // Attempt 3: base = 1000 * 2^2 = 4000
    const delay3Mid = calculateJitteredBackoff(3, { random: () => 0.5 });
    expect(delay3Mid).toBe(4000);

    // Attempt 4: base = 1000 * 2^3 = 8000
    const delay4Mid = calculateJitteredBackoff(4, { random: () => 0.5 });
    expect(delay4Mid).toBe(8000);
  });

  it("caps maximum reconnection delay at 30,000ms (30s)", () => {
    // Attempt 10: 1000 * 2^9 = 512,000 => capped at 30,000ms
    const delayCapped = calculateJitteredBackoff(10, { random: () => 1 });
    expect(delayCapped).toBe(30000);
  });

  it("prevents synchronized reconnect spikes across multiple simulated clients", () => {
    const samples = Array.from({ length: 20 }, () =>
      calculateJitteredBackoff(2),
    );
    const uniqueDelays = new Set(samples);
    expect(uniqueDelays.size).toBeGreaterThan(1);
  });
});

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
    const listeners: Record<string, ((...args: any[]) => void)[]> = {};
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
    const _tab1 = renderHook(() =>
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

  it("prevents duplicate reconnect loops and maintains single active socket on rapid network toggles (#3937)", () => {
    const { result } = renderHook(() =>
      usePartySocket({ host: "localhost:1999", room: "flapping-room" }),
    );

    act(() => {
      jest.advanceTimersByTime(300);
    });

    const initialSocketCount = mockSocketsCreated.length;
    expect(initialSocketCount).toBe(1);

    // Simulate rapid offline/online network flapping
    act(() => {
      window.dispatchEvent(new Event("online"));
      window.dispatchEvent(new Event("online"));
      window.dispatchEvent(new Event("online"));
      jest.advanceTimersByTime(50);
      window.dispatchEvent(new Event("online"));
      jest.advanceTimersByTime(200);
    });

    // Reconnection timers were debounced and canceled, avoiding duplicate socket creation
    expect(mockSocketsCreated.length).toBe(1);
    expect(result.current.isLeader).toBe(true);
  });
});
