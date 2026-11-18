import { createHash } from 'crypto';

/**
 * Recursive Nova IVC Relaxed R1CS Folding Scheme Verifier
 *
 * Implements the Nova folding scheme (Kothapalli, Setty, Tzialla, CRYPTO 2022)
 * over a safe-prime Pedersen commitment subgroup (P = 2Q + 1). Folds arbitrary
 * chains of committed Relaxed R1CS instances (A Z) o (B Z) = u * (C Z) + E via
 * cross-term slack vector T, deterministic Fiat-Shamir challenge r, and
 * homomorphic commitment aggregation.
 */

const SUBGROUP_ORDER = 0x7fffffffffffffffffffffffffffe1d3n; // Prime Q
const SAFE_PRIME = 0xffffffffffffffffffffffffffffc3a7n; // Safe prime P = 2Q + 1
const SUBGROUP_GEN = 4n; // Order-Q quadratic residue generator

export interface SparseMatrixEntry {
  readonly row: number;
  readonly col: number;
  readonly value: bigint;
}

export interface R1CSShape {
  readonly numConstraints: number;
  readonly numWitnessVars: number;
  readonly numPublicInputs: number;
  readonly matrixA: readonly SparseMatrixEntry[];
  readonly matrixB: readonly SparseMatrixEntry[];
  readonly matrixC: readonly SparseMatrixEntry[];
}

export interface RelaxedR1CSInstance {
  readonly commitW: bigint;
  readonly commitE: bigint;
  readonly scalarU: bigint;
  readonly publicInputs: readonly bigint[];
  readonly instanceDigest: string;
}

export interface RelaxedR1CSWitness {
  readonly witnessVector: readonly bigint[];
  readonly errorVector: readonly bigint[];
  readonly blindingW: bigint;
  readonly blindingE: bigint;
}

export interface NovaFoldingProof {
  readonly commitT: bigint;
  readonly foldingChallengeR: bigint;
  readonly foldedInstance: RelaxedR1CSInstance;
  readonly stepDigest: string;
}

export interface NovaVerificationResult {
  readonly isValid: boolean;
  readonly commitmentHomomorphismValid: boolean;
  readonly relaxedR1CSSatisfied: boolean;
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

function hashHex(domain: string, parts: readonly string[]): string {
  const h = createHash('sha256');
  h.update(domain);
  for (const p of parts) {
    h.update('|');
    h.update(p);
  }
  return h.digest('hex');
}

function sparseMatVecMul(
  entries: readonly SparseMatrixEntry[],
  numRows: number,
  vec: readonly bigint[]
): bigint[] {
  const out = new Array<bigint>(numRows).fill(0n);
  for (const e of entries) {
    out[e.row] = modQ(out[e.row] + modQ(modQ(e.value) * modQ(vec[e.col])));
  }
  return out;
}

function hadamardProduct(a: readonly bigint[], b: readonly bigint[]): bigint[] {
  return a.map((v, i) => modQ(modQ(v) * modQ(b[i])));
}

function computeInstanceDigest(
  commitW: bigint,
  commitE: bigint,
  scalarU: bigint,
  publicInputs: readonly bigint[]
): string {
  return hashHex('NOVA_INSTANCE', [
    commitW.toString(16),
    commitE.toString(16),
    modQ(scalarU).toString(16),
    ...publicInputs.map((x) => modQ(x).toString(16)),
  ]);
}

export class NovaIVCStepVerifier {
  private readonly shape: R1CSShape;
  private readonly gensW: readonly bigint[];
  private readonly gensE: readonly bigint[];
  private readonly genH: bigint;

  constructor(shape: R1CSShape, domainSeed = 'WORKSPHERE_NOVA_IVC_V1') {
    if (shape.numConstraints < 1 || shape.numWitnessVars < 1 || shape.numPublicInputs < 0) {
      throw new Error('Invalid R1CS shape dimensions');
    }
    const totalCols = shape.numWitnessVars + 1 + shape.numPublicInputs;
    for (const mat of [shape.matrixA, shape.matrixB, shape.matrixC]) {
      for (const entry of mat) {
        if (
          entry.row < 0 ||
          entry.row >= shape.numConstraints ||
          entry.col < 0 ||
          entry.col >= totalCols
        ) {
          throw new Error(`Sparse R1CS entry out of bounds: (${entry.row}, ${entry.col})`);
        }
      }
    }
    this.shape = shape;
    this.gensW = Array.from({ length: shape.numWitnessVars }, (_, i) =>
      modPow(SUBGROUP_GEN, hashToScalar('NOVA_GEN_W', [domainSeed, String(i)]), SAFE_PRIME)
    );
    this.gensE = Array.from({ length: shape.numConstraints }, (_, i) =>
      modPow(SUBGROUP_GEN, hashToScalar('NOVA_GEN_E', [domainSeed, String(i)]), SAFE_PRIME)
    );
    this.genH = modPow(SUBGROUP_GEN, hashToScalar('NOVA_GEN_H', [domainSeed]), SAFE_PRIME);
  }

  private commitVector(gens: readonly bigint[], vec: readonly bigint[], blinding: bigint): bigint {
    let acc = modPow(this.genH, modQ(blinding), SAFE_PRIME);
    for (let i = 0; i < vec.length; i++) {
      const val = modQ(vec[i]);
      if (val !== 0n) {
        acc = modP(acc * modPow(gens[i], val, SAFE_PRIME));
      }
    }
    return acc;
  }

  private buildFullVector(
    witnessVec: readonly bigint[],
    scalarU: bigint,
    publicInputs: readonly bigint[]
  ): bigint[] {
    return [
      ...witnessVec.map((v) => modQ(v)),
      modQ(scalarU),
      ...publicInputs.map((v) => modQ(v)),
    ];
  }

  public createStrictInstance(
    witnessVector: readonly bigint[],
    publicInputs: readonly bigint[],
    blindingW: bigint,
    blindingE = 0n
  ): { instance: RelaxedR1CSInstance; witness: RelaxedR1CSWitness } {
    if (witnessVector.length !== this.shape.numWitnessVars) {
      throw new Error(`Expected witness length ${this.shape.numWitnessVars}`);
    }
    if (publicInputs.length !== this.shape.numPublicInputs) {
      throw new Error(`Expected publicInputs length ${this.shape.numPublicInputs}`);
    }

    const w = witnessVector.map((v) => modQ(v));
    const x = publicInputs.map((v) => modQ(v));
    const e = new Array<bigint>(this.shape.numConstraints).fill(0n);
    const bW = modQ(blindingW);
    const bE = modQ(blindingE);

    const commitW = this.commitVector(this.gensW, w, bW);
    const commitE = this.commitVector(this.gensE, e, bE);
    const instanceDigest = computeInstanceDigest(commitW, commitE, 1n, x);

    const instance: RelaxedR1CSInstance = {
      commitW,
      commitE,
      scalarU: 1n,
      publicInputs: x,
      instanceDigest,
    };
    const witness: RelaxedR1CSWitness = {
      witnessVector: w,
      errorVector: e,
      blindingW: bW,
      blindingE: bE,
    };

    if (!this.isSatisfied(instance, witness)) {
      throw new Error('Strict R1CS witness does not satisfy constraints');
    }

    return { instance, witness };
  }

  public isSatisfied(instance: RelaxedR1CSInstance, witness: RelaxedR1CSWitness): boolean {
    if (
      witness.witnessVector.length !== this.shape.numWitnessVars ||
      witness.errorVector.length !== this.shape.numConstraints ||
      instance.publicInputs.length !== this.shape.numPublicInputs
    ) {
      return false;
    }

    if (
      this.commitVector(this.gensW, witness.witnessVector, witness.blindingW) !== instance.commitW ||
      this.commitVector(this.gensE, witness.errorVector, witness.blindingE) !== instance.commitE
    ) {
      return false;
    }

    const z = this.buildFullVector(witness.witnessVector, instance.scalarU, instance.publicInputs);
    const az = sparseMatVecMul(this.shape.matrixA, this.shape.numConstraints, z);
    const bz = sparseMatVecMul(this.shape.matrixB, this.shape.numConstraints, z);
    const cz = sparseMatVecMul(this.shape.matrixC, this.shape.numConstraints, z);
    const lhs = hadamardProduct(az, bz);

    for (let row = 0; row < this.shape.numConstraints; row++) {
      const rhs = modQ(modQ(modQ(instance.scalarU) * cz[row]) + modQ(witness.errorVector[row]));
      if (lhs[row] !== rhs) {
        return false;
      }
    }
    return true;
  }

  public fold(
    u1: RelaxedR1CSInstance,
    w1: RelaxedR1CSWitness,
    u2: RelaxedR1CSInstance,
    w2: RelaxedR1CSWitness,
    blindingT: bigint
  ): {
    proof: NovaFoldingProof;
    foldedWitness: RelaxedR1CSWitness;
  } {
    const z1 = this.buildFullVector(w1.witnessVector, u1.scalarU, u1.publicInputs);
    const z2 = this.buildFullVector(w2.witnessVector, u2.scalarU, u2.publicInputs);

    const az1 = sparseMatVecMul(this.shape.matrixA, this.shape.numConstraints, z1);
    const bz1 = sparseMatVecMul(this.shape.matrixB, this.shape.numConstraints, z1);
    const cz1 = sparseMatVecMul(this.shape.matrixC, this.shape.numConstraints, z1);

    const az2 = sparseMatVecMul(this.shape.matrixA, this.shape.numConstraints, z2);
    const bz2 = sparseMatVecMul(this.shape.matrixB, this.shape.numConstraints, z2);
    const cz2 = sparseMatVecMul(this.shape.matrixC, this.shape.numConstraints, z2);

    const crossT: bigint[] = new Array<bigint>(this.shape.numConstraints);
    for (let i = 0; i < this.shape.numConstraints; i++) {
      const term1 = modQ(az1[i] * bz2[i]);
      const term2 = modQ(az2[i] * bz1[i]);
      const term3 = modQ(modQ(u1.scalarU) * cz2[i]);
      const term4 = modQ(modQ(u2.scalarU) * cz1[i]);
      crossT[i] = modQ(term1 + term2 - term3 - term4);
    }

    const bT = modQ(blindingT);
    const commitT = this.commitVector(this.gensE, crossT, bT);

    const r = hashToScalar('NOVA_FOLD_R', [
      u1.instanceDigest,
      u2.instanceDigest,
      commitT.toString(16),
    ]);
    const rSq = modQ(r * r);

    const foldedCommitW = modP(u1.commitW * modPow(u2.commitW, r, SAFE_PRIME));
    const foldedCommitE = modP(
      modP(u1.commitE * modPow(commitT, r, SAFE_PRIME)) * modPow(u2.commitE, rSq, SAFE_PRIME)
    );
    const foldedU = modQ(modQ(u1.scalarU) + modQ(r * modQ(u2.scalarU)));
    const foldedX = u1.publicInputs.map((x1, i) => modQ(x1 + modQ(r * u2.publicInputs[i])));

    const foldedInstance: RelaxedR1CSInstance = {
      commitW: foldedCommitW,
      commitE: foldedCommitE,
      scalarU: foldedU,
      publicInputs: foldedX,
      instanceDigest: computeInstanceDigest(foldedCommitW, foldedCommitE, foldedU, foldedX),
    };

    const foldedWitness: RelaxedR1CSWitness = {
      witnessVector: w1.witnessVector.map((v1, i) => modQ(v1 + modQ(r * w2.witnessVector[i]))),
      errorVector: w1.errorVector.map((e1, i) =>
        modQ(e1 + modQ(r * crossT[i]) + modQ(rSq * w2.errorVector[i]))
      ),
      blindingW: modQ(w1.blindingW + modQ(r * w2.blindingW)),
      blindingE: modQ(w1.blindingE + modQ(r * bT) + modQ(rSq * w2.blindingE)),
    };

    const stepDigest = hashHex('NOVA_FOLD_STEP', [
      u1.instanceDigest,
      u2.instanceDigest,
      commitT.toString(16),
      r.toString(16),
      foldedInstance.instanceDigest,
    ]);

    return {
      proof: {
        commitT,
        foldingChallengeR: r,
        foldedInstance,
        stepDigest,
      },
      foldedWitness,
    };
  }

  public verifyFoldingStep(
    u1: RelaxedR1CSInstance,
    u2: RelaxedR1CSInstance,
    proof: NovaFoldingProof,
    foldedWitness?: RelaxedR1CSWitness
  ): NovaVerificationResult {
    const expectedR = hashToScalar('NOVA_FOLD_R', [
      u1.instanceDigest,
      u2.instanceDigest,
      proof.commitT.toString(16),
    ]);
    if (expectedR !== proof.foldingChallengeR) {
      return {
        isValid: false,
        commitmentHomomorphismValid: false,
        relaxedR1CSSatisfied: false,
        reason: 'Fiat-Shamir folding challenge r mismatch',
      };
    }

    const rSq = modQ(expectedR * expectedR);
    const expectedCommitW = modP(u1.commitW * modPow(u2.commitW, expectedR, SAFE_PRIME));
    const expectedCommitE = modP(
      modP(u1.commitE * modPow(proof.commitT, expectedR, SAFE_PRIME)) *
        modPow(u2.commitE, rSq, SAFE_PRIME)
    );
    const expectedU = modQ(modQ(u1.scalarU) + modQ(expectedR * modQ(u2.scalarU)));
    const expectedX = u1.publicInputs.map((x1, i) =>
      modQ(x1 + modQ(expectedR * u2.publicInputs[i]))
    );
    const expectedDigest = computeInstanceDigest(expectedCommitW, expectedCommitE, expectedU, expectedX);

    const commitmentHomomorphismValid =
      expectedCommitW === proof.foldedInstance.commitW &&
      expectedCommitE === proof.foldedInstance.commitE &&
      expectedU === proof.foldedInstance.scalarU &&
      expectedDigest === proof.foldedInstance.instanceDigest &&
      expectedX.every((val, idx) => val === proof.foldedInstance.publicInputs[idx]);

    const expectedStepDigest = hashHex('NOVA_FOLD_STEP', [
      u1.instanceDigest,
      u2.instanceDigest,
      proof.commitT.toString(16),
      expectedR.toString(16),
      proof.foldedInstance.instanceDigest,
    ]);
    if (expectedStepDigest !== proof.stepDigest) {
      return {
        isValid: false,
        commitmentHomomorphismValid,
        relaxedR1CSSatisfied: false,
        reason: 'Folding step digest mismatch',
      };
    }

    const relaxedR1CSSatisfied = foldedWitness
      ? this.isSatisfied(proof.foldedInstance, foldedWitness)
      : true;

    if (!commitmentHomomorphismValid || !relaxedR1CSSatisfied) {
      return {
        isValid: false,
        commitmentHomomorphismValid,
        relaxedR1CSSatisfied,
        reason: 'Nova IVC commitment homomorphism or Relaxed R1CS satisfaction failed',
      };
    }

    return {
      isValid: true,
      commitmentHomomorphismValid: true,
      relaxedR1CSSatisfied,
    };
  }
}
