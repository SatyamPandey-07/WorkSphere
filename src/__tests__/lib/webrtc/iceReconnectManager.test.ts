import {
  ICEReconnectManager,
  ReconnectState,
} from '../../../lib/webrtc/iceReconnectManager';

// Mock MockRTCPeerConnection
class MockRTCPeerConnection {
  public iceConnectionState: RTCIceConnectionState = 'new';
  public connectionState: RTCPeerConnectionState = 'new';
  private config: RTCConfiguration = {};

  public restartIce = jest.fn();
  public setConfiguration = jest.fn((newConfig: RTCConfiguration) => {
    this.config = newConfig;
  });
  public getConfiguration = jest.fn(() => this.config);
}

describe('ICEReconnectManager', () => {
  let manager: ICEReconnectManager;
  let mockPC: MockRTCPeerConnection;
  let renegotiateMock: ReturnType<typeof jest.fn>;

  beforeEach(() => {
    jest.useFakeTimers();
    mockPC = new MockRTCPeerConnection();
    renegotiateMock = jest.fn().mockResolvedValue(undefined);
    manager = new ICEReconnectManager({
      baseDelayMs: 200,
      maxDelayMs: 2000,
      backoffFactor: 2,
      jitterRatio: 0.1,
      maxAttempts: 3,
      disconnectGracePeriodMs: 1000,
      fallbackAttemptThreshold: 2,
      fallbackIceServers: [{ urls: 'turn:fallback.turn.org:3478' }],
    });
    manager.attach(mockPC as unknown as RTCPeerConnection, renegotiateMock);
  });

  afterEach(() => {
    manager.dispose();
    jest.useRealTimers();
  });

  it('initializes with idle state and configures default params', () => {
    expect(manager.getState()).toBe('idle');
    expect(manager.getAttemptCount()).toBe(0);
    expect(manager.isFallbackActive()).toBe(false);
  });

  it('computes exponential backoff within jitter bounds', () => {
    // attempt 1: base 200, jitter 0.1 -> range [180, 220] capped at min base 200
    const delay1 = manager.computeBackoff(1);
    expect(delay1).toBeGreaterThanOrEqual(180);
    expect(delay1).toBeLessThanOrEqual(220);

    // attempt 2: base 200 * 2^1 = 400, jitter 0.1 -> range [360, 440]
    const delay2 = manager.computeBackoff(2);
    expect(delay2).toBeGreaterThanOrEqual(360);
    expect(delay2).toBeLessThanOrEqual(440);

    // attempt 3: base 200 * 2^2 = 800, jitter 0.1 -> range [720, 880]
    const delay3 = manager.computeBackoff(3);
    expect(delay3).toBeGreaterThanOrEqual(720);
    expect(delay3).toBeLessThanOrEqual(880);

    // large attempt capped at maxDelayMs (2000)
    const delayLarge = manager.computeBackoff(10);
    expect(delayLarge).toBeLessThanOrEqual(2200);
  });

  it('honors disconnect grace period before triggering reconnection', () => {
    const states: ReconnectState[] = [];
    manager.onStateChange((s) => states.push(s));

    // Transition to disconnected
    manager.handleIceConnectionStateChange('disconnected');
    expect(manager.getState()).toBe('disconnected');
    expect(manager.getAttemptCount()).toBe(0);

    // Advance 500ms (less than 1000ms grace period)
    jest.advanceTimersByTime(500);
    expect(manager.getState()).toBe('disconnected');
    expect(manager.getAttemptCount()).toBe(0);

    // Advance past grace period (1000ms total)
    jest.advanceTimersByTime(501);
    expect(manager.getState()).toBe('reconnecting');
    expect(manager.getAttemptCount()).toBe(1);
  });

  it('recovers to connected state if connection re-establishes during grace period', () => {
    manager.handleIceConnectionStateChange('disconnected');
    expect(manager.getState()).toBe('disconnected');

    // Connection restores before grace period expires
    jest.advanceTimersByTime(400);
    manager.handleIceConnectionStateChange('connected');
    expect(manager.getState()).toBe('connected');
    expect(manager.getAttemptCount()).toBe(0);

    // Advance time further to ensure no delayed reconnect fires
    jest.advanceTimersByTime(1000);
    expect(manager.getState()).toBe('connected');
  });

  it('triggers immediate reconnect schedule on failed state', () => {
    manager.handleIceConnectionStateChange('failed');
    expect(manager.getState()).toBe('reconnecting');
    expect(manager.getAttemptCount()).toBe(1);
  });

  it('executes restartIce and renegotiation during reconnect cycle', async () => {
    const iceRestartListener = jest.fn();
    manager.onIceRestart(iceRestartListener);

    manager.handleIceConnectionStateChange('failed');
    expect(manager.getState()).toBe('reconnecting');

    // Advance timer to trigger execution
    await jest.advanceTimersByTimeAsync(300);

    expect(mockPC.restartIce).toHaveBeenCalledTimes(1);
    expect(renegotiateMock).toHaveBeenCalledTimes(1);
    expect(iceRestartListener).toHaveBeenCalledTimes(1);
  });

  it('applies fallback ICE servers when reaching threshold', async () => {
    const fallbackListener = jest.fn();
    manager.onFallbackApplied(fallbackListener);

    // First attempt
    manager.handleIceConnectionStateChange('failed');
    await jest.advanceTimersByTimeAsync(300);
    expect(manager.isFallbackActive()).toBe(false);

    // Second attempt (threshold = 2)
    manager.handleIceConnectionStateChange('failed');
    await jest.advanceTimersByTimeAsync(500);

    expect(manager.isFallbackActive()).toBe(true);
    expect(mockPC.setConfiguration).toHaveBeenCalledWith({
      iceServers: [{ urls: 'turn:fallback.turn.org:3478' }],
    });
    expect(fallbackListener).toHaveBeenCalledWith([{ urls: 'turn:fallback.turn.org:3478' }]);
  });

  it('stops and emits onFatalFailure when maxAttempts exceeded', async () => {
    const fatalListener = jest.fn();
    manager.onFatalFailure(fatalListener);

    // Attempt 1
    manager.handleIceConnectionStateChange('failed');
    await jest.advanceTimersByTimeAsync(300);

    // Attempt 2
    manager.handleIceConnectionStateChange('failed');
    await jest.advanceTimersByTimeAsync(500);

    // Attempt 3
    manager.handleIceConnectionStateChange('failed');
    await jest.advanceTimersByTimeAsync(900);

    // Attempt 4 -> exceeds maxAttempts (3)
    manager.handleIceConnectionStateChange('failed');

    expect(manager.getState()).toBe('failed');
    expect(fatalListener).toHaveBeenCalledWith(3);
  });

  it('does not exhaust the retry budget from duplicate events while a timer is pending', async () => {
    manager.dispose();
    manager = new ICEReconnectManager({
      baseDelayMs: 200,
      maxDelayMs: 200,
      backoffFactor: 2,
      jitterRatio: 0,
      maxAttempts: 1,
      disconnectGracePeriodMs: 1000,
      fallbackAttemptThreshold: 2,
      fallbackIceServers: [{ urls: 'turn:fallback.turn.org:3478' }],
    });
    manager.attach(mockPC as unknown as RTCPeerConnection, renegotiateMock);

    manager.handleIceConnectionStateChange('failed');
    manager.handleIceConnectionStateChange('failed');
    manager.handleConnectionStateChange('failed');

    expect(manager.getAttemptCount()).toBe(1);
    expect(manager.getState()).toBe('reconnecting');

    await jest.advanceTimersByTimeAsync(200);

    expect(mockPC.restartIce).toHaveBeenCalledTimes(1);
    expect(manager.getState()).toBe('reconnecting');
  });

  it('coalesces rapid failure events while renegotiation is in flight', async () => {
    let finishRenegotiation!: () => void;
    const pendingRenegotiation = new Promise<void>((resolve) => {
      finishRenegotiation = resolve;
    });
    renegotiateMock.mockImplementationOnce(() => pendingRenegotiation);

    manager.handleIceConnectionStateChange('failed');
    jest.advanceTimersByTime(300);
    await Promise.resolve();

    expect(mockPC.restartIce).toHaveBeenCalledTimes(1);
    expect(manager.getAttemptCount()).toBe(1);

    // Both state-change APIs can report the same failure during negotiation.
    manager.handleIceConnectionStateChange('failed');
    manager.handleConnectionStateChange('failed');
    manager.handleIceConnectionStateChange('failed');

    expect(mockPC.restartIce).toHaveBeenCalledTimes(1);
    expect(manager.getAttemptCount()).toBe(1);

    finishRenegotiation();
    await Promise.resolve();
    await Promise.resolve();

    // The burst is represented by one follow-up timer, not parallel cycles.
    expect(manager.getAttemptCount()).toBe(2);

    await jest.advanceTimersByTimeAsync(500);
    expect(mockPC.restartIce).toHaveBeenCalledTimes(2);
    expect(renegotiateMock).toHaveBeenCalledTimes(2);
  });

  it('supports manual reconnect invocation', async () => {
    const success = await manager.manualReconnect(true);
    expect(success).toBe(true);
    expect(mockPC.restartIce).toHaveBeenCalledTimes(1);
    expect(renegotiateMock).toHaveBeenCalledTimes(1);
  });

  it('cleans up all timers and listeners upon dispose()', () => {
    const stateListener = jest.fn();
    manager.onStateChange(stateListener);

    manager.handleIceConnectionStateChange('disconnected');
    manager.dispose();

    expect(manager.getState()).toBe('closed');

    // Advancing timers should not cause any errors or state changes
    jest.advanceTimersByTime(2000);
    expect(stateListener).toHaveBeenCalledWith('disconnected');
    expect(stateListener).not.toHaveBeenCalledWith('reconnecting');
  });
});
