import {
  BFTConsensusCoordinator,
  QuorumCertificate,
  ViewChangeMessage,
  createTestValidatorKeySet,
} from "../../core/consensus/BFTConsensusCoordinator";

const validators = ["node-0", "node-1", "node-2", "node-3"];
const testKeys = createTestValidatorKeySet(validators);

function vcMsg(
  from: string,
  newView: number,
  lastCommitQC?: QuorumCertificate,
): ViewChangeMessage {
  const payload = BFTConsensusCoordinator.formatViewChangePayload(
    from,
    newView,
    lastCommitQC,
  );
  const signature = testKeys.signers[from].sign(payload);
  return { fromNodeId: from, newView, signature, timestamp: Date.now() };
}

describe("BFTConsensusCoordinator view-change timeout and leader rotation", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it("uses 5s base timeout and 30s ceiling by default", () => {
    const c = new BFTConsensusCoordinator({
      nodeId: "node-1",
      validators,
      validatorPublicKeys: testKeys.publicKeys,
      signer: testKeys.signers["node-1"],
    });
    expect(c.getCurrentViewTimeoutMs()).toBe(5000);
    expect(c.maxViewChangeTimeoutMs).toBe(30000);
  });

  it("broadcasts a signed ViewChangeMessage when the leader fails to propose in time", () => {
    const onViewChangeBroadcast = jest.fn();
    const c = new BFTConsensusCoordinator({
      nodeId: "node-1",
      validators,
      validatorPublicKeys: testKeys.publicKeys,
      signer: testKeys.signers["node-1"],
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
    expect(msg.signature).toHaveLength(128); // 64-byte Ed25519 signature in hex
    expect(c.verifyViewChangeSignature(msg)).toBe(true);
    c.dispose();
  });

  it("elects the next round-robin leader once 2f+1 view-change messages arrive", () => {
    const c = new BFTConsensusCoordinator({
      nodeId: "node-1",
      validators,
      validatorPublicKeys: testKeys.publicKeys,
      signer: testKeys.signers["node-1"],
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
      validatorPublicKeys: testKeys.publicKeys,
      signer: testKeys.signers["node-1"],
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
      validatorPublicKeys: testKeys.publicKeys,
      signer: testKeys.signers["node-1"],
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
      validatorPublicKeys: testKeys.publicKeys,
      signer: testKeys.signers["node-1"],
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
        validatorPublicKeys: testKeys.publicKeys,
        signer: testKeys.signers[id],
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
      validatorPublicKeys: testKeys.publicKeys,
      signer: testKeys.signers["node-1"],
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
    const onViewChangeBroadcast = jest.fn(() => coordinator.stopViewTimer());
    const coordinator: BFTConsensusCoordinator = new BFTConsensusCoordinator({
      nodeId: "node-1",
      validators,
      validatorPublicKeys: testKeys.publicKeys,
      signer: testKeys.signers["node-1"],
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
    const onViewChangeBroadcast = jest.fn(() => coordinator.dispose());
    const coordinator: BFTConsensusCoordinator = new BFTConsensusCoordinator({
      nodeId: "node-1",
      validators,
      validatorPublicKeys: testKeys.publicKeys,
      signer: testKeys.signers["node-1"],
      viewChangeTimeoutMs: 1000,
      onViewChangeBroadcast,
    });

    coordinator.startViewTimer();
    jest.advanceTimersByTime(1000);
    jest.advanceTimersByTime(10000);

    expect(onViewChangeBroadcast).toHaveBeenCalledTimes(1);
  });

  it("rejects uncertified future-view proposals from rotated leader after timeout", () => {
    const c = new BFTConsensusCoordinator({
      nodeId: "node-2",
      validators,
      validatorPublicKeys: testKeys.publicKeys,
      signer: testKeys.signers["node-2"],
    });

    // Node-1 is leader for view 1
    const uncertifiedProposal = {
      view: 1,
      sequence: 1,
      proposerId: "node-1",
      payload: { tx: "rotated-leader-proposal" },
      parentHash:
        "0000000000000000000000000000000000000000000000000000000000000000",
      timestamp: Date.now(),
    };
    const blockHash = BFTConsensusCoordinator.hashPayload(uncertifiedProposal);

    // Node-2 is still on view 0, receives proposal without viewChangeEvidence
    const vote = c.handleProposal({
      ...uncertifiedProposal,
      blockHash,
    });

    expect(vote).toBeNull();
    expect(c.getCurrentView()).toBe(0);
    c.dispose();
  });

  it("accepts certified proposals from rotated leader after pacemaker view change", () => {
    const c = new BFTConsensusCoordinator({
      nodeId: "node-2",
      validators,
      validatorPublicKeys: testKeys.publicKeys,
      signer: testKeys.signers["node-2"],
    });

    // Certified with 3 ViewChangeMessages for view 1
    const vcMsgs = [vcMsg("node-0", 1), vcMsg("node-1", 1), vcMsg("node-2", 1)];

    const certifiedProposal = {
      view: 1,
      sequence: 1,
      proposerId: "node-1",
      payload: { tx: "certified-rotated-leader-proposal" },
      parentHash:
        "0000000000000000000000000000000000000000000000000000000000000000",
      timestamp: Date.now(),
    };
    const blockHash = BFTConsensusCoordinator.hashPayload(certifiedProposal);

    const vote = c.handleProposal({
      ...certifiedProposal,
      blockHash,
      viewChangeEvidence: vcMsgs,
    });

    expect(vote).not.toBeNull();
    expect(vote?.phase).toBe("PREPARE");
    expect(vote?.view).toBe(1);
    expect(c.getCurrentView()).toBe(1);
    expect(c.getCurrentLeader()).toBe("node-1");
    c.dispose();
  });
});
