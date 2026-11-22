/**
 * @file ZeroKnowledgeCircuitR1CSWitnessProver.ts
 * @description Rank-1 Constraint System (R1CS) Committed Witness Satisfaction & Nova-Style
 * Relaxed-R1CS Folding Prover & Verifier over F_q.
 * Models arithmetic circuits as (A, B, C) constraint matrices where witness z = [1, publicIO..., privateW...]
 * satisfies (A * z) o (B * z) == C * z (Hadamard product):
 *   1. Validates R1CS satisfaction and identifies any violated constraint gate indices.
 *   2. Commits to witness vector z and gate wire vectors (a = A*z, b = B*z, c = C*z) via Pedersen
 *      commitments and proves linear consistency (A*z == a, B*z == b, C*z == c) AND multiplicative
 *      gate satisfaction (a_i * b_i == c_i) via zero-knowledge Schnorr multiplication proofs!
 *   3. Implements Nova-style Relaxed-R1CS folding of two committed instances into one folded instance!
 */

import { createHash, randomBytes } from 'node:crypto';

const SUBGROUP_Q = 0x7fffffffffffffffffffffffffffe1d3n;
const SAFE_PRIME_P = 0xffffffffffffffffffffffffffffc3a7n;
const BASE_G = 4n;

export interface R1CSCircuit {
  circuitId: string;
  numVariables: number; // length of z (z[0] === 1n)
  numConstraints: number;
  matrixA: bigint[][];
  matrixB: bigint[][];
  matrixC: bigint[][];
}

export interface GateMultiplicationProof {
  gateIndex: number;
  commitA: bigint;
  commitB: bigint;
  commitC: bigint;
  tA: bigint;
  tB: bigint;
  tCross: bigint;
  challenge: bigint;
  zA: bigint;
  zRA: bigint;
  zB: bigint;
  zRB: bigint;
  zRCross: bigint;
}

export interface R1CSZeroKnowledgeProof {
  proofId: string;
  circuitId: string;
  witnessCommitments: bigint[];
  gateProofs: GateMultiplicationProof[];
  linearCheckNonce: bigint;
  linearCheckChallenge: bigint;
  linearCheckResponse: bigint;
  proofDigest: string;
}

export interface RelaxedR1CSInstance {
  instanceId: string;
  uScalar: bigint;
  witnessZ: bigint[];
  errorE: bigint[];
  witnessCommitment: bigint;
  errorCommitment: bigint;
}

function modNorm(a: bigint, m: bigint): bigint {
  const r = a % m;
  return r >= 0n ? r : r + m;
}

function modPow(base: bigint, exp: bigint, mod: bigint): bigint {
  let result = 1n;
  let b = modNorm(base, mod);
  let e = exp;
  while (e > 0n) {
    if ((e & 1n) === 1n) result = (result * b) % mod;
    b = (b * b) % mod;
    e >>= 1n;
  }
  return result;
}

function modInverse(a: bigint, m: bigint): bigint {
  let t = 0n;
  let newT = 1n;
  let r = m;
  let newR = modNorm(a, m);
  while (newR !== 0n) {
    const q = r / newR;
    [t, newT] = [newT, t - q * newT];
    [r, newR] = [newR, r - q * newR];
  }
  if (r > 1n) throw new Error('Not invertible');
  return t < 0n ? t + m : t;
}

function randomScalar(q: bigint): bigint {
  return (BigInt(`0x${randomBytes(16).toString('hex')}`) % (q - 2n)) + 2n;
}

function deriveH(p: bigint, g: bigint): bigint {
  const digest = createHash('sha256').update(`WorkSphere::R1CSH|${p.toString(16)}|${g.toString(16)}`).digest('hex');
  const raw = BigInt(`0x${digest}`) % (p - 2n) + 2n;
  return (raw * raw) % p;
}

function hashScalar(domain: string, parts: readonly (string | bigint)[]): bigint {
  const h = createHash('sha256');
  h.update(domain);
  for (const part of parts) {
    h.update('|');
    h.update(typeof part === 'bigint' ? part.toString(16) : part);
  }
  return (BigInt(`0x${h.digest('hex')}`) % (SUBGROUP_Q - 1n)) + 1n;
}

/**
 * R1CS Zero-Knowledge Circuit Satisfaction & Nova Relaxed-R1CS Folding Prover.
 */
export class ZeroKnowledgeCircuitR1CSWitnessProver {
  private readonly p: bigint;
  private readonly q: bigint;
  private readonly g: bigint;
  private readonly h: bigint;

  constructor(p = SAFE_PRIME_P, q = SUBGROUP_Q, g = BASE_G) {
    if (p !== 2n * q + 1n) {
      throw new Error('Safe prime invariant p = 2q + 1 is required');
    }
    this.p = p;
    this.q = q;
    this.g = g;
    this.h = deriveH(p, g);
  }

  public commit(val: bigint, blind: bigint): bigint {
    return (
      modPow(this.g, modNorm(val, this.q), this.p) *
      modPow(this.h, modNorm(blind, this.q), this.p)
    ) % this.p;
  }

  public matVec(matrix: readonly (readonly bigint[])[], vec: readonly bigint[]): bigint[] {
    return matrix.map((row) => {
      let sum = 0n;
      for (let j = 0; j < vec.length; j++) {
        sum = modNorm(sum + modNorm(row[j], this.q) * modNorm(vec[j], this.q), this.q);
      }
      return sum;
    });
  }

  /**
   * Evaluates whether witness z satisfies every gate (A*z)_i * (B*z)_i == (C*z)_i mod q.
   */
  public checkR1CSSatisfaction(
    circuit: R1CSCircuit,
    witnessZ: readonly bigint[]
  ): { satisfied: boolean; violatedGates: number[] } {
    if (witnessZ.length !== circuit.numVariables || modNorm(witnessZ[0], this.q) !== 1n) {
      throw new Error('Witness length mismatch or z[0] != 1');
    }
    const az = this.matVec(circuit.matrixA, witnessZ);
    const bz = this.matVec(circuit.matrixB, witnessZ);
    const cz = this.matVec(circuit.matrixC, witnessZ);

    const violatedGates: number[] = [];
    for (let i = 0; i < circuit.numConstraints; i++) {
      if (modNorm(az[i] * bz[i], this.q) !== cz[i]) {
        violatedGates.push(i);
      }
    }
    return { satisfied: violatedGates.length === 0, violatedGates };
  }

  private homomorphicRowCommit(row: readonly bigint[], witnessCommits: readonly bigint[]): bigint {
    let acc = 1n;
    for (let j = 0; j < row.length; j++) {
      const coeff = modNorm(row[j], this.q);
      if (coeff !== 0n) {
        acc = (acc * modPow(witnessCommits[j], coeff, this.p)) % this.p;
      }
    }
    return acc;
  }

  private dotRow(row: readonly bigint[], vec: readonly bigint[]): bigint {
    let acc = 0n;
    for (let j = 0; j < row.length; j++) {
      acc = modNorm(acc + modNorm(row[j], this.q) * modNorm(vec[j], this.q), this.q);
    }
    return acc;
  }

  /**
   * Zero-knowledge proof that committed triple (C_a, C_b, C_c) satisfies a * b == c mod q:
   * Notice C_c == C_a^b * h^{r_c - b * r_a} mod p!
   */
  private proveGateMultiplication(
    ctx: string,
    gateIndex: number,
    a: bigint,
    rA: bigint,
    commitA: bigint,
    b: bigint,
    rB: bigint,
    commitB: bigint,
    rC: bigint,
    commitC: bigint
  ): GateMultiplicationProof {
    const rCross = modNorm(rC - b * rA, this.q);

    const kA = randomScalar(this.q);
    const kRA = randomScalar(this.q);
    const kB = randomScalar(this.q);
    const kRB = randomScalar(this.q);
    const kRCross = randomScalar(this.q);

    const tA = this.commit(kA, kRA);
    const tB = this.commit(kB, kRB);
    const tCross = (modPow(commitA, kB, this.p) * modPow(this.h, kRCross, this.p)) % this.p;

    const challenge = hashScalar('WorkSphere::R1CSGateMul', [
      ctx,
      BigInt(gateIndex),
      commitA,
      commitB,
      commitC,
      tA,
      tB,
      tCross,
    ]);

    return {
      gateIndex,
      commitA,
      commitB,
      commitC,
      tA,
      tB,
      tCross,
      challenge,
      zA: modNorm(kA + challenge * a, this.q),
      zRA: modNorm(kRA + challenge * rA, this.q),
      zB: modNorm(kB + challenge * b, this.q),
      zRB: modNorm(kRB + challenge * rB, this.q),
      zRCross: modNorm(kRCross + challenge * rCross, this.q),
    };
  }

  private verifyGateMultiplication(ctx: string, gp: GateMultiplicationProof): boolean {
    const expectedC = hashScalar('WorkSphere::R1CSGateMul', [
      ctx,
      BigInt(gp.gateIndex),
      gp.commitA,
      gp.commitB,
      gp.commitC,
      gp.tA,
      gp.tB,
      gp.tCross,
    ]);
    if (expectedC !== gp.challenge) return false;

    if (this.commit(gp.zA, gp.zRA) !== (gp.tA * modPow(gp.commitA, gp.challenge, this.p)) % this.p) return false;
    if (this.commit(gp.zB, gp.zRB) !== (gp.tB * modPow(gp.commitB, gp.challenge, this.p)) % this.p) return false;

    const lhsCross = (modPow(gp.commitA, gp.zB, this.p) * modPow(this.h, gp.zRCross, this.p)) % this.p;
    const rhsCross = (gp.tCross * modPow(gp.commitC, gp.challenge, this.p)) % this.p;
    return lhsCross === rhsCross;
  }

  /**
   * Produces a full zero-knowledge R1CS satisfaction proof proving knowledge of witness z
   * (with z[0] === 1) satisfying every gate without disclosing any witness wire!
   */
  public proveR1CS(
    proofId: string,
    circuit: R1CSCircuit,
    witnessZ: readonly bigint[]
  ): R1CSZeroKnowledgeProof {
    const check = this.checkR1CSSatisfaction(circuit, witnessZ);
    if (!check.satisfied) {
      throw new Error(`Witness violates R1CS gates: ${check.violatedGates.join(', ')}`);
    }

    const normZ = witnessZ.map((v) => modNorm(v, this.q));
    const blindings = normZ.map(() => randomScalar(this.q));
    const witnessCommitments = normZ.map((v, i) => this.commit(v, blindings[i]));

    const gateProofs: GateMultiplicationProof[] = [];
    for (let i = 0; i < circuit.numConstraints; i++) {
      const a = this.dotRow(circuit.matrixA[i], normZ);
      const rA = this.dotRow(circuit.matrixA[i], blindings);
      const commitA = this.homomorphicRowCommit(circuit.matrixA[i], witnessCommitments);

      const b = this.dotRow(circuit.matrixB[i], normZ);
      const rB = this.dotRow(circuit.matrixB[i], blindings);
      const commitB = this.homomorphicRowCommit(circuit.matrixB[i], witnessCommitments);

      const rC = this.dotRow(circuit.matrixC[i], blindings);
      const commitC = this.homomorphicRowCommit(circuit.matrixC[i], witnessCommitments);

      gateProofs.push(
        this.proveGateMultiplication(
          `${proofId}:${circuit.circuitId}`,
          i,
          a,
          rA,
          commitA,
          b,
          rB,
          commitB,
          rC,
          commitC
        )
      );
    }

    // Prove z[0] === 1 by proving witnessCommitments[0] / g == h^{blindings[0]}
    const k0 = randomScalar(this.q);
    const linearCheckNonce = modPow(this.h, k0, this.p);
    const linearCheckChallenge = hashScalar('WorkSphere::R1CSOneWire', [
      proofId,
      circuit.circuitId,
      witnessCommitments[0],
      linearCheckNonce,
    ]);
    const linearCheckResponse = modNorm(k0 + linearCheckChallenge * blindings[0], this.q);

    const proofDigest = createHash('sha256')
      .update(`${proofId}|${circuit.circuitId}|gates:${gateProofs.length}|${linearCheckChallenge.toString(16)}`)
      .digest('hex');

    return {
      proofId,
      circuitId: circuit.circuitId,
      witnessCommitments,
      gateProofs,
      linearCheckNonce,
      linearCheckChallenge,
      linearCheckResponse,
      proofDigest,
    };
  }

  /**
   * Publicly verifies a zero-knowledge R1CS proof against the circuit matrices.
   */
  public verifyR1CS(
    circuit: R1CSCircuit,
    proof: R1CSZeroKnowledgeProof
  ): { valid: boolean; reason?: string } {
    if (
      proof.circuitId !== circuit.circuitId ||
      proof.witnessCommitments.length !== circuit.numVariables ||
      proof.gateProofs.length !== circuit.numConstraints
    ) {
      return { valid: false, reason: 'Circuit dimensions or ID mismatch' };
    }

    // Verify z[0] == 1 wire commitment
    const expOneC = hashScalar('WorkSphere::R1CSOneWire', [
      proof.proofId,
      circuit.circuitId,
      proof.witnessCommitments[0],
      proof.linearCheckNonce,
    ]);
    if (expOneC !== proof.linearCheckChallenge) {
      return { valid: false, reason: 'Constant-1 wire challenge mismatch' };
    }
    const oneRatio = (proof.witnessCommitments[0] * modInverse(this.g, this.p)) % this.p;
    if (
      modPow(this.h, modNorm(proof.linearCheckResponse, this.q), this.p) !==
      (proof.linearCheckNonce * modPow(oneRatio, proof.linearCheckChallenge, this.p)) % this.p
    ) {
      return { valid: false, reason: 'Constant-1 wire opening failed' };
    }

    for (let i = 0; i < circuit.numConstraints; i++) {
      const gp = proof.gateProofs[i];
      if (gp.gateIndex !== i) return { valid: false, reason: `Out-of-order gate ${gp.gateIndex}` };
      const expA = this.homomorphicRowCommit(circuit.matrixA[i], proof.witnessCommitments);
      const expB = this.homomorphicRowCommit(circuit.matrixB[i], proof.witnessCommitments);
      const expC = this.homomorphicRowCommit(circuit.matrixC[i], proof.witnessCommitments);
      if (gp.commitA !== expA || gp.commitB !== expB || gp.commitC !== expC) {
        return { valid: false, reason: `Homomorphic gate wire commitment mismatch at gate ${i}` };
      }
      if (!this.verifyGateMultiplication(`${proof.proofId}:${circuit.circuitId}`, gp)) {
        return { valid: false, reason: `Multiplication proof failed at gate ${i}` };
      }
    }

    return { valid: true };
  }

  /**
   * Nova-Style Relaxed-R1CS Folding: folds two satisfied instances (u1, z1, E1) and (u2, z2, E2)
   * with cross-term T = (A*z1 o B*z2) + (A*z2 o B*z1) - u1*(C*z2) - u2*(C*z1) into ONE folded instance!
   */
  public foldRelaxedInstances(
    circuit: R1CSCircuit,
    inst1: RelaxedR1CSInstance,
    inst2: RelaxedR1CSInstance
  ): { folded: RelaxedR1CSInstance; foldingChallengeR: bigint; crossTermT: bigint[] } {
    const az1 = this.matVec(circuit.matrixA, inst1.witnessZ);
    const bz1 = this.matVec(circuit.matrixB, inst1.witnessZ);
    const cz1 = this.matVec(circuit.matrixC, inst1.witnessZ);

    const az2 = this.matVec(circuit.matrixA, inst2.witnessZ);
    const bz2 = this.matVec(circuit.matrixB, inst2.witnessZ);
    const cz2 = this.matVec(circuit.matrixC, inst2.witnessZ);

    const crossTermT = Array.from({ length: circuit.numConstraints }, (_, i) =>
      modNorm(az1[i] * bz2[i] + az2[i] * bz1[i] - inst1.uScalar * cz2[i] - inst2.uScalar * cz1[i], this.q)
    );

    const r = hashScalar('WorkSphere::NovaFoldR', [
      circuit.circuitId,
      inst1.instanceId,
      inst2.instanceId,
      inst1.witnessCommitment,
      inst2.witnessCommitment,
      ...crossTermT,
    ]);
    const rSq = modNorm(r * r, this.q);

    const foldedU = modNorm(inst1.uScalar + r * inst2.uScalar, this.q);
    const foldedZ = inst1.witnessZ.map((z1i, i) => modNorm(z1i + r * inst2.witnessZ[i], this.q));
    const foldedE = inst1.errorE.map((e1i, i) =>
      modNorm(e1i + r * crossTermT[i] + rSq * inst2.errorE[i], this.q)
    );

    const folded: RelaxedR1CSInstance = {
      instanceId: `${inst1.instanceId}+${inst2.instanceId}`,
      uScalar: foldedU,
      witnessZ: foldedZ,
      errorE: foldedE,
      witnessCommitment: (inst1.witnessCommitment * modPow(inst2.witnessCommitment, r, this.p)) % this.p,
      errorCommitment: (inst1.errorCommitment * modPow(inst2.errorCommitment, rSq, this.p)) % this.p,
    };

    return { folded, foldingChallengeR: r, crossTermT };
  }

  /**
   * Verifies Relaxed-R1CS satisfaction: (A*z) o (B*z) == u * (C*z) + E mod q.
   */
  public verifyRelaxedSatisfaction(circuit: R1CSCircuit, inst: RelaxedR1CSInstance): boolean {
    const az = this.matVec(circuit.matrixA, inst.witnessZ);
    const bz = this.matVec(circuit.matrixB, inst.witnessZ);
    const cz = this.matVec(circuit.matrixC, inst.witnessZ);
    for (let i = 0; i < circuit.numConstraints; i++) {
      const lhs = modNorm(az[i] * bz[i], this.q);
      const rhs = modNorm(inst.uScalar * cz[i] + inst.errorE[i], this.q);
      if (lhs !== rhs) return false;
    }
    return true;
  }
}
