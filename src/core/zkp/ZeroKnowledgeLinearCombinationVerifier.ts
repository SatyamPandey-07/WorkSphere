import { createHash, randomBytes } from 'node:crypto';

/**
 * Zero-Knowledge Committed Linear Combination & Affine System Verifier.
 *
 * Proves simultaneously in zero knowledge that hidden Pedersen-committed witness scalars
 * C_x[0..n-1] satisfy a system of M affine linear equations:
 *   sum_{j=0}^{n-1} A[i][j] * x_j + b_i == y_i  (mod Q),   for i = 0..M-1
 * where y_i may be either publicly known OR secretly committed in C_y[i]!
 *
 * Uses Fiat-Shamir random linear folding across all M equations with challenge scalar gamma,
 * collapsing the entire M-equation affine system into ONE constant-size Schnorr opening
 * proof of zero residual commitment — verifiable in O(M + N) group exponentiations!
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
  const v = modScalar(BigInt('0x' + sha256Hex(...parts).slice(0, 32)));
  return v === 0n ? 1n : v;
}

function deriveH(): bigint {
  const raw = (BigInt('0x' + sha256Hex('ZK-LINEAR-COMBO-H-V1').slice(0, 32)) % (SAFE_PRIME_P - 3n)) + 2n;
  const qr = (raw * raw) % SAFE_PRIME_P;
  return qr === 1n || qr === BASE_G ? 9n : qr;
}

export const BASE_H = deriveH();

export interface CommittedVariable {
  name: string;
  value: bigint;
  blinding: bigint;
  commitment: bigint;
}

export interface AffineEquationSpec {
  id: string;
  coefficients: bigint[]; // length == variable count
  constantOffset: bigint; // b_i
  targetOutput: CommittedVariable; // y_i (committed; can commit with blinding=0 for public target)
}

export interface LinearCombinationSystemProof {
  variableCommitments: bigint[];
  equations: Array<{
    id: string;
    coefficients: bigint[];
    constantOffset: bigint;
    targetCommitment: bigint;
  }>;
  foldingGamma: bigint;
  announcementR: bigint;
  challenge: bigint;
  responseBlinding: bigint;
  context: string;
}

export class ZeroKnowledgeLinearCombinationVerifier {
  public commitVariable(name: string, value: bigint, blinding?: bigint): CommittedVariable {
    const v = modScalar(value);
    const r = blinding !== undefined ? modScalar(blinding) : randomScalar();
    const commitment = (modPow(BASE_G, v, SAFE_PRIME_P) * modPow(BASE_H, r, SAFE_PRIME_P)) % SAFE_PRIME_P;
    return { name, value: v, blinding: r, commitment };
  }

  public evaluateAffine(coefficients: bigint[], variables: CommittedVariable[], constantOffset: bigint): bigint {
    if (coefficients.length !== variables.length) {
      throw new RangeError('Coefficient vector length must match variable count');
    }
    let acc = modScalar(constantOffset);
    for (let j = 0; j < variables.length; j++) {
      acc = modScalar(acc + modScalar(coefficients[j]) * variables[j].value);
    }
    return acc;
  }

  private computeFoldingGamma(
    variableCommitments: bigint[],
    equations: Array<{ id: string; coefficients: bigint[]; constantOffset: bigint; targetCommitment: bigint }>,
    context: string,
  ): bigint {
    return hashToScalar(
      'LINCOMBO-GAMMA-V1',
      context,
      ...variableCommitments.map((c) => c.toString(16)),
      ...equations.map((eq) =>
        `${eq.id}:${eq.constantOffset.toString(16)}:${eq.targetCommitment.toString(16)}:${eq.coefficients.map((c) => c.toString(16)).join(',')}`,
      ),
    );
  }

  public proveAffineSystem(
    variables: CommittedVariable[],
    equations: AffineEquationSpec[],
    context = 'affine-sys-v1',
  ): LinearCombinationSystemProof {
    if (variables.length === 0 || equations.length === 0) {
      throw new Error('Variables and equations must be non-empty');
    }

    const publicEqs = equations.map((eq) => {
      if (eq.coefficients.length !== variables.length) {
        throw new RangeError(`Equation "${eq.id}" coefficient length mismatch`);
      }
      const lhsVal = this.evaluateAffine(eq.coefficients, variables, eq.constantOffset);
      if (lhsVal !== eq.targetOutput.value) {
        throw new Error(`Equation "${eq.id}" is unsatisfied: lhs=${lhsVal}, target=${eq.targetOutput.value}`);
      }
      return {
        id: eq.id,
        coefficients: eq.coefficients.map((c) => modScalar(c)),
        constantOffset: modScalar(eq.constantOffset),
        targetCommitment: eq.targetOutput.commitment,
      };
    });

    const variableCommitments = variables.map((v) => v.commitment);
    const foldingGamma = this.computeFoldingGamma(variableCommitments, publicEqs, context);

    // Fold blindings across all equations: sum_i gamma^i * (sum_j a_{i,j} r_j - r_{y,i})
    let gammaPow = 1n;
    let foldedResidualBlinding = 0n;
    for (let i = 0; i < equations.length; i++) {
      let eqBlinding = modScalar(SUBGROUP_Q - equations[i].targetOutput.blinding);
      for (let j = 0; j < variables.length; j++) {
        eqBlinding = modScalar(eqBlinding + publicEqs[i].coefficients[j] * variables[j].blinding);
      }
      foldedResidualBlinding = modScalar(foldedResidualBlinding + gammaPow * eqBlinding);
      gammaPow = modScalar(gammaPow * foldingGamma);
    }

    const k = randomScalar();
    const announcementR = modPow(BASE_H, k, SAFE_PRIME_P);
    const challenge = hashToScalar(
      'LINCOMBO-CHALLENGE-V1',
      foldingGamma.toString(16),
      announcementR.toString(16),
      context,
    );
    const responseBlinding = modScalar(k + challenge * foldedResidualBlinding);

    return {
      variableCommitments,
      equations: publicEqs,
      foldingGamma,
      announcementR,
      challenge,
      responseBlinding,
      context,
    };
  }

  public verifyAffineSystem(proof: LinearCombinationSystemProof): boolean {
    const n = proof.variableCommitments.length;
    const m = proof.equations.length;
    if (n === 0 || m === 0) return false;
    if (proof.equations.some((eq) => eq.coefficients.length !== n)) return false;

    const expectedGamma = this.computeFoldingGamma(proof.variableCommitments, proof.equations, proof.context);
    if (expectedGamma !== proof.foldingGamma) return false;

    const expectedC = hashToScalar(
      'LINCOMBO-CHALLENGE-V1',
      proof.foldingGamma.toString(16),
      proof.announcementR.toString(16),
      proof.context,
    );
    if (expectedC !== proof.challenge) return false;

    // Aggregate coefficients per variable in O(M*N) scalar ops, then perform only O(M + N) group exponentiations!
    const foldedVarExps = new Array<bigint>(n).fill(0n);
    let foldedConstOffset = 0n;
    let foldedTargetProd = 1n;
    let gammaPow = 1n;

    for (let i = 0; i < m; i++) {
      const eq = proof.equations[i];
      for (let j = 0; j < n; j++) {
        foldedVarExps[j] = modScalar(foldedVarExps[j] + gammaPow * modScalar(eq.coefficients[j]));
      }
      foldedConstOffset = modScalar(foldedConstOffset + gammaPow * modScalar(eq.constantOffset));
      foldedTargetProd = (foldedTargetProd * modPow(eq.targetCommitment, gammaPow, SAFE_PRIME_P)) % SAFE_PRIME_P;
      gammaPow = modScalar(gammaPow * proof.foldingGamma);
    }

    let lhsGroup = modPow(BASE_G, foldedConstOffset, SAFE_PRIME_P);
    for (let j = 0; j < n; j++) {
      lhsGroup = (lhsGroup * modPow(proof.variableCommitments[j], foldedVarExps[j], SAFE_PRIME_P)) % SAFE_PRIME_P;
    }

    const invTarget = modPow(foldedTargetProd, SAFE_PRIME_P - 2n, SAFE_PRIME_P);
    const foldedResidualComm = (lhsGroup * invTarget) % SAFE_PRIME_P;

    const lhs = modPow(BASE_H, proof.responseBlinding, SAFE_PRIME_P);
    const rhs = (proof.announcementR * modPow(foldedResidualComm, proof.challenge, SAFE_PRIME_P)) % SAFE_PRIME_P;
    return lhs === rhs;
  }

  public verifyBatch(proofs: LinearCombinationSystemProof[]): { allValid: boolean; failedIndices: number[] } {
    const failedIndices: number[] = [];
    for (let i = 0; i < proofs.length; i++) {
      if (!this.verifyAffineSystem(proofs[i])) failedIndices.push(i);
    }
    return { allValid: failedIndices.length === 0, failedIndices };
  }

  public serializeProof(proof: LinearCombinationSystemProof): string {
    return JSON.stringify({
      variableCount: proof.variableCommitments.length,
      equationCount: proof.equations.length,
      foldingGamma: proof.foldingGamma.toString(16),
      context: proof.context,
    });
  }
}
