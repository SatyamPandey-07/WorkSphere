import {
  WsHeartbeatController,
  type WsSocketLike,
} from '@/lib/realtime/wsHeartbeatController';

function makeMockSocket(sentSink: string[]): WsSocketLike {
  return {
    readyState: 1,
    send: (data: string) => {
      sentSink.push(data);
    },
    close: jest.fn(),
  };
}

describe('WsHeartbeatController', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('tracks min, max, average, and jitter RTT over a rolling window of 10 heartbeats', () => {
    let mockTime = 10_000;
    const sent: string[] = [];
    const currentSocket = makeMockSocket(sent);

    const controller = new WsHeartbeatController({
      heartbeatIntervalMs: 1_000,
      pongTimeoutMs: 500,
      createSocket: () => currentSocket,
      nowFn: () => mockTime,
    });

    // Initial state before heartbeats
    const initialStats = controller.getLatencyStats();
    expect(initialStats).toEqual({
      min: null,
      max: null,
      average: null,
      jitter: null,
      sampleCount: 0,
    });

    controller.connect();
    controller.handleOpen();

    // 1st Heartbeat: RTT = 50ms
    mockTime += 1_000;
    jest.advanceTimersByTime(1_000);
    mockTime += 50;
    controller.handleIncomingMessage('pong');

    let stats = controller.getLatencyStats();
    expect(stats).toEqual({
      min: 50,
      max: 50,
      average: 50,
      jitter: 0,
      sampleCount: 1,
    });

    // 2nd Heartbeat: RTT = 70ms (|70 - 50| = 20) -> jitter = 20
    mockTime += 950;
    jest.advanceTimersByTime(1_000);
    mockTime += 70;
    controller.handleIncomingMessage('pong');

    stats = controller.getLatencyStats();
    expect(stats).toEqual({
      min: 50,
      max: 70,
      average: 60,
      jitter: 20,
      sampleCount: 2,
    });

    // 3rd Heartbeat: RTT = 60ms (|60 - 70| = 10) -> jitter = (20 + 10) / 2 = 15
    mockTime += 930;
    jest.advanceTimersByTime(1_000);
    mockTime += 60;
    controller.handleIncomingMessage('pong');

    stats = controller.getLatencyStats();
    expect(stats).toEqual({
      min: 50,
      max: 70,
      average: 60,
      jitter: 15,
      sampleCount: 3,
    });

    // Feed 8 more measurements to exceed the 10-window limit:
    // Window will contain 10 elements.
    const rtts = [40, 80, 50, 90, 30, 70, 60, 100];
    for (const rtt of rtts) {
      mockTime += 1_000;
      jest.advanceTimersByTime(1_000);
      mockTime += rtt;
      controller.handleIncomingMessage('pong');
    }

    stats = controller.getLatencyStats();
    expect(stats.sampleCount).toBe(10);
    // Oldest sample (50) was discarded. Current window:
    // [70, 60, 40, 80, 50, 90, 30, 70, 60, 100]
    expect(stats.min).toBe(30);
    expect(stats.max).toBe(100);
    // Sum = 70 + 60 + 40 + 80 + 50 + 90 + 30 + 70 + 60 + 100 = 650 -> avg = 65
    expect(stats.average).toBe(65);
    // Consecutive diffs:
    // |60-70|=10, |40-60|=20, |80-40|=40, |50-80|=30, |90-50|=40, |30-90|=60, |70-30|=40, |60-70|=10, |100-60|=40
    // Sum diffs = 10 + 20 + 40 + 30 + 40 + 60 + 40 + 10 + 40 = 290
    // Jitter = 290 / 9 = 32.22
    expect(stats.jitter).toBe(32.22);

    controller.dispose();
  });

  it('resets latency statistics upon reconnection or disconnect', () => {
    let mockTime = 1_000;
    const sent: string[] = [];
    const currentSocket = makeMockSocket(sent);

    const controller = new WsHeartbeatController({
      heartbeatIntervalMs: 1_000,
      pongTimeoutMs: 500,
      createSocket: () => currentSocket,
      nowFn: () => mockTime,
    });

    controller.connect();
    controller.handleOpen();

    mockTime += 1_000;
    jest.advanceTimersByTime(1_000);
    mockTime += 45;
    controller.handleIncomingMessage('pong');

    expect(controller.getLatencyStats().sampleCount).toBe(1);

    // Reconnecting resets latency stats
    controller.connect();
    expect(controller.getLatencyStats()).toEqual({
      min: null,
      max: null,
      average: null,
      jitter: null,
      sampleCount: 0,
    });

    controller.dispose();
  });

  it('transitions to stalled on missed pong and schedules bounded backoff reconnect without overlapping timers', () => {
    const sent: string[] = [];
    const states: string[] = [];
    let latestSocket = makeMockSocket(sent);

    const controller = new WsHeartbeatController({
      heartbeatIntervalMs: 1_000,
      pongTimeoutMs: 500,
      baseReconnectDelayMs: 250,
      maxReconnectDelayMs: 2_000,
      maxReconnectAttempts: 4,
      createSocket: () => {
        latestSocket = makeMockSocket(sent);
        return latestSocket;
      },
      onStateChange: (s) => states.push(s),
    });

    controller.connect();
    controller.handleOpen();
    expect(controller.getState()).toBe('healthy');

    jest.advanceTimersByTime(1_000);
    expect(sent.length).toBe(1);

    jest.advanceTimersByTime(500);
    expect(states).toContain('stalled');
    expect(controller.getState()).toBe('reconnecting');

    controller.connect();
    expect(controller.getState()).toBe('connecting');
    controller.handleOpen();
    expect(controller.getState()).toBe('healthy');

    jest.advanceTimersByTime(1_000);
    controller.handleIncomingMessage('pong');
    jest.advanceTimersByTime(500);
    expect(controller.getState()).toBe('healthy');

    controller.dispose();
  });

  it('enforces maxQueueSize under backpressure and replays buffered frames in FIFO order on reconnect', () => {
    const sent: string[] = [];
    const currentSocket = makeMockSocket(sent);

    const controller = new WsHeartbeatController({
      maxQueueSize: 3,
      dropPolicy: 'drop_oldest',
      createSocket: () => currentSocket,
    });

    controller.send('msg-1');
    controller.send('msg-2');
    controller.send('msg-3');
    controller.send('msg-4');

    expect(controller.getQueuedCount()).toBe(3);

    controller.connect();
    controller.handleOpen();

    expect(sent).toEqual(['msg-2', 'msg-3', 'msg-4']);
    expect(controller.getQueuedCount()).toBe(0);

    controller.dispose();
  });

  it('clears all timers and prevents further reconnects on manual disconnect or dispose', () => {
    const createSocket = jest.fn(() => makeMockSocket([]));
    const controller = new WsHeartbeatController({
      heartbeatIntervalMs: 1_000,
      pongTimeoutMs: 400,
      baseReconnectDelayMs: 500,
      createSocket,
    });

    controller.connect();
    controller.handleOpen();
    controller.handleSocketClose('drop');
    expect(controller.getState()).toBe('reconnecting');

    controller.dispose();
    expect(controller.getState()).toBe('closed');

    const countAtDispose = createSocket.mock.calls.length;
    jest.advanceTimersByTime(10_000);
    expect(createSocket.mock.calls.length).toBe(countAtDispose);
  });

  it('clears pending pong-timeout and heartbeat timers on explicit disconnect without triggering reconnect', () => {
    const sent: string[] = [];
    const states: string[] = [];
    const createSocket = jest.fn(() => makeMockSocket(sent));

    const controller = new WsHeartbeatController({
      heartbeatIntervalMs: 1_000,
      pongTimeoutMs: 400,
      baseReconnectDelayMs: 250,
      createSocket,
      onStateChange: (s) => states.push(s),
    });

    controller.connect();
    controller.handleOpen();
    expect(controller.getState()).toBe('healthy');

    // Trigger ping send so pongTimer is pending
    jest.advanceTimersByTime(1_000);
    expect(sent).toHaveLength(1);
    expect(jest.getTimerCount()).toBeGreaterThan(0);

    // Explicitly disconnect before pong arrives
    controller.disconnect();
    expect(controller.getState()).toBe('closed');
    expect(jest.getTimerCount()).toBe(0);

    const socketCallsAtDisconnect = createSocket.mock.calls.length;
    const statesAtDisconnect = states.length;

    // Advance well past pongTimeoutMs and reconnect backoff windows
    jest.advanceTimersByTime(30_000);
    expect(controller.getState()).toBe('closed');
    expect(createSocket.mock.calls.length).toBe(socketCallsAtDisconnect);
    expect(states.length).toBe(statesAtDisconnect);
  });

  it('does not leak pong-timeout timer if disconnect is called synchronously during ping or before handshake finishes', () => {
    const states: string[] = [];
    const createSocket = jest.fn(() => makeMockSocket([]));

    const controllerRef: { current?: WsHeartbeatController } = {};
    const controller = new WsHeartbeatController({
      heartbeatIntervalMs: 1_000,
      pongTimeoutMs: 400,
      baseReconnectDelayMs: 250,
      createSocket,
      onStateChange: (s) => states.push(s),
      onPing: () => {
        controllerRef.current?.disconnect();
      },
    });
    controllerRef.current = controller;

    // Disconnect before handshake finishes
    controller.connect();
    expect(controller.getState()).toBe('connecting');
    controller.disconnect();
    expect(controller.getState()).toBe('closed');
    expect(jest.getTimerCount()).toBe(0);

    // Reconnect, open, and trigger re-entrant disconnect inside onPing
    controller.connect();
    controller.handleOpen();
    jest.advanceTimersByTime(1_000);

    expect(controller.getState()).toBe('closed');
    expect(jest.getTimerCount()).toBe(0);

    const socketCallsAfter = createSocket.mock.calls.length;
    jest.advanceTimersByTime(15_000);
    expect(createSocket.mock.calls.length).toBe(socketCallsAfter);
    expect(states[states.length - 1]).toBe('closed');
  });
});
