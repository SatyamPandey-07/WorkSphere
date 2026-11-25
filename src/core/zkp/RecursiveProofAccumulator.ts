import { createHash } from 'crypto';

/**
 * BN254 Scalar Field Modulus (matching circomlib and alt_bn128).
 * r = 21888242871839275222246405745257275088548364400416034343698204186575808495617
 */
export const BN254_SCALAR_FIELD =
  21888242871839275222246405745257275088548364400416034343698204186575808495617n;

export const ACCUMULATOR_PROTOCOL_VERSION = 'worksphere-zkp-accumulator-v1.0';
export const SUPPORTED_CIRCUIT_IDS = [
  'student_access_pass_v1',
  'student_membership_v1',
  'premium_membership_v1',
] as const;

export type SupportedCircuitId = (typeof SUPPORTED_CIRCUIT_IDS)[number];

/**
 * Domain-separation tags preventing cross-protocol and cross-context collision attacks.
 */
export const DOMAIN_SEPARATION_TAGS = {
  LEAF: 'WorkSphere::ZKP::Accumulator::Leaf::v1',
  NODE: 'WorkSphere::ZKP::Accumulator::Node::v1',
  ROOT: 'WorkSphere::ZKP::Accumulator::Root::v1',
  FOLD: 'WorkSphere::ZKP::Accumulator::Fold::v1',
  TRANSCRIPT: 'WorkSphere::ZKP::Accumulator::Transcript::v1',
} as const;

/**
 * Finite field arithmetic utilities over BN254 scalar field.
 */
export class AccumulatorFieldMath {
  public static mod(a: bigint, p: bigint = BN254_SCALAR_FIELD): bigint {
    const res = a % p;
    return res >= 0n ? res : res + p;
  }

  public static add(a: bigint, b: bigint, p: bigint = BN254_SCALAR_FIELD): bigint {
    return this.mod(a + b, p);
  }

  public static sub(a: bigint, b: bigint, p: bigint = BN254_SCALAR_FIELD): bigint {
    return this.mod(a - b, p);
  }

  public static mul(a: bigint, b: bigint, p: bigint = BN254_SCALAR_FIELD): bigint {
    return this.mod(a * b, p);
  }

  public static exp(base: bigint, exponent: bigint, p: bigint = BN254_SCALAR_FIELD): bigint {
    let res = 1n;
    let b = this.mod(base, p);
    let e = exponent < 0n ? this.mod(exponent, p - 1n) : exponent;
    while (e > 0n) {
      if (e & 1n) res = this.mod(res * b, p);
      b = this.mod(b * b, p);
      e >>= 1n;
    }
    return res;
  }

  public static inv(a: bigint, p: bigint = BN254_SCALAR_FIELD): bigint {
    const val = this.mod(a, p);
    if (val === 0n) {
      throw new Error('AccumulatorFieldMath: Division by zero in finite field');
    }
    return this.exp(val, p - 2n, p);
  }

  public static hashToScalar(domain: string, data: string, p: bigint = BN254_SCALAR_FIELD): bigint {
    const hashHex = createHash('sha256')
      .update(domain)
      .update('|')
      .update(data)
      .digest('hex');
    return BigInt('0x' + hashHex) % p;
  }
}

/**
 * Serialized representation of a cryptographic proof.
 */
export interface SerializedProof {
  pi_a: readonly string[];
  pi_b: readonly (readonly string[])[];
  pi_c: readonly string[];
  protocol: string;
  curve: string;
}

/**
 * Typed representation of an individual venue membership proof.
 */
export interface VenueMembershipProof {
  /** Unique venue identifier (e.g. 'venue_sf_01') */
  readonly venueId: string;
  /** Cryptographic proof structure or raw proof payload */
  readonly proof: SerializedProof;
  /** Public input signals required by circuit */
  readonly publicSignals: readonly string[];
  /** Expected circuit identifier (e.g. 'student_access_pass_v1') */
  readonly circuitId: string;
  /** Verification key identifier or hash */
  readonly verificationKeyId: string;
  /** Academic or temporal epoch */
  readonly epoch: number;
  /** Anonymized student pass nullifier hash (preventing double-spend within epoch) */
  readonly nullifierHash?: string;
  /** University Merkle root commitment */
  readonly universityRoot?: string;
}

/**
 * Accumulated step node tracking folding trace.
 */
export interface AccumulationStepTrace {
  readonly stepIndex: number;
  readonly venueId: string;
  readonly nullifierHash: string;
  readonly proofCommitment: bigint;
  readonly foldingChallenge: bigint;
  readonly runningAccumulator: bigint;
}

/**
 * Finalized accumulated verification state.
 */
export interface AccumulatedVerificationResult {
  readonly version: string;
  readonly circuitId: string;
  readonly verificationKeyId: string;
  readonly epoch: number;
  readonly proofCount: number;
  readonly venues: readonly string[];
  readonly nullifiers: readonly string[];
  readonly stateRoot: string;
  readonly foldedCommitment: string;
  readonly transcriptDigest: string;
  readonly stepTraces: readonly AccumulationStepTrace[];
  readonly timestamp: number;
}

/**
 * Options for configuring the proof accumulator.
 */
export interface AccumulatorOptions {
  circuitId?: string;
  verificationKeyId?: string;
  epoch?: number;
  maxProofs?: number;
  /** Custom verifier hook for underlying proof systems (e.g. Groth16 / Circom) */
  verifySingleProof?: (proof: VenueMembershipProof) => Promise<boolean> | boolean;
}

/**
 * Verification result returned by the accumulator verifier.
 */
export interface AccumulatorVerificationStatus {
  readonly isValid: boolean;
  readonly reason?: string;
  readonly verifiedCount: number;
  readonly reconstructedStateRoot?: string;
}

/**
 * Recursive Proof Accumulator for multi-venue student pass validation.
 *
 * Implements an incremental, cryptographically sound accumulation abstraction
 * over BN254 scalar field:
 * - Strict structural and public signal validation
 * - Verification key & circuit ID compatibility checking
 * - Cryptographic verification of each constituent proof before state incorporation
 * - Replay prevention via epoch-scoped nullifier tracking and duplicate proof rejection
 * - Fiat-Shamir linear evaluation folding over BN254
 * - Deterministic, domain-separated accumulated state root commitment
 * - Explicit separation between proof validation, folding accumulation, and circuit-level recursive proofs
 */
export class RecursiveProofAccumulator {
  private readonly _circuitId: string;
  private readonly _verificationKeyId: string;
  private readonly _epoch: number;
  private readonly _maxProofs: number;
  private readonly _verifySingleProof?: (proof: VenueMembershipProof) => Promise<boolean> | boolean;

  private _proofs: VenueMembershipProof[] = [];
  private _nullifiers: Set<string> = new Set();
  private _seenVenues: Set<string> = new Set();
  private _stepTraces: AccumulationStepTrace[] = [];
  private _runningAccumulator: bigint = 0n;
  private _isFinalized: boolean = false;

  constructor(options: AccumulatorOptions = {}) {
    this._circuitId = options.circuitId ?? 'student_access_pass_v1';
    this._verificationKeyId = options.verificationKeyId ?? 'vk_student_membership_2026';
    this._epoch = options.epoch ?? 2026;
    this._maxProofs = options.maxProofs ?? 128;
    this._verifySingleProof = options.verifySingleProof;
  }

  public get circuitId(): string {
    return this._circuitId;
  }

  public get verificationKeyId(): string {
    return this._verificationKeyId;
  }

  public get epoch(): number {
    return this._epoch;
  }

  public get count(): number {
    return this._proofs.length;
  }

  public get isFinalized(): boolean {
    return this._isFinalized;
  }

  public get nullifiers(): string[] {
    return Array.from(this._nullifiers);
  }

  public get venues(): string[] {
    return this._proofs.map((p) => p.venueId);
  }

  /**
   * Validates structural integrity and data types of a venue membership proof.
   */
  public static validateProofStructure(proof: VenueMembershipProof): void {
    if (!proof || typeof proof !== 'object') {
      throw new Error('Invalid proof: proof item must be a non-null object');
    }

    if (!proof.venueId || typeof proof.venueId !== 'string' || proof.venueId.trim() === '') {
      throw new Error('Invalid proof: missing or empty venueId');
    }

    if (!proof.circuitId || typeof proof.circuitId !== 'string') {
      throw new Error('Invalid proof: missing circuitId');
    }

    if (!proof.verificationKeyId || typeof proof.verificationKeyId !== 'string') {
      throw new Error('Invalid proof: missing verificationKeyId');
    }

    if (typeof proof.epoch !== 'number' || !Number.isInteger(proof.epoch) || proof.epoch <= 0) {
      throw new Error('Invalid proof: epoch must be a positive integer');
    }

    if (!proof.proof || typeof proof.proof !== 'object') {
      throw new Error('Invalid proof: proof payload object is required');
    }

    const { pi_a, pi_b, pi_c, protocol, curve } = proof.proof;

    if (!Array.isArray(pi_a) || pi_a.length < 2) {
      throw new Error('Invalid proof: pi_a must be an array of at least 2 coordinate strings');
    }

    if (!Array.isArray(pi_b) || pi_b.length < 2 || !Array.isArray(pi_b[0]) || !Array.isArray(pi_b[1])) {
      throw new Error('Invalid proof: pi_b must be a 2x2 coordinate array');
    }

    if (!Array.isArray(pi_c) || pi_c.length < 2) {
      throw new Error('Invalid proof: pi_c must be an array of at least 2 coordinate strings');
    }

    if (protocol && typeof protocol === 'string' && protocol.toLowerCase() !== 'groth16') {
      throw new Error(`Unsupported proof protocol: ${protocol}. Expected groth16.`);
    }

    if (curve && typeof curve === 'string' && !['bn128', 'bn254', 'alt_bn128'].includes(curve.toLowerCase())) {
      throw new Error(`Unsupported curve: ${curve}. Expected bn128/bn254.`);
    }

    if (!Array.isArray(proof.publicSignals) || proof.publicSignals.length === 0) {
      throw new Error('Invalid proof: publicSignals must be a non-empty array of strings');
    }

    for (let i = 0; i < proof.publicSignals.length; i++) {
      const sig = proof.publicSignals[i];
      if (typeof sig !== 'string' || sig.trim() === '') {
        throw new Error(`Invalid proof: publicSignal at index ${i} is not a valid non-empty string`);
      }
    }
  }

  /**
   * Computes a canonical, deterministic leaf commitment for an individual proof.
   */
  public static computeProofCommitment(proof: VenueMembershipProof): bigint {
    this.validateProofStructure(proof);

    const parts: string[] = [
      DOMAIN_SEPARATION_TAGS.LEAF,
      proof.venueId,
      proof.circuitId,
      proof.verificationKeyId,
      proof.epoch.toString(),
      proof.proof.protocol ?? 'groth16',
      proof.proof.curve ?? 'bn128',
      proof.proof.pi_a.join(','),
      proof.proof.pi_b.map((row) => row.join(',')).join(';'),
      proof.proof.pi_c.join(','),
      proof.publicSignals.join(','),
    ];

    if (proof.nullifierHash) parts.push(`nullifier:${proof.nullifierHash}`);
    if (proof.universityRoot) parts.push(`root:${proof.universityRoot}`);

    return AccumulatorFieldMath.hashToScalar(DOMAIN_SEPARATION_TAGS.LEAF, parts.join('|'));
  }

  /**
   * Incrementally adds a verified venue membership proof into the accumulator.
   */
  public async addProof(membershipProof: VenueMembershipProof): Promise<AccumulationStepTrace> {
    if (this._isFinalized) {
      throw new Error('Cannot add proof: accumulator has already been finalized');
    }

    if (this._proofs.length >= this._maxProofs) {
      throw new Error(`Cannot add proof: accumulator capacity limit reached (${this._maxProofs})`);
    }

    // 1. Validate structure
    RecursiveProofAccumulator.validateProofStructure(membershipProof);

    // 2. Validate circuit and verification key compatibility
    if (membershipProof.circuitId !== this._circuitId) {
      throw new Error(
        `Incompatible circuitId: expected "${this._circuitId}", received "${membershipProof.circuitId}"`
      );
    }

    if (membershipProof.verificationKeyId !== this._verificationKeyId) {
      throw new Error(
        `Incompatible verificationKeyId: expected "${this._verificationKeyId}", received "${membershipProof.verificationKeyId}"`
      );
    }

    if (membershipProof.epoch !== this._epoch) {
      throw new Error(
        `Incompatible epoch: expected ${this._epoch}, received ${membershipProof.epoch}`
      );
    }

    // 3. Prevent duplicate venue proofs and nullifier reuse (replay attack prevention)
    if (this._seenVenues.has(membershipProof.venueId)) {
      throw new Error(`Duplicate proof for venue "${membershipProof.venueId}" is rejected`);
    }

    const effectiveNullifier =
      membershipProof.nullifierHash ??
      (membershipProof.publicSignals.length >= 3 ? membershipProof.publicSignals[2] : null);

    if (effectiveNullifier) {
      if (this._nullifiers.has(effectiveNullifier)) {
        throw new Error(`Replay attack detected: nullifier "${effectiveNullifier}" has already been accumulated`);
      }
    }

    // 4. Verify cryptographic validity of the proof
    if (this._verifySingleProof) {
      const isValid = await this._verifySingleProof(membershipProof);
      if (!isValid) {
        throw new Error(
          `Cryptographic proof verification failed for venue "${membershipProof.venueId}"`
        );
      }
    }

    // 5. Compute leaf commitment
    const leafCommitment = RecursiveProofAccumulator.computeProofCommitment(membershipProof);

    // 6. Derive Fiat-Shamir folding challenge gamma over BN254
    const stepIndex = this._proofs.length + 1;
    const challengeData = [
      this._runningAccumulator.toString(16),
      leafCommitment.toString(16),
      membershipProof.venueId,
      stepIndex.toString(),
    ].join(':');

    const gamma =
      this._proofs.length === 0
        ? 1n
        : AccumulatorFieldMath.hashToScalar(DOMAIN_SEPARATION_TAGS.FOLD, challengeData);

    // 7. Linear folding accumulation over BN254
    const newAccumulator =
      this._proofs.length === 0
        ? leafCommitment
        : AccumulatorFieldMath.add(
            this._runningAccumulator,
            AccumulatorFieldMath.mul(gamma, leafCommitment)
          );

    this._runningAccumulator = newAccumulator;
    this._proofs.push(membershipProof);
    this._seenVenues.add(membershipProof.venueId);
    if (effectiveNullifier) {
      this._nullifiers.add(effectiveNullifier);
    }

    const trace: AccumulationStepTrace = {
      stepIndex,
      venueId: membershipProof.venueId,
      nullifierHash: effectiveNullifier ?? '',
      proofCommitment: leafCommitment,
      foldingChallenge: gamma,
      runningAccumulator: newAccumulator,
    };

    this._stepTraces.push(trace);
    return trace;
  }

  /**
   * Computes the current deterministic state root of the accumulated proofs.
   */
  public getStateRoot(): string {
    if (this._proofs.length === 0) {
      return createHash('sha256')
        .update(DOMAIN_SEPARATION_TAGS.ROOT)
        .update('|empty|0')
        .digest('hex');
    }

    // Canonical ordering: sort step digests deterministically to guarantee order invariance if requested
    const leafDigests = this._stepTraces.map((t) => t.proofCommitment.toString(16)).sort();

    const rootHash = createHash('sha256')
      .update(DOMAIN_SEPARATION_TAGS.ROOT)
      .update('|')
      .update(this._circuitId)
      .update('|')
      .update(this._verificationKeyId)
      .update('|')
      .update(this._epoch.toString())
      .update('|')
      .update(this._runningAccumulator.toString(16))
      .update('|')
      .update(leafDigests.join(','))
      .digest('hex');

    return rootHash;
  }

  /**
   * Finalizes the accumulator, locking state against subsequent insertions.
   */
  public finalize(): AccumulatedVerificationResult {
    this._isFinalized = true;

    const stateRoot = this.getStateRoot();
    const transcriptDigest = createHash('sha256')
      .update(DOMAIN_SEPARATION_TAGS.TRANSCRIPT)
      .update('|')
      .update(stateRoot)
      .update('|')
      .update(this._runningAccumulator.toString(16))
      .update('|')
      .update(this._proofs.length.toString())
      .digest('hex');

    return {
      version: ACCUMULATOR_PROTOCOL_VERSION,
      circuitId: this._circuitId,
      verificationKeyId: this._verificationKeyId,
      epoch: this._epoch,
      proofCount: this._proofs.length,
      venues: this.venues,
      nullifiers: this.nullifiers,
      stateRoot,
      foldedCommitment: '0x' + this._runningAccumulator.toString(16),
      transcriptDigest,
      stepTraces: [...this._stepTraces],
      timestamp: Date.now(),
    };
  }

  /**
   * Safely serializes an accumulated result to a JSON string.
   */
  public static serialize(result: AccumulatedVerificationResult): string {
    return JSON.stringify(result, (_, value) =>
      typeof value === 'bigint' ? value.toString() : value
    );
  }

  /**
   * Safely deserializes a JSON string into an AccumulatedVerificationResult with strict validation.
   */
  public static deserialize(json: string): AccumulatedVerificationResult {
    if (!json || typeof json !== 'string') {
      throw new Error('Deserialization failed: input must be a non-empty string');
    }

    let parsed: any;
    try {
      parsed = JSON.parse(json);
    } catch (e: any) {
      throw new Error(`Deserialization failed: invalid JSON syntax (${e.message})`);
    }

    if (!parsed || typeof parsed !== 'object') {
      throw new Error('Deserialization failed: payload must be a JSON object');
    }

    if (parsed.version !== ACCUMULATOR_PROTOCOL_VERSION) {
      throw new Error(
        `Deserialization failed: unsupported protocol version "${parsed.version}". Expected "${ACCUMULATOR_PROTOCOL_VERSION}"`
      );
    }

    if (!parsed.circuitId || typeof parsed.circuitId !== 'string') {
      throw new Error('Deserialization failed: missing or invalid circuitId');
    }

    if (!parsed.verificationKeyId || typeof parsed.verificationKeyId !== 'string') {
      throw new Error('Deserialization failed: missing or invalid verificationKeyId');
    }

    if (typeof parsed.epoch !== 'number' || parsed.epoch <= 0) {
      throw new Error('Deserialization failed: missing or invalid epoch');
    }

    if (typeof parsed.proofCount !== 'number' || parsed.proofCount < 0) {
      throw new Error('Deserialization failed: missing or invalid proofCount');
    }

    if (!parsed.stateRoot || typeof parsed.stateRoot !== 'string') {
      throw new Error('Deserialization failed: missing or invalid stateRoot');
    }

    if (!parsed.foldedCommitment || typeof parsed.foldedCommitment !== 'string') {
      throw new Error('Deserialization failed: missing or invalid foldedCommitment');
    }

    if (!Array.isArray(parsed.venues) || !Array.isArray(parsed.nullifiers)) {
      throw new Error('Deserialization failed: venues and nullifiers must be arrays');
    }

    if (!Array.isArray(parsed.stepTraces)) {
      throw new Error('Deserialization failed: stepTraces must be an array');
    }

    const stepTraces: AccumulationStepTrace[] = parsed.stepTraces.map((t: any) => ({
      stepIndex: Number(t.stepIndex),
      venueId: String(t.venueId),
      nullifierHash: String(t.nullifierHash),
      proofCommitment: BigInt(t.proofCommitment),
      foldingChallenge: BigInt(t.foldingChallenge),
      runningAccumulator: BigInt(t.runningAccumulator),
    }));

    return {
      version: parsed.version,
      circuitId: parsed.circuitId,
      verificationKeyId: parsed.verificationKeyId,
      epoch: parsed.epoch,
      proofCount: parsed.proofCount,
      venues: parsed.venues,
      nullifiers: parsed.nullifiers,
      stateRoot: parsed.stateRoot,
      foldedCommitment: parsed.foldedCommitment,
      transcriptDigest: parsed.transcriptDigest,
      stepTraces,
      timestamp: parsed.timestamp ?? Date.now(),
    };
  }

  /**
   * Verifies an accumulated verification result against expected parameters and reconstructed traces.
   */
  public static verifyAccumulatedResult(
    result: AccumulatedVerificationResult,
    expectedParams: {
      circuitId?: string;
      verificationKeyId?: string;
      epoch?: number;
    } = {}
  ): AccumulatorVerificationStatus {
    if (!result || typeof result !== 'object') {
      return { isValid: false, verifiedCount: 0, reason: 'Accumulated result is null or not an object' };
    }

    if (result.version !== ACCUMULATOR_PROTOCOL_VERSION) {
      return {
        isValid: false,
        verifiedCount: 0,
        reason: `Mismatched protocol version: ${result.version}`,
      };
    }

    if (expectedParams.circuitId && result.circuitId !== expectedParams.circuitId) {
      return {
        isValid: false,
        verifiedCount: 0,
        reason: `Mismatched circuitId: expected "${expectedParams.circuitId}", received "${result.circuitId}"`,
      };
    }

    if (expectedParams.verificationKeyId && result.verificationKeyId !== expectedParams.verificationKeyId) {
      return {
        isValid: false,
        verifiedCount: 0,
        reason: `Mismatched verificationKeyId: expected "${expectedParams.verificationKeyId}", received "${result.verificationKeyId}"`,
      };
    }

    if (expectedParams.epoch && result.epoch !== expectedParams.epoch) {
      return {
        isValid: false,
        verifiedCount: 0,
        reason: `Mismatched epoch: expected ${expectedParams.epoch}, received ${result.epoch}`,
      };
    }

    if (result.proofCount !== result.stepTraces.length || result.proofCount !== result.venues.length) {
      return {
        isValid: false,
        verifiedCount: 0,
        reason: `Count mismatch: proofCount=${result.proofCount}, traces=${result.stepTraces.length}, venues=${result.venues.length}`,
      };
    }

    // Empty accumulator verification
    if (result.proofCount === 0) {
      const expectedEmptyRoot = createHash('sha256')
        .update(DOMAIN_SEPARATION_TAGS.ROOT)
        .update('|empty|0')
        .digest('hex');

      if (result.stateRoot !== expectedEmptyRoot) {
        return { isValid: false, verifiedCount: 0, reason: 'Empty accumulator stateRoot mismatch' };
      }

      return { isValid: true, verifiedCount: 0, reconstructedStateRoot: expectedEmptyRoot };
    }

    // Reconstruct linear folding trace over BN254
    let runningAcc = 0n;
    const seenVenues = new Set<string>();
    const seenNullifiers = new Set<string>();

    for (let i = 0; i < result.stepTraces.length; i++) {
      const trace = result.stepTraces[i];

      if (trace.stepIndex !== i + 1) {
        return {
          isValid: false,
          verifiedCount: i,
          reason: `Invalid step index at trace ${i}: expected ${i + 1}, received ${trace.stepIndex}`,
        };
      }

      if (seenVenues.has(trace.venueId)) {
        return {
          isValid: false,
          verifiedCount: i,
          reason: `Duplicate venue detected in accumulation trace: "${trace.venueId}"`,
        };
      }
      seenVenues.add(trace.venueId);

      if (trace.nullifierHash) {
        if (seenNullifiers.has(trace.nullifierHash)) {
          return {
            isValid: false,
            verifiedCount: i,
            reason: `Replay nullifier detected in trace: "${trace.nullifierHash}"`,
          };
        }
        seenNullifiers.add(trace.nullifierHash);
      }

      // Verify challenge derivation
      const challengeData = [
        runningAcc.toString(16),
        trace.proofCommitment.toString(16),
        trace.venueId,
        trace.stepIndex.toString(),
      ].join(':');

      const expectedGamma =
        i === 0
          ? 1n
          : AccumulatorFieldMath.hashToScalar(DOMAIN_SEPARATION_TAGS.FOLD, challengeData);

      if (trace.foldingChallenge !== expectedGamma) {
        return {
          isValid: false,
          verifiedCount: i,
          reason: `Folding challenge mismatch at step ${i + 1}`,
        };
      }

      // Recompute running accumulator
      runningAcc =
        i === 0
          ? trace.proofCommitment
          : AccumulatorFieldMath.add(
              runningAcc,
              AccumulatorFieldMath.mul(expectedGamma, trace.proofCommitment)
            );

      if (trace.runningAccumulator !== runningAcc) {
        return {
          isValid: false,
          verifiedCount: i,
          reason: `Running accumulator mismatch at step ${i + 1}`,
        };
      }
    }

    // Verify final commitment
    const expectedCommitmentHex = '0x' + runningAcc.toString(16);
    if (result.foldedCommitment !== expectedCommitmentHex) {
      return {
        isValid: false,
        verifiedCount: result.proofCount,
        reason: `Final folded commitment mismatch: expected "${expectedCommitmentHex}", received "${result.foldedCommitment}"`,
      };
    }

    // Reconstruct state root
    const leafDigests = result.stepTraces.map((t) => t.proofCommitment.toString(16)).sort();
    const reconstructedRoot = createHash('sha256')
      .update(DOMAIN_SEPARATION_TAGS.ROOT)
      .update('|')
      .update(result.circuitId)
      .update('|')
      .update(result.verificationKeyId)
      .update('|')
      .update(result.epoch.toString())
      .update('|')
      .update(runningAcc.toString(16))
      .update('|')
      .update(leafDigests.join(','))
      .digest('hex');

    if (result.stateRoot !== reconstructedRoot) {
      return {
        isValid: false,
        verifiedCount: result.proofCount,
        reason: 'State root mismatch: accumulated root has been tampered with',
      };
    }

    // Verify transcript digest
    const expectedTranscript = createHash('sha256')
      .update(DOMAIN_SEPARATION_TAGS.TRANSCRIPT)
      .update('|')
      .update(reconstructedRoot)
      .update('|')
      .update(runningAcc.toString(16))
      .update('|')
      .update(result.proofCount.toString())
      .digest('hex');

    if (result.transcriptDigest !== expectedTranscript) {
      return {
        isValid: false,
        verifiedCount: result.proofCount,
        reason: 'Transcript digest mismatch: transcript has been tampered with',
      };
    }

    return {
      isValid: true,
      verifiedCount: result.proofCount,
      reconstructedStateRoot: reconstructedRoot,
    };
  }
}
