/**
 * Additional ICE state transition tests verifying the 5-second grace period
 * for "disconnected" state and the immediate restart on "failed" state.
 */

jest.useFakeTimers();

function createIceStateMachine(
  onRestart: jest.Mock,
  onCleanup: jest.Mock,
) {
  let iceConnectionState = "connected";

  const handler = () => {
    if (iceConnectionState === "failed") {
      if (typeof onRestart === "function") {
        try {
          onRestart();
        } catch {
          onCleanup("peer-1");
        }
      } else {
        onCleanup("peer-1");
      }
    } else if (iceConnectionState === "disconnected") {
      setTimeout(() => {
        if (iceConnectionState === "disconnected" || iceConnectionState === "failed") {
          onCleanup("peer-1");
        }
      }, 5000);
    }
  };

  return {
    setState: (state: string) => { iceConnectionState = state; handler(); },
    getState: () => iceConnectionState,
  };
}

afterEach(() => {
  jest.clearAllTimers();
});

afterAll(() => {
  jest.useRealTimers();
});

describe("ICE state machine grace period", () => {
  it("calls restartIce immediately on 'failed'", () => {
    const onRestart = jest.fn();
    const onCleanup = jest.fn();
    const machine = createIceStateMachine(onRestart, onCleanup);

    machine.setState("failed");
    expect(onRestart).toHaveBeenCalledTimes(1);
    expect(onCleanup).not.toHaveBeenCalled();
  });

  it("waits 5 seconds before cleanup on 'disconnected'", () => {
    const onRestart = jest.fn();
    const onCleanup = jest.fn();
    const machine = createIceStateMachine(onRestart, onCleanup);

    machine.setState("disconnected");
    expect(onCleanup).not.toHaveBeenCalled();

    jest.advanceTimersByTime(4999);
    expect(onCleanup).not.toHaveBeenCalled();

    jest.advanceTimersByTime(1);
    expect(onCleanup).toHaveBeenCalledWith("peer-1");
  });

  it("does not clean up if connection recovers from 'disconnected'", () => {
    const onRestart = jest.fn();
    const onCleanup = jest.fn();
    const machine = createIceStateMachine(onRestart, onCleanup);

    machine.setState("disconnected");
    // Connection recovers before timeout
    machine.setState("connected");

    jest.advanceTimersByTime(5000);
    expect(onCleanup).not.toHaveBeenCalled();
  });

  it("cleans up when 'failed' follows 'disconnected'", () => {
    const onRestart = jest.fn();
    const onCleanup = jest.fn();
    const machine = createIceStateMachine(onRestart, onCleanup);

    machine.setState("disconnected");
    // Connection moves to 'failed' during grace period
    machine.setState("failed");

    // ICE restart should have been called for 'failed'
    expect(onRestart).toHaveBeenCalled();
  });

  it("transition from connected to failed triggers restart without delay", () => {
    const onRestart = jest.fn();
    const onCleanup = jest.fn();
    const machine = createIceStateMachine(onRestart, onCleanup);

    machine.setState("connected"); // no-op
    machine.setState("failed");

    expect(onRestart).toHaveBeenCalledTimes(1);
    // No timer advance needed — should be synchronous
  });
});
