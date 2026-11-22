/**
 * @file SchnorrThresholdAggregator.ts
 * @description Authoritative MuSig2 (BIP 327) and multi-party threshold Schnorr signature
 * aggregation engine. Provides rogue-key resistant key aggregation, two-round nonce
 * exchange, individual partial signature verification, randomized batch multiscalar
 * verification, and BIP 340 64-byte signature aggregation.
 */

import { createHash, randomBytes } from "crypto";

// secp256k1 curve parameters
export const SECP256K1_P =
  0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffefffffc2fn;
export const SECP256K1_ORDER =
  0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
export const G_X =
  0x79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798n;
export const G_Y =
  0x483ada7726a3c4655da4fbfc0e1108a8fd17b448a68554199c47d08ffb10d4b8n;

export interface ECPoint {
  x: bigint;
  y: bigint;
}

export const POINT_AT_INFINITY: ECPoint = { x: 0n, y: 0n };

export interface ParticipantInfo {
  id: string;
  publicKey: ECPoint;
}

export interface KeyPair {
  privateKey: bigint;
  publicKey: ECPoint;
}

export interface PublicNoncePair {
  participantId: string;
  R1: ECPoint;
  R2: ECPoint;
}

export interface SecretNoncePair {
  r1: bigint;
  r2: bigint;
  publicNonces: PublicNoncePair;
}

export type SessionState =
  "INIT" | "NONCES_EXCHANGED" | "PARTIALS_COLLECTED" | "FINALIZED" | "ABORTED";

export interface AggregationSession {
  sessionId: string;
  participants: ParticipantInfo[];
  message: Buffer;
  aggregatedPublicKey: ECPoint;
  keyCoefficients: Map<string, bigint>;
  nonces: Map<string, PublicNoncePair>;
  partialSignatures: Map<string, bigint>;
  state: SessionState;
  aggregateNonce?: ECPoint;
  nonceBindingFactor?: bigint;
  finalSignature?: Buffer;
  createdAt: number;
}

export interface BatchVerificationResult {
  isValid: boolean;
  invalidParticipantIds: string[];
}

export class SchnorrThresholdAggregator {
  private sessions: Map<string, AggregationSession> = new Map();
  private readonly sessionTtlMs: number;
  private readonly cleanupTimer: ReturnType<typeof setInterval>;

  constructor(sessionTtlMs = 5 * 60_000, cleanupIntervalMs = 30_000) {
    this.sessionTtlMs =
      Number.isFinite(sessionTtlMs) && sessionTtlMs > 0
        ? sessionTtlMs
        : 5 * 60_000;
    const interval =
      Number.isFinite(cleanupIntervalMs) && cleanupIntervalMs > 0
        ? cleanupIntervalMs
        : Math.min(30_000, this.sessionTtlMs);
    this.cleanupTimer = setInterval(() => {
      this.cleanupExpiredSessions();
    }, interval);
    (this.cleanupTimer as unknown as { unref?: () => void }).unref?.();
  }

  /**
   * Evicts sessions older than the configured lifetime. The sweep removes
   * aborted, incomplete, and completed sessions alike so abandoned session
   * buffers (messages, nonce maps, and partial signatures) cannot accumulate.
   */
  public cleanupExpiredSessions(now = Date.now()): number {
    let removed = 0;
    for (const [sessionId, session] of this.sessions) {
      if (now - session.createdAt >= this.sessionTtlMs) {
        this.sessions.delete(sessionId);
        removed++;
      }
    }
    return removed;
  }

  /** Stops the background expiry sweep when the aggregator is no longer used. */
  public dispose(): void {
    clearInterval(this.cleanupTimer);
    this.sessions.clear();
  }

  // --- SECP256K1 Finite Field & Curve Arithmetic ---

  public static mod(a: bigint, m: bigint): bigint {
    const result = a % m;
    return result >= 0n ? result : result + m;
  }

  public static modInverse(a: bigint, m: bigint = SECP256K1_P): bigint {
    let t = 0n;
    let newt = 1n;
    let r = m;
    let newr = SchnorrThresholdAggregator.mod(a, m);

    while (newr !== 0n) {
      const quotient = r / newr;
      [t, newt] = [newt, t - quotient * newt];
      [r, newr] = [newr, r - quotient * newr];
    }

    if (r > 1n) throw new Error("Element not invertible");
    if (t < 0n) t += m;
    return t;
  }

  public static isInfinity(p: ECPoint): boolean {
    return p.x === 0n && p.y === 0n;
  }

  public static pointAdd(p1: ECPoint, p2: ECPoint): ECPoint {
    if (SchnorrThresholdAggregator.isInfinity(p1)) return p2;
    if (SchnorrThresholdAggregator.isInfinity(p2)) return p1;

    if (p1.x === p2.x) {
      if (p1.y !== p2.y) return POINT_AT_INFINITY;
      // Point doubling: slope = (3 * x1^2) / (2 * y1) mod p
      const num = SchnorrThresholdAggregator.mod(3n * p1.x * p1.x, SECP256K1_P);
      const den = SchnorrThresholdAggregator.modInverse(2n * p1.y, SECP256K1_P);
      const s = SchnorrThresholdAggregator.mod(num * den, SECP256K1_P);
      const x3 = SchnorrThresholdAggregator.mod(s * s - 2n * p1.x, SECP256K1_P);
      const y3 = SchnorrThresholdAggregator.mod(
        s * (p1.x - x3) - p1.y,
        SECP256K1_P,
      );
      return { x: x3, y: y3 };
    } else {
      // Point addition: slope = (y2 - y1) / (x2 - x1) mod p
      const num = SchnorrThresholdAggregator.mod(p2.y - p1.y, SECP256K1_P);
      const den = SchnorrThresholdAggregator.modInverse(
        p2.x - p1.x,
        SECP256K1_P,
      );
      const s = SchnorrThresholdAggregator.mod(num * den, SECP256K1_P);
      const x3 = SchnorrThresholdAggregator.mod(
        s * s - p1.x - p2.x,
        SECP256K1_P,
      );
      const y3 = SchnorrThresholdAggregator.mod(
        s * (p1.x - x3) - p1.y,
        SECP256K1_P,
      );
      return { x: x3, y: y3 };
    }
  }

  public static pointMul(k: bigint, p: ECPoint): ECPoint {
    k = SchnorrThresholdAggregator.mod(k, SECP256K1_ORDER);
    let result = POINT_AT_INFINITY;
    let addend = p;

    while (k > 0n) {
      if ((k & 1n) === 1n) {
        result = SchnorrThresholdAggregator.pointAdd(result, addend);
      }
      addend = SchnorrThresholdAggregator.pointAdd(addend, addend);
      k >>= 1n;
    }

    return result;
  }

  public static getGenerator(): ECPoint {
    return { x: G_X, y: G_Y };
  }

  public static generateKeyPair(): KeyPair {
    const privBuf = randomBytes(32);
    const privateKey =
      SchnorrThresholdAggregator.mod(
        BigInt(`0x${privBuf.toString("hex")}`),
        SECP256K1_ORDER - 1n,
      ) + 1n;
    const publicKey = SchnorrThresholdAggregator.pointMul(
      privateKey,
      SchnorrThresholdAggregator.getGenerator(),
    );
    return { privateKey, publicKey };
  }

  public static pointToHex(p: ECPoint): string {
    return `${p.x.toString(16).padStart(64, "0")}${p.y.toString(16).padStart(64, "0")}`;
  }

  // --- MuSig2 (BIP 327) Key Aggregation ---

  /**
   * Aggregates public keys using MuSig2 rogue-key resistant coefficient hashing.
   */
  public static aggregatePublicKeys(participants: ParticipantInfo[]): {
    aggregatedPublicKey: ECPoint;
    coefficients: Map<string, bigint>;
  } {
    if (participants.length === 0)
      throw new Error("At least one participant required.");

    // Sort keys lexicographically by x-coordinate hex representation
    const sorted = [...participants].sort((a, b) =>
      a.publicKey.x.toString(16).localeCompare(b.publicKey.x.toString(16)),
    );

    // Compute list hash L = SHA256("BIP0327/keyagglist" || pk1 || pk2 ...)
    const listHasher = createHash("sha256");
    listHasher.update("BIP0327/keyagglist");
    for (const part of sorted) {
      listHasher.update(
        Buffer.from(
          SchnorrThresholdAggregator.pointToHex(part.publicKey),
          "hex",
        ),
      );
    }
    const keyListHash = listHasher.digest();

    const coefficients = new Map<string, bigint>();
    let aggregatedKey = POINT_AT_INFINITY;

    for (const part of sorted) {
      // Compute coefficient c_i = SHA256("BIP0327/keyaggcoef" || L || pk_i) mod n
      const coefHasher = createHash("sha256");
      coefHasher.update("BIP0327/keyaggcoef");
      coefHasher.update(keyListHash);
      coefHasher.update(
        Buffer.from(
          SchnorrThresholdAggregator.pointToHex(part.publicKey),
          "hex",
        ),
      );
      const c_i = SchnorrThresholdAggregator.mod(
        BigInt(`0x${coefHasher.digest("hex")}`),
        SECP256K1_ORDER,
      );
      coefficients.set(part.id, c_i);

      // c_i * X_i
      const scaledKey = SchnorrThresholdAggregator.pointMul(
        c_i,
        part.publicKey,
      );
      aggregatedKey = SchnorrThresholdAggregator.pointAdd(
        aggregatedKey,
        scaledKey,
      );
    }

    return { aggregatedPublicKey: aggregatedKey, coefficients };
  }

  // --- Two-Round Nonce Generation ---

  /**
   * Generates a pair of secret nonces (r1, r2) and their public commitments (R1 = r1*G, R2 = r2*G).
   */
  public static generateNoncePair(participantId: string): SecretNoncePair {
    const r1Buf = randomBytes(32);
    const r2Buf = randomBytes(32);
    const r1 =
      SchnorrThresholdAggregator.mod(
        BigInt(`0x${r1Buf.toString("hex")}`),
        SECP256K1_ORDER - 1n,
      ) + 1n;
    const r2 =
      SchnorrThresholdAggregator.mod(
        BigInt(`0x${r2Buf.toString("hex")}`),
        SECP256K1_ORDER - 1n,
      ) + 1n;

    const G = SchnorrThresholdAggregator.getGenerator();
    const R1 = SchnorrThresholdAggregator.pointMul(r1, G);
    const R2 = SchnorrThresholdAggregator.pointMul(r2, G);

    return {
      r1,
      r2,
      publicNonces: {
        participantId,
        R1,
        R2,
      },
    };
  }

  // --- Session Life Cycle ---

  public createSession(
    sessionId: string,
    participants: ParticipantInfo[],
    message: Buffer,
  ): AggregationSession {
    this.cleanupExpiredSessions();
    const { aggregatedPublicKey, coefficients } =
      SchnorrThresholdAggregator.aggregatePublicKeys(participants);

    const session: AggregationSession = {
      sessionId,
      participants,
      message,
      aggregatedPublicKey,
      keyCoefficients: coefficients,
      nonces: new Map(),
      partialSignatures: new Map(),
      state: "INIT",
      createdAt: Date.now(),
    };

    this.sessions.set(sessionId, session);
    return session;
  }

  public getSession(sessionId: string): AggregationSession | undefined {
    this.cleanupExpiredSessions();
    return this.sessions.get(sessionId);
  }

  public submitNonces(sessionId: string, noncePair: PublicNoncePair): void {
    this.cleanupExpiredSessions();
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found.`);
    if (session.state !== "INIT")
      throw new Error(`Cannot submit nonces in state ${session.state}.`);

    const isParticipant = session.participants.some(
      (p) => p.id === noncePair.participantId,
    );
    if (!isParticipant)
      throw new Error(`Participant ${noncePair.participantId} not in session.`);

    session.nonces.set(noncePair.participantId, noncePair);

    // Check if all nonces collected
    if (session.nonces.size === session.participants.length) {
      this.computeAggregateNonce(session);
      session.state = "NONCES_EXCHANGED";
    }
  }

  private computeAggregateNonce(session: AggregationSession): void {
    // Nonce binding factor b = SHA256("BIP0327/noncecoef" || P_agg || R1_all || R2_all || message) mod n
    const bindingHasher = createHash("sha256");
    bindingHasher.update("BIP0327/noncecoef");
    bindingHasher.update(
      Buffer.from(
        SchnorrThresholdAggregator.pointToHex(session.aggregatedPublicKey),
        "hex",
      ),
    );

    for (const part of session.participants) {
      const n = session.nonces.get(part.id)!;
      bindingHasher.update(
        Buffer.from(SchnorrThresholdAggregator.pointToHex(n.R1), "hex"),
      );
      bindingHasher.update(
        Buffer.from(SchnorrThresholdAggregator.pointToHex(n.R2), "hex"),
      );
    }
    bindingHasher.update(session.message);

    const b = SchnorrThresholdAggregator.mod(
      BigInt(`0x${bindingHasher.digest("hex")}`),
      SECP256K1_ORDER,
    );
    session.nonceBindingFactor = b;

    // Aggregate nonce R = sum(R_i,1 + b * R_i,2)
    let aggR = POINT_AT_INFINITY;
    for (const part of session.participants) {
      const n = session.nonces.get(part.id)!;
      const bR2 = SchnorrThresholdAggregator.pointMul(b, n.R2);
      const Ri = SchnorrThresholdAggregator.pointAdd(n.R1, bR2);
      aggR = SchnorrThresholdAggregator.pointAdd(aggR, Ri);
    }

    session.aggregateNonce = aggR;
  }

  public computeChallenge(session: AggregationSession): bigint {
    if (!session.aggregateNonce)
      throw new Error("Aggregate nonce not computed.");
    const challengeHasher = createHash("sha256");
    challengeHasher.update("BIP0340/challenge");
    challengeHasher.update(
      Buffer.from(
        session.aggregateNonce.x.toString(16).padStart(64, "0"),
        "hex",
      ),
    );
    challengeHasher.update(
      Buffer.from(
        session.aggregatedPublicKey.x.toString(16).padStart(64, "0"),
        "hex",
      ),
    );
    challengeHasher.update(session.message);
    return SchnorrThresholdAggregator.mod(
      BigInt(`0x${challengeHasher.digest("hex")}`),
      SECP256K1_ORDER,
    );
  }

  /**
   * Generates a cosigner's partial signature:
   * s_i = (r1 + b * r2) + e * c_i * x_i mod n
   */
  public signPartial(
    session: AggregationSession,
    participantId: string,
    secretKey: bigint,
    secretNonces: SecretNoncePair,
  ): bigint {
    if (session.state !== "NONCES_EXCHANGED") {
      throw new Error(
        `Session must be in NONCES_EXCHANGED state, currently ${session.state}.`,
      );
    }

    const b = session.nonceBindingFactor!;
    const c_i = session.keyCoefficients.get(participantId)!;
    const e = this.computeChallenge(session);

    const k_i = SchnorrThresholdAggregator.mod(
      secretNonces.r1 + b * secretNonces.r2,
      SECP256K1_ORDER,
    );
    const s_i = SchnorrThresholdAggregator.mod(
      k_i + e * c_i * secretKey,
      SECP256K1_ORDER,
    );

    return s_i;
  }

  /**
   * Verifies an individual partial signature share:
   * s_i * G == R_i + e * c_i * X_i
   */
  public verifyPartialSignature(
    session: AggregationSession,
    participantId: string,
    s_i: bigint,
  ): boolean {
    const participant = session.participants.find(
      (p) => p.id === participantId,
    );
    const nonces = session.nonces.get(participantId);
    const b = session.nonceBindingFactor;
    const c_i = session.keyCoefficients.get(participantId);

    if (!participant || !nonces || b === undefined || c_i === undefined) {
      return false;
    }

    const e = this.computeChallenge(session);

    // Left hand side: s_i * G
    const lhs = SchnorrThresholdAggregator.pointMul(
      s_i,
      SchnorrThresholdAggregator.getGenerator(),
    );

    // Right hand side: (R1 + b * R2) + (e * c_i) * X_i
    const bR2 = SchnorrThresholdAggregator.pointMul(b, nonces.R2);
    const Ri = SchnorrThresholdAggregator.pointAdd(nonces.R1, bR2);

    const ecX = SchnorrThresholdAggregator.pointMul(
      SchnorrThresholdAggregator.mod(e * c_i, SECP256K1_ORDER),
      participant.publicKey,
    );
    const rhs = SchnorrThresholdAggregator.pointAdd(Ri, ecX);

    return lhs.x === rhs.x && lhs.y === rhs.y;
  }

  /**
   * Verifies multiple partial signatures simultaneously in a single randomized batch multiscalar equation.
   * Uses 128-bit random scalar weights to prevent rogue-key or cancellation attacks.
   * Falls back to individual verification on batch failure to isolate rogue signatures and log IDs.
   */
  public verifyBatchPartialSignatures(
    session: AggregationSession,
    submissions: Array<{ participantId: string; s_i: bigint }>,
  ): BatchVerificationResult {
    if (submissions.length === 0) {
      return { isValid: true, invalidParticipantIds: [] };
    }

    const b = session.nonceBindingFactor;
    if (b === undefined || !session.aggregateNonce) {
      throw new Error(
        "Session nonces must be exchanged before batch verification.",
      );
    }

    const e = this.computeChallenge(session);

    // Step 1: Generate 128-bit random scalar weights for each submission
    const weights: bigint[] = submissions.map(() => {
      const buf = randomBytes(16);
      return BigInt(`0x${buf.toString("hex")}`);
    });

    // Step 2: Compute batched LHS: sum(z_i * s_i) * G
    let sumZS = 0n;
    for (let i = 0; i < submissions.length; i++) {
      sumZS = SchnorrThresholdAggregator.mod(
        sumZS + weights[i] * submissions[i].s_i,
        SECP256K1_ORDER,
      );
    }
    const lhs = SchnorrThresholdAggregator.pointMul(
      sumZS,
      SchnorrThresholdAggregator.getGenerator(),
    );

    // Step 3: Compute batched RHS: sum(z_i * (R_i + e * c_i * X_i))
    let rhs = POINT_AT_INFINITY;
    for (let i = 0; i < submissions.length; i++) {
      const { participantId } = submissions[i];
      const participant = session.participants.find(
        (p) => p.id === participantId,
      );
      const nonces = session.nonces.get(participantId);
      const c_i = session.keyCoefficients.get(participantId);

      if (!participant || !nonces || c_i === undefined) {
        return { isValid: false, invalidParticipantIds: [participantId] };
      }

      const bR2 = SchnorrThresholdAggregator.pointMul(b, nonces.R2);
      const Ri = SchnorrThresholdAggregator.pointAdd(nonces.R1, bR2);

      const ec_i = SchnorrThresholdAggregator.mod(e * c_i, SECP256K1_ORDER);
      const ecX_i = SchnorrThresholdAggregator.pointMul(
        ec_i,
        participant.publicKey,
      );
      const innerSum = SchnorrThresholdAggregator.pointAdd(Ri, ecX_i);
      const weightedTerm = SchnorrThresholdAggregator.pointMul(
        weights[i],
        innerSum,
      );

      rhs = SchnorrThresholdAggregator.pointAdd(rhs, weightedTerm);
    }

    const batchPass = lhs.x === rhs.x && lhs.y === rhs.y;
    if (batchPass) {
      return { isValid: true, invalidParticipantIds: [] };
    }

    // Step 4: Batch check failed; fall back to individual checks to isolate rogue signers
    const invalidParticipantIds: string[] = [];
    for (const sub of submissions) {
      const isValidSingle = this.verifyPartialSignature(
        session,
        sub.participantId,
        sub.s_i,
      );
      if (!isValidSingle) {
        console.error(
          `[SchnorrThresholdAggregator] Rogue partial signature detected for participant ID: ${sub.participantId}`,
        );
        invalidParticipantIds.push(sub.participantId);
      }
    }

    return {
      isValid: invalidParticipantIds.length === 0,
      invalidParticipantIds,
    };
  }

  public submitPartialSignature(
    sessionId: string,
    participantId: string,
    partialSig: bigint,
  ): void {
    this.cleanupExpiredSessions();
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found.`);
    if (session.state !== "NONCES_EXCHANGED") {
      throw new Error(
        `Cannot submit partial signature in state ${session.state}.`,
      );
    }

    // One signer contributes exactly one share per session. Reject duplicates
    // before verification so a later payload can never overwrite an accepted
    // contribution in the keyed accumulator.
    if (session.partialSignatures.has(participantId)) {
      throw new Error(
        `Duplicate partial signature rejected from participant ${participantId}.`,
      );
    }

    const isValid = this.verifyPartialSignature(
      session,
      participantId,
      partialSig,
    );
    if (!isValid) {
      throw new Error(
        `Malicious or invalid partial signature rejected from participant ${participantId}.`,
      );
    }

    session.partialSignatures.set(participantId, partialSig);

    if (session.partialSignatures.size === session.participants.length) {
      session.state = "PARTIALS_COLLECTED";
    }
  }

  /**
   * Aggregates partial signatures into a standard 64-byte BIP 340 Schnorr signature:
   * s = sum(s_i) mod n, returns [R_x (32 bytes) || s (32 bytes)]
   */
  public aggregateSignature(sessionId: string): {
    signature: Buffer;
    rX: string;
    s: string;
  } {
    this.cleanupExpiredSessions();
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found.`);
    if (session.state !== "PARTIALS_COLLECTED") {
      throw new Error(
        `Cannot aggregate in state ${session.state}. All partial signatures must be verified.`,
      );
    }

    let totalS = 0n;
    for (const s_i of session.partialSignatures.values()) {
      totalS = SchnorrThresholdAggregator.mod(totalS + s_i, SECP256K1_ORDER);
    }

    const rxBuf = Buffer.from(
      session.aggregateNonce!.x.toString(16).padStart(64, "0"),
      "hex",
    );
    const sBuf = Buffer.from(totalS.toString(16).padStart(64, "0"), "hex");
    const finalSignature = Buffer.concat([rxBuf, sBuf]);

    session.finalSignature = finalSignature;
    session.state = "FINALIZED";

    return {
      signature: finalSignature,
      rX: rxBuf.toString("hex"),
      s: sBuf.toString("hex"),
    };
  }

  /**
   * Verifies the aggregated BIP 340 64-byte Schnorr signature against the aggregated public key:
   * s * G == R + e * P_agg
   */
  public static verifyAggregatedSignature(
    message: Buffer,
    signature: Buffer,
    aggregatedPublicKey: ECPoint,
  ): boolean {
    if (signature.length !== 64) return false;

    const rx = BigInt(`0x${signature.subarray(0, 32).toString("hex")}`);
    const s = BigInt(`0x${signature.subarray(32, 64).toString("hex")}`);

    if (s >= SECP256K1_ORDER) return false;

    // Challenge e = SHA256("BIP0340/challenge" || R_x || P_agg_x || message) mod n
    const challengeHasher = createHash("sha256");
    challengeHasher.update("BIP0340/challenge");
    challengeHasher.update(
      Buffer.from(rx.toString(16).padStart(64, "0"), "hex"),
    );
    challengeHasher.update(
      Buffer.from(aggregatedPublicKey.x.toString(16).padStart(64, "0"), "hex"),
    );
    challengeHasher.update(message);
    const e = SchnorrThresholdAggregator.mod(
      BigInt(`0x${challengeHasher.digest("hex")}`),
      SECP256K1_ORDER,
    );

    // s * G
    const sG = SchnorrThresholdAggregator.pointMul(
      s,
      SchnorrThresholdAggregator.getGenerator(),
    );

    // e * P_agg
    const eP = SchnorrThresholdAggregator.pointMul(e, aggregatedPublicKey);

    // Since sG = R + eP => R = sG - eP = sG + (-eP)
    const negEP: ECPoint = {
      x: eP.x,
      y: SchnorrThresholdAggregator.mod(-eP.y, SECP256K1_P),
    };
    const recoveredR = SchnorrThresholdAggregator.pointAdd(sG, negEP);

    // Check if recovered R.x == rx
    return recoveredR.x === rx;
  }
}
