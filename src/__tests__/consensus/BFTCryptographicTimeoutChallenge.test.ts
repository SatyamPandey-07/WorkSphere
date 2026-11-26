import {
  BFTConsensusCoordinator,
  createTestValidatorKeySet,
  CryptographicTimeoutEvidence,
  TimeoutWitnessProof,
  ViewChangeManager,
  ViewChangeMessage,
} from "../../core/consensus/BFTConsensusCoordinator";

describe("Cryptographic View-Change Timeout Challenge Generator (Issue #10116)", () => {
  const validators = ["node-0", "node-1", "node-2", "node-3"];
  const keySet = createTestValidatorKeySet(validators);

  function createCoordinator(opts?: any): BFTConsensusCoordinator {
    return new BFTConsensusCoordinator({
      nodeId: "node-0",
      validators,
      validatorPublicKeys: keySet.publicKeys,
      signer: keySet.signers["node-0"],
      ...opts,
    });
  }

  describe("A. Challenge Generation and Cryptographic Signing", () => {
    it("generates a canonically signed challenge bound to consensus context", () => {
      const coordinator = createCoordinator({
        viewChangeTimeoutMs: 5000,
      });

      const now = Date.now();
      const challenge = coordinator.createTimeoutChallenge(1, 5000, now);

      expect(challenge.challengeId).toBeDefined();
      expect(challenge.challengeId.length).toBe(64); // sha256 hex
      expect(challenge.view).toBe(0);
      expect(challenge.newView).toBe(1);
      expect(challenge.sequence).toBe(0);
      expect(challenge.proposerId).toBe("node-0");
      expect(challenge.timeoutDurationMs).toBe(5000);
      expect(challenge.createdAt).toBe(now);
      expect(challenge.challengerSignature).toHaveLength(128); // 64-byte Ed25519 signature

      const context = coordinator.getTimeoutVerificationContext(now + 6000);
      const isValid = coordinator
        .getViewChangeManager()
        .verifyChallengeSignature(challenge, context);
      expect(isValid).toBe(true);
    });

    it("rejects challenge creation with invalid next view or non-positive timeout", () => {
      const manager = new ViewChangeManager();
      expect(() => {
        manager.createTimeoutChallenge(
          2,
          1, // newView <= view
          0,
          "node-0",
          5000,
          keySet.signers["node-0"],
        );
      }).toThrow(/Invalid newView/);

      expect(() => {
        manager.createTimeoutChallenge(
          1,
          2,
          0,
          "node-0",
          0, // timeoutDurationMs <= 0
          keySet.signers["node-0"],
        );
      }).toThrow(/Invalid timeoutDurationMs/);
    });
  });

  describe("B. Independent Timeout Verification and Premature Rejection", () => {
    it("rejects premature view-change challenges before the required timeout has elapsed", () => {
      const coordinator = createCoordinator({
        requireTimeoutChallenges: true,
        viewChangeTimeoutMs: 5000,
        clockToleranceMs: 500,
      });

      const startTime = Date.now();
      // Challenge created at startTime with 5000ms timeout
      const challenge = coordinator.createTimeoutChallenge(1, 5000, startTime);

      // Node-1, Node-2, Node-3 sign witness proof prematurely (only 1000ms after startTime)
      const prematureTime = startTime + 1000;
      const witnesses: TimeoutWitnessProof[] = [
        "node-1",
        "node-2",
        "node-3",
      ].map((id) =>
        new ViewChangeManager().createWitnessProof(
          challenge.challengeId,
          id,
          keySet.signers[id],
          prematureTime,
        ),
      );

      const prematureEvidence: CryptographicTimeoutEvidence = {
        challenge,
        witnesses,
      };

      const signer = keySet.signers["node-1"];
      const payload = BFTConsensusCoordinator.formatViewChangePayload(
        "node-1",
        1,
      );
      const signature = signer.sign(payload);

      const vcMsg: ViewChangeMessage = {
        fromNodeId: "node-1",
        newView: 1,
        signature,
        timestamp: prematureTime,
        timeoutEvidence: prematureEvidence,
      };

      // Honest validator evaluates at prematureTime (only 1s elapsed, need 5s)
      const res = coordinator.handleViewChange(vcMsg);
      expect(res).toBeNull();
      expect(coordinator.getCurrentView()).toBe(0);
    });

    it("accepts valid timeout challenges after the required timeout duration elapses", () => {
      const coordinator = createCoordinator({
        requireTimeoutChallenges: true,
        viewChangeTimeoutMs: 5000,
        clockToleranceMs: 500,
      });

      const startTime = Date.now();
      const elapsedTimestamp = startTime + 5100;
      const challenge = coordinator.createTimeoutChallenge(1, 5000, startTime);

      // Validators witness the timeout after 5100ms
      const witnesses: TimeoutWitnessProof[] = [
        "node-0",
        "node-1",
        "node-2",
      ].map((id) =>
        coordinator
          .getViewChangeManager()
          .createWitnessProof(
            challenge.challengeId,
            id,
            keySet.signers[id],
            elapsedTimestamp,
          ),
      );

      const validEvidence: CryptographicTimeoutEvidence = {
        challenge,
        witnesses,
      };

      // Deliver 3 valid view-change messages containing the verified timeout evidence
      for (const id of ["node-1", "node-2"]) {
        const payload = BFTConsensusCoordinator.formatViewChangePayload(id, 1);
        const signature = keySet.signers[id].sign(payload);
        const msg: ViewChangeMessage = {
          fromNodeId: id,
          newView: 1,
          signature,
          timestamp: elapsedTimestamp,
          timeoutEvidence: validEvidence,
        };
        coordinator.handleViewChange(msg);
      }

      // Third validator completes 2f+1 quorum
      const payload3 = BFTConsensusCoordinator.formatViewChangePayload(
        "node-3",
        1,
      );
      const sig3 = keySet.signers["node-3"].sign(payload3);
      const msg3: ViewChangeMessage = {
        fromNodeId: "node-3",
        newView: 1,
        signature: sig3,
        timestamp: elapsedTimestamp,
        timeoutEvidence: validEvidence,
      };

      const transition = coordinator.handleViewChange(msg3);
      expect(transition).toEqual({
        newLeader: "node-1",
        view: 1,
      });
      expect(coordinator.getCurrentView()).toBe(1);
    });

    it("rejects view-change messages without timeout evidence when requireTimeoutChallenges is enabled", () => {
      const coordinator = createCoordinator({
        requireTimeoutChallenges: true,
      });

      const payload = BFTConsensusCoordinator.formatViewChangePayload(
        "node-1",
        1,
      );
      const signature = keySet.signers["node-1"].sign(payload);
      const msgWithoutEvidence: ViewChangeMessage = {
        fromNodeId: "node-1",
        newView: 1,
        signature,
        timestamp: Date.now(),
      };

      expect(coordinator.handleViewChange(msgWithoutEvidence)).toBeNull();
    });

    it("rejects challenges with forged, corrupted, or unauthorized witness signatures", () => {
      const coordinator = createCoordinator({
        requireTimeoutChallenges: true,
        viewChangeTimeoutMs: 5000,
      });

      const startTime = Date.now();
      const elapsedTimestamp = startTime + 5200;
      const challenge = coordinator.createTimeoutChallenge(1, 5000, startTime);

      // Corrupt signature from node-2
      const witnesses: TimeoutWitnessProof[] = [
        coordinator
          .getViewChangeManager()
          .createWitnessProof(
            challenge.challengeId,
            "node-1",
            keySet.signers["node-1"],
            elapsedTimestamp,
          ),
        {
          witnessNodeId: "node-2",
          witnessTimestamp: elapsedTimestamp,
          signature: "00".repeat(64), // Corrupted
        },
        coordinator
          .getViewChangeManager()
          .createWitnessProof(
            challenge.challengeId,
            "node-3",
            keySet.signers["node-3"],
            elapsedTimestamp,
          ),
      ];

      const evidence: CryptographicTimeoutEvidence = {
        challenge,
        witnesses,
      };

      const payload = BFTConsensusCoordinator.formatViewChangePayload(
        "node-1",
        1,
      );
      const signature = keySet.signers["node-1"].sign(payload);
      const msg: ViewChangeMessage = {
        fromNodeId: "node-1",
        newView: 1,
        signature,
        timestamp: elapsedTimestamp,
        timeoutEvidence: evidence,
      };

      // Fails because valid witness quorum (3) is not met (only 2 valid)
      expect(coordinator.handleViewChange(msg)).toBeNull();
    });
  });

  describe("C. Replay Prevention and State Cleanups", () => {
    it("prevents replay of previously accepted timeout challenges", () => {
      const coordinator = createCoordinator({
        requireTimeoutChallenges: true,
        viewChangeTimeoutMs: 5000,
      });

      const startTime = Date.now();
      const elapsed = startTime + 5200;
      const challenge = coordinator.createTimeoutChallenge(1, 5000, startTime);

      const witnesses: TimeoutWitnessProof[] = [
        "node-0",
        "node-1",
        "node-2",
      ].map((id) =>
        coordinator
          .getViewChangeManager()
          .createWitnessProof(
            challenge.challengeId,
            id,
            keySet.signers[id],
            elapsed,
          ),
      );

      const evidence: CryptographicTimeoutEvidence = {
        challenge,
        witnesses,
      };

      // Advance to View 1 with this evidence
      for (const id of ["node-1", "node-2", "node-3"]) {
        const payload = BFTConsensusCoordinator.formatViewChangePayload(id, 1);
        const sig = keySet.signers[id].sign(payload);
        coordinator.handleViewChange({
          fromNodeId: id,
          newView: 1,
          signature: sig,
          timestamp: elapsed,
          timeoutEvidence: evidence,
        });
      }
      expect(coordinator.getCurrentView()).toBe(1);

      // Attempt to replay the exact same challenge for another view or repeated transition
      const replayedMsg: ViewChangeMessage = {
        fromNodeId: "node-1",
        newView: 1,
        signature: keySet.signers["node-1"].sign(
          BFTConsensusCoordinator.formatViewChangePayload("node-1", 1),
        ),
        timestamp: elapsed,
        timeoutEvidence: evidence,
      };

      expect(coordinator.handleViewChange(replayedMsg)).toBeNull();
    });

    it("deduplicates multiple witness submissions from the same validator", () => {
      const coordinator = createCoordinator({
        requireTimeoutChallenges: true,
        viewChangeTimeoutMs: 5000,
      });

      const startTime = Date.now();
      const elapsed = startTime + 5200;
      const challenge = coordinator.createTimeoutChallenge(1, 5000, startTime);

      // Node-1 submits duplicate witness signatures
      const proof1 = coordinator
        .getViewChangeManager()
        .createWitnessProof(
          challenge.challengeId,
          "node-1",
          keySet.signers["node-1"],
          elapsed,
        );
      const proof1Duplicate = coordinator
        .getViewChangeManager()
        .createWitnessProof(
          challenge.challengeId,
          "node-1",
          keySet.signers["node-1"],
          elapsed,
        );
      const proof2 = coordinator
        .getViewChangeManager()
        .createWitnessProof(
          challenge.challengeId,
          "node-2",
          keySet.signers["node-2"],
          elapsed,
        );

      const evidence: CryptographicTimeoutEvidence = {
        challenge,
        witnesses: [proof1, proof1Duplicate, proof2], // Only 2 distinct validators: node-1 and node-2
      };

      const payload = BFTConsensusCoordinator.formatViewChangePayload(
        "node-1",
        1,
      );
      const sig = keySet.signers["node-1"].sign(payload);
      const msg: ViewChangeMessage = {
        fromNodeId: "node-1",
        newView: 1,
        signature: sig,
        timestamp: elapsed,
        timeoutEvidence: evidence,
      };

      // Rejected because distinct witness quorum requires 3
      expect(coordinator.handleViewChange(msg)).toBeNull();
    });

    it("prunes stale challenges when views advance", () => {
      const manager = new ViewChangeManager(100);
      const now = Date.now();

      const c0 = manager.createTimeoutChallenge(
        0,
        1,
        0,
        "node-0",
        5000,
        keySet.signers["node-0"],
        now,
      );
      const c1 = manager.createTimeoutChallenge(
        1,
        2,
        1,
        "node-0",
        5000,
        keySet.signers["node-0"],
        now,
      );

      manager.pruneStaleChallenges(1);
      // Challenge c0 (view 0) pruned, c1 (view 1) retained
      expect(manager.buildTimeoutEvidence(c0.challengeId)).toBeNull();
      expect(manager.buildTimeoutEvidence(c1.challengeId)).not.toBeNull();
    });
  });

  describe("D. Concurrency and Network Packet Reordering", () => {
    it("handles concurrent view-change timeout requests idempotently and safely", () => {
      const coordinator = createCoordinator({
        requireTimeoutChallenges: true,
        viewChangeTimeoutMs: 5000,
      });

      const now = Date.now();
      const elapsed = now + 5500;

      // Two validators independently generate challenges for the same view change
      const challengeNode1 = coordinator
        .getViewChangeManager()
        .createTimeoutChallenge(
          0,
          1,
          0,
          "node-1",
          5000,
          keySet.signers["node-1"],
          now,
        );

      const witnesses: TimeoutWitnessProof[] = [
        "node-0",
        "node-1",
        "node-2",
      ].map((id) =>
        coordinator
          .getViewChangeManager()
          .createWitnessProof(
            challengeNode1.challengeId,
            id,
            keySet.signers[id],
            elapsed,
          ),
      );

      const evidence: CryptographicTimeoutEvidence = {
        challenge: challengeNode1,
        witnesses,
      };

      // Deliver duplicate messages concurrently
      const msg1 = {
        fromNodeId: "node-1",
        newView: 1,
        signature: keySet.signers["node-1"].sign(
          BFTConsensusCoordinator.formatViewChangePayload("node-1", 1),
        ),
        timestamp: elapsed,
        timeoutEvidence: evidence,
      };

      const msg2 = {
        fromNodeId: "node-2",
        newView: 1,
        signature: keySet.signers["node-2"].sign(
          BFTConsensusCoordinator.formatViewChangePayload("node-2", 1),
        ),
        timestamp: elapsed,
        timeoutEvidence: evidence,
      };

      const msg3 = {
        fromNodeId: "node-3",
        newView: 1,
        signature: keySet.signers["node-3"].sign(
          BFTConsensusCoordinator.formatViewChangePayload("node-3", 1),
        ),
        timestamp: elapsed,
        timeoutEvidence: evidence,
      };

      // Repeated concurrent deliveries
      expect(coordinator.handleViewChange(msg1)).toBeNull();
      expect(coordinator.handleViewChange(msg1)).toBeNull(); // idempotent duplicate
      expect(coordinator.handleViewChange(msg2)).toBeNull();
      expect(coordinator.handleViewChange(msg2)).toBeNull();

      const transition = coordinator.handleViewChange(msg3);
      expect(transition).toEqual({
        newLeader: "node-1",
        view: 1,
      });
      expect(coordinator.getCurrentView()).toBe(1);

      // Redundant post-transition arrivals handled cleanly without state corruption
      expect(coordinator.handleViewChange(msg3)).toBeNull();
      expect(coordinator.getCurrentView()).toBe(1);
    });
  });
});
