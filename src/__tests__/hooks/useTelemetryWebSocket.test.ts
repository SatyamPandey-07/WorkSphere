import { renderHook, act } from "@testing-library/react";
import {
  useTelemetryWebSocket,
  computeBackoffWithJitter,
} from "@/hooks/useTelemetryWebSocket";

class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  static instances: MockWebSocket[] = [];

  url: string;
  readyState = MockWebSocket.CONNECTING;
  onopen: ((ev: Event) => void) | null = null;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;
  onclose: ((ev: CloseEvent) => void) | null = null;
  closeCalls: Array<{ code?: number; reason?: string }> = [];
  sent: string[] = [];

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }

  send(data: string) {
    this.sent.push(data);
  }

  close(code?: number, reason?: string) {
    this.closeCalls.push({ code, reason });
    this.readyState = MockWebSocket.CLOSED;
  }

  triggerOpen() {
    this.readyState = MockWebSocket.OPEN;
    this.onopen?.(new Event("open"));
  }

  triggerMessage(data: unknown) {
    this.onmessage?.({ data: JSON.stringify(data) } as MessageEvent);
  }

  triggerClose(code = 1006, reason = "Abnormal closure") {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.({ code, reason } as CloseEvent);
  }
}

describe("useTelemetryWebSocket", () => {
  const OriginalWebSocket = global.WebSocket;

  beforeEach(() => {
    jest.useFakeTimers();
    MockWebSocket.instances = [];
    (global as unknown as { WebSocket: typeof MockWebSocket }).WebSocket =
      MockWebSocket;
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
    jest.restoreAllMocks();
    (global as unknown as { WebSocket: typeof WebSocket }).WebSocket =
      OriginalWebSocket;
  });

  it("computes capped exponential backoff (500ms base, 30s ceiling) with +/-25% jitter", () => {
    jest.spyOn(Math, "random").mockReturnValue(0); // -25% lower bound (0.75x)
    expect(computeBackoffWithJitter(0)).toBe(375);
    expect(computeBackoffWithJitter(1)).toBe(750);
    expect(computeBackoffWithJitter(10)).toBe(22500);

    jest.spyOn(Math, "random").mockReturnValue(1); // +25% upper bound (1.25x)
    expect(computeBackoffWithJitter(0)).toBe(625);
    expect(computeBackoffWithJitter(1)).toBe(1250);
    expect(computeBackoffWithJitter(10)).toBe(37500);
  });

  it("reconnects on non-1000 close with jittered exponential backoff and resets attempt counter on onopen", () => {
    const setTimeoutSpy = jest.spyOn(global, "setTimeout");
    jest.spyOn(Math, "random").mockReturnValue(0.5); // 1.0x midpoint -> 500ms, 1000ms

    const { result } = renderHook(() =>
      useTelemetryWebSocket("wss://telemetry.worksphere.local/venue-1"),
    );

    expect(MockWebSocket.instances).toHaveLength(1);
    const ws1 = MockWebSocket.instances[0];

    act(() => {
      ws1.triggerOpen();
    });
    expect(result.current.status).toBe("open");
    expect(result.current.reconnectAttempts).toBe(0);

    // Unexpected gateway drop (1006) -> schedules attempt 0 (~500ms)
    act(() => {
      ws1.triggerClose(1006);
    });
    expect(result.current.status).toBe("reconnecting");
    expect(result.current.reconnectAttempts).toBe(1);
    expect(setTimeoutSpy).toHaveBeenLastCalledWith(expect.any(Function), 500);

    act(() => {
      jest.advanceTimersByTime(500);
    });
    expect(MockWebSocket.instances).toHaveLength(2);
    const ws2 = MockWebSocket.instances[1];

    // Second drop before open -> schedules attempt 1 (~1000ms)
    act(() => {
      ws2.triggerClose(1006);
    });
    expect(result.current.reconnectAttempts).toBe(2);
    expect(setTimeoutSpy).toHaveBeenLastCalledWith(expect.any(Function), 1000);

    act(() => {
      jest.advanceTimersByTime(1000);
    });
    expect(MockWebSocket.instances).toHaveLength(3);
    const ws3 = MockWebSocket.instances[2];

    // Successful handshake resets reconnectAttempts back to 0
    act(() => {
      ws3.triggerOpen();
    });
    expect(result.current.status).toBe("open");
    expect(result.current.reconnectAttempts).toBe(0);
  });

  it("does not reconnect on intentional close (code === 1000) and clears timers/handlers on unmount mid-connecting", () => {
    const onMessage = jest.fn();
    const { result, unmount } = renderHook(() =>
      useTelemetryWebSocket("wss://telemetry.worksphere.local/venue-1", {
        onMessage,
      }),
    );

    const ws1 = MockWebSocket.instances[0];
    act(() => {
      ws1.triggerOpen();
    });

    // Intentional close with code 1000 must not schedule reconnection
    act(() => {
      ws1.triggerClose(1000, "Normal closure");
    });
    expect(result.current.status).toBe("closed");
    act(() => {
      jest.advanceTimersByTime(60_000);
    });
    expect(MockWebSocket.instances).toHaveLength(1);

    // Reconnect and unmount while still in CONNECTING state
    act(() => {
      result.current.reconnect();
    });
    expect(MockWebSocket.instances).toHaveLength(2);
    const wsConnecting = MockWebSocket.instances[1];
    expect(wsConnecting.readyState).toBe(MockWebSocket.CONNECTING);

    unmount();

    expect(wsConnecting.onopen).toBeNull();
    expect(wsConnecting.onmessage).toBeNull();
    expect(wsConnecting.onerror).toBeNull();
    expect(wsConnecting.onclose).toBeNull();
    expect(wsConnecting.closeCalls).toEqual([
      { code: 1000, reason: "Component unmount" },
    ]);

    // Stale events after unmount must not invoke callbacks or schedule timers
    wsConnecting.triggerMessage({ temp: 22.5 });
    wsConnecting.triggerClose(1006);
    act(() => {
      jest.advanceTimersByTime(60_000);
    });
    expect(onMessage).not.toHaveBeenCalled();
    expect(MockWebSocket.instances).toHaveLength(2);
  });
});
