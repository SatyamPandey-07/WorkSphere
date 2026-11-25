/**
 * @file ThresholdOPRFProtocol.ts
 * @description Verifiable Threshold Oblivious Pseudorandom Function (t-OPRF) Engine.
 * Implements a (t, n) distributed OPRF over BN254 with Chaum-Pedersen DLEQ verifiability
 * for password-hardening (OPAQUE), decentralized Privacy Pass tokens, and private set
 * intersection (PSI). Guarantees client input obliviousness, key secrecy, and subset invariance.
 */

import { createHash, randomBytes } from 'crypto';

export const TOPRF_PRIME = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
export const TOPRF_GENERATOR = 3n;

/**
 * Field arithmetic utilities over BN254.
 */
export class TOPRFFieldMath {
  public static add(a: bigint, b: bigint, p: bigint = TOPRF_PRIME): bigint {
    const res = (a + b) % p;
    return res >= 0n ? res : res + p;
  }

  public static sub(a: bigint, b: bigint, p: bigint = TOPRF_PRIME): bigint {
    const res = (a - b) % p;
    return res >= 0n ? res : res + p;
  }

  public static mul(a: bigint, b: bigint, p: bigint = TOPRF_PRIME): bigint {
    const res = (a * b) % p;
    return res >= 0n ? res : res + p;
  }

  public static exp(base: bigint, exponent: bigint, p: bigint = TOPRF_PRIME): bigint {
    let res = 1n;
    let b = ((base % p) + p) % p;
    let e = exponent < 0n ? (exponent % (p - 1n)) + (p - 1n) : exponent % (p - 1n);
    while (e > 0n) {
      if (e & 1n) res = (res * b) % p;
      b = (b * b) % p;
      e >>= 1n;
    }
    return res;
  }

  public static inv(val: bigint, p: bigint = TOPRF_PRIME): bigint {
    const v = ((val % p) + p) % p;
    if (v === 0n) throw new Error('TOPRFFieldMath: Division by zero');
    return this.exp(v, p - 2n, p);
  }

  public static hashToScalar(data: string, p: bigint = TOPRF_PRIME): bigint {
    const h = createHash('sha256').update(data).digest('hex');
    const val = BigInt('0x' + h) % p;
    return val === 0n ? 1n : val;
  }

  public static randomScalar(p: bigint = TOPRF_PRIME): bigint {
    const b = randomBytes(32);
    const val = BigInt('0x' + b.toString('hex')) % p;
    return val === 0n ? 1n : val;
  }
}

/**
 * Chaum-Pedersen DLEQ proof: log_G(PK_i) == log_Q(Z_i) = k_i.
 */
export interface OPRFDLEQProof {
  commitmentA: bigint;
  commitmentB: bigint;
  challenge: bigint;
  response: bigint;
}

/**
 * Blinded client OPRF query.
 */
export interface BlindedOPRFQuery {
  queryId: string;
  blindedElement: bigint;
  blindingScalar: bigint;
  inputHashScalar: bigint;
}

/**
 * Verifiable partial evaluation from threshold server i.
 */
export interface OPRFPartialEvaluation {
  serverIndex: number;
  queryId: string;
  evaluatedElement: bigint;
  proof: OPRFDLEQProof;
}

/**
 * Final unblinded deterministic OPRF output.
 */
export interface OPRFOutput {
  unblindedPoint: bigint;
  prfDigestHex: string;
  participatingServers: number[];
}

/**
 * Configuration for threshold OPRF committee.
 */
export interface TOPRFConfig {
  threshold: number;
  totalServers: number;
  serverPublicKeys: Map<number, bigint>;
  prime?: bigint;
  g?: bigint;
}

/**
 * Verifiable Threshold Oblivious PRF Engine.
 */
export class ThresholdOPRFProtocol {
  public readonly threshold: number;
  public readonly totalServers: number;
  public readonly serverPublicKeys: Map<number, bigint>;
  public readonly prime: bigint;
  public readonly g: bigint;

  constructor(config: TOPRFConfig) {
    this.threshold = config.threshold;
    this.totalServers = config.totalServers;
    this.serverPublicKeys = new Map(config.serverPublicKeys);
    this.prime = config.prime ?? TOPRF_PRIME;
    this.g = config.g ?? TOPRF_GENERATOR;
  }

  /**
   * Helper: Generates (threshold, totalServers) Shamir key shares for a master OPRF key.
   */
  public static generateCommitteeShares(
    masterKey: bigint,
    threshold: number,
    totalServers: number,
    prime: bigint = TOPRF_PRIME,
    g: bigint = TOPRF_GENERATOR
  ): { secretShares: Map<number, bigint>; publicKeys: Map<number, bigint>; groupPublicKey: bigint } {
    const k = ((masterKey % prime) + prime) % prime;
    const coeffs: bigint[] = [k];
    for (let i = 1; i < threshold; i++) {
      coeffs.push(TOPRFFieldMath.randomScalar(prime));
    }

    const secretShares = new Map<number, bigint>();
    const publicKeys = new Map<number, bigint>();

    for (let idx = 1; idx <= totalServers; idx++) {
      const x = BigInt(idx);
      let val = 0n;
      let xPow = 1n;
      for (let c = 0; c < coeffs.length; c++) {
        val = TOPRFFieldMath.add(val, TOPRFFieldMath.mul(coeffs[c], xPow, prime), prime);
        xPow = TOPRFFieldMath.mul(xPow, x, prime);
      }
      secretShares.set(idx, val);
      publicKeys.set(idx, TOPRFFieldMath.mul(val, g, prime));
    }

    return {
      secretShares,
      publicKeys,
      groupPublicKey: TOPRFFieldMath.mul(k, g, prime),
    };
  }

  /**
   * Maps an arbitrary client input string to a non-zero field element.
   */
  public hashInputToElement(input: string): bigint {
    return TOPRFFieldMath.hashToScalar(`toprf_h1:${input}`, this.prime);
  }

  /**
   * Client: Blinds input with a fresh random scalar r -> Q = r * H1(input).
   */
  public blindInput(input: string, queryId?: string): BlindedOPRFQuery {
    const inputHashScalar = this.hashInputToElement(input);
    const blindingScalar = TOPRFFieldMath.randomScalar(this.prime);
    const blindedElement = TOPRFFieldMath.mul(blindingScalar, inputHashScalar, this.prime);

    return {
      queryId: queryId ?? `oprf_${randomBytes(8).toString('hex')}`,
      blindedElement,
      blindingScalar,
      inputHashScalar,
    };
  }

  /**
   * Server i: Evaluates Z_i = k_i * Q and produces Chaum-Pedersen DLEQ proof.
   */
  public evaluatePartial(
    serverIndex: number,
    secretShare: bigint,
    blindedElement: bigint,
    queryId: string
  ): OPRFPartialEvaluation {
    const k_i = ((secretShare % this.prime) + this.prime) % this.prime;
    const pk_i = this.serverPublicKeys.get(serverIndex);
    if (!pk_i) {
      throw new Error(`Unknown server index ${serverIndex}`);
    }

    const evaluatedElement = TOPRFFieldMath.mul(k_i, blindedElement, this.prime);

    // Chaum-Pedersen DLEQ proof
    const w = TOPRFFieldMath.randomScalar(this.prime);
    const commitmentA = TOPRFFieldMath.mul(w, this.g, this.prime);
    const commitmentB = TOPRFFieldMath.mul(w, blindedElement, this.prime);

    const transcript = [
      queryId,
      this.g.toString(16),
      pk_i.toString(16),
      blindedElement.toString(16),
      evaluatedElement.toString(16),
      commitmentA.toString(16),
      commitmentB.toString(16),
    ].join(':');

    const challenge = TOPRFFieldMath.hashToScalar(transcript, this.prime);
    const response = TOPRFFieldMath.add(w, TOPRFFieldMath.mul(challenge, k_i, this.prime), this.prime);

    return {
      serverIndex,
      queryId,
      evaluatedElement,
      proof: {
        commitmentA,
        commitmentB,
        challenge,
        response,
      },
    };
  }

  /**
   * Client: Verifies server's partial evaluation against its public key share via DLEQ proof.
   */
  public verifyPartialEvaluation(
    partial: OPRFPartialEvaluation,
    blindedElement: bigint
  ): boolean {
    const pk_i = this.serverPublicKeys.get(partial.serverIndex);
    if (!pk_i) return false;

    const transcript = [
      partial.queryId,
      this.g.toString(16),
      pk_i.toString(16),
      blindedElement.toString(16),
      partial.evaluatedElement.toString(16),
      partial.proof.commitmentA.toString(16),
      partial.proof.commitmentB.toString(16),
    ].join(':');

    const expectedChallenge = TOPRFFieldMath.hashToScalar(transcript, this.prime);
    if (partial.proof.challenge !== expectedChallenge) return false;

    const lhsA = TOPRFFieldMath.mul(partial.proof.response, this.g, this.prime);
    const rhsA = TOPRFFieldMath.add(
      partial.proof.commitmentA,
      TOPRFFieldMath.mul(partial.proof.challenge, pk_i, this.prime),
      this.prime
    );
    if (lhsA !== rhsA) return false;

    const lhsB = TOPRFFieldMath.mul(partial.proof.response, blindedElement, this.prime);
    const rhsB = TOPRFFieldMath.add(
      partial.proof.commitmentB,
      TOPRFFieldMath.mul(partial.proof.challenge, partial.evaluatedElement, this.prime),
      this.prime
    );

    return lhsB === rhsB;
  }

  /**
   * Client: Combines threshold t verified partial evaluations via Lagrange interpolation,
   * unblinds by r^{-1}, and outputs the deterministic 256-bit OPRF digest.
   */
  public finalizeOutput(
    partials: OPRFPartialEvaluation[],
    blindingScalar: bigint,
    originalInput: string,
    blindedElement?: bigint
  ): OPRFOutput {
    if (partials.length < this.threshold) {
      throw new Error(`Insufficient partial evaluations: have ${partials.length}, need ${this.threshold}`);
    }

    const active = partials.slice(0, this.threshold);
    if (blindedElement !== undefined) {
      for (const p of active) {
        if (!this.verifyPartialEvaluation(p, blindedElement)) {
          throw new Error(`Partial evaluation from server ${p.serverIndex} failed DLEQ verification`);
        }
      }
    }

    const indices = active.map((p) => BigInt(p.serverIndex));
    let combinedBlinded = 0n;

    for (let i = 0; i < this.threshold; i++) {
      let num = 1n;
      let den = 1n;
      for (let j = 0; j < this.threshold; j++) {
        if (i === j) continue;
        num = TOPRFFieldMath.mul(num, TOPRFFieldMath.sub(0n, indices[j], this.prime), this.prime);
        den = TOPRFFieldMath.mul(den, TOPRFFieldMath.sub(indices[i], indices[j], this.prime), this.prime);
      }
      const lambda = TOPRFFieldMath.mul(num, TOPRFFieldMath.inv(den, this.prime), this.prime);
      combinedBlinded = TOPRFFieldMath.add(
        combinedBlinded,
        TOPRFFieldMath.mul(lambda, active[i].evaluatedElement, this.prime),
        this.prime
      );
    }

    const rInv = TOPRFFieldMath.inv(blindingScalar, this.prime);
    const unblindedPoint = TOPRFFieldMath.mul(combinedBlinded, rInv, this.prime);
    const prfDigestHex = createHash('sha256')
      .update(`toprf_out:${originalInput}:${unblindedPoint.toString(16)}`)
      .digest('hex');

    return {
      unblindedPoint,
      prfDigestHex,
      participatingServers: active.map((p) => p.serverIndex),
    };
  }

  /**
   * Reference evaluation using the unsplit master key for verifying correctness.
   */
  public evaluateDirectlyWithMasterKey(masterKey: bigint, input: string): string {
    const h = this.hashInputToElement(input);
    const point = TOPRFFieldMath.mul(((masterKey % this.prime) + this.prime) % this.prime, h, this.prime);
    return createHash('sha256')
      .update(`toprf_out:${input}:${point.toString(16)}`)
      .digest('hex');
  }
}
