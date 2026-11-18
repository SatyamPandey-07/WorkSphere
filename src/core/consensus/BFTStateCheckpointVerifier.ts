/**
 * @file BFTStateCheckpointVerifier.ts
 * @description Byzantine Fault-Tolerant (BFT) State Checkpoint & Light-Client Verifier.
 * Manages periodic immutable state checkpoints in BFT replicated state machines for safe
 * log garbage collection, rapid light-client synchronization, equivocation (double-signing)
 * slashing detection, and 2f + 1 weighted quorum certificate assembly.
 */

import { createHash, createHmac } from 'crypto';

export interface CheckpointValidator {
  id: string;
  publicKey: string;
  votingPower: bigint;
  slashed?: boolean;
}

export interface StateCheckpointProposal {
  height: number;
  epoch: number;
  stateRoot: string;
  prevCheckpointHash: string;
  checkpointHash: string;
  timestamp: number;
}

export interface CheckpointVote {
  height: number;
  epoch: number;
  checkpointHash: string;
  validatorId: string;
  signature: string;
  timestamp: number;
}

export interface EquivocationEvidence {
  validatorId: string;
  height: number;
  firstCheckpointHash: string;
  conflictingCheckpointHash: string;
  firstSignature: string;
  conflictingSignature: string;
  detectedAt: number;
}

export interface CheckpointQuorumCertificate {
  height: number;
  epoch: number;
  stateRoot: string;
  prevCheckpointHash: string;
  checkpointHash: string;
  totalVotingPower: bigint;
  signedVotingPower: bigint;
  signatures: Record<string, string>;
  finalizedAt: number;
}

export interface CheckpointVerificationResult {
  isValid: boolean;
  reason?: string;
  signedVotingPower: bigint;
  quorumThreshold: bigint;
}

export class BFTStateCheckpointVerifier {
  private validators: Map<string, CheckpointValidator> = new Map();
  private totalVotingPower: bigint = 0n;
  private proposals: Map<string, StateCheckpointProposal> = new Map();
  // height -> validatorId -> CheckpointVote
  private votesByHeight: Map<number, Map<string, CheckpointVote>> = new Map();
  // checkpointHash -> Map<validatorId, CheckpointVote>
  private votesByHash: Map<string, Map<string, CheckpointVote>> = new Map();
  private certificates: Map<number, CheckpointQuorumCertificate> = new Map();
  private equivocations: EquivocationEvidence[] = [];

  constructor(validators: CheckpointValidator[]) {
    for (const v of validators) {
      this.validators.set(v.id, { ...v, slashed: Boolean(v.slashed) });
      if (!v.slashed) {
        this.totalVotingPower += v.votingPower;
      }
    }
  }

  /**
   * Computes BFT 2f + 1 quorum threshold: floor(2 * totalPower / 3) + 1n.
   */
  public static computeQuorumThreshold(totalPower: bigint): bigint {
    return (2n * totalPower) / 3n + 1n;
  }

  /**
   * Computes deterministic SHA-256 checkpoint hash.
   */
  public static computeCheckpointHash(
    height: number,
    epoch: number,
    stateRoot: string,
    prevCheckpointHash: string
  ): string {
    return createHash('sha256')
      .update(`${height}:${epoch}:${stateRoot}:${prevCheckpointHash}`)
      .digest('hex');
  }

  /**
   * Signs a checkpoint vote payload.
   */
  public static signVotePayload(
    height: number,
    epoch: number,
    checkpointHash: string,
    secretKey: string
  ): string {
    return createHmac('sha256', secretKey)
      .update(`checkpoint_vote:${height}:${epoch}:${checkpointHash}`)
      .digest('hex');
  }

  /**
   * Verifies a checkpoint vote signature.
   */
  public static verifyVoteSignature(
    height: number,
    epoch: number,
    checkpointHash: string,
    signature: string,
    publicKey: string
  ): boolean {
    const expected = this.signVotePayload(height, epoch, checkpointHash, publicKey);
    return signature === expected;
  }

  public getQuorumThreshold(): bigint {
    return BFTStateCheckpointVerifier.computeQuorumThreshold(this.totalVotingPower);
  }

  public getEquivocationEvidence(): EquivocationEvidence[] {
    return [...this.equivocations];
  }

  public getCertificate(height: number): CheckpointQuorumCertificate | undefined {
    return this.certificates.get(height);
  }

  /**
   * Registers a new state checkpoint proposal.
   */
  public proposeCheckpoint(
    height: number,
    epoch: number,
    stateRoot: string,
    prevCheckpointHash: string
  ): StateCheckpointProposal {
    const checkpointHash = BFTStateCheckpointVerifier.computeCheckpointHash(
      height,
      epoch,
      stateRoot,
      prevCheckpointHash
    );

    const proposal: StateCheckpointProposal = {
      height,
      epoch,
      stateRoot,
      prevCheckpointHash,
      checkpointHash,
      timestamp: Date.now(),
    };

    this.proposals.set(checkpointHash, proposal);
    if (!this.votesByHash.has(checkpointHash)) {
      this.votesByHash.set(checkpointHash, new Map());
    }
    return proposal;
  }

  /**
   * Helper to generate a signed vote for a proposal.
   */
  public signVote(
    validatorId: string,
    secretKey: string,
    proposal: StateCheckpointProposal
  ): CheckpointVote {
    const signature = BFTStateCheckpointVerifier.signVotePayload(
      proposal.height,
      proposal.epoch,
      proposal.checkpointHash,
      secretKey
    );

    return {
      height: proposal.height,
      epoch: proposal.epoch,
      checkpointHash: proposal.checkpointHash,
      validatorId,
      signature,
      timestamp: Date.now(),
    };
  }

  /**
   * Submits a validator checkpoint vote, checking authentication, equivocation, and quorum.
   */
  public submitVote(vote: CheckpointVote): {
    accepted: boolean;
    quorumReached: boolean;
    signedVotingPower: bigint;
    equivocationDetected: boolean;
    reason?: string;
  } {
    const validator = this.validators.get(vote.validatorId);
    if (!validator) {
      return {
        accepted: false,
        quorumReached: false,
        signedVotingPower: 0n,
        equivocationDetected: false,
        reason: 'Unknown validator',
      };
    }

    if (validator.slashed) {
      return {
        accepted: false,
        quorumReached: false,
        signedVotingPower: 0n,
        equivocationDetected: false,
        reason: 'Validator is slashed',
      };
    }

    const proposal = this.proposals.get(vote.checkpointHash);
    if (!proposal || proposal.height !== vote.height || proposal.epoch !== vote.epoch) {
      return {
        accepted: false,
        quorumReached: false,
        signedVotingPower: 0n,
        equivocationDetected: false,
        reason: 'Unknown checkpoint proposal or height/epoch mismatch',
      };
    }

    const sigValid = BFTStateCheckpointVerifier.verifyVoteSignature(
      vote.height,
      vote.epoch,
      vote.checkpointHash,
      vote.signature,
      validator.publicKey
    );
    if (!sigValid) {
      return {
        accepted: false,
        quorumReached: false,
        signedVotingPower: 0n,
        equivocationDetected: false,
        reason: 'Invalid cryptographic signature',
      };
    }

    // Equivocation detection: did this validator already sign a DIFFERENT hash at this height?
    if (!this.votesByHeight.has(vote.height)) {
      this.votesByHeight.set(vote.height, new Map());
    }
    const heightVotes = this.votesByHeight.get(vote.height)!;
    const priorVote = heightVotes.get(vote.validatorId);

    if (priorVote && priorVote.checkpointHash !== vote.checkpointHash) {
      // Byzantine double-signing detected! Slash validator and record evidence.
      validator.slashed = true;
      this.equivocations.push({
        validatorId: vote.validatorId,
        height: vote.height,
        firstCheckpointHash: priorVote.checkpointHash,
        conflictingCheckpointHash: vote.checkpointHash,
        firstSignature: priorVote.signature,
        conflictingSignature: vote.signature,
        detectedAt: Date.now(),
      });
      // Remove prior vote from prior hash bucket
      this.votesByHash.get(priorVote.checkpointHash)?.delete(vote.validatorId);

      return {
        accepted: false,
        quorumReached: false,
        signedVotingPower: this.computeSignedPower(vote.checkpointHash),
        equivocationDetected: true,
        reason: 'Byzantine equivocation detected: validator signed conflicting checkpoints at same height',
      };
    }

    heightVotes.set(vote.validatorId, vote);
    this.votesByHash.get(vote.checkpointHash)!.set(vote.validatorId, vote);

    const signedVotingPower = this.computeSignedPower(vote.checkpointHash);
    const quorumReached = signedVotingPower >= this.getQuorumThreshold();

    return {
      accepted: true,
      quorumReached,
      signedVotingPower,
      equivocationDetected: false,
    };
  }

  private computeSignedPower(checkpointHash: string): bigint {
    const hashVotes = this.votesByHash.get(checkpointHash);
    if (!hashVotes) return 0n;
    let power = 0n;
    for (const valId of hashVotes.keys()) {
      const v = this.validators.get(valId);
      if (v && !v.slashed) {
        power += v.votingPower;
      }
    }
    return power;
  }

  /**
   * Builds and stores an immutable Checkpoint Quorum Certificate once 2f + 1 power is reached.
   */
  public buildQuorumCertificate(checkpointHash: string): CheckpointQuorumCertificate {
    const proposal = this.proposals.get(checkpointHash);
    if (!proposal) {
      throw new Error(`Proposal ${checkpointHash} not found`);
    }

    const signedVotingPower = this.computeSignedPower(checkpointHash);
    const threshold = this.getQuorumThreshold();
    if (signedVotingPower < threshold) {
      throw new Error(`Insufficient voting power for quorum: ${signedVotingPower} / ${threshold}`);
    }

    const signatures: Record<string, string> = {};
    const hashVotes = this.votesByHash.get(checkpointHash)!;
    for (const [valId, vote] of hashVotes.entries()) {
      const v = this.validators.get(valId);
      if (v && !v.slashed) {
        signatures[valId] = vote.signature;
      }
    }

    const cert: CheckpointQuorumCertificate = {
      height: proposal.height,
      epoch: proposal.epoch,
      stateRoot: proposal.stateRoot,
      prevCheckpointHash: proposal.prevCheckpointHash,
      checkpointHash: proposal.checkpointHash,
      totalVotingPower: this.totalVotingPower,
      signedVotingPower,
      signatures,
      finalizedAt: Date.now(),
    };

    this.certificates.set(proposal.height, cert);
    return cert;
  }

  /**
   * Stateless light-client verification of a Checkpoint Quorum Certificate.
   */
  public static verifyCheckpointCertificate(
    cert: CheckpointQuorumCertificate,
    validators: CheckpointValidator[]
  ): CheckpointVerificationResult {
    const totalPower = validators
      .filter((v) => !v.slashed)
      .reduce((acc, v) => acc + v.votingPower, 0n);
    const quorumThreshold = this.computeQuorumThreshold(totalPower);

    // 1. Recompute digest
    const expectedHash = this.computeCheckpointHash(
      cert.height,
      cert.epoch,
      cert.stateRoot,
      cert.prevCheckpointHash
    );
    if (cert.checkpointHash !== expectedHash) {
      return {
        isValid: false,
        reason: 'Checkpoint hash digest mismatch',
        signedVotingPower: 0n,
        quorumThreshold,
      };
    }

    // 2. Verify signatures and sum voting power
    const valMap = new Map(validators.map((v) => [v.id, v]));
    let verifiedPower = 0n;

    for (const [valId, sig] of Object.entries(cert.signatures)) {
      const val = valMap.get(valId);
      if (!val || val.slashed) continue;

      const valid = this.verifyVoteSignature(
        cert.height,
        cert.epoch,
        cert.checkpointHash,
        sig,
        val.publicKey
      );
      if (!valid) {
        return {
          isValid: false,
          reason: `Invalid signature from validator ${valId}`,
          signedVotingPower: verifiedPower,
          quorumThreshold,
        };
      }
      verifiedPower += val.votingPower;
    }

    if (verifiedPower < quorumThreshold) {
      return {
        isValid: false,
        reason: `Insufficient verified voting power: ${verifiedPower} < ${quorumThreshold}`,
        signedVotingPower: verifiedPower,
        quorumThreshold,
      };
    }

    return {
      isValid: true,
      signedVotingPower: verifiedPower,
      quorumThreshold,
    };
  }
}
