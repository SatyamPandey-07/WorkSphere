import { createHash } from "crypto";
import {
  BFTConsensusCoordinator,
  BlockProposal,
  QuorumCertificate,
  ViewChangeMessage,
  createTestValidatorKeySet,
  generateEd25519ValidatorKey,
} from "../../core/consensus/BFTConsensusCoordinator";

describe("BFTConsensusCoordinator", () => {
  const validators4 = ["node-0", "node-1", "node-2", "node-3"];
  const keys4 = createTestValidatorKeySet(validators4);

  describe("Initialization and Byzantine Fault Parameter Bounds", () => {
    it("calculates correct f and quorum size 2f + 1 for 4-node cluster (N=4 -> f=1, Q=3)", () => {
      const coordinator = new BFTConsensusCoordinator({
        nodeId: "node-0",
        validators: validators4,
      });

      expect(coordinator.f).toBe(1);
      expect(coordinator.quorumSize).toBe(3);
      expect(coordinator.getCurrentView()).toBe(0);
      expect(coordinator.getCurrentLeader()).toBe("node-0");
    });

    it("calculates correct f and quorum size for 7-node cluster (N=7 -> f=2, Q=5)", () => {
      const validators7 = [
        "val-0",
        "val-1",
        "val-2",
        "val-3",
        "val-4",
        "val-5",
        "val-6",
      ];
      const coordinator = new BFTConsensusCoordinator({
        nodeId: "val-0",
        validators: validators7,
      });

      expect(coordinator.f).toBe(2);
      expect(coordinator.quorumSize).toBe(5);
    });

    it("calculates correct round-robin leader per view", () => {
      const coordinator = new BFTConsensusCoordinator({
        nodeId: "node-0",
        validators: validators4,
      });

      expect(coordinator.getLeaderForView(0)).toBe("node-0");
      expect(coordinator.getLeaderForView(1)).toBe("node-1");
      expect(coordinator.getLeaderForView(2)).toBe("node-2");
      expect(coordinator.getLeaderForView(3)).toBe("node-3");
      expect(coordinator.getLeaderForView(4)).toBe("node-0");
    });
  });

  describe("Proposal Generation and Validation", () => {
    it("allows designated leader to propose a block with valid SHA-256 hash", () => {
      const coordinator = new BFTConsensusCoordinator<{ tx: string }>({
        nodeId: "node-0",
        validators: validators4,
      });

      const proposal = coordinator.propose({ tx: "transfer-500-tokens" });
      expect(proposal.view).toBe(0);
      expect(proposal.sequence).toBe(1);
      expect(proposal.proposerId).toBe("node-0");
      expect(proposal.payload.tx).toBe("transfer-500-tokens");
      expect(proposal.blockHash).toMatch(/^[a-f0-9]{64}$/);
    });

    it("rejects proposal attempts from non-leader nodes", () => {
      const coordinator = new BFTConsensusCoordinator<{ tx: string }>({
        nodeId: "node-1", // node-1 is not leader for view 0
        validators: validators4,
      });

      expect(() => {
        coordinator.propose({ tx: "malicious-proposal" });
      }).toThrow(/not the designated leader/);
    });

    it("validates and signs a genuine block proposal on follower node", () => {
      const leader = new BFTConsensusCoordinator<{ tx: string }>({
        nodeId: "node-0",
        validators: validators4,
        validatorPublicKeys: keys4.publicKeys,
        signer: keys4.signers["node-0"],
      });
      const follower = new BFTConsensusCoordinator<{ tx: string }>({
        nodeId: "node-1",
        validators: validators4,
        validatorPublicKeys: keys4.publicKeys,
        signer: keys4.signers["node-1"],
      });

      const proposal = leader.propose({ tx: "state-delta" });
      const vote = follower.handleProposal(proposal);

      expect(vote).not.toBeNull();
      expect(vote?.phase).toBe("PREPARE");
      expect(vote?.nodeId).toBe("node-1");
      expect(vote?.blockHash).toBe(proposal.blockHash);
      expect(vote?.view).toBe(0);
    });

    it("rejects proposal with forged or tampered hash", () => {
      const leader = new BFTConsensusCoordinator<{ tx: string }>({
        nodeId: "node-0",
        validators: validators4,
      });
      const follower = new BFTConsensusCoordinator<{ tx: string }>({
        nodeId: "node-1",
        validators: validators4,
      });

      const proposal = leader.propose({ tx: "tampered-data" });
      const tamperedProposal: BlockProposal<{ tx: string }> = {
        ...proposal,
        blockHash:
          "0000000000000000000000000000000000000000000000000000000000000000",
      };

      const vote = follower.handleProposal(tamperedProposal);
      expect(vote).toBeNull();
    });
  });

  describe("3-Phase Consensus Pipeline & Quorum Certificate Aggregation", () => {
    it("executes full 3-phase HotStuff BFT pipeline from PREPARE to DECIDED", () => {
      const onCommitMock = jest.fn();
      const node0 = new BFTConsensusCoordinator<{ message: string }>({
        nodeId: "node-0",
        validators: validators4,
        validatorPublicKeys: keys4.publicKeys,
        signer: keys4.signers["node-0"],
        onCommit: onCommitMock,
      });
      const node1 = new BFTConsensusCoordinator<{ message: string }>({
        nodeId: "node-1",
        validators: validators4,
        validatorPublicKeys: keys4.publicKeys,
        signer: keys4.signers["node-1"],
      });
      const node2 = new BFTConsensusCoordinator<{ message: string }>({
        nodeId: "node-2",
        validators: validators4,
        validatorPublicKeys: keys4.publicKeys,
        signer: keys4.signers["node-2"],
      });
      const _node3 = new BFTConsensusCoordinator<{ message: string }>({
        nodeId: "node-3",
        validators: validators4,
        validatorPublicKeys: keys4.publicKeys,
        signer: keys4.signers["node-3"],
      });

      const proposal = node0.propose({ message: "cluster-init" });

      // PHASE 1: PREPARE
      const voteP0 = node0.createVote("PREPARE", proposal.blockHash);
      const voteP1 = node1.handleProposal(proposal)!;
      const voteP2 = node2.handleProposal(proposal)!;

      expect(node0.handleVote(voteP0)).toBeNull(); // 1/3 votes
      expect(node0.handleVote(voteP1)).toBeNull(); // 2/3 votes
      const prepareQC = node0.handleVote(voteP2); // 3/3 votes -> QUORUM REACHED!

      expect(prepareQC).not.toBeNull();
      expect(prepareQC?.phase).toBe("PREPARE");
      expect(node0.verifyQuorumCertificate(prepareQC!)).toBe(true);

      // PHASE 2: PRE-COMMIT
      const votePC0 = node0.createVote("PRE_COMMIT", proposal.blockHash);
      const votePC1 = node1.createVote("PRE_COMMIT", proposal.blockHash);
      const votePC2 = node2.createVote("PRE_COMMIT", proposal.blockHash);

      node0.handleVote(votePC0);
      node0.handleVote(votePC1);
      const preCommitQC = node0.handleVote(votePC2);

      expect(preCommitQC).not.toBeNull();
      expect(preCommitQC?.phase).toBe("PRE_COMMIT");
      expect(node0.verifyQuorumCertificate(preCommitQC!)).toBe(true);

      // PHASE 3: COMMIT
      const voteC0 = node0.createVote("COMMIT", proposal.blockHash);
      const voteC1 = node1.createVote("COMMIT", proposal.blockHash);
      const voteC2 = node2.createVote("COMMIT", proposal.blockHash);

      node0.handleVote(voteC0);
      node0.handleVote(voteC1);
      const commitQC = node0.handleVote(voteC2);

      expect(commitQC).not.toBeNull();
      expect(commitQC?.phase).toBe("COMMIT");
      expect(node0.verifyQuorumCertificate(commitQC!)).toBe(true);

      // DECIDED & COMMITTED
      expect(node0.getCommittedBlocks().length).toBe(1);
      expect(node0.getCommittedBlocks()[0].payload.message).toBe(
        "cluster-init",
      );
      expect(node0.getLastCommitQC()?.blockHash).toBe(proposal.blockHash);
      expect(onCommitMock).toHaveBeenCalledTimes(1);
    });
  });

  describe("Byzantine Faults: Equivocation and Slashing", () => {
    it("detects double-signing of conflicting block hashes and triggers slashing", () => {
      const onSlashMock = jest.fn();
      const coordinator = new BFTConsensusCoordinator({
        nodeId: "node-0",
        validators: validators4,
        onSlash: onSlashMock,
      });

      const vote1 = {
        nodeId: "node-1",
        view: 0,
        sequence: 1,
        blockHash: "hash-aaa-111",
        phase: "PREPARE" as const,
        signature: "sig1",
        timestamp: Date.now(),
      };

      const vote2 = {
        nodeId: "node-1",
        view: 0,
        sequence: 1,
        blockHash: "hash-bbb-222", // Conflicting hash for same view, seq & phase
        phase: "PREPARE" as const,
        signature: "sig2",
        timestamp: Date.now(),
      };

      const isEquivocation = coordinator.detectEquivocation(vote1, vote2);
      expect(isEquivocation).toBe(true);
      expect(onSlashMock).toHaveBeenCalledWith(
        "node-1",
        expect.stringContaining("Double-signing"),
      );
    });

    it("rejects votes submitted by unlisted nodes", () => {
      const coordinator = new BFTConsensusCoordinator({
        nodeId: "node-0",
        validators: validators4,
      });

      const maliciousVote = {
        nodeId: "unauthorized-hacker",
        view: 0,
        sequence: 1,
        blockHash: "hash-123",
        phase: "PREPARE" as const,
        signature: "bogus",
        timestamp: Date.now(),
      };

      const result = coordinator.handleVote(maliciousVote);
      expect(result).toBeNull();
    });
  });

  describe("Pacemaker and View Change Coordinator", () => {
    it("triggers view change and elects next leader upon 2f + 1 NEW_VIEW consensus", () => {
      const node0 = new BFTConsensusCoordinator({
        nodeId: "node-0",
        validators: validators4,
        validatorPublicKeys: keys4.publicKeys,
        signer: keys4.signers["node-0"],
      });
      const node1 = new BFTConsensusCoordinator({
        nodeId: "node-1",
        validators: validators4,
        validatorPublicKeys: keys4.publicKeys,
        signer: keys4.signers["node-1"],
      });
      const node2 = new BFTConsensusCoordinator({
        nodeId: "node-2",
        validators: validators4,
        validatorPublicKeys: keys4.publicKeys,
        signer: keys4.signers["node-2"],
      });

      expect(node0.getCurrentView()).toBe(0);
      expect(node0.getCurrentLeader()).toBe("node-0");

      // Trigger view change due to leader timeout
      const vc0 = node0.triggerViewChange("leader-timeout");
      const vc1 = node1.triggerViewChange("leader-timeout");
      const vc2 = node2.triggerViewChange("leader-timeout");

      expect(vc0.newView).toBe(1);

      // Ingest view change votes into node0
      expect(node0.handleViewChange(vc1)).toBeNull(); // 2 votes (vc0 + vc1), quorum is 3
      const transition = node0.handleViewChange(vc2); // 3 votes -> Quorum reached!

      expect(transition).not.toBeNull();
      expect(transition?.view).toBe(1);
      expect(transition?.newLeader).toBe("node-1");
      expect(node0.getCurrentView()).toBe(1);
      expect(node0.getCurrentLeader()).toBe("node-1");
    });
  });

  describe("Cryptographic Signature Verification Error Boundaries & Timeout Protection (#8025)", () => {
    it("catches and rejects corrupted or malformed signature in vote without crashing coordinator", () => {
      const coordinator = new BFTConsensusCoordinator({
        nodeId: "node-0",
        validators: validators4,
      });

      const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});

      // Corrupted signature
      const corruptedVote: any = {
        nodeId: "node-1",
        view: 0,
        sequence: 1,
        blockHash: "valid-block-hash-123",
        phase: "COMMIT",
        signature: "corrupted-ecdsa-sig-000",
        timestamp: Date.now(),
      };

      const result = coordinator.handleVote(corruptedVote);
      expect(result).toBeNull();
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("invalid cryptographic signature from node-1"),
      );

      // Non-string signature or malformed payload
      const nonStringSigVote: any = {
        nodeId: "node-2",
        view: 0,
        sequence: 1,
        blockHash: "valid-block-hash-123",
        phase: "COMMIT",
        signature: { r: "0x123", s: "0x456" }, // Object instead of string
        timestamp: Date.now(),
      };

      expect(coordinator.handleVote(nonStringSigVote)).toBeNull();

      warnSpy.mockRestore();
    });

    it("catches unexpected exceptions thrown during cryptographic verification and rejects vote", () => {
      const coordinator = new BFTConsensusCoordinator({
        nodeId: "node-0",
        validators: validators4,
      });

      const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});

      // Mock verifyVoteSignature to simulate a cryptographic worker throwing
      jest
        .spyOn(coordinator, "verifyVoteSignature")
        .mockImplementationOnce(() => {
          throw new Error("ECDSA worker crashed: memory allocation failure");
        });

      const throwingVote = {
        nodeId: "node-1",
        view: 0,
        sequence: 1,
        blockHash: "block-hash-xyz",
        phase: "PREPARE" as const,
        signature: "some-sig",
        timestamp: Date.now(),
      };

      expect(() => {
        const res = coordinator.handleVote(throwingVote);
        expect(res).toBeNull();
      }).not.toThrow();

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          "cryptographic signature verification threw exception",
        ),
        expect.stringContaining("ECDSA worker crashed"),
      );

      warnSpy.mockRestore();
    });

    it("handles asynchronous worker verification timeout without unhandled promise rejection", async () => {
      const coordinator = new BFTConsensusCoordinator({
        nodeId: "node-0",
        validators: validators4,
      });

      const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});

      // Simulate a verification call that exceeds the timeout
      jest
        .spyOn(coordinator, "verifyNodeSignature")
        .mockImplementationOnce(() => {
          // block/hang
          return false;
        });

      // Directly test verifyNodeSignatureAsync timeout
      jest
        .spyOn(coordinator, "verifyNodeSignatureAsync")
        .mockImplementationOnce(async () => {
          throw new Error("Signature verification timed out after 50ms");
        });

      const vote = {
        nodeId: "node-1",
        view: 0,
        sequence: 1,
        blockHash: "hash-abc",
        phase: "COMMIT" as const,
        signature: "sig-timeout",
        timestamp: Date.now(),
      };

      const result = await coordinator.handleVoteAsync(vote, 50);
      expect(result).toBeNull();

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          "Vote verification rejected due to unhandled promise:",
        ),
        expect.stringContaining("timed out"),
      );

      warnSpy.mockRestore();
    });

    it("verifyQuorumCertificate handles malformed or null signatures gracefully without throwing", () => {
      const coordinator = new BFTConsensusCoordinator({
        nodeId: "node-0",
        validators: validators4,
      });

      const malformedQC: any = {
        view: 0,
        sequence: 1,
        blockHash: "hash-123",
        phase: "PREPARE",
        signatures: null, // malformed
        aggregatedAt: Date.now(),
      };

      expect(coordinator.verifyQuorumCertificate(malformedQC)).toBe(false);

      const invalidSigsQC: any = {
        view: 0,
        sequence: 1,
        blockHash: "hash-123",
        phase: "PREPARE",
        signatures: {
          "node-0": 12345, // invalid type
          "node-1": undefined,
        },
        aggregatedAt: Date.now(),
      };

      expect(coordinator.verifyQuorumCertificate(invalidSigsQC)).toBe(false);
    });
  });
  describe("Asymmetric Cryptographic Signature & Authentication Boundaries", () => {
    it("accepts valid Ed25519 signatures from authorized validators for votes and view-changes", () => {
      const coordinator = new BFTConsensusCoordinator({
        nodeId: "node-0",
        validators: validators4,
        validatorPublicKeys: keys4.publicKeys,
        signer: keys4.signers["node-0"],
      });

      const follower = new BFTConsensusCoordinator({
        nodeId: "node-1",
        validators: validators4,
        validatorPublicKeys: keys4.publicKeys,
        signer: keys4.signers["node-1"],
      });

      // Valid vote
      const vote = follower.createVote(
        "PREPARE",
        "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      );
      expect(coordinator.verifyVoteSignature(vote)).toBe(true);
      expect(coordinator.handleVote(vote)).toBeNull(); // 1/3, accepted into pool

      // Valid view change
      const vc = follower.triggerViewChange("pacemaker-timeout", 1);
      expect(coordinator.verifyViewChangeSignature(vc)).toBe(true);
      expect(coordinator.handleViewChange(vc)).toBeNull(); // 1/3, accepted into pool
    });

    it("rejects public deterministic SHA-256 hashes as cryptographic signatures", () => {
      const coordinator = new BFTConsensusCoordinator({
        nodeId: "node-0",
        validators: validators4,
        validatorPublicKeys: keys4.publicKeys,
        signer: keys4.signers["node-0"],
      });

      // 1. Deterministic SHA-256 hash disguised as vote signature
      const deterministicVoteSig = createHash("sha256")
        .update("BFT_SIG:node-1:PREPARE:0:1:block-hash-123")
        .digest("hex");

      const forgedVote = {
        nodeId: "node-1",
        view: 0,
        sequence: 1,
        blockHash: "block-hash-123",
        phase: "PREPARE" as const,
        signature: deterministicVoteSig,
        timestamp: Date.now(),
      };

      expect(coordinator.verifyVoteSignature(forgedVote)).toBe(false);
      expect(coordinator.handleVote(forgedVote)).toBeNull();

      // 2. Deterministic SHA-256 hash disguised as view-change signature
      const deterministicVCSig = createHash("sha256")
        .update("node-1:NEW_VIEW:1:leader-timeout")
        .digest("hex");

      const forgedVC: ViewChangeMessage = {
        fromNodeId: "node-1",
        newView: 1,
        signature: deterministicVCSig,
        timestamp: Date.now(),
      };

      expect(coordinator.verifyViewChangeSignature(forgedVC)).toBe(false);
      expect(coordinator.handleViewChange(forgedVC)).toBeNull();
    });

    it("rejects signatures from unauthorized or different validators", () => {
      const coordinator = new BFTConsensusCoordinator({
        nodeId: "node-0",
        validators: validators4,
        validatorPublicKeys: keys4.publicKeys,
        signer: keys4.signers["node-0"],
      });

      // 1. Key from an unauthorized validator node
      const rogueKey = generateEd25519ValidatorKey("rogue-attacker");
      const roguePayload = BFTConsensusCoordinator.formatVotePayload(
        "rogue-attacker",
        "PREPARE",
        0,
        1,
        "hash-123",
      );
      const rogueVote = {
        nodeId: "rogue-attacker",
        view: 0,
        sequence: 1,
        blockHash: "hash-123",
        phase: "PREPARE" as const,
        signature: rogueKey.signer.sign(roguePayload),
        timestamp: Date.now(),
      };

      expect(coordinator.handleVote(rogueVote)).toBeNull();

      // 2. Signer spoofing: node-1 signs a payload claiming to be node-2
      const spoofedPayload = BFTConsensusCoordinator.formatVotePayload(
        "node-2",
        "PREPARE",
        0,
        1,
        "hash-123",
      );
      const spoofedVote = {
        nodeId: "node-2",
        view: 0,
        sequence: 1,
        blockHash: "hash-123",
        phase: "PREPARE" as const,
        signature: keys4.signers["node-1"].sign(spoofedPayload),
        timestamp: Date.now(),
      };

      expect(coordinator.verifyVoteSignature(spoofedVote)).toBe(false);
      expect(coordinator.handleVote(spoofedVote)).toBeNull();

      // 3. Spoofed view change: node-1 signs payload claiming to be node-2
      const spoofedVCPayload = BFTConsensusCoordinator.formatViewChangePayload(
        "node-2",
        1,
      );
      const spoofedVC: ViewChangeMessage = {
        fromNodeId: "node-2",
        newView: 1,
        signature: keys4.signers["node-1"].sign(spoofedVCPayload),
        timestamp: Date.now(),
      };

      expect(coordinator.verifyViewChangeSignature(spoofedVC)).toBe(false);
      expect(coordinator.handleViewChange(spoofedVC)).toBeNull();
    });

    it("tampering with signed message fields invalidates verification", () => {
      const coordinator = new BFTConsensusCoordinator({
        nodeId: "node-0",
        validators: validators4,
        validatorPublicKeys: keys4.publicKeys,
        signer: keys4.signers["node-0"],
      });

      const follower = new BFTConsensusCoordinator({
        nodeId: "node-1",
        validators: validators4,
        validatorPublicKeys: keys4.publicKeys,
        signer: keys4.signers["node-1"],
      });

      const legitimateVote = follower.createVote(
        "PREPARE",
        "initial-block-hash",
      );

      // Tamper with blockHash
      const tamperedHashVote = {
        ...legitimateVote,
        blockHash: "tampered-block-hash",
      };
      expect(coordinator.verifyVoteSignature(tamperedHashVote)).toBe(false);
      expect(coordinator.handleVote(tamperedHashVote)).toBeNull();

      // Tamper with view
      const tamperedViewVote = { ...legitimateVote, view: 5 };
      expect(coordinator.verifyVoteSignature(tamperedViewVote)).toBe(false);

      // Tamper with sequence
      const tamperedSeqVote = { ...legitimateVote, sequence: 99 };
      expect(coordinator.verifyVoteSignature(tamperedSeqVote)).toBe(false);

      // Tamper with phase
      const tamperedPhaseVote = { ...legitimateVote, phase: "COMMIT" as const };
      expect(coordinator.verifyVoteSignature(tamperedPhaseVote)).toBe(false);

      // Tamper with ViewChange newView
      const legitimateVC = follower.triggerViewChange("timeout", 1);
      const tamperedVC: ViewChangeMessage = { ...legitimateVC, newView: 2 };
      expect(coordinator.verifyViewChangeSignature(tamperedVC)).toBe(false);
      expect(coordinator.handleViewChange(tamperedVC)).toBeNull();
    });

    it("invalid view-change messages cannot advance the consensus view", () => {
      const coordinator = new BFTConsensusCoordinator({
        nodeId: "node-0",
        validators: validators4,
        validatorPublicKeys: keys4.publicKeys,
        signer: keys4.signers["node-0"],
      });

      expect(coordinator.getCurrentView()).toBe(0);

      // Send 3 forged view-change messages with invalid signatures
      for (const id of ["node-1", "node-2", "node-3"]) {
        const forged: ViewChangeMessage = {
          fromNodeId: id,
          newView: 1,
          signature: "forged-invalid-sig-0000",
          timestamp: Date.now(),
        };
        expect(coordinator.handleViewChange(forged)).toBeNull();
      }

      // View MUST NOT advance
      expect(coordinator.getCurrentView()).toBe(0);
      expect(coordinator.getCurrentLeader()).toBe("node-0");
    });

    it("future-view buffers reject unauthenticated messages", () => {
      const coordinator = new BFTConsensusCoordinator({
        nodeId: "node-0",
        validators: validators4,
        validatorPublicKeys: keys4.publicKeys,
        signer: keys4.signers["node-0"],
      });

      // Attempt to buffer unauthenticated messages for future view 3
      const forgedFutureMsg: ViewChangeMessage = {
        fromNodeId: "node-1",
        newView: 3,
        signature: "invalid-unauthenticated-sig",
        timestamp: Date.now(),
      };
      expect(coordinator.handleViewChange(forgedFutureMsg)).toBeNull();

      // Advance views legitimately to view 1, then view 2
      const _vc1_1 = coordinator.triggerViewChange("timeout", 1);
      const vc1_2 = new BFTConsensusCoordinator({
        nodeId: "node-1",
        validators: validators4,
        validatorPublicKeys: keys4.publicKeys,
        signer: keys4.signers["node-1"],
      }).triggerViewChange("timeout", 1);
      const vc1_3 = new BFTConsensusCoordinator({
        nodeId: "node-2",
        validators: validators4,
        validatorPublicKeys: keys4.publicKeys,
        signer: keys4.signers["node-2"],
      }).triggerViewChange("timeout", 1);

      coordinator.handleViewChange(vc1_2);
      coordinator.handleViewChange(vc1_3);
      expect(coordinator.getCurrentView()).toBe(1);

      // Advance to view 2
      const _vc2_1 = coordinator.triggerViewChange("timeout", 2);
      const vc2_2 = new BFTConsensusCoordinator({
        nodeId: "node-1",
        validators: validators4,
        validatorPublicKeys: keys4.publicKeys,
        signer: keys4.signers["node-1"],
      }).triggerViewChange("timeout", 2);
      const vc2_3 = new BFTConsensusCoordinator({
        nodeId: "node-2",
        validators: validators4,
        validatorPublicKeys: keys4.publicKeys,
        signer: keys4.signers["node-2"],
      }).triggerViewChange("timeout", 2);

      coordinator.handleViewChange(vc2_2);
      coordinator.handleViewChange(vc2_3);
      expect(coordinator.getCurrentView()).toBe(2);

      // Future-view buffer did NOT accept forged message, so view remains at 2
      expect(coordinator.getCurrentView()).toBe(2);
    });

    it("quorum certificates require the correct number of distinct valid signers", () => {
      const coordinator = new BFTConsensusCoordinator({
        nodeId: "node-0",
        validators: validators4,
        validatorPublicKeys: keys4.publicKeys,
        signer: keys4.signers["node-0"],
      });

      const hash =
        "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2";

      const sig0 = keys4.signers["node-0"].sign(
        BFTConsensusCoordinator.formatVotePayload(
          "node-0",
          "COMMIT",
          0,
          1,
          hash,
        ),
      );
      const sig1 = keys4.signers["node-1"].sign(
        BFTConsensusCoordinator.formatVotePayload(
          "node-1",
          "COMMIT",
          0,
          1,
          hash,
        ),
      );
      const sig2 = keys4.signers["node-2"].sign(
        BFTConsensusCoordinator.formatVotePayload(
          "node-2",
          "COMMIT",
          0,
          1,
          hash,
        ),
      );

      // 1. Valid QC with 3 distinct signers (quorum = 3)
      const validQC: QuorumCertificate = {
        view: 0,
        sequence: 1,
        blockHash: hash,
        phase: "COMMIT",
        signatures: {
          "node-0": sig0,
          "node-1": sig1,
          "node-2": sig2,
        },
        aggregatedAt: Date.now(),
      };
      expect(coordinator.verifyQuorumCertificate(validQC)).toBe(true);

      // 2. Insufficient signers (only 2 signers, quorum requires 3)
      const subQuorumQC: QuorumCertificate = {
        ...validQC,
        signatures: {
          "node-0": sig0,
          "node-1": sig1,
        },
      };
      expect(coordinator.verifyQuorumCertificate(subQuorumQC)).toBe(false);

      // 3. One forged signature among 3 signers
      const forgedQC: QuorumCertificate = {
        ...validQC,
        signatures: {
          "node-0": sig0,
          "node-1": sig1,
          "node-2": "forged-signature-not-valid",
        },
      };
      expect(coordinator.verifyQuorumCertificate(forgedQC)).toBe(false);

      // 4. Signature from unauthorized node outside validators
      const rogueKey = generateEd25519ValidatorKey("intruder");
      const intruderSig = rogueKey.signer.sign(
        BFTConsensusCoordinator.formatVotePayload(
          "intruder",
          "COMMIT",
          0,
          1,
          hash,
        ),
      );
      const intruderQC: QuorumCertificate = {
        ...validQC,
        signatures: {
          "node-0": sig0,
          "node-1": sig1,
          intruder: intruderSig,
        },
      };
      expect(coordinator.verifyQuorumCertificate(intruderQC)).toBe(false);
    });

    it("rejects replayed votes from prior views or sequences", () => {
      const coordinator = new BFTConsensusCoordinator({
        nodeId: "node-0",
        validators: validators4,
        validatorPublicKeys: keys4.publicKeys,
        signer: keys4.signers["node-0"],
      });

      // Construct vote for view 0
      const oldVote = new BFTConsensusCoordinator({
        nodeId: "node-1",
        validators: validators4,
        validatorPublicKeys: keys4.publicKeys,
        signer: keys4.signers["node-1"],
      }).createVote("PREPARE", "hash-1");

      // Transition coordinator to view 1
      const _vc0 = coordinator.triggerViewChange("timeout", 1);
      const vc1 = new BFTConsensusCoordinator({
        nodeId: "node-1",
        validators: validators4,
        validatorPublicKeys: keys4.publicKeys,
        signer: keys4.signers["node-1"],
      }).triggerViewChange("timeout", 1);
      const vc2 = new BFTConsensusCoordinator({
        nodeId: "node-2",
        validators: validators4,
        validatorPublicKeys: keys4.publicKeys,
        signer: keys4.signers["node-2"],
      }).triggerViewChange("timeout", 1);

      coordinator.handleViewChange(vc1);
      coordinator.handleViewChange(vc2);
      expect(coordinator.getCurrentView()).toBe(1);

      // Replay old vote from view 0: signature was for view 0!
      const replayedVote = { ...oldVote, view: 1 };
      expect(coordinator.verifyVoteSignature(replayedVote)).toBe(false);
      expect(coordinator.handleVote(replayedVote)).toBeNull();
    });
  });

  describe("Proposal View Validation & Certified View-Change Quorum", () => {
    const validators4 = ["node-0", "node-1", "node-2", "node-3"];
    let keys4: ReturnType<typeof createTestValidatorKeySet>;

    beforeEach(() => {
      keys4 = createTestValidatorKeySet(validators4);
    });

    it("rejects proposals targeting unauthorized future views without view-change evidence", () => {
      const follower = new BFTConsensusCoordinator({
        nodeId: "node-0",
        validators: validators4,
        validatorPublicKeys: keys4.publicKeys,
        signer: keys4.signers["node-0"],
      });

      expect(follower.getCurrentView()).toBe(0);

      // Node-1 is leader for view 1
      // Craft proposal for view 1 without view-change evidence
      const blockContent = {
        view: 1,
        sequence: 1,
        proposerId: "node-1",
        payload: { tx: "unauthorized-future-view" },
        parentHash:
          "0000000000000000000000000000000000000000000000000000000000000000",
        timestamp: Date.now(),
      };
      const blockHash = BFTConsensusCoordinator.hashPayload(blockContent);
      const proposal: BlockProposal = {
        ...blockContent,
        blockHash,
      };

      const vote = follower.handleProposal(proposal);
      expect(vote).toBeNull();
      // Follower state must NOT be modified
      expect(follower.getCurrentView()).toBe(0);
      expect(follower.getCurrentLeader()).toBe("node-0");
    });

    it("rejects future proposals with invalid, insufficient, or mismatched view-change evidence", () => {
      const follower = new BFTConsensusCoordinator({
        nodeId: "node-0",
        validators: validators4,
        validatorPublicKeys: keys4.publicKeys,
        signer: keys4.signers["node-0"],
      });

      // 1. Insufficient evidence: only 1 signature when quorum is 3
      const vc1 = new BFTConsensusCoordinator({
        nodeId: "node-1",
        validators: validators4,
        validatorPublicKeys: keys4.publicKeys,
        signer: keys4.signers["node-1"],
      }).triggerViewChange("timeout", 1);

      const blockContent = {
        view: 1,
        sequence: 1,
        proposerId: "node-1",
        payload: { tx: "partial-evidence" },
        parentHash:
          "0000000000000000000000000000000000000000000000000000000000000000",
        timestamp: Date.now(),
      };
      const blockHash = BFTConsensusCoordinator.hashPayload(blockContent);

      const proposalInsufficient: BlockProposal = {
        ...blockContent,
        blockHash,
        viewChangeEvidence: [vc1],
      };
      expect(follower.handleProposal(proposalInsufficient)).toBeNull();
      expect(follower.getCurrentView()).toBe(0);

      // 2. Forged signature in view-change evidence
      const forgedVC: ViewChangeMessage = {
        fromNodeId: "node-2",
        newView: 1,
        signature: "forged-signature-0000",
        timestamp: Date.now(),
      };
      const proposalForged: BlockProposal = {
        ...blockContent,
        blockHash,
        viewChangeEvidence: [vc1, forgedVC, { ...vc1, fromNodeId: "node-3" }],
      };
      expect(follower.handleProposal(proposalForged)).toBeNull();
      expect(follower.getCurrentView()).toBe(0);

      // 3. Mismatched target view: evidence targets view 2, but proposal is for view 1
      const vcTarget2_0 = new BFTConsensusCoordinator({
        nodeId: "node-0",
        validators: validators4,
        validatorPublicKeys: keys4.publicKeys,
        signer: keys4.signers["node-0"],
      }).triggerViewChange("timeout", 2);
      const vcTarget2_1 = new BFTConsensusCoordinator({
        nodeId: "node-1",
        validators: validators4,
        validatorPublicKeys: keys4.publicKeys,
        signer: keys4.signers["node-1"],
      }).triggerViewChange("timeout", 2);
      const vcTarget2_2 = new BFTConsensusCoordinator({
        nodeId: "node-2",
        validators: validators4,
        validatorPublicKeys: keys4.publicKeys,
        signer: keys4.signers["node-2"],
      }).triggerViewChange("timeout", 2);

      const proposalMismatched: BlockProposal = {
        ...blockContent,
        blockHash,
        viewChangeEvidence: [vcTarget2_0, vcTarget2_1, vcTarget2_2],
      };
      expect(follower.handleProposal(proposalMismatched)).toBeNull();
      expect(follower.getCurrentView()).toBe(0);
    });

    it("rejects proposals targeting views beyond maxFutureViewWindow", () => {
      const follower = new BFTConsensusCoordinator({
        nodeId: "node-0",
        validators: validators4,
        validatorPublicKeys: keys4.publicKeys,
        signer: keys4.signers["node-0"],
        maxFutureViewWindow: 5,
      });

      // View 10 exceeds 0 + 5
      const targetView = 10;
      const expectedLeader = follower.getLeaderForView(targetView);
      const blockContent = {
        view: targetView,
        sequence: 1,
        proposerId: expectedLeader,
        payload: { tx: "too-far" },
        parentHash:
          "0000000000000000000000000000000000000000000000000000000000000000",
        timestamp: Date.now(),
      };
      const blockHash = BFTConsensusCoordinator.hashPayload(blockContent);

      const proposal: BlockProposal = {
        ...blockContent,
        blockHash,
      };

      expect(follower.handleProposal(proposal)).toBeNull();
      expect(follower.getCurrentView()).toBe(0);
    });

    it("rejects proposals with invalid or future justification certificates", () => {
      const coordinator = new BFTConsensusCoordinator({
        nodeId: "node-1",
        validators: validators4,
        validatorPublicKeys: keys4.publicKeys,
        signer: keys4.signers["node-1"],
      });

      // 1. Invalid justification certificate (invalid signature)
      const invalidQC: QuorumCertificate = {
        view: 0,
        sequence: 0,
        blockHash: "prev-hash",
        phase: "COMMIT",
        signatures: {
          "node-0": "invalid-signature",
          "node-1": "invalid-signature",
          "node-2": "invalid-signature",
        },
        aggregatedAt: Date.now(),
      };

      const blockContent = {
        view: 0,
        sequence: 1,
        proposerId: "node-0",
        payload: { tx: "with-bad-qc" },
        parentHash: "prev-hash",
        timestamp: Date.now(),
      };
      const blockHash = BFTConsensusCoordinator.hashPayload(blockContent);

      const proposalWithBadQC: BlockProposal = {
        ...blockContent,
        blockHash,
        justifyQC: invalidQC,
      };

      expect(coordinator.handleProposal(proposalWithBadQC)).toBeNull();

      // 2. Justification certificate from future view (justifyQC.view > proposal.view)
      // Create a legitimately signed QC for view 2
      const futureSignatures: Record<string, string> = {};
      for (const id of ["node-0", "node-1", "node-2"]) {
        const payload = Buffer.from(
          `BFT_VOTE_V1:${id}:COMMIT:2:1:future-hash`,
          "utf8",
        );
        futureSignatures[id] = keys4.signers[id].sign(payload);
      }
      const futureQC: QuorumCertificate = {
        view: 2,
        sequence: 1,
        blockHash: "future-hash",
        phase: "COMMIT",
        signatures: futureSignatures,
        aggregatedAt: Date.now(),
      };

      const proposalWithFutureQC: BlockProposal = {
        ...blockContent,
        blockHash,
        justifyQC: futureQC,
      };

      expect(coordinator.handleProposal(proposalWithFutureQC)).toBeNull();
    });

    it("ensures rejected proposals do not modify coordinator state", () => {
      const coordinator = new BFTConsensusCoordinator({
        nodeId: "node-0",
        validators: validators4,
        validatorPublicKeys: keys4.publicKeys,
        signer: keys4.signers["node-0"],
      });

      const initialView = coordinator.getCurrentView();
      const initialLeader = coordinator.getCurrentLeader();

      // Attempt handling an invalid proposal with hash mismatch
      const badHashProposal: BlockProposal = {
        view: 0,
        sequence: 1,
        proposerId: "node-0",
        payload: { bad: true },
        blockHash: "corrupted-hash",
        parentHash:
          "0000000000000000000000000000000000000000000000000000000000000000",
        timestamp: Date.now(),
      };

      expect(coordinator.handleProposal(badHashProposal)).toBeNull();
      expect(coordinator.getCurrentView()).toBe(initialView);
      expect(coordinator.getCurrentLeader()).toBe(initialLeader);
    });

    it("accepts certified future-view proposals with valid view-change evidence and transitions view", () => {
      const follower = new BFTConsensusCoordinator({
        nodeId: "node-0",
        validators: validators4,
        validatorPublicKeys: keys4.publicKeys,
        signer: keys4.signers["node-0"],
      });

      expect(follower.getCurrentView()).toBe(0);

      // Generate 3 valid ViewChangeMessages for view 1 (quorum = 3)
      const vc0 = follower.triggerViewChange("timeout", 1);
      const vc1 = new BFTConsensusCoordinator({
        nodeId: "node-1",
        validators: validators4,
        validatorPublicKeys: keys4.publicKeys,
        signer: keys4.signers["node-1"],
      }).triggerViewChange("timeout", 1);
      const vc2 = new BFTConsensusCoordinator({
        nodeId: "node-2",
        validators: validators4,
        validatorPublicKeys: keys4.publicKeys,
        signer: keys4.signers["node-2"],
      }).triggerViewChange("timeout", 1);

      // Node-1 is leader for view 1
      const leader1 = new BFTConsensusCoordinator({
        nodeId: "node-1",
        validators: validators4,
        validatorPublicKeys: keys4.publicKeys,
        signer: keys4.signers["node-1"],
      });

      // Ingest view changes into leader1 so it transitions to view 1
      leader1.handleViewChange(vc0);
      leader1.handleViewChange(vc1);
      leader1.handleViewChange(vc2);
      expect(leader1.getCurrentView()).toBe(1);

      // Leader1 proposes next block, carrying viewChangeEvidence
      const proposal = leader1.propose({ tx: "certified-view-1" });
      expect(proposal.view).toBe(1);
      expect(proposal.viewChangeEvidence).toBeDefined();

      // Follower (still on view 0) handles the certified proposal
      const vote = follower.handleProposal(proposal);
      expect(vote).not.toBeNull();
      expect(vote?.phase).toBe("PREPARE");
      expect(vote?.view).toBe(1);
      expect(vote?.nodeId).toBe("node-0");
      expect(vote?.blockHash).toBe(proposal.blockHash);

      // Follower successfully transitioned to view 1
      expect(follower.getCurrentView()).toBe(1);
      expect(follower.getCurrentLeader()).toBe("node-1");
    });

    it("supports skipped view transitions when certified by valid view-change quorum evidence", () => {
      const follower = new BFTConsensusCoordinator({
        nodeId: "node-0",
        validators: validators4,
        validatorPublicKeys: keys4.publicKeys,
        signer: keys4.signers["node-0"],
      });

      expect(follower.getCurrentView()).toBe(0);

      // Skip directly from view 0 to view 2
      const targetView = 2;
      const expectedLeader = follower.getLeaderForView(targetView); // "node-2"

      const vcMsgs: ViewChangeMessage[] = [];
      for (const id of ["node-0", "node-1", "node-2"]) {
        const c = new BFTConsensusCoordinator({
          nodeId: id,
          validators: validators4,
          validatorPublicKeys: keys4.publicKeys,
          signer: keys4.signers[id],
        });
        vcMsgs.push(c.triggerViewChange("skipped-timeout", targetView));
      }

      const blockContent = {
        view: targetView,
        sequence: 1,
        proposerId: expectedLeader,
        payload: { tx: "skipped-view-transition" },
        parentHash:
          "0000000000000000000000000000000000000000000000000000000000000000",
        timestamp: Date.now(),
      };
      const blockHash = BFTConsensusCoordinator.hashPayload(blockContent);

      const certifiedSkippedProposal: BlockProposal = {
        ...blockContent,
        blockHash,
        viewChangeEvidence: vcMsgs,
      };

      const vote = follower.handleProposal(certifiedSkippedProposal);
      expect(vote).not.toBeNull();
      expect(vote?.view).toBe(2);
      expect(vote?.phase).toBe("PREPARE");
      expect(follower.getCurrentView()).toBe(2);
      expect(follower.getCurrentLeader()).toBe(expectedLeader);
    });
  });

  describe("Proposal Sequence Monotonicity, Parent Hash & Justification Verification", () => {
    const validators4 = ["node-0", "node-1", "node-2", "node-3"];
    let keys4: ReturnType<typeof createTestValidatorKeySet>;

    beforeEach(() => {
      keys4 = createTestValidatorKeySet(validators4);
    });

    it("rejects stale, replayed, or out-of-order sequence proposals", () => {
      const leader = new BFTConsensusCoordinator({
        nodeId: "node-0",
        validators: validators4,
        validatorPublicKeys: keys4.publicKeys,
        signer: keys4.signers["node-0"],
      });

      const follower = new BFTConsensusCoordinator({
        nodeId: "node-1",
        validators: validators4,
        validatorPublicKeys: keys4.publicKeys,
        signer: keys4.signers["node-1"],
      });

      // 1. Initial valid proposal seq 1
      const p1 = leader.propose({ tx: "block-1" });
      expect(p1.sequence).toBe(1);

      const vote1 = follower.handleProposal(p1);
      expect(vote1).not.toBeNull();
      expect(follower.getCurrentSequence()).toBe(1);

      // 2. Replay p1 (stale/replayed: seq 1 <= current 1)
      const replayedVote = follower.handleProposal(p1);
      expect(replayedVote).toBeNull();
      expect(follower.getCurrentSequence()).toBe(1);

      // 3. Stale proposal with seq 0
      const staleContent = {
        view: 0,
        sequence: 0,
        proposerId: "node-0",
        payload: { tx: "stale-0" },
        parentHash:
          "0000000000000000000000000000000000000000000000000000000000000000",
        timestamp: Date.now(),
      };
      const staleProposal: BlockProposal = {
        ...staleContent,
        blockHash: BFTConsensusCoordinator.hashPayload(staleContent),
      };
      expect(follower.handleProposal(staleProposal)).toBeNull();
      expect(follower.getCurrentSequence()).toBe(1);

      // 4. Out-of-order proposal skipping sequence (seq 3 when current is 1)
      const outOfOrderContent = {
        view: 0,
        sequence: 3,
        proposerId: "node-0",
        payload: { tx: "skip-seq" },
        parentHash: p1.blockHash,
        timestamp: Date.now(),
      };
      const outOfOrderProposal: BlockProposal = {
        ...outOfOrderContent,
        blockHash: BFTConsensusCoordinator.hashPayload(outOfOrderContent),
      };
      expect(follower.handleProposal(outOfOrderProposal)).toBeNull();
      expect(follower.getCurrentSequence()).toBe(1);
    });

    it("rejects proposals with invalid parentHash", () => {
      const coordinator = new BFTConsensusCoordinator({
        nodeId: "node-1",
        validators: validators4,
        validatorPublicKeys: keys4.publicKeys,
        signer: keys4.signers["node-1"],
      });

      // At genesis, expected parentHash is 64 zeros
      const wrongParentContent = {
        view: 0,
        sequence: 1,
        proposerId: "node-0",
        payload: { tx: "wrong-parent" },
        parentHash:
          "1111111111111111111111111111111111111111111111111111111111111111",
        timestamp: Date.now(),
      };
      const wrongParentProposal: BlockProposal = {
        ...wrongParentContent,
        blockHash: BFTConsensusCoordinator.hashPayload(wrongParentContent),
      };

      expect(coordinator.handleProposal(wrongParentProposal)).toBeNull();
      expect(coordinator.getCurrentSequence()).toBe(0);
    });

    it("rejects proposals extending committed chain when justifyQC is missing or invalid", () => {
      const nodes = validators4.map(
        (id) =>
          new BFTConsensusCoordinator({
            nodeId: id,
            validators: validators4,
            validatorPublicKeys: keys4.publicKeys,
            signer: keys4.signers[id],
          }),
      );

      const [node0, node1, node2] = nodes;

      // 1. Propose and commit Block 1
      const p1 = node0.propose({ tx: "commit-me" });
      const voteP1 = node1.handleProposal(p1)!;
      const voteP2 = node2.handleProposal(p1)!;

      // PREPARE -> PRE_COMMIT -> COMMIT
      const prep0 = node0.createVote("PREPARE", p1.blockHash);
      node0.handleVote(prep0);
      node0.handleVote(voteP1);
      const _prepQC = node0.handleVote(voteP2)!;

      node1.handleVote(prep0);
      node1.handleVote(voteP1);
      node1.handleVote(voteP2);

      const pc0 = node0.createVote("PRE_COMMIT", p1.blockHash);
      const pc1 = node1.createVote("PRE_COMMIT", p1.blockHash);
      const pc2 = node2.createVote("PRE_COMMIT", p1.blockHash);
      node0.handleVote(pc0);
      node0.handleVote(pc1);
      const _pcQC = node0.handleVote(pc2)!;

      node1.handleVote(pc0);
      node1.handleVote(pc1);
      node1.handleVote(pc2);

      const c0 = node0.createVote("COMMIT", p1.blockHash);
      const c1 = node1.createVote("COMMIT", p1.blockHash);
      const c2 = node2.createVote("COMMIT", p1.blockHash);
      node0.handleVote(c0);
      node0.handleVote(c1);
      const commitQC = node0.handleVote(c2)!;

      node1.handleVote(c0);
      node1.handleVote(c1);
      node1.handleVote(c2);

      expect(node1.getLastCommitQC()).not.toBeNull();
      expect(node1.getCommittedBlocks().length).toBe(1);

      // Now node1 expects next proposal to have sequence 2, parentHash p1.blockHash, and justifyQC === commitQC
      // Case A: Missing justifyQC
      const noQCContent = {
        view: 0,
        sequence: 2,
        proposerId: "node-0",
        payload: { tx: "no-qc" },
        parentHash: p1.blockHash,
        timestamp: Date.now(),
      };
      const noQCProposal: BlockProposal = {
        ...noQCContent,
        blockHash: BFTConsensusCoordinator.hashPayload(noQCContent),
      };
      expect(node1.handleProposal(noQCProposal)).toBeNull();
      expect(node1.getCurrentSequence()).toBe(1);

      // Case B: Mismatched justifyQC blockHash
      const mismatchedQC: QuorumCertificate = {
        ...commitQC,
        blockHash: "other-hash-000",
      };
      const mismatchQCProposal: BlockProposal = {
        ...noQCContent,
        blockHash: BFTConsensusCoordinator.hashPayload(noQCContent),
        justifyQC: mismatchedQC,
      };
      expect(node1.handleProposal(mismatchQCProposal)).toBeNull();
      expect(node1.getCurrentSequence()).toBe(1);

      // Case C: Mismatched parentHash
      const wrongParentP2 = {
        view: 0,
        sequence: 2,
        proposerId: "node-0",
        payload: { tx: "wrong-parent" },
        parentHash: "wrong-predecessor-hash",
        timestamp: Date.now(),
      };
      const wrongParentProposal: BlockProposal = {
        ...wrongParentP2,
        blockHash: BFTConsensusCoordinator.hashPayload(wrongParentP2),
        justifyQC: commitQC,
      };
      expect(node1.handleProposal(wrongParentProposal)).toBeNull();
      expect(node1.getCurrentSequence()).toBe(1);
    });

    it("valid proposals advance sequence state consistently across multiple blocks", () => {
      const nodes = validators4.map(
        (id) =>
          new BFTConsensusCoordinator({
            nodeId: id,
            validators: validators4,
            validatorPublicKeys: keys4.publicKeys,
            signer: keys4.signers[id],
          }),
      );

      const [node0, node1, node2] = nodes;

      // --- Block 1 ---
      const p1 = node0.propose({ tx: "tx-1" });
      expect(p1.sequence).toBe(1);

      const vote1 = node1.handleProposal(p1)!;
      expect(vote1).not.toBeNull();
      expect(node1.getCurrentSequence()).toBe(1);

      // Commit Block 1 on node0 and node1
      const prep0 = node0.createVote("PREPARE", p1.blockHash);
      const prep1 = vote1;
      const prep2 = node2.handleProposal(p1)!;
      node0.handleVote(prep0);
      node0.handleVote(prep1);
      node0.handleVote(prep2);
      node1.handleVote(prep0);
      node1.handleVote(prep1);
      node1.handleVote(prep2);

      const pc0 = node0.createVote("PRE_COMMIT", p1.blockHash);
      const pc1 = node1.createVote("PRE_COMMIT", p1.blockHash);
      const pc2 = node2.createVote("PRE_COMMIT", p1.blockHash);
      node0.handleVote(pc0);
      node0.handleVote(pc1);
      node0.handleVote(pc2);
      node1.handleVote(pc0);
      node1.handleVote(pc1);
      node1.handleVote(pc2);

      const c0 = node0.createVote("COMMIT", p1.blockHash);
      const c1 = node1.createVote("COMMIT", p1.blockHash);
      const c2 = node2.createVote("COMMIT", p1.blockHash);
      node0.handleVote(c0);
      node0.handleVote(c1);
      node0.handleVote(c2);
      node1.handleVote(c0);
      node1.handleVote(c1);
      node1.handleVote(c2);

      expect(node0.getLastCommitQC()?.blockHash).toBe(p1.blockHash);
      expect(node1.getLastCommitQC()?.blockHash).toBe(p1.blockHash);

      // --- Block 2 ---
      const p2 = node0.propose({ tx: "tx-2" }, p1.blockHash);
      expect(p2.sequence).toBe(2);
      expect(p2.parentHash).toBe(p1.blockHash);
      expect(p2.justifyQC).toBeDefined();

      const vote2 = node1.handleProposal(p2);
      expect(vote2).not.toBeNull();
      expect(vote2?.phase).toBe("PREPARE");
      expect(vote2?.sequence).toBe(2);
      expect(node1.getCurrentSequence()).toBe(2);
    });
  });
});
