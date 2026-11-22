import {
  BFTConsensusCoordinator,
  QuorumCertificate,
  ViewChangeMessage,
} from "../../core/consensus/BFTConsensusCoordinator";

const validators = ["node-0", "node-1", "node-2", "node-3"];

function vcMsg(from: string, newView: number): ViewChangeMessage {
  return { fromNodeId: from, newView, signature: "sig", timestamp: Date.now() };
}

describe("BFTConsensusCoordinator view-change timeout and leader rotation", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it("uses 5s base timeout and 30s ceiling by default", () => {
    const c = new BFTConsensusCoordinator({ nodeId: "node-1", validators });
    expect(c.getCurrentViewTimeoutMs()).toBe(5000);
    expect(c.maxViewChangeTimeoutMs).toBe(30000);
  });

  it("broadcasts a signed ViewChangeMessage when the leader fails to propose in time", () => {
    const onViewChangeBroadcast = jest.fn();
    const c = new BFTConsensusCoordinator({
      nodeId: "node-1",
      validators,
      onViewChangeBroadcast,
    });
    c.startViewTimer();

    jest.advanceTimersByTime(4999);
    expect(onViewChangeBroadcast).not.toHaveBeenCalled();

    jest.advanceTimersByTime(1);
    expect(onViewChangeBroadcast).toHaveBeenCalledTimes(1);
    const msg = onViewChangeBroadcast.mock.calls[0][0] as ViewChangeMessage;
    expect(msg.fromNodeId).toBe("node-1");
    expect(msg.newView).toBe(1);
    expect(msg.signature).toHaveLength(64);
    c.dispose();
  });

  it("elects the next round-robin leader once 2f+1 view-change messages arrive", () => {
    const c = new BFTConsensusCoordinator({
      nodeId: "node-1",
      validators,
      onViewChangeBroadcast: jest.fn(),
    });
    c.startViewTimer();
    jest.advanceTimersByTime(5000); // own message counted: 1 of 3

    expect(c.getCurrentLeader()).toBe("node-0");
    expect(c.handleViewChange(vcMsg("node-2", 1))).toBeNull();
    expect(c.handleViewChange(vcMsg("node-3", 1))).toEqual({
      newLeader: "node-1",
      view: 1,
    });
    expect(c.getCurrentView()).toBe(1);
    expect(c.getCurrentLeader()).toBe("node-1");
    c.dispose();
  });

  it("doubles the timeout on consecutive failed views and requests successive views", () => {
    const onViewChangeBroadcast = jest.fn();
    const c = new BFTConsensusCoordinator({
      nodeId: "node-1",
      validators,
      viewChangeTimeoutMs: 1000,
      onViewChangeBroadcast,
    });
    c.startViewTimer();

    jest.advanceTimersByTime(1000);
    expect(c.getCurrentViewTimeoutMs()).toBe(2000);
    jest.advanceTimersByTime(2000);
    expect(c.getCurrentViewTimeoutMs()).toBe(4000);

    const views = onViewChangeBroadcast.mock.calls.map(
      (call) => (call[0] as ViewChangeMessage).newView,
    );
    expect(views).toEqual([1, 2]);
    expect(c.getConsecutiveFailedViews()).toBe(2);
    c.dispose();
  });

  it("caps the backed-off timeout at the 30s ceiling", () => {
    const c = new BFTConsensusCoordinator({
      nodeId: "node-1",
      validators,
      viewChangeTimeoutMs: 10000,
      onViewChangeBroadcast: jest.fn(),
    });
    c.startViewTimer();

    jest.advanceTimersByTime(10000);
    expect(c.getCurrentViewTimeoutMs()).toBe(20000);
    jest.advanceTimersByTime(20000);
    expect(c.getCurrentViewTimeoutMs()).toBe(30000);
    jest.advanceTimersByTime(30000);
    expect(c.getCurrentViewTimeoutMs()).toBe(30000);
    c.dispose();
  });

  it("resets the backoff after a block commits (recovery)", () => {
    const c = new BFTConsensusCoordinator({
      nodeId: "node-1",
      validators,
      viewChangeTimeoutMs: 1000,
      onViewChangeBroadcast: jest.fn(),
    });
    c.startViewTimer();
    jest.advanceTimersByTime(1000);
    jest.advanceTimersByTime(2000);
    expect(c.getCurrentViewTimeoutMs()).toBe(4000);

    const hash = "ab".repeat(32);
    const signatures: Record<string, string> = {};
    for (const id of ["node-0", "node-1", "node-2"]) {
      signatures[id] = new BFTConsensusCoordinator({
        nodeId: id,
        validators,
      }).createVote("COMMIT", hash).signature;
    }
    const qc: QuorumCertificate = {
      view: 0,
      sequence: 0,
      blockHash: hash,
      phase: "COMMIT",
      signatures,
      aggregatedAt: Date.now(),
    };
    (
      c as unknown as { advancePhaseOnQC: (q: QuorumCertificate) => void }
    ).advancePhaseOnQC(qc);

    expect(c.getCurrentViewTimeoutMs()).toBe(1000);
    expect(c.getConsecutiveFailedViews()).toBe(0);
    c.dispose();
  });

  it("does not fire after stopViewTimer or dispose", () => {
    const onViewChangeBroadcast = jest.fn();
    const c = new BFTConsensusCoordinator({
      nodeId: "node-1",
      validators,
      onViewChangeBroadcast,
    });
    c.startViewTimer();
    c.stopViewTimer();
    jest.advanceTimersByTime(60000);
    expect(onViewChangeBroadcast).not.toHaveBeenCalled();

    c.startViewTimer();
    c.dispose();
    jest.advanceTimersByTime(60000);
    expect(onViewChangeBroadcast).not.toHaveBeenCalled();
  });

  it("does not restart a timer when the timeout callback stops it", () => {
    let coordinator: BFTConsensusCoordinator;
    const onViewChangeBroadcast = jest.fn(() => coordinator.stopViewTimer());
    coordinator = new BFTConsensusCoordinator({
      nodeId: "node-1",
      validators,
      viewChangeTimeoutMs: 1000,
      onViewChangeBroadcast,
    });

    coordinator.startViewTimer();
    jest.advanceTimersByTime(1000);
    jest.advanceTimersByTime(10000);

    expect(onViewChangeBroadcast).toHaveBeenCalledTimes(1);
    coordinator.dispose();
  });

  it("does not resurrect a timer when the timeout callback disposes the coordinator", () => {
    let coordinator: BFTConsensusCoordinator;
    const onViewChangeBroadcast = jest.fn(() => coordinator.dispose());
    coordinator = new BFTConsensusCoordinator({
      nodeId: "node-1",
      validators,
      viewChangeTimeoutMs: 1000,
      onViewChangeBroadcast,
    });

    coordinator.startViewTimer();
    jest.advanceTimersByTime(1000);
    jest.advanceTimersByTime(10000);

    expect(onViewChangeBroadcast).toHaveBeenCalledTimes(1);
  });

});
