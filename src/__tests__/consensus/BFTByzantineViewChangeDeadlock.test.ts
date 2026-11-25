import {
  BFTConsensusCoordinator,
  QuorumCertificate,
  ViewChangeMessage,
  createTestValidatorKeySet,
} from "../../core/consensus/BFTConsensusCoordinator";

describe("Issue #10124 - Prevent Byzantine view-change deadlocks when validator signature verifications fail intermittently", () => {
  const validators = ["node-0", "node-1", "node-2", "node-3"];
  const testKeys = createTestValidatorKeySet(validators);

  function createSignedViewChange(
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
    return {
      fromNodeId: from,
      newView,
      lastCommitQC,
      signature,
      timestamp: Date.now(),
    };
  }

  it("rejects an invalid/corrupt signature from a Byzantine validator without stalling the round, allowing honest quorum to complete view change", () => {
    const coordinator = new BFTConsensusCoordinator({
      nodeId: "node-0",
      validators,
      validatorPublicKeys: testKeys.publicKeys,
      signer: testKeys.signers["node-0"],
    });

    expect(coordinator.getCurrentView()).toBe(0);
    expect(coordinator.getCurrentLeader()).toBe("node-0");

    // Honest validator node-1 sends valid view-change for view 1
    const vc1 = createSignedViewChange("node-1", 1);
    const res1 = coordinator.handleViewChange(vc1);
    expect(res1).toBeNull();
    expect(coordinator.getCurrentView()).toBe(0);

    // Byzantine validator node-2 sends a corrupt/invalid signature
    const corruptVc: ViewChangeMessage = {
      fromNodeId: "node-2",
      newView: 1,
      signature: "00".repeat(64), // Corrupt 64-byte Ed25519 signature
      timestamp: Date.now(),
    };
    const resCorrupt = coordinator.handleViewChange(corruptVc);
    // Coordinator rejects the invalid signature and does not advance view
    expect(resCorrupt).toBeNull();
    expect(coordinator.getCurrentView()).toBe(0);

    // Round remains active; honest validator node-3 sends valid view-change
    const vc3 = createSignedViewChange("node-3", 1);
    const res3 = coordinator.handleViewChange(vc3);
    expect(res3).toBeNull();
    expect(coordinator.getCurrentView()).toBe(0);

    // Honest coordinator itself triggers view change (node-0) reaching 2f + 1 (3 honest: node-1, node-3, node-0)
    coordinator.triggerViewChange("timeout", 1);
    expect(coordinator.getCurrentView()).toBe(1);
    expect(coordinator.getCurrentLeader()).toBe("node-1");
  });

  it("handles signature verification throwing an exception gracefully and continues processing remaining validators", () => {
    const coordinator = new BFTConsensusCoordinator({
      nodeId: "node-0",
      validators,
      validatorPublicKeys: testKeys.publicKeys,
      signer: testKeys.signers["node-0"],
      verifier: {
        verify: (nodeId, _payload, _signature) => {
          if (nodeId === "node-2") {
            throw new Error("Transient cryptographic worker failure / hardware enclave error");
          }
          // Honest verification using standard Ed25519 check
          return true;
        },
      },
    });

    // Honest node-1
    expect(coordinator.handleViewChange(createSignedViewChange("node-1", 1))).toBeNull();

    // Node-2 verification throws an exception
    const vc2 = createSignedViewChange("node-2", 1);
    expect(() => coordinator.handleViewChange(vc2)).not.toThrow();
    expect(coordinator.getCurrentView()).toBe(0);

    // Honest node-3 arrives afterward
    expect(coordinator.handleViewChange(createSignedViewChange("node-3", 1))).toBeNull();
    expect(coordinator.getCurrentView()).toBe(0);

    // Honest node-0 triggers view change to reach 2f + 1 quorum
    coordinator.triggerViewChange("manual", 1);
    expect(coordinator.getCurrentView()).toBe(1);
    expect(coordinator.getCurrentLeader()).toBe("node-1");
  });

  it("ensures duplicate or repeated signature submissions do not corrupt quorum accounting", () => {
    const coordinator = new BFTConsensusCoordinator({
      nodeId: "node-0",
      validators,
      validatorPublicKeys: testKeys.publicKeys,
      signer: testKeys.signers["node-0"],
    });

    const vc1 = createSignedViewChange("node-1", 1);

    // Node-1 submits duplicate valid messages
    expect(coordinator.handleViewChange(vc1)).toBeNull();
    expect(coordinator.handleViewChange(vc1)).toBeNull();
    expect(coordinator.handleViewChange(vc1)).toBeNull();

    // Node-2 submits corrupt signature multiple times
    const corruptVc: ViewChangeMessage = {
      fromNodeId: "node-2",
      newView: 1,
      signature: "deadbeef".repeat(16),
      timestamp: Date.now(),
    };
    expect(coordinator.handleViewChange(corruptVc)).toBeNull();
    expect(coordinator.handleViewChange(corruptVc)).toBeNull();

    // Quorum should still NOT be reached (only node-1 is valid, count = 1, need 3)
    expect(coordinator.getCurrentView()).toBe(0);

    // Valid node-2 and node-3 arrive to complete quorum
    expect(coordinator.handleViewChange(createSignedViewChange("node-2", 1))).toBeNull();
    const transition = coordinator.handleViewChange(createSignedViewChange("node-3", 1));

    expect(transition).toEqual({
      newLeader: "node-1",
      view: 1,
    });
    expect(coordinator.getCurrentView()).toBe(1);
  });

  it("preserves timeout and backoff behavior when quorum cannot be reached due to Byzantine faults", () => {
    jest.useFakeTimers();
    try {
      const onViewChangeBroadcast = jest.fn();
      const coordinator = new BFTConsensusCoordinator({
        nodeId: "node-1",
        validators,
        validatorPublicKeys: testKeys.publicKeys,
        signer: testKeys.signers["node-1"],
        viewChangeTimeoutMs: 1000,
        onViewChangeBroadcast,
      });

      coordinator.startViewTimer();

      // View 0 times out -> coordinator broadcasts ViewChangeMessage for view 1
      jest.advanceTimersByTime(1000);
      expect(onViewChangeBroadcast).toHaveBeenCalledTimes(1);
      expect(coordinator.getConsecutiveFailedViews()).toBe(1);
      expect(coordinator.getCurrentViewTimeoutMs()).toBe(2000);

      // Node-2 sends corrupt signature
      const corruptVc: ViewChangeMessage = {
        fromNodeId: "node-2",
        newView: 1,
        signature: "bad-signature".padEnd(128, "0"),
        timestamp: Date.now(),
      };
      coordinator.handleViewChange(corruptVc);

      // No other honest nodes arrive in time -> view 1 times out as well
      jest.advanceTimersByTime(2000);
      expect(onViewChangeBroadcast).toHaveBeenCalledTimes(2);
      expect(coordinator.getConsecutiveFailedViews()).toBe(2);
      expect(coordinator.getCurrentViewTimeoutMs()).toBe(4000);

      // Timeout backoff mechanism continues working correctly
      const broadcastViews = onViewChangeBroadcast.mock.calls.map(
        (c) => (c[0] as ViewChangeMessage).newView,
      );
      expect(broadcastViews).toEqual([1, 2]);

      coordinator.dispose();
    } finally {
      jest.useRealTimers();
    }
  });

  it("handles transient failure recovery: validator retry with valid signature succeeds after failure", () => {
    let transientFail = true;
    const coordinator = new BFTConsensusCoordinator({
      nodeId: "node-0",
      validators,
      validatorPublicKeys: testKeys.publicKeys,
      signer: testKeys.signers["node-0"],
      verifier: {
        verify: (nodeId, _payload, _signature) => {
          if (nodeId === "node-2" && transientFail) {
            return false; // Transient signature verification error
          }
          return true;
        },
      },
    });

    const vc1 = createSignedViewChange("node-1", 1);
    const vc2 = createSignedViewChange("node-2", 1);

    expect(coordinator.handleViewChange(vc1)).toBeNull();

    // Node-2 first attempt fails due to transient issue
    expect(coordinator.handleViewChange(vc2)).toBeNull();
    expect(coordinator.getCurrentView()).toBe(0);

    // Transient issue resolves; node-2 retries
    transientFail = false;
    expect(coordinator.handleViewChange(vc2)).toBeNull();

    // Node-3 arrives -> completes quorum
    const vc3 = createSignedViewChange("node-3", 1);
    const res = coordinator.handleViewChange(vc3);
    expect(res).toEqual({
      newLeader: "node-1",
      view: 1,
    });
    expect(coordinator.getCurrentView()).toBe(1);
  });
});
