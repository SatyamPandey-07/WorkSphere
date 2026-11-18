import { createHash, randomBytes } from 'node:crypto';

/**
 * Zero-Knowledge Quadratic Constraint Satisfaction Prover.
 *
 * Proves in zero knowledge that hidden committed variables (x, y) satisfy a public quadratic
 * polynomial constraint over F_Q:
 *   a * x^2 + b * x + c == y  (mod Q)
 * given hiding Pedersen commitments:
 *   C_x = g^x * h^{r_x},   C_sq = g^{x^2} * h^{r_sq},   C_y = g^y * h^{r_y}
 *
 * Protocol:
 *  1. Squaring-gate Sigma proof: proves C_sq commits to x^2 by expressing
 *       C_sq = C_x^x * h^{r_sq - x * r_x}
 *     and proving simultaneous knowledge of (x, r_x, r_delta = r_sq - x * r_x) via
 *     Fiat-Shamir generalized Schnorr proof!
 *  2. Linear combination opening proof: verifier homomorphically computes
 *       C_eval = C_sq^a * C_x^b * g^c * C_y^{-1} = h^{a*r_sq + b*r_x - r_y}
 *     and verifies a Schnorr opening proving C_eval commits to 0!
 *  3. Supports batched multi-constraint quadratic systems and chained constraints!
 */

export const SUBGROUP_Q = 0x7fffffffffffffffffffffffffffe1d3n;
export const SAFE_PRIME_P = 0xffffffffffffffffffffffffffffc3a7n;
export const BASE_G = 4n;

function modPow(base: bigint, exp: bigint, mod: bigint): bigint {
  let result = 1n;
  let b = ((base % mod) + mod) % mod;
  let e = exp;
  while (e > 0n) {
    if ((e & 1n) === 1n) result = (result * b) % mod;
    e >>= 1n;
    b = (b * b) % mod;
  }
  return result;
}

function modScalar(v: bigint): bigint {
  return ((v % SUBGROUP_Q) + SUBGROUP_Q) % SUBGROUP_Q;
}

function randomScalar(): bigint {
  const bytes = randomBytes(16);
  let v = 0n;
  for (const b of bytes) v = (v << 8n) | BigInt(b);
  return (v % (SUBGROUP_Q - 2n)) + 1n;
}

function sha256Hex(...parts: string[]): string {
  const h = createHash('sha256');
  for (const p of parts) {
    h.update(p);
    h.update('|');
  }
  return h.digest('hex');
}

function hashToScalar(...parts: string[]): bigint {
  return modScalar(BigInt('0x' + sha256Hex(...parts).slice(0, 32)));
}

function deriveH(): bigint {
  const raw = (BigInt('0x' + sha256Hex('ZK-QUAD-CONSTRAINT-H-V1').slice(0, 32)) % (SAFE_PRIME_P - 3n)) + 2n;
  const qr = (raw * raw) % SAFE_PRIME_P;
  return qr === 1n || qr === BASE_G ? 9n : qr;
}

export const BASE_H = deriveH();

export interface CommittedScalar {
  value: bigint;
  blinding: bigint;
  commitment: bigint;
}

export interface QuadraticEquation {
  id: string;
  a: bigint;
  b: bigint;
  c: bigint;
}

export interface QuadraticConstraintProof {
  equation: QuadraticEquation;
  commX: bigint;
  commXSq: bigint;
  commY: bigint;
  // Squaring proof: C_x = g^x h^{rx}, C_sq = C_x^x h^{r_sq - x*rx}
  sqAnnounceX: bigint;
  sqAnnounceSq: bigint;
  // Linear relation proof: C_sq^a * C_x^b * g^c * C_y^{-1} = h^{r_lin}
  linAnnounceR: bigint;
  challenge: bigint;
  respX: bigint;
  respRx: bigint;
  respRDelta: bigint;
  respRLin: bigint;
  context: string;
}

export interface QuadraticBatchReport {
  allValid: boolean;
  verifiedCount: number;
  failedEquationIds: string[];
}

export class ZeroKnowledgeQuadraticConstraintProver {
  public commitScalar(value: bigint, blinding?: bigint): CommittedScalar {
    const v = modScalar(value);
    const r = blinding !== undefined ? modScalar(blinding) : randomScalar();
    const commitment = (modPow(BASE_G, v, SAFE_PRIME_P) * modPow(BASE_H, r, SAFE_PRIME_P)) % SAFE_PRIME_P;
    return { value: v, blinding: r, commitment };
  }

  public evaluateQuadratic(eq: QuadraticEquation, x: bigint): bigint {
    const xn = modScalar(x);
    const xSq = modScalar(xn * xn);
    return modScalar(modScalar(eq.a) * xSq + modScalar(eq.b) * xn + modScalar(eq.c));
  }

  private computeChallenge(
    eq: QuadraticEquation,
    commX: bigint,
    commXSq: bigint,
    commY: bigint,
    sqAnnounceX: bigint,
    sqAnnounceSq: bigint,
    linAnnounceR: bigint,
    context: string,
  ): bigint {
    return hashToScalar(
      'ZK-QUADRATIC-CONSTRAINT-V1',
      eq.id,
      modScalar(eq.a).toString(16),
      modScalar(eq.b).toString(16),
      modScalar(eq.c).toString(16),
      commX.toString(16),
      commXSq.toString(16),
      commY.toString(16),
      sqAnnounceX.toString(16),
      sqAnnounceSq.toString(16),
      linAnnounceR.toString(16),
      context,
    );
  }

  public proveConstraint(
    eq: QuadraticEquation,
    xComm: CommittedScalar,
    yComm?: CommittedScalar,
    context = 'quad-v1',
  ): { proof: QuadraticConstraintProof; yCommitted: CommittedScalar } {
    const expectedY = this.evaluateQuadratic(eq, xComm.value);
    const yCommitted = yComm ?? this.commitScalar(expectedY);
    if (yCommitted.value !== expectedY) {
      throw new Error(`Committed y (${yCommitted.value}) does not satisfy ${eq.id} (expected ${expectedY})`);
    }

    const xSqVal = modScalar(xComm.value * xComm.value);
    const xSqComm = this.commitScalar(xSqVal);

    // rDelta = r_sq - x * r_x  =>  C_sq = C_x^x * h^{rDelta}
    const rDelta = modScalar(xSqComm.blinding - xComm.value * xComm.blinding);
    // rLin = a * r_sq + b * r_x - r_y  =>  C_sq^a * C_x^b * g^c * C_y^{-1} = h^{rLin}
    const rLin = modScalar(modScalar(eq.a) * xSqComm.blinding + modScalar(eq.b) * xComm.blinding - yCommitted.blinding);

    const kx = randomScalar();
    const krx = randomScalar();
    const krDelta = randomScalar();
    const krLin = randomScalar();

    const sqAnnounceX = (modPow(BASE_G, kx, SAFE_PRIME_P) * modPow(BASE_H, krx, SAFE_PRIME_P)) % SAFE_PRIME_P;
    const sqAnnounceSq = (modPow(xComm.commitment, kx, SAFE_PRIME_P) * modPow(BASE_H, krDelta, SAFE_PRIME_P)) % SAFE_PRIME_P;
    const linAnnounceR = modPow(BASE_H, krLin, SAFE_PRIME_P);

    const normalizedEq: QuadraticEquation = {
      id: eq.id,
      a: modScalar(eq.a),
      b: modScalar(eq.b),
      c: modScalar(eq.c),
    };

    const challenge = this.computeChallenge(
      normalizedEq,
      xComm.commitment,
      xSqComm.commitment,
      yCommitted.commitment,
      sqAnnounceX,
      sqAnnounceSq,
      linAnnounceR,
      context,
    );

    const proof: QuadraticConstraintProof = {
      equation: normalizedEq,
      commX: xComm.commitment,
      commXSq: xSqComm.commitment,
      commY: yCommitted.commitment,
      sqAnnounceX,
      sqAnnounceSq,
      linAnnounceR,
      challenge,
      respX: modScalar(kx + challenge * xComm.value),
      respRx: modScalar(krx + challenge * xComm.blinding),
      respRDelta: modScalar(krDelta + challenge * rDelta),
      respRLin: modScalar(krLin + challenge * rLin),
      context,
    };

    return { proof, yCommitted };
  }

  public verifyConstraint(proof: QuadraticConstraintProof): boolean {
    const eq = proof.equation;
    const expectedC = this.computeChallenge(
      eq,
      proof.commX,
      proof.commXSq,
      proof.commY,
      proof.sqAnnounceX,
      proof.sqAnnounceSq,
      proof.linAnnounceR,
      proof.context,
    );
    if (expectedC !== proof.challenge) return false;

    // Check 1: g^{respX} * h^{respRx} == sqAnnounceX * C_x^c
    const lhs1 = (modPow(BASE_G, proof.respX, SAFE_PRIME_P) * modPow(BASE_H, proof.respRx, SAFE_PRIME_P)) % SAFE_PRIME_P;
    const rhs1 = (proof.sqAnnounceX * modPow(proof.commX, proof.challenge, SAFE_PRIME_P)) % SAFE_PRIME_P;
    if (lhs1 !== rhs1) return false;

    // Check 2: C_x^{respX} * h^{respRDelta} == sqAnnounceSq * C_sq^c
    const lhs2 = (modPow(proof.commX, proof.respX, SAFE_PRIME_P) * modPow(BASE_H, proof.respRDelta, SAFE_PRIME_P)) % SAFE_PRIME_P;
    const rhs2 = (proof.sqAnnounceSq * modPow(proof.commXSq, proof.challenge, SAFE_PRIME_P)) % SAFE_PRIME_P;
    if (lhs2 !== rhs2) return false;

    // Check 3: C_eval = C_sq^a * C_x^b * g^c * C_y^{-1} opens to 0 via h^{respRLin}
    const termA = modPow(proof.commXSq, modScalar(eq.a), SAFE_PRIME_P);
    const termB = modPow(proof.commX, modScalar(eq.b), SAFE_PRIME_P);
    const termC = modPow(BASE_G, modScalar(eq.c), SAFE_PRIME_P);
    const invY = modPow(proof.commY, SAFE_PRIME_P - 2n, SAFE_PRIME_P);
    const cEval = (((((termA * termB) % SAFE_PRIME_P) * termC) % SAFE_PRIME_P) * invY) % SAFE_PRIME_P;

    const lhs3 = modPow(BASE_H, proof.respRLin, SAFE_PRIME_P);
    const rhs3 = (proof.linAnnounceR * modPow(cEval, proof.challenge, SAFE_PRIME_P)) % SAFE_PRIME_P;
    return lhs3 === rhs3;
  }

  public proveChainedSystem(
    equations: QuadraticEquation[],
    initialX: bigint,
    context = 'quad-chain',
  ): QuadraticConstraintProof[] {
    if (equations.length === 0) throw new Error('Equation chain cannot be empty');
    let cur = this.commitScalar(initialX);
    const proofs: QuadraticConstraintProof[] = [];
    for (let i = 0; i < equations.length; i++) {
      const { proof, yCommitted } = this.proveConstraint(equations[i], cur, undefined, `${context}:step-${i}`);
      proofs.push(proof);
      cur = yCommitted;
    }
    return proofs;
  }

  public verifyBatch(proofs: QuadraticConstraintProof[], requireChainLink = false): QuadraticBatchReport {
    const failedEquationIds: string[] = [];
    let verifiedCount = 0;

    for (let i = 0; i < proofs.length; i++) {
      const p = proofs[i];
      let ok = this.verifyConstraint(p);
      if (ok && requireChainLink && i > 0) {
        if (p.commX !== proofs[i - 1].commY) ok = false;
      }
      if (ok) verifiedCount++;
      else failedEquationIds.push(p.equation.id);
    }

    return {
      allValid: failedEquationIds.length === 0,
      verifiedCount,
      failedEquationIds,
    };
  }

  public serializeProof(proof: QuadraticConstraintProof): string {
    return JSON.stringify({
      equationId: proof.equation.id,
      a: proof.equation.a.toString(),
      b: proof.equation.b.toString(),
      c: proof.equation.c.toString(),
      commX: proof.commX.toString(16),
      commY: proof.commY.toString(16),
      context: proof.context,
    });
  }
}
