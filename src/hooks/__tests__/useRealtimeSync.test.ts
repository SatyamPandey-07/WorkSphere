import { act, renderHook } from '@testing-library/react';
import { useRealtimeSync } from '../useRealtimeSync';

class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  static instances: MockWebSocket[] = [];

  readyState = MockWebSocket.CONNECTING;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  sent: string[] = [];

  constructor(public url: string) {
    MockWebSocket.instances.push(this);
  }

  send(data: string) {
    this.sent.push(data);
  }

  close() {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.();
  }
}

describe('useRealtimeSync', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    MockWebSocket.instances = [];
    (globalThis as unknown as { WebSocket: typeof MockWebSocket }).WebSocket = MockWebSocket;
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('connects, sends heartbeat pings, and reconnects with exponential backoff', () => {
    const { result, unmount } = renderHook(() =>
      useRealtimeSync({
        url: 'ws://localhost:1999',
        maxRetries: 3,
        baseDelay: 1000,
        heartbeatInterval: 5000,
      })
    );

    expect(result.current.isConnected).toBe(false);
    expect(MockWebSocket.instances).toHaveLength(1);

    const firstSocket = MockWebSocket.instances[0];
    act(() => {
      firstSocket.readyState = MockWebSocket.OPEN;
      firstSocket.onopen?.();
    });
    expect(result.current.isConnected).toBe(true);

    act(() => {
      jest.advanceTimersByTime(5000);
    });
    expect(firstSocket.sent).toEqual([JSON.stringify({ type: 'PING' })]);

    act(() => {
      firstSocket.close();
    });
    expect(result.current.isConnected).toBe(false);

    act(() => {
      jest.advanceTimersByTime(1000);
    });
    expect(MockWebSocket.instances).toHaveLength(2);

    unmount();
    expect(MockWebSocket.instances[1].readyState).toBe(MockWebSocket.CLOSED);
  });
});