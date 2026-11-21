/**
 * @file ZeroKnowledgePrivateSetIntersectionProver.ts
 * @description Verifiable Diffie-Hellman Double-Blinding Mutual Private Set Intersection (PSI)
 * Prover & Verifier with Batched Chaum-Pedersen DLEQ Honesty Proofs.
 * Allows Party A (set S_A) and Party B (set S_B) to discover S_A intersect S_B (or its cardinality)
 * without revealing non-matching elements, while preventing malicious blinding/substitution:
 *   1. Party A picks secret key a, publishes pk_A = g^a, sends blinded set {H(x)^a : x in S_A}
 *      plus a batched DLEQ proof that every element was raised to the exact committed secret a.
 *   2. Party B picks secret key b, publishes pk_B = g^b, sends blinded set {H(y)^b : y in S_B}
 *      AND doubly-blinded A-set {(H(x)^a)^b} with batched DLEQ proofs under pk_B.
 *   3. Party A computes doubly-blinded B-set {(H(y)^b)^a} with a batched DLEQ proof under pk_A.
 *   4. By commutativity (H(x)^a)^b == (H(y)^b)^a mod p iff x == y, both parties recover the exact
 *      verified intersection and emit an auditable PSI receipt!
 */

import { createHash, randomBytes } from 'node:crypto';

const SUBGROUP_Q = 0x7fffffffffffffffffffffffffffe1d3n;
const SAFE_PRIME_P = 0xffffffffffffffffffffffffffffc3a7n;
const BASE_G = 4n;

export interface PSIPartySecret {
  partyId: string;
  secretKey: bigint;
  publicKey: bigint;
}

export interface PSIBatchedDLEQProof {
  partyId: string;
  publicKey: bigint;
  inputs: bigint[];
  outputs: bigint[];
  challengeC: bigint;
  responseS: bigint;
  proofDigest: string;
}

export interface PSISessionReceipt {
  sessionId: string;
  partyAId: string;
  partyBId: string;
  partyAPublicKey: bigint;
  partyBPublicKey: bigint;
  intersectionElements: string[];
  intersectionCardinality: number;
  proofAInitial: PSIBatchedDLEQProof;
  proofBInitial: PSIBatchedDLEQProof;
  proofBDouble: PSIBatchedDLEQProof;
  proofADouble: PSIBatchedDLEQProof;
  receiptDigest: string;
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

function randomScalar(q: bigint): bigint {
  return (BigInt(`0x${randomBytes(16).toString('hex')}`) % (q - 2n)) + 2n;
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
 * Verifiable Mutual Private Set Intersection (DH-PSI) Prover & Auditor.
 */
export class ZeroKnowledgePrivateSetIntersectionProver {
  private readonly p: bigint;
  private readonly q: bigint;
  private readonly g: bigint;

  constructor(p = SAFE_PRIME_P, q = SUBGROUP_Q, g = BASE_G) {
    if (p !== 2n * q + 1n) {
      throw new Error('Safe prime invariant p = 2q + 1 is required');
    }
    this.p = p;
    this.q = q;
    this.g = g;
  }

  public initParty(partyId: string, seedSecret?: bigint): PSIPartySecret {
    const secretKey = seedSecret !== undefined
      ? modNorm(seedSecret, this.q - 2n) + 2n
      : randomScalar(this.q);
    return {
      partyId,
      secretKey,
      publicKey: modPow(this.g, secretKey, this.p),
    };
  }

  public isSubgroupElement(el: bigint): boolean {
    return el > 1n && el < this.p && modPow(el, this.q, this.p) === 1n;
  }

  /**
   * Deterministically maps a string identifier into the order-q quadratic residue subgroup.
   */
  public hashItemToSubgroup(sessionId: string, item: string): bigint {
    for (let ctr = 0; ctr < 1024; ctr++) {
      const hex = createHash('sha256')
        .update(`WorkSphere::PSIHash|${sessionId}|${item}|${ctr}`)
        .digest('hex');
      const raw = BigInt(`0x${hex}`) % (this.p - 2n) + 2n;
      const cand = (raw * raw) % this.p;
      if (cand > 1n && modPow(cand, this.q, this.p) === 1n) {
        return cand;
      }
    }
    throw new Error(`Failed to hash PSI item ${item} into subgroup`);
  }

  private computeCompositePair(
    partyId: string,
    publicKey: bigint,
    inputs: readonly bigint[],
    outputs: readonly bigint[]
  ): { compIn: bigint; compOut: bigint; seed: string } {
    const h = createHash('sha256');
    h.update(`WorkSphere::PSISeed|${partyId}|${publicKey.toString(16)}`);
    for (let i = 0; i < inputs.length; i++) {
      h.update(`|${inputs[i].toString(16)}:${outputs[i].toString(16)}`);
    }
    const seed = h.digest('hex');

    let compIn = 1n;
    let compOut = 1n;
    for (let i = 0; i < inputs.length; i++) {
      const w = hashScalar('WorkSphere::PSIWeight', [seed, BigInt(i), inputs[i], outputs[i]]);
      compIn = (compIn * modPow(inputs[i], w, this.p)) % this.p;
      compOut = (compOut * modPow(outputs[i], w, this.p)) % this.p;
    }
    return { compIn, compOut, seed };
  }

  /**
   * Raises every subgroup element in `inputs` to `party.secretKey` and produces a constant-size
   * batched Chaum-Pedersen DLEQ proof that every element used the exact key behind `party.publicKey`.
   */
  public blindAndProveSet(
    party: PSIPartySecret,
    inputs: readonly bigint[]
  ): PSIBatchedDLEQProof {
    if (inputs.length === 0) {
      throw new Error('PSI set must contain at least one element');
    }
    const outputs: bigint[] = [];
    for (const el of inputs) {
      if (!this.isSubgroupElement(el)) {
        throw new Error('Input element lies outside order-q subgroup');
      }
      outputs.push(modPow(el, party.secretKey, this.p));
    }

    const { compIn, compOut, seed } = this.computeCompositePair(
      party.partyId,
      party.publicKey,
      inputs,
      outputs
    );

    const k = randomScalar(this.q);
    const tG = modPow(this.g, k, this.p);
    const tIn = modPow(compIn, k, this.p);

    const challengeC = hashScalar('WorkSphere::PSIBatchDLEQ', [
      party.partyId,
      seed,
      party.publicKey,
      compIn,
      compOut,
      tG,
      tIn,
    ]);
    const responseS = modNorm(k - challengeC * party.secretKey, this.q);

    const proofDigest = createHash('sha256')
      .update(`${party.partyId}|${seed}|${challengeC.toString(16)}|${outputs.length}`)
      .digest('hex');

    return {
      partyId: party.partyId,
      publicKey: party.publicKey,
      inputs: [...inputs],
      outputs,
      challengeC,
      responseS,
      proofDigest,
    };
  }

  /**
   * Publicly verifies a batched DH-blinding DLEQ proof.
   */
  public verifyBlindingProof(proof: PSIBatchedDLEQProof): boolean {
    if (proof.inputs.length === 0 || proof.inputs.length !== proof.outputs.length) return false;
    if (!this.isSubgroupElement(proof.publicKey)) return false;

    for (let i = 0; i < proof.inputs.length; i++) {
      if (!this.isSubgroupElement(proof.inputs[i]) || !this.isSubgroupElement(proof.outputs[i])) {
        return false;
      }
    }

    const { compIn, compOut, seed } = this.computeCompositePair(
      proof.partyId,
      proof.publicKey,
      proof.inputs,
      proof.outputs
    );

    const tG =
      (modPow(this.g, proof.responseS, this.p) * modPow(proof.publicKey, proof.challengeC, this.p)) %
      this.p;
    const tIn =
      (modPow(compIn, proof.responseS, this.p) * modPow(compOut, proof.challengeC, this.p)) %
      this.p;

    const expectedC = hashScalar('WorkSphere::PSIBatchDLEQ', [
      proof.partyId,
      seed,
      proof.publicKey,
      compIn,
      compOut,
      tG,
      tIn,
    ]);
    return expectedC === proof.challengeC;
  }

  /**
   * Runs the complete verifiable two-party mutual PSI protocol and emits an auditable receipt.
   */
  public executeMutualPSI(
    sessionId: string,
    partyA: PSIPartySecret,
    setA: readonly string[],
    partyB: PSIPartySecret,
    setB: readonly string[]
  ): PSISessionReceipt {
    const uniqueA = Array.from(new Set(setA)).sort();
    const uniqueB = Array.from(new Set(setB)).sort();

    const hashedA = uniqueA.map((x) => this.hashItemToSubgroup(sessionId, x));
    const hashedB = uniqueB.map((y) => this.hashItemToSubgroup(sessionId, y));

    const proofAInitial = this.blindAndProveSet(partyA, hashedA);
    const proofBInitial = this.blindAndProveSet(partyB, hashedB);

    const proofBDouble = this.blindAndProveSet(partyB, proofAInitial.outputs);
    const proofADouble = this.blindAndProveSet(partyA, proofBInitial.outputs);

    // Match doubly-blinded tokens: (H(x)^a)^b == (H(y)^b)^a
    const doubleBSet = new Set(proofADouble.outputs);
    const intersectionElements: string[] = [];
    for (let i = 0; i < uniqueA.length; i++) {
      if (doubleBSet.has(proofBDouble.outputs[i])) {
        intersectionElements.push(uniqueA[i]);
      }
    }

    const receiptDigest = createHash('sha256')
      .update(
        `WorkSphere::PSIReceipt|${sessionId}|${partyA.partyId}|${partyB.partyId}|card:${intersectionElements.length}|${proofBDouble.proofDigest}|${proofADouble.proofDigest}`
      )
      .digest('hex');

    return {
      sessionId,
      partyAId: partyA.partyId,
      partyBId: partyB.partyId,
      partyAPublicKey: partyA.publicKey,
      partyBPublicKey: partyB.publicKey,
      intersectionElements,
      intersectionCardinality: intersectionElements.length,
      proofAInitial,
      proofBInitial,
      proofBDouble,
      proofADouble,
      receiptDigest,
    };
  }

  /**
   * Publicly audits a PSI session receipt (verifies all 4 batched DLEQ proofs, input-output
   * chaining between single and double blinding rounds, and claimed intersection cardinality)
   * without learning either party's non-intersecting elements!
   */
  public auditPSIReceipt(receipt: PSISessionReceipt): { valid: boolean; reason?: string } {
    if (
      !this.verifyBlindingProof(receipt.proofAInitial) ||
      !this.verifyBlindingProof(receipt.proofBInitial) ||
      !this.verifyBlindingProof(receipt.proofBDouble) ||
      !this.verifyBlindingProof(receipt.proofADouble)
    ) {
      return { valid: false, reason: 'One or more PSI batched DLEQ proofs failed' };
    }

    if (
      receipt.proofAInitial.publicKey !== receipt.partyAPublicKey ||
      receipt.proofADouble.publicKey !== receipt.partyAPublicKey ||
      receipt.proofBInitial.publicKey !== receipt.partyBPublicKey ||
      receipt.proofBDouble.publicKey !== receipt.partyBPublicKey
    ) {
      return { valid: false, reason: 'Public key consistency check failed across PSI rounds' };
    }

    // Verify chaining: B double-blinded A's outputs, and A double-blinded B's outputs
    const chainAB =
      receipt.proofAInitial.outputs.length === receipt.proofBDouble.inputs.length &&
      receipt.proofAInitial.outputs.every((v, i) => v === receipt.proofBDouble.inputs[i]);
    const chainBA =
      receipt.proofBInitial.outputs.length === receipt.proofADouble.inputs.length &&
      receipt.proofBInitial.outputs.every((v, i) => v === receipt.proofADouble.inputs[i]);
    if (!chainAB || !chainBA) {
      return { valid: false, reason: 'Broken chaining between single-blinded and double-blinded rounds' };
    }

    const setB = new Set(receipt.proofADouble.outputs);
    let computedCard = 0;
    for (const token of receipt.proofBDouble.outputs) {
      if (setB.has(token)) computedCard++;
    }
    if (computedCard !== receipt.intersectionCardinality) {
      return { valid: false, reason: 'Claimed intersection cardinality does not match verified doubly-blinded tokens' };
    }

    return { valid: true };
  }

  public serializeProof(proof: PSIBatchedDLEQProof): string {
    return JSON.stringify({
      partyId: proof.partyId,
      publicKey: proof.publicKey.toString(16),
      inputs: proof.inputs.map((v) => v.toString(16)),
      outputs: proof.outputs.map((v) => v.toString(16)),
      challengeC: proof.challengeC.toString(16),
      responseS: proof.responseS.toString(16),
      proofDigest: proof.proofDigest,
    });
  }

  public deserializeProof(payload: string): PSIBatchedDLEQProof {
    const raw = JSON.parse(payload) as Record<string, any>;
    return {
      partyId: raw.partyId,
      publicKey: BigInt(`0x${raw.publicKey}`),
      inputs: raw.inputs.map((v: string) => BigInt(`0x${v}`)),
      outputs: raw.outputs.map((v: string) => BigInt(`0x${v}`)),
      challengeC: BigInt(`0x${raw.challengeC}`),
      responseS: BigInt(`0x${raw.responseS}`),
      proofDigest: raw.proofDigest,
    };
  }
}
