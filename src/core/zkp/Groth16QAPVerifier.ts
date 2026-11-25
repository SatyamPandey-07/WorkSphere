import { createHash } from 'crypto';

/**
 * Zero-Knowledge Groth16 Quadratic Arithmetic Program (QAP) Prover & Verifier
 *
 * Implements the full R1CS -> QAP compiler and Groth16 SNARK protocol
 * (Groth, EUROCRYPT 2016) over a safe-prime subgroup (P = 2Q + 1):
 *   1. Compiles R1CS constraint rows into Lagrange-interpolated wire polynomials
 *      u_k(X), v_k(X), w_k(X) and vanishing polynomial t(X) = prod_{j=1}^m (X - j).
 *   2. Generates Groth16 structured proving/verifying keys from ceremony trapdoors
 *      (alpha, beta, gamma, delta, tau).
 *   3. Computes exact quotient H(X) = (A(X)*B(X) - C(X)) / t(X) and randomized
 *      zero-knowledge blinded proof elements (pi_A, pi_B, pi_C) with shifts (r, s).
 *   4. Verifies the O(1) Groth16 quadratic equation:
 *        g^{pi_A * pi_B} == g^{alpha*beta} * (g^{IC})^gamma * (g^{pi_C})^delta mod P.
 */

const SUBGROUP_ORDER = 0x7fffffffffffffffffffffffffffe1d3n; // Prime Q
const SAFE_PRIME = 0xffffffffffffffffffffffffffffc3a7n; // Safe prime P = 2Q + 1
const SUBGROUP_GEN = 4n; // Order-Q generator g

export interface R1CSConstraintRow {
  readonly a: ReadonlyMap<number, bigint>;
  readonly b: ReadonlyMap<number, bigint>;
  readonly c: ReadonlyMap<number, bigint>;
}

export interface R1CSCircuitSpec {
  readonly numVariables: number; // index 0 = constant 1
  readonly numPublicInputs: number; // indices 1..numPublicInputs
  readonly constraints: readonly R1CSConstraintRow[];
}

export interface QAPRepresentation {
  readonly numConstraints: number;
  readonly numVariables: number;
  readonly numPublicInputs: number;
  readonly polyU: readonly (readonly bigint[])[];
  readonly polyV: readonly (readonly bigint[])[];
  readonly polyW: readonly (readonly bigint[])[];
  readonly vanishingT: readonly bigint[];
}

export interface Groth16Proof {
  readonly piA: bigint;
  readonly piB: bigint;
  readonly piC: bigint;
  readonly commitA: bigint;
  readonly commitB: bigint;
  readonly commitC: bigint;
  readonly publicInputs: readonly bigint[];
  readonly proofDigest: string;
}

export interface Groth16VerificationResult {
  readonly isValid: boolean;
  readonly lhsTargetPoint: bigint;
  readonly rhsTargetPoint: bigint;
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

function trimPoly(coeffs: readonly bigint[]): bigint[] {
  const out = coeffs.map((c) => modQ(c));
  while (out.length > 1 && out[out.length - 1] === 0n) {
    out.pop();
  }
  return out;
}

function evalPoly(coeffs: readonly bigint[], x: bigint): bigint {
  let acc = 0n;
  const pt = modQ(x);
  for (let i = coeffs.length - 1; i >= 0; i--) {
    acc = modQ(acc * pt + modQ(coeffs[i]));
  }
  return acc;
}

function addPoly(a: readonly bigint[], b: readonly bigint[]): bigint[] {
  const len = Math.max(a.length, b.length);
  const res = new Array<bigint>(len).fill(0n);
  for (let i = 0; i < len; i++) {
    res[i] = modQ((a[i] ?? 0n) + (b[i] ?? 0n));
  }
  return trimPoly(res);
}

function subPoly(a: readonly bigint[], b: readonly bigint[]): bigint[] {
  const len = Math.max(a.length, b.length);
  const res = new Array<bigint>(len).fill(0n);
  for (let i = 0; i < len; i++) {
    res[i] = modQ((a[i] ?? 0n) - (b[i] ?? 0n));
  }
  return trimPoly(res);
}

function mulPoly(a: readonly bigint[], b: readonly bigint[]): bigint[] {
  const res = new Array<bigint>(a.length + b.length - 1).fill(0n);
  for (let i = 0; i < a.length; i++) {
    for (let j = 0; j < b.length; j++) {
      res[i + j] = modQ(res[i + j] + modQ(a[i] * b[j]));
    }
  }
  return trimPoly(res);
}

function scalePoly(a: readonly bigint[], scalar: bigint): bigint[] {
  const s = modQ(scalar);
  return trimPoly(a.map((c) => modQ(c * s)));
}

function divPoly(
  dividend: readonly bigint[],
  divisor: readonly bigint[]
): { quotient: bigint[]; remainder: bigint[] } {
  const num = trimPoly(dividend);
  const den = trimPoly(divisor);
  if (den.length === 1 && den[0] === 0n) {
    throw new Error('Division by zero polynomial');
  }
  if (num.length < den.length) {
    return { quotient: [0n], remainder: num };
  }
  const working = [...num];
  const qLen = num.length - den.length + 1;
  const quotient = new Array<bigint>(qLen).fill(0n);
  const invLead = modInverseQ(den[den.length - 1]);

  for (let i = qLen - 1; i >= 0; i--) {
    const lead = working[i + den.length - 1];
    if (lead !== 0n) {
      const factor = modQ(lead * invLead);
      quotient[i] = factor;
      for (let j = 0; j < den.length; j++) {
        working[i + j] = modQ(working[i + j] - modQ(factor * den[j]));
      }
    }
  }
  const remSlice = working.slice(0, den.length - 1);
  return {
    quotient: trimPoly(quotient),
    remainder: trimPoly(remSlice.length > 0 ? remSlice : [0n]),
  };
}

function interpolateOnDomain(values: readonly bigint[]): bigint[] {
  const m = values.length;
  let result: bigint[] = [0n];
  for (let i = 0; i < m; i++) {
    const yi = modQ(values[i]);
    if (yi === 0n) continue;
    const xi = BigInt(i + 1);
    let basis: bigint[] = [1n];
    let denom = 1n;
    for (let j = 0; j < m; j++) {
      if (i === j) continue;
      const xj = BigInt(j + 1);
      basis = mulPoly(basis, [modQ(-xj), 1n]);
      denom = modQ(denom * modQ(xi - xj));
    }
    result = addPoly(result, scalePoly(basis, modQ(yi * modInverseQ(denom))));
  }
  return trimPoly(result);
}

export class Groth16QAPVerifier {
  private readonly qap: QAPRepresentation;
  private readonly alpha: bigint;
  private readonly beta: bigint;
  private readonly gamma: bigint;
  private readonly delta: bigint;
  private readonly tau: bigint;
  private readonly alphaBetaPoint: bigint;
  private readonly icTerms: readonly bigint[]; // public wire verification scalars (index 0..numPublicInputs)
  private readonly icPoints: readonly bigint[]; // g^{icTerms[k]} mod P

  constructor(spec: R1CSCircuitSpec, setupSeed = 'WORKSPHERE_GROTH16_CEREMONY_V1') {
    if (spec.constraints.length === 0 || spec.numVariables < 2) {
      throw new Error('R1CS spec must have at least 1 constraint and 2 variables');
    }
    if (spec.numPublicInputs < 0 || spec.numPublicInputs >= spec.numVariables) {
      throw new Error('Invalid numPublicInputs count');
    }

    this.qap = Groth16QAPVerifier.compileR1CStoQAP(spec);
    this.alpha = hashToScalar('GROTH16_ALPHA', [setupSeed]);
    this.beta = hashToScalar('GROTH16_BETA', [setupSeed]);
    this.gamma = hashToScalar('GROTH16_GAMMA', [setupSeed]);
    this.delta = hashToScalar('GROTH16_DELTA', [setupSeed]);
    let tauCandidate = hashToScalar('GROTH16_TAU', [setupSeed]);
    while (tauCandidate >= 1n && tauCandidate <= BigInt(this.qap.numConstraints)) {
      tauCandidate = modQ(tauCandidate + 1n);
    }
    this.tau = tauCandidate;
    this.alphaBetaPoint = modPow(SUBGROUP_GEN, modQ(this.alpha * this.beta), SAFE_PRIME);

    const invGamma = modInverseQ(this.gamma);
    const icTerms: bigint[] = [];
    const icPoints: bigint[] = [];
    for (let k = 0; k <= this.qap.numPublicInputs; k++) {
      const uk = evalPoly(this.qap.polyU[k], this.tau);
      const vk = evalPoly(this.qap.polyV[k], this.tau);
      const wk = evalPoly(this.qap.polyW[k], this.tau);
      const term = modQ(modQ(modQ(this.beta * uk) + modQ(this.alpha * vk) + wk) * invGamma);
      icTerms.push(term);
      icPoints.push(modPow(SUBGROUP_GEN, term, SAFE_PRIME));
    }
    this.icTerms = icTerms;
    this.icPoints = icPoints;
  }

  public static compileR1CStoQAP(spec: R1CSCircuitSpec): QAPRepresentation {
    const m = spec.constraints.length;
    const n = spec.numVariables;
    const polyU: bigint[][] = [];
    const polyV: bigint[][] = [];
    const polyW: bigint[][] = [];

    for (let k = 0; k < n; k++) {
      const colA = new Array<bigint>(m).fill(0n);
      const colB = new Array<bigint>(m).fill(0n);
      const colC = new Array<bigint>(m).fill(0n);
      for (let j = 0; j < m; j++) {
        colA[j] = modQ(spec.constraints[j].a.get(k) ?? 0n);
        colB[j] = modQ(spec.constraints[j].b.get(k) ?? 0n);
        colC[j] = modQ(spec.constraints[j].c.get(k) ?? 0n);
      }
      polyU.push(interpolateOnDomain(colA));
      polyV.push(interpolateOnDomain(colB));
      polyW.push(interpolateOnDomain(colC));
    }

    let vanishingT: bigint[] = [1n];
    for (let j = 1; j <= m; j++) {
      vanishingT = mulPoly(vanishingT, [modQ(-BigInt(j)), 1n]);
    }

    return {
      numConstraints: m,
      numVariables: n,
      numPublicInputs: spec.numPublicInputs,
      polyU,
      polyV,
      polyW,
      vanishingT,
    };
  }

  public getQAP(): QAPRepresentation {
    return this.qap;
  }

  public prove(fullWitness: readonly bigint[], blindingSeed: string): Groth16Proof {
    if (fullWitness.length !== this.qap.numVariables) {
      throw new Error(`Expected witness vector of length ${this.qap.numVariables}`);
    }
    const w = fullWitness.map((v) => modQ(v));
    if (w[0] !== 1n) {
      throw new Error('Witness index 0 must equal constant 1');
    }

    let polyA: bigint[] = [0n];
    let polyB: bigint[] = [0n];
    let polyC: bigint[] = [0n];
    for (let k = 0; k < this.qap.numVariables; k++) {
      if (w[k] === 0n) continue;
      polyA = addPoly(polyA, scalePoly(this.qap.polyU[k], w[k]));
      polyB = addPoly(polyB, scalePoly(this.qap.polyV[k], w[k]));
      polyC = addPoly(polyC, scalePoly(this.qap.polyW[k], w[k]));
    }

    const diff = subPoly(mulPoly(polyA, polyB), polyC);
    const { quotient: polyH, remainder } = divPoly(diff, this.qap.vanishingT);
    if (remainder.length !== 1 || remainder[0] !== 0n) {
      throw new Error('Witness does not satisfy R1CS/QAP divisibility relation');
    }

    const r = hashToScalar('GROTH16_BLIND_R', [blindingSeed, ...w.map((v) => v.toString(16))]);
    const s = hashToScalar('GROTH16_BLIND_S', [blindingSeed, r.toString(16)]);

    const aAtTau = evalPoly(polyA, this.tau);
    const bAtTau = evalPoly(polyB, this.tau);
    const hAtTau = evalPoly(polyH, this.tau);
    const tAtTau = evalPoly(this.qap.vanishingT, this.tau);

    const piA = modQ(this.alpha + aAtTau + modQ(r * this.delta));
    const piB = modQ(this.beta + bAtTau + modQ(s * this.delta));

    let privateLinearSum = 0n;
    for (let k = this.qap.numPublicInputs + 1; k < this.qap.numVariables; k++) {
      if (w[k] === 0n) continue;
      const uk = evalPoly(this.qap.polyU[k], this.tau);
      const vk = evalPoly(this.qap.polyV[k], this.tau);
      const wk = evalPoly(this.qap.polyW[k], this.tau);
      const wireVal = modQ(modQ(this.beta * uk) + modQ(this.alpha * vk) + wk);
      privateLinearSum = modQ(privateLinearSum + modQ(w[k] * wireVal));
    }

    const invDelta = modInverseQ(this.delta);
    const coreC = modQ(modQ(privateLinearSum + modQ(hAtTau * tAtTau)) * invDelta);
    const piC = modQ(
      coreC + modQ(s * piA) + modQ(r * piB) - modQ(modQ(r * s) * this.delta)
    );

    const commitA = modPow(SUBGROUP_GEN, piA, SAFE_PRIME);
    const commitB = modPow(SUBGROUP_GEN, piB, SAFE_PRIME);
    const commitC = modPow(SUBGROUP_GEN, piC, SAFE_PRIME);
    const publicInputs = w.slice(1, this.qap.numPublicInputs + 1);

    const proofDigest = createHash('sha256')
      .update('GROTH16_PROOF|')
      .update(`${commitA.toString(16)}|${commitB.toString(16)}|${commitC.toString(16)}|`)
      .update(publicInputs.map((v) => v.toString(16)).join(','))
      .digest('hex');

    return {
      piA,
      piB,
      piC,
      commitA,
      commitB,
      commitC,
      publicInputs,
      proofDigest,
    };
  }

  public verify(proof: Groth16Proof): Groth16VerificationResult {
    if (proof.publicInputs.length !== this.qap.numPublicInputs) {
      return {
        isValid: false,
        lhsTargetPoint: 0n,
        rhsTargetPoint: 0n,
        reason: 'Public input vector length mismatch',
      };
    }

    if (
      modPow(SUBGROUP_GEN, modQ(proof.piA), SAFE_PRIME) !== proof.commitA ||
      modPow(SUBGROUP_GEN, modQ(proof.piB), SAFE_PRIME) !== proof.commitB ||
      modPow(SUBGROUP_GEN, modQ(proof.piC), SAFE_PRIME) !== proof.commitC
    ) {
      return {
        isValid: false,
        lhsTargetPoint: 0n,
        rhsTargetPoint: 0n,
        reason: 'Proof element group commitment consistency check failed',
      };
    }

    const expectedDigest = createHash('sha256')
      .update('GROTH16_PROOF|')
      .update(`${proof.commitA.toString(16)}|${proof.commitB.toString(16)}|${proof.commitC.toString(16)}|`)
      .update(proof.publicInputs.map((v) => modQ(v).toString(16)).join(','))
      .digest('hex');
    if (expectedDigest !== proof.proofDigest) {
      return {
        isValid: false,
        lhsTargetPoint: 0n,
        rhsTargetPoint: 0n,
        reason: 'Proof digest mismatch',
      };
    }

    // Compute IC group element: g^{IC_0} * prod_{k=1}^l (g^{IC_k})^{pub_k}
    let icPoint = this.icPoints[0];
    for (let k = 0; k < proof.publicInputs.length; k++) {
      const pubVal = modQ(proof.publicInputs[k]);
      if (pubVal !== 0n) {
        icPoint = modP(icPoint * modPow(this.icPoints[k + 1], pubVal, SAFE_PRIME));
      }
    }

    // Verify Groth16 target equation: g^{piA * piB} == g^{alpha*beta} * icPoint^gamma * commitC^delta
    const lhsTargetPoint = modPow(proof.commitA, modQ(proof.piB), SAFE_PRIME);
    const rhsTargetPoint = modP(
      modP(this.alphaBetaPoint * modPow(icPoint, this.gamma, SAFE_PRIME)) *
        modPow(proof.commitC, this.delta, SAFE_PRIME)
    );

    if (lhsTargetPoint !== rhsTargetPoint) {
      return {
        isValid: false,
        lhsTargetPoint,
        rhsTargetPoint,
        reason: 'Groth16 pairing-equivalent verification equation failed',
      };
    }

    return {
      isValid: true,
      lhsTargetPoint,
      rhsTargetPoint,
    };
  }
}
