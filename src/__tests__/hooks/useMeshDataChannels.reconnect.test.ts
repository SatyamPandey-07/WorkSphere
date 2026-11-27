import { describe, it, expect, jest, beforeEach, afterEach } from "@jest/globals";
import {
  createMeshConnectionMetricsController,
  createSocketReconnectController,
  VISIBILITY_RECONNECT_DEBOUNCE_MS,
} from "@/hooks/useMeshDataChannels";

describe("useMeshDataChannels WebSocket reconnect locking & debounce (#9266)", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("debounces rapid visibilitychange events by 300ms and establishes only a single active connection", () => {
    const performReconnect = jest.fn();
    const cleanupHalfOpen = jest.fn();

    const controller = createSocketReconnectController({
      debounceMs: VISIBILITY_RECONNECT_DEBOUNCE_MS,
      onPerformReconnect: performReconnect,
      onCleanupHalfOpen: cleanupHalfOpen,
    });

    expect(controller.getState()).toBe("DISCONNECTED");
    expect(controller.getIsConnecting()).toBe(false);

    // Simulate rapid tab switching 6 times within 150ms
    controller.scheduleVisibilityReconnect(true);
    jest.advanceTimersByTime(50);
    controller.scheduleVisibilityReconnect(false);
    jest.advanceTimersByTime(30);
    controller.scheduleVisibilityReconnect(true);
    jest.advanceTimersByTime(40);
    controller.scheduleVisibilityReconnect(true);

    // Before 300ms debounce finishes, zero reconnects should have fired
    expect(performReconnect).not.toHaveBeenCalled();

    // Advance past 300ms debounce
    jest.advanceTimersByTime(VISIBILITY_RECONNECT_DEBOUNCE_MS);

    expect(performReconnect).toHaveBeenCalledTimes(1);
    expect(controller.getState()).toBe("CONNECTING");
    expect(controller.getIsConnecting()).toBe(true);

    // Subsequent visibility events while CONNECTING must be ignored
    controller.scheduleVisibilityReconnect(true);
    jest.advanceTimersByTime(500);
    expect(performReconnect).toHaveBeenCalledTimes(1);

    // Once CONNECTED, visibility events must also not spawn duplicate sockets
    controller.markConnected();
    expect(controller.getState()).toBe("CONNECTED");
    expect(controller.getIsConnecting()).toBe(false);

    controller.scheduleVisibilityReconnect(true);
    jest.advanceTimersByTime(500);
    expect(performReconnect).toHaveBeenCalledTimes(1);
  });

  it("cleans up half-open handshakes and transitions states cleanly on dispose", () => {
    const performReconnect = jest.fn();
    const cleanupHalfOpen = jest.fn();

    const controller = createSocketReconnectController({
      onPerformReconnect: performReconnect,
      onCleanupHalfOpen: cleanupHalfOpen,
    });

    controller.scheduleVisibilityReconnect(true);
    jest.advanceTimersByTime(VISIBILITY_RECONNECT_DEBOUNCE_MS);
    expect(controller.getState()).toBe("CONNECTING");

    controller.dispose();
    expect(cleanupHalfOpen).toHaveBeenCalledTimes(1);
    expect(controller.getState()).toBe("DISCONNECTED");
    expect(controller.getIsConnecting()).toBe(false);
  });

  it("tracks initial, connected, disconnected, reconnecting, and active channel states", () => {
    const metrics = createMeshConnectionMetricsController();

    expect(metrics.getMetrics()).toEqual({
      reconnectCount: 0,
      lastDisconnectReason: null,
      activeChannelState: "closed",
    });

    metrics.markConnected();
    metrics.setActiveChannelState("connecting");
    metrics.setActiveChannelState("open");
    metrics.markDisconnected("network unavailable");
    metrics.setActiveChannelState("closed");

    expect(metrics.getMetrics()).toEqual({
      reconnectCount: 0,
      lastDisconnectReason: "network unavailable",
      activeChannelState: "closed",
    });

    metrics.markConnected();
    metrics.setActiveChannelState("connecting");
    expect(metrics.getMetrics()).toEqual({
      reconnectCount: 1,
      lastDisconnectReason: "network unavailable",
      activeChannelState: "connecting",
    });
    metrics.setActiveChannelState("open");
    expect(metrics.getMetrics().activeChannelState).toBe("open");
  });

  it("does not publish metric updates when values remain unchanged", () => {
    const onUpdate = jest.fn();
    const metrics = createMeshConnectionMetricsController(onUpdate);

    metrics.markConnected();
    metrics.setActiveChannelState("closed");
    metrics.markDisconnected(null);
    expect(onUpdate).not.toHaveBeenCalled();

    metrics.setActiveChannelState("connecting");
    metrics.setActiveChannelState("connecting");
    metrics.markDisconnected("network unavailable");
    metrics.markDisconnected("network unavailable");
    metrics.markConnected();
    metrics.markConnected();

    expect(onUpdate).toHaveBeenCalledTimes(3);
    expect(metrics.getMetrics()).toEqual({
      reconnectCount: 1,
      lastDisconnectReason: "network unavailable",
      activeChannelState: "connecting",
    });
  });
});