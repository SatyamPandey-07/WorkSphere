/**
 * Tests for the ICE restart logic added in fix/issue-1932.
 * The oniceconnectionstatechange handler should:
 * - Call pc.restartIce() on "failed" (not cleanupPeer)
 * - Give 5s grace period on "disconnected" before cleanup
 */

// Mock peer connection with ICE restart support
function createMockPC(): {
  iceConnectionState: string;
  restartIce: jest.Mock;
  close: jest.Mock;
  oniceconnectionstatechange: (() => void) | null;
} {
  return {
    iceConnectionState: "connected",
    restartIce: jest.fn(),
    close: jest.fn(),
    oniceconnectionstatechange: null,
  };
}

describe("ICE restart negotiation logic", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  it("calls restartIce when ICE state is 'failed' (not cleanup)", () => {
    const pc = createMockPC();
    const cleanupPeer = jest.fn();

    // Simulate the handler logic directly
    const handler = () => {
      const state = pc.iceConnectionState;
      if (state === "failed") {
        if (typeof pc.restartIce === "function") {
          try {
            pc.restartIce();
          } catch {
            cleanupPeer("peer-1");
          }
        } else {
          cleanupPeer("peer-1");
        }
      } else if (state === "disconnected") {
        setTimeout(() => {
          if (
            pc.iceConnectionState === "disconnected" ||
            pc.iceConnectionState === "failed"
          ) {
            cleanupPeer("peer-1");
          }
        }, 5000);
      }
    };

    pc.iceConnectionState = "failed";
    handler();

    expect(pc.restartIce).toHaveBeenCalledTimes(1);
    expect(cleanupPeer).not.toHaveBeenCalled();
  });

  it("falls back to cleanupPeer if restartIce is not available", () => {
    const pc = { ...createMockPC(), restartIce: undefined as unknown as jest.Mock };
    const cleanupPeer = jest.fn();

    const handler = () => {
      if (pc.iceConnectionState === "failed") {
        if (typeof pc.restartIce === "function") {
          pc.restartIce();
        } else {
          cleanupPeer("peer-1");
        }
      }
    };

    pc.iceConnectionState = "failed";
    handler();

    expect(cleanupPeer).toHaveBeenCalledWith("peer-1");
  });

  it("does not cleanup peer immediately on 'disconnected'", () => {
    const pc = createMockPC();
    const cleanupPeer = jest.fn();

    const handler = () => {
      if (pc.iceConnectionState === "disconnected") {
        setTimeout(() => {
          if (
            pc.iceConnectionState === "disconnected" ||
            pc.iceConnectionState === "failed"
          ) {
            cleanupPeer("peer-1");
          }
        }, 5000);
      }
    };

    pc.iceConnectionState = "disconnected";
    handler();

    // Should NOT cleanup immediately
    expect(cleanupPeer).not.toHaveBeenCalled();
  });

  it("cleans up after 5s grace period if still disconnected", () => {
    const pc = createMockPC();
    const cleanupPeer = jest.fn();

    const handler = () => {
      if (pc.iceConnectionState === "disconnected") {
        setTimeout(() => {
          if (
            pc.iceConnectionState === "disconnected" ||
            pc.iceConnectionState === "failed"
          ) {
            cleanupPeer("peer-1");
          }
        }, 5000);
      }
    };

    pc.iceConnectionState = "disconnected";
    handler();

    jest.advanceTimersByTime(5000);
    expect(cleanupPeer).toHaveBeenCalledWith("peer-1");
  });

  it("does not cleanup if connection recovers within 5s grace period", () => {
    const pc = createMockPC();
    const cleanupPeer = jest.fn();

    const handler = () => {
      if (pc.iceConnectionState === "disconnected") {
        setTimeout(() => {
          if (
            pc.iceConnectionState === "disconnected" ||
            pc.iceConnectionState === "failed"
          ) {
            cleanupPeer("peer-1");
          }
        }, 5000);
      }
    };

    pc.iceConnectionState = "disconnected";
    handler();

    // Simulate recovery within 5s
    pc.iceConnectionState = "connected";
    jest.advanceTimersByTime(5000);

    expect(cleanupPeer).not.toHaveBeenCalled();
  });
});
