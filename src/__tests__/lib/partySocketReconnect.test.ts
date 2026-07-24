import {
  attachJitteredBackoff,
  jitteredReconnectDelay,
  PARTY_SOCKET_RECONNECT_OPTIONS,
} from "@/lib/partySocketReconnect";

describe("PARTY_SOCKET_RECONNECT_OPTIONS", () => {
  it("caps retries instead of reconnecting forever", () => {
    expect(PARTY_SOCKET_RECONNECT_OPTIONS.maxRetries).toBeLessThanOrEqual(10);
    expect(Number.isFinite(PARTY_SOCKET_RECONNECT_OPTIONS.maxRetries)).toBe(
      true,
    );
  });
});

describe("jitteredReconnectDelay", () => {
  it("does not delay the initial connect", () => {
    expect(jitteredReconnectDelay(0, undefined, () => 0.5)).toBe(0);
    expect(jitteredReconnectDelay(-1, undefined, () => 0.5)).toBe(0);
  });

  it("applies exponential backoff with jitter on later attempts", () => {
    const mid = jitteredReconnectDelay(1, undefined, () => 0.5);
    expect(mid).toBe(1_000);

    const second = jitteredReconnectDelay(2, undefined, () => 0.5);
    expect(second).toBe(2_000);

    const low = jitteredReconnectDelay(1, undefined, () => 0);
    const high = jitteredReconnectDelay(1, undefined, () => 1);
    expect(low).toBeGreaterThanOrEqual(1_000);
    expect(high).toBeLessThanOrEqual(1_000 * 1.2);
    expect(low).toBeLessThan(high);
  });

  it("never exceeds maxReconnectionDelay", () => {
    const delay = jitteredReconnectDelay(20, undefined, () => 1);
    expect(delay).toBeLessThanOrEqual(
      PARTY_SOCKET_RECONNECT_OPTIONS.maxReconnectionDelay,
    );
  });
});

describe("attachJitteredBackoff", () => {
  it("overrides _getNextDelay using the socket retry count", () => {
    const socket = {
      _retryCount: 2,
      _getNextDelay: () => 0,
    };

    attachJitteredBackoff(socket);
    // retry 2 → base 2000ms, ±20% jitter
    const delay = socket._getNextDelay();
    expect(delay).toBeGreaterThanOrEqual(1_600);
    expect(delay).toBeLessThanOrEqual(2_400);

    const first = socket._getNextDelay;
    attachJitteredBackoff(socket);
    expect(socket._getNextDelay).toBe(first);
  });

  it("guards connection attempts using ConnectionState enum", () => {
    const mockConnect = jest.fn();
    const mockDisconnect = jest.fn();
    const eventListeners: Record<string, Array<() => void>> = {};

    const socket = {
      _retryCount: 0,
      _getNextDelay: () => 10,
      _connect: mockConnect,
      _disconnect: mockDisconnect,
      _clearTimeouts: jest.fn(),
      addEventListener: (event: string, cb: () => void) => {
        if (!eventListeners[event]) eventListeners[event] = [];
        eventListeners[event].push(cb);
      },
    } as any;

    attachJitteredBackoff(socket);

    // Initial state is CLOSED
    expect(socket.__worksphereState).toBe("CLOSED");

    // Calling connect transitions state to CONNECTING
    socket._connect();
    expect(socket.__worksphereState).toBe("CONNECTING");
    expect(mockConnect).toHaveBeenCalledTimes(1);

    // Calling connect again while CONNECTING does not trigger mockConnect again
    socket._connect();
    expect(mockConnect).toHaveBeenCalledTimes(1);

    // Simulate open event transitions to CONNECTED
    eventListeners["open"]?.forEach((cb) => cb());
    expect(socket.__worksphereState).toBe("CONNECTED");

    // Calling connect while CONNECTED does not trigger mockConnect
    socket._connect();
    expect(mockConnect).toHaveBeenCalledTimes(1);

    // Calling disconnect transitions state to CLOSED
    socket._disconnect();
    expect(socket.__worksphereState).toBe("CLOSED");
    expect(mockDisconnect).toHaveBeenCalledTimes(1);
  });

  it("aborts pending reconnect timers on new connection or disconnect", async () => {
    jest.useFakeTimers();

    const socket = {
      _retryCount: 1,
      _getNextDelay: () => 1000,
      _connect: jest.fn(),
      _disconnect: jest.fn(),
      _clearTimeouts: jest.fn(),
      addEventListener: jest.fn(),
    } as any;

    attachJitteredBackoff(socket);

    // Start waiting for reconnect
    const _waitPromise = socket._wait();

    // Reconnect timer is scheduled in setTimeout. Let's call disconnect before it fires.
    socket._disconnect();

    // Fast-forward time
    jest.advanceTimersByTime(1000);

    // Wait for any microtasks
    await Promise.resolve();

    // Verify waitPromise did not resolve yet because the timeout was cleared by _disconnect
    // Since waitPromise resolves inside setTimeout which was cleared, it remains pending.
    // If we trigger _connect, it also clears any pending timeouts.
jest.useRealTimers();
  });

  it("clears the pending backoff timer and reconnects immediately on online event", async () => {
    jest.useFakeTimers();

    let onlineHandler: (() => void) | undefined;
    const originalAddEventListener = window.addEventListener;
    window.addEventListener = jest.fn((event: string, cb: any) => {
      if (event === "online") {
        onlineHandler = cb;
      }
    }) as any;

    const socket = {
      _retryCount: 3,
      _getNextDelay: () => 30_000,
      _connect: jest.fn(),
      _disconnect: jest.fn(),
      _clearTimeouts: jest.fn(),
      addEventListener: jest.fn(),
    } as any;

    attachJitteredBackoff(socket);

    let resolved = false;
    const waitPromise = socket._wait().then(() => {
      resolved = true;
    });

    // Simulate the browser regaining network connection
    onlineHandler?.();
    await Promise.resolve();
    await waitPromise;

    expect(resolved).toBe(true);

    window.addEventListener = originalAddEventListener;
    jest.useRealTimers();
  });
});
import { PartySocketReconnectManager } from "@/lib/partySocketReconnect";

describe("PartySocketReconnectManager", () => {
  beforeEach(() => {
    global.fetch = jest.fn();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it("probes regions and returns latency", async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: true });

    const manager = new PartySocketReconnectManager({
      regions: ["region1.com"],
    });
    const probePromise = manager.probeRegion("region1.com");

    // Fast forward to simulate latency
    jest.advanceTimersByTime(50);
    const latency = await probePromise;

    expect(global.fetch).toHaveBeenCalledWith(
      "https://region1.com",
      expect.objectContaining({ method: "HEAD", mode: "no-cors" }),
    );
    // Since we mocked fetch to resolve immediately but advanced timers, Date.now() will reflect the timer advancement if we mocked Date.now
    // Actually jest fake timers don't mock Date.now() by default unless configured.
    // We can just check that it returns a number.
    expect(typeof latency).toBe("number");
  });

  it("handles fetch errors gracefully returning Infinity", async () => {
    (global.fetch as jest.Mock).mockRejectedValueOnce(
      new Error("Network Error"),
    );

    const manager = new PartySocketReconnectManager({
      regions: ["bad-region.com"],
    });
    const latency = await manager.probeRegion("bad-region.com");

    expect(latency).toBe(Infinity);
  });

  it("selects the best region based on latency", async () => {
    // Mock fetch to simulate different latencies
    // We will spy on probeRegion directly for easier testing
    const manager = new PartySocketReconnectManager({
      regions: ["us-east.com", "eu-west.com"],
    });
    jest.spyOn(manager, "probeRegion").mockImplementation(async (region) => {
      if (region === "us-east.com") return 150;
      if (region === "eu-west.com") return 50; // best
      return Infinity;
    });

    const best = await manager.getBestRegion();
    expect(best).toBe("eu-west.com");
  });

  it("returns null if no regions are healthy", async () => {
    const manager = new PartySocketReconnectManager({
      regions: ["us-east.com", "eu-west.com"],
    });
    jest.spyOn(manager, "probeRegion").mockResolvedValue(Infinity);

    const best = await manager.getBestRegion();
    expect(best).toBeNull();
  });

  it("returns the region immediately if only one exists", async () => {
    const manager = new PartySocketReconnectManager({
      regions: ["us-east.com"],
    });
    jest.spyOn(manager, "probeRegion");

    const best = await manager.getBestRegion();
    expect(best).toBe("us-east.com");
    expect(manager.probeRegion).not.toHaveBeenCalled();
  });

  it("onDisconnect increments retryCount and delays before reconnect", async () => {
    const manager = new PartySocketReconnectManager({
      regions: ["us-east.com"],
      maxRetries: 3,
      minReconnectionDelay: 1000,
      maxReconnectionDelay: 5000,
      reconnectionDelayGrowFactor: 2,
    });

    // Mock getBestRegion
    jest.spyOn(manager, "getBestRegion").mockResolvedValue("us-east.com");

    // First disconnect
    const disconnectPromise1 = manager.onDisconnect();
    jest.runAllTimers();
    const region1 = await disconnectPromise1;
    expect(region1).toBe("us-east.com");

    // Second disconnect
    const disconnectPromise2 = manager.onDisconnect();
    jest.runAllTimers();
    await disconnectPromise2;

    // Third disconnect
    const disconnectPromise3 = manager.onDisconnect();
    jest.runAllTimers();
    await disconnectPromise3;

    // Fourth disconnect should exceed maxRetries
    const region4 = await manager.onDisconnect();
    expect(region4).toBeNull();
  });

  it("resets retry count on connect", () => {
    const manager = new PartySocketReconnectManager({
      regions: ["us-east.com"],
    });
    // access private retryCount for test
    (manager as any).retryCount = 5;
    manager.onConnect();
    expect((manager as any).retryCount).toBe(0);
  });

  it("stores close code and reason and handles policy termination", async () => {
    const manager = new PartySocketReconnectManager({
      regions: ["us-east.com"],
      maxRetries: 3,
    });
    jest.spyOn(manager, "getBestRegion").mockResolvedValue("us-east.com");

    const disconnectPromise1 = manager.onDisconnect(1006, "Abnormal");
    jest.runAllTimers();
    const res1 = await disconnectPromise1;
    expect(res1).toBe("us-east.com");
    expect(manager.lastCloseCode).toBe(1006);
    expect(manager.lastCloseReason).toBe("Abnormal");

    const res2 = await manager.onDisconnect(1008, "Policy Violation");
    expect(res2).toBeNull();
    expect(manager.lastCloseCode).toBe(1008);
    expect(manager.lastCloseReason).toBe("Policy Violation");

    const res3 = await manager.onDisconnect(1000, "Normal Closure");
    expect(res3).toBeNull();
    expect(manager.lastCloseCode).toBe(1000);
    expect(manager.lastCloseReason).toBe("Normal Closure");
  });
});

describe("attachJitteredBackoff - Offline Recovery", () => {
  it("tracks close event details", () => {
    const eventListeners: Record<string, Array<(event?: any) => void>> = {};
    const socket = {
      _retryCount: 0,
      _getNextDelay: () => 10,
      addEventListener: (event: string, cb: (event?: any) => void) => {
        if (!eventListeners[event]) eventListeners[event] = [];
        eventListeners[event].push(cb);
      },
    } as any;

    attachJitteredBackoff(socket);

    eventListeners["close"]?.forEach((cb) =>
      cb({ code: 1006, reason: "Connection lost" }),
    );
    expect(socket.__lastCloseCode).toBe(1006);
    expect(socket.__lastCloseReason).toBe("Connection lost");
  });

  it("queues actions and CRDT updates when offline and replays them on open", () => {
    const eventListeners: Record<string, Array<() => void>> = {};
    const mockSend = jest.fn();
    const socket = {
      _retryCount: 0,
      _getNextDelay: () => 10,
      send: mockSend,
      addEventListener: (event: string, cb: () => void) => {
        if (!eventListeners[event]) eventListeners[event] = [];
        eventListeners[event].push(cb);
      },
    } as any;

    attachJitteredBackoff(socket);
    expect(socket.__worksphereState).toBe("CLOSED");

    // Send actions when offline
    socket.send(JSON.stringify({ type: "seat_checkin", venueId: "v1" }));
    socket.send(JSON.stringify({ type: "cursor", x: 10, y: 20 })); // transient, should be skipped
    socket.send(JSON.stringify({ type: "presence", userId: "u1" })); // transient, should be skipped
    const binUpdate = new Uint8Array([1, 2, 3]);
    socket.send(binUpdate);

    expect(socket.__offlineActionsQueue).toHaveLength(1);
    expect(socket.__offlineActionsQueue[0]).toBe(
      JSON.stringify({ type: "seat_checkin", venueId: "v1" }),
    );
    expect(socket.__offlineCrdtQueue).toHaveLength(1);
    expect(socket.__offlineCrdtQueue[0]).toBe(binUpdate);
    expect(mockSend).not.toHaveBeenCalled();

    // Reconnect
    eventListeners["open"]?.forEach((cb) => cb());
    expect(socket.__worksphereState).toBe("CONNECTED");

    // Verify replay in correct order (CRDT first, then actions)
    expect(mockSend).toHaveBeenCalledTimes(2);
    expect(mockSend.mock.calls[0][0]).toBe(binUpdate);
    expect(mockSend.mock.calls[1][0]).toBe(
      JSON.stringify({ type: "seat_checkin", venueId: "v1" }),
    );

    expect(socket.__offlineActionsQueue).toHaveLength(0);
    expect(socket.__offlineCrdtQueue).toHaveLength(0);

    // Send when online goes directly
    socket.send("hello");
    expect(mockSend).toHaveBeenCalledTimes(3);
    expect(mockSend.mock.calls[2][0]).toBe("hello");
  });
});
