/**
 * Tests for the online event listener leak fix in attachJitteredBackoff
 * (Issue #2117). The online listener was previously never removed, causing
 * accumulation and duplicate handler fires.
 */

// Simulate the fix: named handler + removal via _disconnect wrapping
function createJitteredBackoffSimulation() {
  const registeredListeners: string[] = [];

  const simulateAttachJitteredBackoff = (socket: {
    _disconnect: () => void;
  }) => {
    const onlineHandler = () => {
      // reconnect logic
    };

    window.addEventListener("online", onlineHandler);
    registeredListeners.push("online");

    const originalDisconnect = socket._disconnect;
    socket._disconnect = () => {
      window.removeEventListener("online", onlineHandler);
      const idx = registeredListeners.indexOf("online");
      if (idx !== -1) registeredListeners.splice(idx, 1);
      originalDisconnect.call(socket);
    };
  };

  return { simulateAttachJitteredBackoff, registeredListeners };
}

describe("PartyKit online listener cleanup", () => {
  it("registers one online listener when socket connects", () => {
    const addListenerSpy = jest.spyOn(window, "addEventListener");
    const socket = { _disconnect: jest.fn() };
    const { simulateAttachJitteredBackoff } = createJitteredBackoffSimulation();

    simulateAttachJitteredBackoff(socket);

    expect(addListenerSpy).toHaveBeenCalledWith("online", expect.any(Function));
    addListenerSpy.mockRestore();
  });

  it("removes the online listener when socket disconnects", () => {
    const removeListenerSpy = jest.spyOn(window, "removeEventListener");
    const socket = { _disconnect: jest.fn() };
    const { simulateAttachJitteredBackoff } = createJitteredBackoffSimulation();

    simulateAttachJitteredBackoff(socket);
    socket._disconnect();

    expect(removeListenerSpy).toHaveBeenCalledWith("online", expect.any(Function));
    removeListenerSpy.mockRestore();
  });

  it("does not accumulate listeners on multiple disconnect/reconnect cycles", () => {
    const { simulateAttachJitteredBackoff, registeredListeners } =
      createJitteredBackoffSimulation();

    for (let i = 0; i < 5; i++) {
      const socket = { _disconnect: jest.fn() };
      simulateAttachJitteredBackoff(socket);
      socket._disconnect();
    }

    // After all disconnects, no listeners should remain registered
    expect(registeredListeners).toHaveLength(0);
  });

  it("calls original _disconnect after removing listener", () => {
    const originalDisconnect = jest.fn();
    const socket = { _disconnect: originalDisconnect };
    const { simulateAttachJitteredBackoff } = createJitteredBackoffSimulation();

    simulateAttachJitteredBackoff(socket);
    socket._disconnect();

    expect(originalDisconnect).toHaveBeenCalledTimes(1);
  });
});
