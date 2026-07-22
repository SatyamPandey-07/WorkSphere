import {
  attachJitteredBackoff,
  jitteredReconnectDelay,
  PARTY_SOCKET_RECONNECT_OPTIONS,
} from "@/lib/partySocketReconnect";

describe("PARTY_SOCKET_RECONNECT_OPTIONS", () => {
  it("caps retries instead of reconnecting forever", () => {
    expect(PARTY_SOCKET_RECONNECT_OPTIONS.maxRetries).toBeLessThanOrEqual(10);
    expect(
      Number.isFinite(PARTY_SOCKET_RECONNECT_OPTIONS.maxRetries),
    ).toBe(true);
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
});
