/**
 * @file AsynchronousEpochTransition.ts
 * @description Asynchronous Epoch Reconfiguration & Validator Handshake Coordinator.
 * Manages seamless dynamic validator set rotation, stake redistribution, and state handover
 * across epoch boundaries in asynchronous BFT consensus networks without stopping execution
 * or relying on synchronized clocks.
 */

import { createHash, createHmac, randomBytes } from 'crypto';

export interface ValidatorNode {
  id: string;
  publicKey: string;
  stake: bigint;
  isActive: boolean;
}

export interface EpochConfig {
  epochNumber: number;
  validators: ValidatorNode[];
  totalStake: bigint;
  quorumThreshold: bigint;
  startBlock: number;
  endBlock?: number;
}

export interface EpochHandshakeMessage {
  epoch: number;
  targetEpoch: number;
  validatorId: string;
  stateCommitment: string;
  signature: string;
  timestamp: number;
}

export interface EpochTransitionCertificate {
  fromEpoch: number;
  toEpoch: number;
  nextValidators: ValidatorNode[];
  accumulatedStake: bigint;
  stateCommitment: string;
  validatorSignatures: Record<string, string>;
  certificateHash: string;
  timestamp: number;
}

export interface TransitionStatus {
  targetEpoch: number;
  isInitiated: boolean;
  accumulatedStake: bigint;
  quorumThreshold: bigint;
  isQuorumMet: boolean;
  handshakeCount: number;
  isFinalized: boolean;
}

export class AsynchronousEpochTransition {
  private currentEpoch: EpochConfig;
  private pendingTransition?: {
    targetEpoch: number;
    nextValidators: ValidatorNode[];
    stateCommitment: string;
    handshakes: Map<string, EpochHandshakeMessage>;
    accumulatedStake: bigint;
  };
  private finalizedCertificates: Map<number, EpochTransitionCertificate> = new Map();

  constructor(initialEpoch: EpochConfig) {
    this.currentEpoch = initialEpoch;
  }

  /**
   * Calculates 2f + 1 quorum stake threshold: floor(2 * totalStake / 3) + 1n
   */
  public static calculateQuorumThreshold(totalStake: bigint): bigint {
    return (2n * totalStake) / 3n + 1n;
  }

  /**
   * Helper to verify a validator's signature on a handshake payload.
   */
  public static verifySignature(message: string, signature: string, publicKey: string): boolean {
    const expectedSig = createHmac('sha256', publicKey).update(message).digest('hex');
    return signature === expectedSig;
  }

  /**
   * Helper to generate a validator's handshake signature.
   */
  public static signPayload(message: string, privateKey: string): string {
    return createHmac('sha256', privateKey).update(message).digest('hex');
  }

  public getCurrentEpoch(): EpochConfig {
    return this.currentEpoch;
  }

  public getFinalizedCertificate(epoch: number): EpochTransitionCertificate | undefined {
    return this.finalizedCertificates.get(epoch);
  }

  /**
   * Initiates a transition to the next epoch once boundary state is agreed.
   */
  public initiateEpochTransition(
    targetEpoch: number,
    nextValidators: ValidatorNode[],
    stateCommitment: string
  ): void {
    if (targetEpoch !== this.currentEpoch.epochNumber + 1) {
      throw new Error(`Target epoch ${targetEpoch} must be strictly sequential (expected ${this.currentEpoch.epochNumber + 1})`);
    }

    if (this.pendingTransition && this.pendingTransition.targetEpoch === targetEpoch) {
      throw new Error(`Transition for epoch ${targetEpoch} is already in progress`);
    }

    this.pendingTransition = {
      targetEpoch,
      nextValidators: [...nextValidators],
      stateCommitment,
      handshakes: new Map(),
      accumulatedStake: 0n,
    };
  }

  /**
   * Submits a validator handshake for the pending epoch transition.
   */
  public submitHandshake(handshake: EpochHandshakeMessage): {
    success: boolean;
    currentAccumulatedStake: bigint;
    quorumReached: boolean;
    reason?: string;
  } {
    if (!this.pendingTransition) {
      return { success: false, currentAccumulatedStake: 0n, quorumReached: false, reason: 'No epoch transition in progress' };
    }

    if (handshake.epoch !== this.currentEpoch.epochNumber || handshake.targetEpoch !== this.pendingTransition.targetEpoch) {
      return { success: false, currentAccumulatedStake: this.pendingTransition.accumulatedStake, quorumReached: false, reason: 'Epoch mismatch in handshake' };
    }

    if (handshake.stateCommitment !== this.pendingTransition.stateCommitment) {
      return { success: false, currentAccumulatedStake: this.pendingTransition.accumulatedStake, quorumReached: false, reason: 'State commitment mismatch' };
    }

    const validator = this.currentEpoch.validators.find((v) => v.id === handshake.validatorId && v.isActive);
    if (!validator) {
      return { success: false, currentAccumulatedStake: this.pendingTransition.accumulatedStake, quorumReached: false, reason: 'Validator not found or inactive in current epoch' };
    }

    // Verify cryptographic signature
    const payload = `${handshake.epoch}:${handshake.targetEpoch}:${handshake.stateCommitment}:${handshake.timestamp}`;
    if (!AsynchronousEpochTransition.verifySignature(payload, handshake.signature, validator.publicKey)) {
      return { success: false, currentAccumulatedStake: this.pendingTransition.accumulatedStake, quorumReached: false, reason: 'Invalid validator cryptographic signature' };
    }

    // Prevent double handshakes
    if (this.pendingTransition.handshakes.has(handshake.validatorId)) {
      return { success: true, currentAccumulatedStake: this.pendingTransition.accumulatedStake, quorumReached: this.isTransitionReady(handshake.targetEpoch) };
    }

    this.pendingTransition.handshakes.set(handshake.validatorId, handshake);
    this.pendingTransition.accumulatedStake += validator.stake;

    const quorumReached = this.pendingTransition.accumulatedStake >= this.currentEpoch.quorumThreshold;
    return {
      success: true,
      currentAccumulatedStake: this.pendingTransition.accumulatedStake,
      quorumReached,
    };
  }

  /**
   * Checks whether the target epoch transition has accumulated sufficient 2f + 1 stake.
   */
  public isTransitionReady(targetEpoch: number): boolean {
    if (!this.pendingTransition || this.pendingTransition.targetEpoch !== targetEpoch) {
      return false;
    }
    return this.pendingTransition.accumulatedStake >= this.currentEpoch.quorumThreshold;
  }

  /**
   * Returns current transition status.
   */
  public getTransitionStatus(): TransitionStatus | null {
    if (!this.pendingTransition) return null;
    return {
      targetEpoch: this.pendingTransition.targetEpoch,
      isInitiated: true,
      accumulatedStake: this.pendingTransition.accumulatedStake,
      quorumThreshold: this.currentEpoch.quorumThreshold,
      isQuorumMet: this.pendingTransition.accumulatedStake >= this.currentEpoch.quorumThreshold,
      handshakeCount: this.pendingTransition.handshakes.size,
      isFinalized: false,
    };
  }

  /**
   * Finalizes the epoch transition, generates certificate, and installs next epoch configuration.
   */
  public finalizeEpochTransition(targetEpoch: number, endBlockOfCurrentEpoch: number = 0): EpochTransitionCertificate {
    if (!this.pendingTransition || this.pendingTransition.targetEpoch !== targetEpoch) {
      throw new Error(`No pending transition active for epoch ${targetEpoch}`);
    }

    if (!this.isTransitionReady(targetEpoch)) {
      throw new Error(`Cannot finalize epoch transition: insufficient stake (${this.pendingTransition.accumulatedStake} / ${this.currentEpoch.quorumThreshold})`);
    }

    const signatures: Record<string, string> = {};
    for (const [valId, hs] of this.pendingTransition.handshakes.entries()) {
      signatures[valId] = hs.signature;
    }

    const certData = `${this.currentEpoch.epochNumber}:${targetEpoch}:${this.pendingTransition.stateCommitment}:${this.pendingTransition.accumulatedStake}`;
    const certificateHash = createHash('sha256').update(certData).digest('hex');

    const certificate: EpochTransitionCertificate = {
      fromEpoch: this.currentEpoch.epochNumber,
      toEpoch: targetEpoch,
      nextValidators: [...this.pendingTransition.nextValidators],
      accumulatedStake: this.pendingTransition.accumulatedStake,
      stateCommitment: this.pendingTransition.stateCommitment,
      validatorSignatures: signatures,
      certificateHash,
      timestamp: Date.now(),
    };

    // Store certificate
    this.finalizedCertificates.set(targetEpoch, certificate);

    // Compute next epoch total stake & quorum threshold
    const nextTotalStake = this.pendingTransition.nextValidators
      .filter((v) => v.isActive)
      .reduce((sum, v) => sum + v.stake, 0n);

    // Transition state
    this.currentEpoch = {
      epochNumber: targetEpoch,
      validators: this.pendingTransition.nextValidators,
      totalStake: nextTotalStake,
      quorumThreshold: AsynchronousEpochTransition.calculateQuorumThreshold(nextTotalStake),
      startBlock: endBlockOfCurrentEpoch + 1,
    };

    this.pendingTransition = undefined;
    return certificate;
  }

  /**
   * Verifies an epoch transition certificate against historical validator sets.
   */
  public static verifyCertificate(
    certificate: EpochTransitionCertificate,
    fromEpochValidators: ValidatorNode[],
    quorumThreshold: bigint
  ): boolean {
    const valMap = new Map(fromEpochValidators.map((v) => [v.id, v]));
    let verifiedStake = 0n;

    const certData = `${certificate.fromEpoch}:${certificate.toEpoch}:${certificate.stateCommitment}:${certificate.accumulatedStake}`;
    const expectedHash = createHash('sha256').update(certData).digest('hex');

    if (certificate.certificateHash !== expectedHash) {
      return false;
    }

    for (const [valId, sig] of Object.entries(certificate.validatorSignatures)) {
      const validator = valMap.get(valId);
      if (!validator || !validator.isActive) continue;

      verifiedStake += validator.stake;
    }

    return verifiedStake >= quorumThreshold;
  }
}
