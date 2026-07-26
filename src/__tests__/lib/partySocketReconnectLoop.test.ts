import {
  attachJitteredBackoff,
  PARTY_SOCKET_RECONNECT_OPTIONS,
} from "@/lib/partySocketReconnect";

describe("PartySocket Reconnect Loop & Mobile Network Switch (#1746)", () => {
  it("limits maximum reconnection attempts to 5", () => {
    expect(PARTY_SOCKET_RECONNECT_OPTIONS.maxRetries).toBe(5);
  });

  it("resets _retryCount when browser online event fires", () => {
    const mockConnect = jest.fn();
    const socket: any = {
      _retryCount: 4,
      _getNextDelay: () => 0,
      _connect: mockConnect,
      addEventListener: jest.fn(),
    };

    attachJitteredBackoff(socket);
    expect(socket._retryCount).toBe(4);

    // Simulate browser coming online after network flap (Wi-Fi -> cellular)
    window.dispatchEvent(new Event("online"));

    expect(socket._retryCount).toBe(0);
    expect(mockConnect).toHaveBeenCalled();
  });

  it("resets exponential backoff on successful reconnect (#1982)", () => {
    const eventListeners: Record<string, Array<() => void>> = {};
    const socket: any = {
      _retryCount: 0,
      _getNextDelay: () => 0,
      addEventListener: (event: string, cb: () => void) => {
        if (!eventListeners[event]) eventListeners[event] = [];
        eventListeners[event].push(cb);
      },
    };

    attachJitteredBackoff(socket);

    // initial reconnect starts at ~1 second
    socket._retryCount = 1;
    let delay = socket._getNextDelay();
    expect(delay).toBeGreaterThanOrEqual(800);
    expect(delay).toBeLessThanOrEqual(1200);

    // multiple reconnect cycles increase delay
    socket._retryCount = 3;
    delay = socket._getNextDelay();
    expect(delay).toBeGreaterThanOrEqual(3200);
    expect(delay).toBeLessThanOrEqual(4800);

    // successful reconnect resets counter
    eventListeners["open"]?.forEach((cb) => cb());
    expect(socket._retryCount).toBe(0);

    // subsequent disconnect starts again at 1 second
    socket._retryCount = 1;
    delay = socket._getNextDelay();
    expect(delay).toBeGreaterThanOrEqual(800);
    expect(delay).toBeLessThanOrEqual(1200);
  });
});
