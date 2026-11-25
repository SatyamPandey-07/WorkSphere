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
