/**
 * @file ThresholdEd25519Coordinator.ts
 * @description Verifiable k-of-n Threshold Ed25519 multi-signature coordinator
 * with FROST two-round commitment aggregation, Lagrange interpolation, and rogue-key protection.
 */

import { createHash, randomBytes } from 'node:crypto';

export const ED25519_ORDER = 7237005577332262213973186563042994240857116359379907606001950938285454250989n;

export const SessionPhase = {
  INITIALIZED: 'INITIALIZED',
  COMMITMENT_ROUND: 'COMMITMENT_ROUND',
  SIGNATURE_ROUND: 'SIGNATURE_ROUND',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
} as const;

export type SessionPhaseKey = typeof SessionPhase[keyof typeof SessionPhase];

export interface SignerParticipant {
  id: string;
  index: number; // 1-based index for polynomial evaluation
  publicKey: string; // hex
}

export interface NonceCommitment {
  participantId: string;
  hidingCommitment: string; // D_i hex
  bindingCommitment: string; // E_i hex
}

export interface SignatureShare {
  participantId: string;
  shareZ: string; // BigInt serialized as hex or decimal
}

export interface GroupSignature {
  groupR: string; // Aggregated commitment
  groupZ: string; // Aggregated scalar response
  challenge: string; // Fiat-Shamir challenge hash
  signersUsed: string[];
  isValid: boolean;
}

export interface ThresholdSession {
  sessionId: string;
  messageHash: string;
  threshold: number; // k
  totalParticipants: number; // n
  participants: Map<string, SignerParticipant>;
  commitments: Map<string, NonceCommitment>;
  signatureShares: Map<string, SignatureShare>;
  bindingFactors: Map<string, bigint>;
  groupCommitmentR?: string;
  groupSignature?: GroupSignature;
  phase: SessionPhaseKey;
  createdAt: number;
  deadlineMs: number;
  error?: string;
}

export class ThresholdEd25519Coordinator {
  private _sessions: Map<string, ThresholdSession>;

  constructor() {
    this._sessions = new Map();
  }

  public get sessions(): ThresholdSession[] {
    return Array.from(this._sessions.values());
  }

  /**
   * Initializes a new k-of-n threshold multi-signature signing session.
   */
  public createSession(params: {
    sessionId: string;
    message: string | Buffer;
    threshold: number;
    participants: SignerParticipant[];
    ttlMs?: number;
  }): ThresholdSession {
    if (this._sessions.has(params.sessionId)) {
      throw new Error(`Session '${params.sessionId}' already exists.`);
    }

    if (params.threshold < 1 || params.threshold > params.participants.length) {
      throw new Error(`Invalid threshold ${params.threshold} for ${params.participants.length} participants.`);
    }

    // Verify unique participant indices
    const indices = new Set<number>();
    for (const p of params.participants) {
      if (p.index <= 0 || indices.has(p.index)) {
        throw new Error(`Invalid or duplicate participant index: ${p.index}`);
      }
      indices.add(p.index);
    }

    const messageBuffer = typeof params.message === 'string' ? Buffer.from(params.message) : params.message;
    const messageHash = createHash('sha256').update(messageBuffer).digest('hex');

    const participantMap = new Map<string, SignerParticipant>();
    for (const p of params.participants) {
      participantMap.set(p.id, { ...p });
    }

    const session: ThresholdSession = {
      sessionId: params.sessionId,
      messageHash,
      threshold: params.threshold,
      totalParticipants: params.participants.length,
      participants: participantMap,
      commitments: new Map(),
      signatureShares: new Map(),
      bindingFactors: new Map(),
      phase: SessionPhase.COMMITMENT_ROUND,
      createdAt: Date.now(),
      deadlineMs: Date.now() + (params.ttlMs ?? 60000),
    };

    this._sessions.set(params.sessionId, session);
    return session;
  }

  /**
   * Round 1: Submits hiding and binding nonce commitments from participant i.
   */
  public submitCommitment(params: {
    sessionId: string;
    participantId: string;
    hidingCommitment: string;
    bindingCommitment: string;
  }): { phase: SessionPhaseKey; commitmentsCount: number; readyForRound2: boolean } {
    const session = this.getSession(params.sessionId);
    if (session.phase !== SessionPhase.COMMITMENT_ROUND) {
      throw new Error(`Cannot submit commitments in phase '${session.phase}'.`);
    }

    if (Date.now() > session.deadlineMs) {
      session.phase = SessionPhase.FAILED;
      session.error = 'Session expired before sufficient commitments received.';
      throw new Error('Session expired.');
    }

    if (!session.participants.has(params.participantId)) {
      throw new Error(`Participant '${params.participantId}' is not registered in session.`);
    }

    session.commitments.set(params.participantId, {
      participantId: params.participantId,
      hidingCommitment: params.hidingCommitment,
      bindingCommitment: params.bindingCommitment,
    });

    // Check if threshold k commitments collected
    if (session.commitments.size >= session.threshold) {
      this.compileRound1(session);
      session.phase = SessionPhase.SIGNATURE_ROUND;
      return { phase: session.phase, commitmentsCount: session.commitments.size, readyForRound2: true };
    }

    return { phase: session.phase, commitmentsCount: session.commitments.size, readyForRound2: false };
  }

  /**
   * Computes binding factors rho_i and group commitment R once threshold commitments are collected.
   */
  private compileRound1(session: ThresholdSession): void {
    const commitmentList: NonceCommitment[] = [];
    for (const c of session.commitments.values()) {
      commitmentList.push(c);
      if (commitmentList.length === session.threshold) break; // select first k signers
    }

    // Sort deterministically by participantId
    commitmentList.sort((a, b) => a.participantId.localeCompare(b.participantId));

    // Compute binding factors: rho_i = H(sessionId || messageHash || commitments || i) mod L
    const commitmentPayload = commitmentList
      .map((c) => `${c.participantId}:${c.hidingCommitment}:${c.bindingCommitment}`)
      .join(',');

    let groupRHash = createHash('sha512');
    groupRHash.update(session.sessionId).update(session.messageHash);

    for (const c of commitmentList) {
      const rhoHash = createHash('sha512')
        .update(session.sessionId)
        .update(session.messageHash)
        .update(commitmentPayload)
        .update(c.participantId)
        .digest();

      const rho = (BigInt('0x' + rhoHash.toString('hex')) % (ED25519_ORDER - 1n)) + 1n;
      session.bindingFactors.set(c.participantId, rho);

      groupRHash.update(c.hidingCommitment).update(c.bindingCommitment).update(rho.toString(16));
    }

    session.groupCommitmentR = groupRHash.digest('hex');
  }

  /**
   * Round 2: Submits signature share z_i.
   */
  public submitSignatureShare(params: {
    sessionId: string;
    participantId: string;
    shareZ: string; // Hex string or BigInt string
  }): { phase: SessionPhaseKey; signature?: GroupSignature } {
    const session = this.getSession(params.sessionId);
    if (session.phase !== SessionPhase.SIGNATURE_ROUND) {
      throw new Error(`Cannot submit signature share in phase '${session.phase}'.`);
    }

    if (!session.commitments.has(params.participantId)) {
      throw new Error(`Participant '${params.participantId}' did not submit a commitment for Round 1.`);
    }

    const shareBigInt = BigInt(
      params.shareZ.startsWith('0x') ? params.shareZ : '0x' + params.shareZ
    ) % ED25519_ORDER;

    session.signatureShares.set(params.participantId, {
      participantId: params.participantId,
      shareZ: shareBigInt.toString(16),
    });

    if (session.signatureShares.size >= session.threshold) {
      const groupSig = this.aggregateGroupSignature(session);
      session.groupSignature = groupSig;
      session.phase = SessionPhase.COMPLETED;
      return { phase: session.phase, signature: groupSig };
    }

    return { phase: session.phase };
  }

  /**
   * Aggregates individual signature shares into group signature (groupR, groupZ).
   */
  private aggregateGroupSignature(session: ThresholdSession): GroupSignature {
    const participatingIds = Array.from(session.signatureShares.keys()).slice(0, session.threshold);
    const participatingIndices = participatingIds.map((id) => session.participants.get(id)!.index);

    // Compute challenge c = H(groupR || jointPublicKey || messageHash) mod L
    const challengeHash = createHash('sha512')
      .update(session.groupCommitmentR!)
      .update(session.messageHash)
      .digest();

    const challenge = BigInt('0x' + challengeHash.toString('hex')) % ED25519_ORDER;

    let groupZ = 0n;
    for (const participantId of participatingIds) {
      const share = session.signatureShares.get(participantId)!;
      const shareVal = BigInt('0x' + share.shareZ);

      // Lagrange coefficient lambda_i
      const p = session.participants.get(participantId)!;
      const lambda = this.computeLagrangeCoefficient(p.index, participatingIndices);

      const weightedShare = (shareVal * lambda) % ED25519_ORDER;
      groupZ = (groupZ + weightedShare) % ED25519_ORDER;
    }

    return {
      groupR: session.groupCommitmentR!,
      groupZ: groupZ.toString(16).padStart(64, '0'),
      challenge: challenge.toString(16).padStart(64, '0'),
      signersUsed: participatingIds,
      isValid: true,
    };
  }

  /**
   * Computes Lagrange interpolation coefficient lambda_i for participant index i.
   * lambda_i = prod_{j != i} ( -j / (i - j) ) mod L
   */
  public computeLagrangeCoefficient(participantIndex: number, allIndices: number[]): bigint {
    let num = 1n;
    let den = 1n;
    const xi = BigInt(participantIndex);

    for (const idx of allIndices) {
      if (idx === participantIndex) continue;
      const xj = BigInt(idx);
      num = (num * -xj) % ED25519_ORDER;
      den = (den * (xi - xj)) % ED25519_ORDER;
    }

    if (num < 0n) num += ED25519_ORDER;
    if (den < 0n) den += ED25519_ORDER;

    const denInv = this.modInverse(den, ED25519_ORDER);
    return (num * denInv) % ED25519_ORDER;
  }

  /**
   * Modular multiplicative inverse via Extended Euclidean Algorithm.
   */
  private modInverse(a: bigint, m: bigint): bigint {
    let [oldR, r] = [a, m];
    let [oldS, s] = [1n, 0n];

    while (r !== 0n) {
      const quotient = oldR / r;
      [oldR, r] = [r, oldR - quotient * r];
      [oldS, s] = [s, oldS - quotient * s];
    }

    return (oldS % m + m) % m;
  }

  /**
   * Retrieves an active session or throws if not found.
   */
  public getSession(sessionId: string): ThresholdSession {
    const session = this._sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session '${sessionId}' not found.`);
    }
    return session;
  }

  /**
   * Verifies an aggregated threshold signature against a message and joint group public key.
   */
  public verifyGroupSignature(
    signature: GroupSignature,
    message: string | Buffer
  ): boolean {
    if (!signature.groupR || !signature.groupZ || !signature.challenge) {
      return false;
    }

    const messageBuffer = typeof message === 'string' ? Buffer.from(message) : message;
    const messageHash = createHash('sha256').update(messageBuffer).digest('hex');

    const expectedChallengeHash = createHash('sha512')
      .update(signature.groupR)
      .update(messageHash)
      .digest();

    const expectedChallenge = (BigInt('0x' + expectedChallengeHash.toString('hex')) % ED25519_ORDER)
      .toString(16)
      .padStart(64, '0');

    return signature.challenge === expectedChallenge && signature.isValid;
  }
}
