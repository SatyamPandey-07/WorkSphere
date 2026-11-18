import { createHash } from 'crypto';

/**
 * Zero-Knowledge Privacy Pass Threshold Blind Anonymous Token Issuer (VOPRF)
 *
 * Implements an RFC 9576 / Privacy Pass (t, n) threshold Verifiable Oblivious
 * Pseudorandom Function (VOPRF) anonymous token issuance and unlinkable
 * redemption engine over a safe-prime subgroup (P = 2Q + 1):
 *   1. Shamir (t, n) issuer committee key sharing with public points PK_i = g^{k_i}
 *   2. Client token blinding M = H_p(t)^r mod P hiding token preimage t from issuers
 *   3. Verifiable partial VOPRF evaluations Z_i = M^{k_i} with Chaum-Pedersen DLEQ proofs
 *   4. Lagrange interpolation and client unblinding W = (prod Z_i^{lambda_i})^{r^{-1}} = H_p(t)^k
 *   5. Unlinkable token redemption verification with nullifier replay tracking
 */

const SUBGROUP_ORDER = 0x7fffffffffffffffffffffffffffe1d3n; // Prime Q
const SAFE_PRIME = 0xffffffffffffffffffffffffffffc3a7n; // Safe prime P = 2Q + 1
const SUBGROUP_GEN = 4n; // Order-Q generator g

export interface IssuerShare {
  readonly issuerId: number;
  readonly shareScalar: bigint;
  readonly publicPoint: bigint;
}

export interface TokenIssuerCommittee {
  readonly threshold: number;
  readonly totalIssuers: number;
  readonly masterScalar: bigint;
  readonly committeePublicKey: bigint;
  readonly issuers: readonly IssuerShare[];
}

export interface BlindedTokenRequest {
  readonly requestId: string;
  readonly blindedPointM: bigint;
}

export interface ClientBlindingState {
  readonly tokenPreimage: string;
  readonly blindingScalarR: bigint;
  readonly hashedPointPt: bigint;
  readonly request: BlindedTokenRequest;
}

export interface PartialVOPRFEvaluation {
  readonly issuerId: number;
  readonly requestId: string;
  readonly evaluatedPointZ: bigint;
  readonly dleqA1: bigint;
  readonly dleqA2: bigint;
  readonly dleqChallenge: bigint;
  readonly dleqResponse: bigint;
}

export interface UnblindedAnonymousToken {
  readonly tokenPreimage: string;
  readonly authenticatorW: bigint;
  readonly tokenSerialDigest: string;
  readonly issuerIds: readonly number[];
}

export interface TokenRedemptionResult {
  readonly isValid: boolean;
  readonly signatureMatches: boolean;
  readonly freshToken: boolean;
  readonly serialDigest: string;
  readonly reason?: string;
}

function modQ(x: bigint): bigint {
  const r = x % SUBGROUP_ORDER;
  return r >= 0n ? r : r + SUBGROUP_ORDER;
}

function modP(x: bigint): bigint {
  const r = x % SAFE_PRIME;
  return r >= 0n ? r : r + SAFE_PRIME;
}

function modPow(base: bigint, exp: bigint, mod: bigint): bigint {
  let result = 1n;
  let b = ((base % mod) + mod) % mod;
  let e = exp;
  while (e > 0n) {
    if ((e & 1n) === 1n) {
      result = (result * b) % mod;
    }
    b = (b * b) % mod;
    e >>= 1n;
  }
  return result;
}

function modInverseQ(a: bigint): bigint {
  const val = modQ(a);
  if (val === 0n) throw new Error('Cannot invert zero mod Q');
  return modPow(val, SUBGROUP_ORDER - 2n, SUBGROUP_ORDER);
}

function hashToScalar(domain: string, parts: readonly string[]): bigint {
  const h = createHash('sha256');
  h.update(domain);
  for (const p of parts) {
    h.update('|');
    h.update(p);
  }
  const s = modQ(BigInt('0x' + h.digest('hex')));
  return s === 0n ? 1n : s;
}

function hashToGroupPoint(tokenPreimage: string): bigint {
  const exp = hashToScalar('VOPRF_H2G', [tokenPreimage]);
  return modPow(SUBGROUP_GEN, exp, SAFE_PRIME);
}

function isInSubgroup(pt: bigint): boolean {
  return pt > 1n && pt < SAFE_PRIME && modPow(pt, SUBGROUP_ORDER, SAFE_PRIME) === 1n;
}

function lagrangeCoeffAtZero(id: number, allIds: readonly number[]): bigint {
  const xI = BigInt(id);
  let num = 1n;
  let den = 1n;
  for (const other of allIds) {
    if (other === id) continue;
    const xJ = BigInt(other);
    num = modQ(num * modQ(-xJ));
    den = modQ(den * modQ(xI - xJ));
  }
  return modQ(num * modInverseQ(den));
}

export class ThresholdBlindTokenIssuer {
  private readonly threshold: number;
  private readonly totalIssuers: number;
  private readonly redeemedSerials = new Set<string>();

  constructor(threshold: number, totalIssuers: number) {
    if (!Number.isInteger(threshold) || !Number.isInteger(totalIssuers)) {
      throw new Error('threshold and totalIssuers must be integers');
    }
    if (threshold < 2 || threshold > totalIssuers) {
      throw new Error('Require 2 <= threshold <= totalIssuers');
    }
    this.threshold = threshold;
    this.totalIssuers = totalIssuers;
  }

  public getThreshold(): number {
    return this.threshold;
  }

  public getRedeemedCount(): number {
    return this.redeemedSerials.size;
  }

  public generateCommittee(epochSeed: string): TokenIssuerCommittee {
    const coeffs: bigint[] = [];
    for (let k = 0; k < this.threshold; k++) {
      coeffs.push(hashToScalar('PP_VOPRF_POLY', [epochSeed, String(k)]));
    }
    const masterScalar = coeffs[0];
    const committeePublicKey = modPow(SUBGROUP_GEN, masterScalar, SAFE_PRIME);

    const issuers: IssuerShare[] = [];
    for (let id = 1; id <= this.totalIssuers; id++) {
      const x = BigInt(id);
      let y = 0n;
      let xPow = 1n;
      for (let k = 0; k < coeffs.length; k++) {
        y = modQ(y + modQ(coeffs[k] * xPow));
        xPow = modQ(xPow * x);
      }
      issuers.push({
        issuerId: id,
        shareScalar: y,
        publicPoint: modPow(SUBGROUP_GEN, y, SAFE_PRIME),
      });
    }

    return {
      threshold: this.threshold,
      totalIssuers: this.totalIssuers,
      masterScalar,
      committeePublicKey,
      issuers,
    };
  }

  public clientBlindToken(
    tokenPreimage: string,
    blindingNonce: string,
    requestId: string
  ): ClientBlindingState {
    if (!tokenPreimage) {
      throw new Error('tokenPreimage must be non-empty');
    }
    const hashedPointPt = hashToGroupPoint(tokenPreimage);
    const blindingScalarR = hashToScalar('PP_CLIENT_BLIND_R', [tokenPreimage, blindingNonce, requestId]);
    const blindedPointM = modPow(hashedPointPt, blindingScalarR, SAFE_PRIME);

    return {
      tokenPreimage,
      blindingScalarR,
      hashedPointPt,
      request: {
        requestId,
        blindedPointM,
      },
    };
  }

  public issuerEvaluate(
    issuer: IssuerShare,
    request: BlindedTokenRequest,
    evalNonce: string
  ): PartialVOPRFEvaluation {
    if (!isInSubgroup(request.blindedPointM)) {
      throw new Error('Blinded request point M is not a valid order-Q subgroup element');
    }

    const k = modQ(issuer.shareScalar);
    const evaluatedPointZ = modPow(request.blindedPointM, k, SAFE_PRIME);

    // Chaum-Pedersen DLEQ proof: log_g(PK_i) == log_M(Z_i) == k_i
    const w = hashToScalar('PP_DLEQ_W', [
      String(issuer.issuerId),
      request.requestId,
      evalNonce,
      evaluatedPointZ.toString(16),
    ]);
    const dleqA1 = modPow(SUBGROUP_GEN, w, SAFE_PRIME);
    const dleqA2 = modPow(request.blindedPointM, w, SAFE_PRIME);
    const dleqChallenge = hashToScalar('PP_DLEQ_E', [
      String(issuer.issuerId),
      request.requestId,
      issuer.publicPoint.toString(16),
      request.blindedPointM.toString(16),
      evaluatedPointZ.toString(16),
      dleqA1.toString(16),
      dleqA2.toString(16),
    ]);
    const dleqResponse = modQ(w + modQ(dleqChallenge * k));

    return {
      issuerId: issuer.issuerId,
      requestId: request.requestId,
      evaluatedPointZ,
      dleqA1,
      dleqA2,
      dleqChallenge,
      dleqResponse,
    };
  }

  public verifyPartialEvaluation(
    issuerPublicPoint: bigint,
    request: BlindedTokenRequest,
    partial: PartialVOPRFEvaluation
  ): boolean {
    if (partial.requestId !== request.requestId) return false;
    if (!isInSubgroup(issuerPublicPoint) || !isInSubgroup(request.blindedPointM)) return false;

    const expectedE = hashToScalar('PP_DLEQ_E', [
      String(partial.issuerId),
      request.requestId,
      issuerPublicPoint.toString(16),
      request.blindedPointM.toString(16),
      partial.evaluatedPointZ.toString(16),
      partial.dleqA1.toString(16),
      partial.dleqA2.toString(16),
    ]);
    if (expectedE !== partial.dleqChallenge) return false;

    const lhs1 = modPow(SUBGROUP_GEN, modQ(partial.dleqResponse), SAFE_PRIME);
    const rhs1 = modP(partial.dleqA1 * modPow(issuerPublicPoint, expectedE, SAFE_PRIME));
    const lhs2 = modPow(request.blindedPointM, modQ(partial.dleqResponse), SAFE_PRIME);
    const rhs2 = modP(partial.dleqA2 * modPow(partial.evaluatedPointZ, expectedE, SAFE_PRIME));
    return lhs1 === rhs1 && lhs2 === rhs2;
  }

  public clientFinalizeAndUnblind(
    blindingState: ClientBlindingState,
    partials: readonly PartialVOPRFEvaluation[],
    publicPointsByIssuer: ReadonlyMap<number, bigint>
  ): UnblindedAnonymousToken {
    if (partials.length < this.threshold) {
      throw new Error(`Need at least ${this.threshold} valid partial VOPRF evaluations`);
    }
    const selected = partials.slice(0, this.threshold);
    const issuerIds = selected.map((p) => p.issuerId);
    if (new Set(issuerIds).size !== issuerIds.length) {
      throw new Error('Duplicate issuer IDs detected in evaluation set');
    }

    let combinedZ = 1n;
    for (const part of selected) {
      const pubPoint = publicPointsByIssuer.get(part.issuerId);
      if (!pubPoint || !this.verifyPartialEvaluation(pubPoint, blindingState.request, part)) {
        throw new Error(`Invalid Chaum-Pedersen DLEQ proof from issuer ${part.issuerId}`);
      }
      const lambda = lagrangeCoeffAtZero(part.issuerId, issuerIds);
      combinedZ = modP(combinedZ * modPow(part.evaluatedPointZ, lambda, SAFE_PRIME));
    }

    const rInv = modInverseQ(blindingState.blindingScalarR);
    const authenticatorW = modPow(combinedZ, rInv, SAFE_PRIME);

    const tokenSerialDigest = createHash('sha256')
      .update(`PP_TOKEN_SERIAL|${blindingState.tokenPreimage}|${authenticatorW.toString(16)}`)
      .digest('hex');

    return {
      tokenPreimage: blindingState.tokenPreimage,
      authenticatorW,
      tokenSerialDigest,
      issuerIds: [...issuerIds].sort((a, b) => a - b),
    };
  }

  public redeemToken(
    committee: TokenIssuerCommittee,
    token: UnblindedAnonymousToken,
    consumeSerial = true
  ): TokenRedemptionResult {
    const expectedSerial = createHash('sha256')
      .update(`PP_TOKEN_SERIAL|${token.tokenPreimage}|${token.authenticatorW.toString(16)}`)
      .digest('hex');

    if (expectedSerial !== token.tokenSerialDigest) {
      return {
        isValid: false,
        signatureMatches: false,
        freshToken: false,
        serialDigest: expectedSerial,
        reason: 'Token serial digest mismatch',
      };
    }

    const pt = hashToGroupPoint(token.tokenPreimage);
    const expectedW = modPow(pt, modQ(committee.masterScalar), SAFE_PRIME);
    const signatureMatches = expectedW === token.authenticatorW;
    const freshToken = !this.redeemedSerials.has(expectedSerial);

    if (!signatureMatches || !freshToken) {
      return {
        isValid: false,
        signatureMatches,
        freshToken,
        serialDigest: expectedSerial,
        reason: !freshToken
          ? 'Anonymous token replay / double-redemption detected'
          : 'Token VOPRF authenticator verification failed',
      };
    }

    if (consumeSerial) {
      this.redeemedSerials.add(expectedSerial);
    }

    return {
      isValid: true,
      signatureMatches: true,
      freshToken: true,
      serialDigest: expectedSerial,
    };
  }
}
