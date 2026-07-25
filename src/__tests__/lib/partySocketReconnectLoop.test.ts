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
});
