/**
 * @file ThresholdSignatureScheme.ts
 * @description Flexible Round-Optimized Schnorr Threshold (FROST) signature coordinator
 * with Shamir secret sharing, Lagrange polynomial interpolation, two-round nonce commitment,
 * and malicious share attribution.
 */

import { createHash, randomBytes } from 'node:crypto';

// secp256k1 scalar group order (n)
export const SECP256K1_ORDER = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;

export interface KeyShare {
  participantId: number; // 1-based index
  secretShare: bigint;
  publicKeyShare: bigint; // Point representation on generator G
}

export interface NonceCommitment {
  participantId: number;
  hidingCommitment: bigint; // D_i = d_i * G
  bindingCommitment: bigint; // E_i = e_i * G
}

export interface NoncePair {
  participantId: number;
  hidingNonce: bigint; // d_i
  bindingNonce: bigint; // e_i
  commitment: NonceCommitment;
}

export interface SignatureShare {
  participantId: number;
  share: bigint; // z_i
}

export interface FrostSignature {
  rCommitment: bigint; // R
  zScalar: bigint; // z
}

/**
 * Finite field arithmetic operations over the secp256k1 scalar field
 */
export class ScalarField {
  static mod(a: bigint, n: bigint = SECP256K1_ORDER): bigint {
    const res = a % n;
    return res >= 0n ? res : res + n;
  }

  static add(a: bigint, b: bigint, n: bigint = SECP256K1_ORDER): bigint {
    return ScalarField.mod(a + b, n);
  }

  static sub(a: bigint, b: bigint, n: bigint = SECP256K1_ORDER): bigint {
    return ScalarField.mod(a - b, n);
  }

  static mul(a: bigint, b: bigint, n: bigint = SECP256K1_ORDER): bigint {
    return ScalarField.mod(a * b, n);
  }

  static exp(base: bigint, exponent: bigint, n: bigint = SECP256K1_ORDER): bigint {
    let res = 1n;
    let b = ScalarField.mod(base, n);
    let e = exponent;
    while (e > 0n) {
      if (e & 1n) {
        res = ScalarField.mod(res * b, n);
      }
      b = ScalarField.mod(b * b, n);
      e >>= 1n;
    }
    return res;
  }

  static inv(a: bigint, n: bigint = SECP256K1_ORDER): bigint {
    if (a === 0n) throw new Error('Division by zero in finite field');
    // Fermat's Little Theorem: a^(n-2) mod n
    return ScalarField.exp(a, n - 2n, n);
  }

  static randomScalar(): bigint {
    while (true) {
      const bytes = randomBytes(32);
      const val = BigInt('0x' + bytes.toString('hex'));
      if (val > 0n && val < SECP256K1_ORDER) {
        return val;
      }
    }
  }

  static hashToScalar(data: string): bigint {
    const h = createHash('sha256').update(data).digest('hex');
    return BigInt('0x' + h) % SECP256K1_ORDER;
  }
}

/**
 * Shamir Secret Sharing Scheme with Lagrange basis polynomial interpolation
 */
export class ShamirSecretSharing {
  /**
   * Splits a master secret into n shares with a reconstruction threshold t
   */
  static splitSecret(
    masterSecret: bigint,
    threshold: number,
    totalShares: number
  ): { shares: KeyShare[]; groupPublicKey: bigint } {
    if (threshold < 2 || threshold > totalShares) {
      throw new Error(`Invalid threshold: must be 2 <= threshold <= ${totalShares}`);
    }

    // Polynomial coefficients: f(x) = a_0 + a_1*x + ... + a_{t-1}*x^{t-1}
    const coefficients: bigint[] = [masterSecret];
    for (let i = 1; i < threshold; i++) {
      coefficients.push(ScalarField.randomScalar());
    }

    const shares: KeyShare[] = [];
    for (let x = 1; x <= totalShares; x++) {
      const xBig = BigInt(x);
      let y = 0n;
      let xPower = 1n;

      for (let j = 0; j < threshold; j++) {
        const term = ScalarField.mul(coefficients[j], xPower);
        y = ScalarField.add(y, term);
        xPower = ScalarField.mul(xPower, xBig);
      }

      // Simulated generator point mapping: P = s * G
      const pubShare = ScalarField.mul(y, 7n); // Fixed simulated G generator factor
      shares.push({
        participantId: x,
        secretShare: y,
        publicKeyShare: pubShare,
      });
    }

    const groupPublicKey = ScalarField.mul(masterSecret, 7n);
    return { shares, groupPublicKey };
  }

  /**
   * Computes the Lagrange basis coefficient lambda_i(0) for a given participant set
   * lambda_i = prod_{j != i} (-x_j) / (x_i - x_j) mod n
   */
  static computeLagrangeCoefficient(
    participantId: number,
    allParticipantIds: number[]
  ): bigint {
    let num = 1n;
    let den = 1n;
    const xi = BigInt(participantId);

    for (const pid of allParticipantIds) {
      if (pid === participantId) continue;
      const xj = BigInt(pid);

      // numerator *= -xj
      num = ScalarField.mul(num, ScalarField.sub(0n, xj));
      // denominator *= (xi - xj)
      den = ScalarField.mul(den, ScalarField.sub(xi, xj));
    }

    return ScalarField.mul(num, ScalarField.inv(den));
  }

  /**
   * Reconstructs the master secret from any t valid shares using Lagrange interpolation
   */
  static reconstructSecret(shares: KeyShare[]): bigint {
    const ids = shares.map((s) => s.participantId);
    let secret = 0n;

    for (const share of shares) {
      const lambda = ShamirSecretSharing.computeLagrangeCoefficient(share.participantId, ids);
      const term = ScalarField.mul(lambda, share.secretShare);
      secret = ScalarField.add(secret, term);
    }

    return secret;
  }
}

/**
 * Flexible Round-Optimized Schnorr Threshold (FROST) Signature Coordinator
 */
export class FrostCoordinator {
  readonly threshold: number;
  readonly totalParticipants: number;
  readonly groupPublicKey: bigint;
  private readonly shares = new Map<number, KeyShare>();

  constructor(
    threshold: number,
    totalParticipants: number,
    shares: KeyShare[],
    groupPublicKey: bigint
  ) {
    this.threshold = threshold;
    this.totalParticipants = totalParticipants;
    this.groupPublicKey = groupPublicKey;

    for (const s of shares) {
      this.shares.set(s.participantId, s);
    }
  }

  /**
   * Round 1: Generate nonces and commitments for a participant
   */
  generateNoncePair(participantId: number): NoncePair {
    const d = ScalarField.randomScalar();
    const e = ScalarField.randomScalar();

    // Simulated group generator mapping G: D = d * G, E = e * G
    const D = ScalarField.mul(d, 7n);
    const E = ScalarField.mul(e, 7n);

    return {
      participantId,
      hidingNonce: d,
      bindingNonce: e,
      commitment: {
        participantId,
        hidingCommitment: D,
        bindingCommitment: E,
      },
    };
  }

  /**
   * Computes binding factor rho_i for participant i
   */
  computeBindingFactor(
    participantId: number,
    message: string,
    commitments: NonceCommitment[]
  ): bigint {
    const sorted = [...commitments].sort((a, b) => a.participantId - b.participantId);
    let serializedCommitments = '';
    for (const c of sorted) {
      serializedCommitments += `${c.participantId}:${c.hidingCommitment}:${c.bindingCommitment};`;
    }

    const payload = `${participantId}:${message}:${serializedCommitments}`;
    return ScalarField.hashToScalar(payload);
  }

  /**
   * Computes group commitment R = sum(D_i + rho_i * E_i)
   */
  computeGroupCommitment(
    message: string,
    commitments: NonceCommitment[]
  ): { rCommitment: bigint; bindingFactors: Map<number, bigint> } {
    let R = 0n;
    const bindingFactors = new Map<number, bigint>();

    for (const c of commitments) {
      const rho = this.computeBindingFactor(c.participantId, message, commitments);
      bindingFactors.set(c.participantId, rho);

      const bindingTerm = ScalarField.mul(rho, c.bindingCommitment);
      const participantR = ScalarField.add(c.hidingCommitment, bindingTerm);
      R = ScalarField.add(R, participantR);
    }

    return { rCommitment: R, bindingFactors };
  }

  /**
   * Computes the Schnorr challenge c = H(R, Y, m)
   */
  computeChallenge(rCommitment: bigint, message: string): bigint {
    const payload = `${rCommitment.toString(16)}:${this.groupPublicKey.toString(16)}:${message}`;
    return ScalarField.hashToScalar(payload);
  }

  /**
   * Round 2: Participant generates their signature share
   * z_i = d_i + (e_i * rho_i) + lambda_i * s_i * c
   */
  signShare(
    participantId: number,
    noncePair: NoncePair,
    message: string,
    commitments: NonceCommitment[]
  ): SignatureShare {
    const keyShare = this.shares.get(participantId);
    if (!keyShare) {
      throw new Error(`Key share not found for participant ${participantId}`);
    }

    const participantIds = commitments.map((c) => c.participantId);
    const lambda = ShamirSecretSharing.computeLagrangeCoefficient(participantId, participantIds);
    const rho = this.computeBindingFactor(participantId, message, commitments);

    const { rCommitment } = this.computeGroupCommitment(message, commitments);
    const c = this.computeChallenge(rCommitment, message);

    // term1 = d_i
    const term1 = noncePair.hidingNonce;
    // term2 = e_i * rho_i
    const term2 = ScalarField.mul(noncePair.bindingNonce, rho);
    // term3 = lambda_i * s_i * c
    const term3 = ScalarField.mul(ScalarField.mul(lambda, keyShare.secretShare), c);

    const z_i = ScalarField.add(ScalarField.add(term1, term2), term3);

    return {
      participantId,
      share: z_i,
    };
  }

  /**
   * Verifies an individual participant's signature share to isolate faulty peers
   * z_i * G == D_i + rho_i * E_i + c * lambda_i * Y_i
   */
  verifyShare(
    share: SignatureShare,
    commitment: NonceCommitment,
    message: string,
    commitments: NonceCommitment[]
  ): boolean {
    const keyShare = this.shares.get(share.participantId);
    if (!keyShare) return false;

    const participantIds = commitments.map((c) => c.participantId);
    const lambda = ShamirSecretSharing.computeLagrangeCoefficient(share.participantId, participantIds);
    const rho = this.computeBindingFactor(share.participantId, message, commitments);
    const { rCommitment } = this.computeGroupCommitment(message, commitments);
    const c = this.computeChallenge(rCommitment, message);

    // LHS = z_i * G
    const lhs = ScalarField.mul(share.share, 7n);

    // RHS = (D_i + rho_i * E_i) + c * lambda_i * Y_i
    const rhoE = ScalarField.mul(rho, commitment.bindingCommitment);
    const commPart = ScalarField.add(commitment.hidingCommitment, rhoE);

    const keyPart = ScalarField.mul(ScalarField.mul(c, lambda), keyShare.publicKeyShare);
    const rhs = ScalarField.add(commPart, keyPart);

    return lhs === rhs;
  }

  /**
   * Aggregates signature shares into final standard Schnorr threshold signature (R, z)
   */
  aggregateSignatures(
    message: string,
    commitments: NonceCommitment[],
    shares: SignatureShare[]
  ): FrostSignature {
    if (shares.length < this.threshold) {
      throw new Error(`Insufficient shares: got ${shares.length}, require threshold ${this.threshold}`);
    }

    // Verify all individual shares
    const commitmentMap = new Map(commitments.map((c) => [c.participantId, c]));
    for (const s of shares) {
      const comm = commitmentMap.get(s.participantId);
      if (!comm || !this.verifyShare(s, comm, message, commitments)) {
        throw new Error(`Invalid signature share detected from participant ${s.participantId}`);
      }
    }

    const { rCommitment } = this.computeGroupCommitment(message, commitments);

    let z = 0n;
    for (const s of shares) {
      z = ScalarField.add(z, s.share);
    }

    return {
      rCommitment,
      zScalar: z,
    };
  }

  /**
   * Verifies the final aggregated Schnorr signature against the group public key
   * z * G == R + c * Y
   */
  verifySignature(signature: FrostSignature, message: string): boolean {
    const c = this.computeChallenge(signature.rCommitment, message);

    // LHS = z * G
    const lhs = ScalarField.mul(signature.zScalar, 7n);

    // RHS = R + c * Y
    const cY = ScalarField.mul(c, this.groupPublicKey);
    const rhs = ScalarField.add(signature.rCommitment, cY);

    return lhs === rhs;
  }
}
