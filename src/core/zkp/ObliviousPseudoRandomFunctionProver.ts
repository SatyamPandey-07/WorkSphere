/**
 * @file ObliviousPseudoRandomFunctionProver.ts
 * @description RFC-9497-inspired Verifiable Oblivious Pseudorandom Function (VOPRF) Prover & Verifier.
 * Enables privacy-preserving password hardening, rate-limiting tokens, and private credential
 * lookups where a client obtains F_k(x) without revealing x to the server, while the server
 * proves via a Chaum-Pedersen DLEQ proof (and batched DLEQ proofs) that it evaluated using its
 * committed public key Y = g^k mod p.
 */

import { createHash, randomBytes } from 'node:crypto';

const SUBGROUP_Q = 0x7fffffffffffffffffffffffffffe1d3n;
const SAFE_PRIME_P = 0xffffffffffffffffffffffffffffc3a7n;
const BASE_G = 4n;

export interface VOPRFServerKeyPair {
  keyId: string;
  secretKey: bigint;
  publicKey: bigint;
}

export interface BlindedClientState {
  input: string;
  blindScalar: bigint;
  blindedElement: bigint;
}

export interface VOPRFEvaluationProof {
  keyId: string;
  serverPublicKey: bigint;
  blindedElement: bigint;
  evaluatedElement: bigint;
  challengeC: bigint;
  responseS: bigint;
}

export interface BatchedVOPRFEvaluation {
  keyId: string;
  serverPublicKey: bigint;
  blindedElements: bigint[];
  evaluatedElements: bigint[];
  challengeC: bigint;
  responseS: bigint;
  batchDigest: string;
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
 * Verifiable Oblivious Pseudorandom Function (VOPRF) over the order-q safe-prime subgroup.
 */
export class ObliviousPseudoRandomFunctionProver {
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

  public generateServerKey(keyId: string, seedSecret?: bigint): VOPRFServerKeyPair {
    const secretKey = seedSecret !== undefined
      ? modNorm(seedSecret, this.q - 2n) + 2n
      : randomScalar(this.q);
    return {
      keyId,
      secretKey,
      publicKey: modPow(this.g, secretKey, this.p),
    };
  }

  public isSubgroupElement(el: bigint): boolean {
    return el > 1n && el < this.p && modPow(el, this.q, this.p) === 1n;
  }

  /**
   * Deterministically maps an input string into the order-q quadratic residue subgroup.
   */
  public hashToGroup(input: string): bigint {
    for (let ctr = 0; ctr < 1024; ctr++) {
      const hex = createHash('sha256')
        .update(`WorkSphere::VOPRFHashToGroup|${input}|${ctr}`)
        .digest('hex');
      const raw = BigInt(`0x${hex}`) % (this.p - 2n) + 2n;
      const point = (raw * raw) % this.p;
      if (point > 1n && modPow(point, this.q, this.p) === 1n) {
        return point;
      }
    }
    throw new Error('Failed to map VOPRF input to subgroup');
  }

  /**
   * Client Step 1: Blinds input x as M = H(x)^r mod p with secret blinding scalar r.
   */
  public blind(input: string, customBlind?: bigint): BlindedClientState {
    const point = this.hashToGroup(input);
    const blindScalar = customBlind !== undefined
      ? modNorm(customBlind, this.q - 2n) + 2n
      : randomScalar(this.q);
    const blindedElement = modPow(point, blindScalar, this.p);
    return { input, blindScalar, blindedElement };
  }

  /**
   * Server Step 2: Evaluates Z = M^sk mod p and emits a Chaum-Pedersen DLEQ proof that
   * log_g(pk) == log_M(Z) without learning input x.
   */
  public blindEvaluate(
    serverKey: VOPRFServerKeyPair,
    blindedElement: bigint
  ): VOPRFEvaluationProof {
    if (!this.isSubgroupElement(blindedElement)) {
      throw new Error('Invalid blinded element outside order-q subgroup');
    }

    const evaluatedElement = modPow(blindedElement, serverKey.secretKey, this.p);
    const k = randomScalar(this.q);
    const t2 = modPow(this.g, k, this.p);
    const t3 = modPow(blindedElement, k, this.p);

    const challengeC = hashScalar('WorkSphere::VOPRFDLEQ', [
      serverKey.keyId,
      serverKey.publicKey,
      blindedElement,
      evaluatedElement,
      t2,
      t3,
    ]);
    const responseS = modNorm(k - challengeC * serverKey.secretKey, this.q);

    return {
      keyId: serverKey.keyId,
      serverPublicKey: serverKey.publicKey,
      blindedElement,
      evaluatedElement,
      challengeC,
      responseS,
    };
  }

  /**
   * Verifies a single server DLEQ evaluation proof against the server's public key.
   */
  public verifyEvaluationProof(
    proof: VOPRFEvaluationProof,
    expectedServerPublicKey: bigint
  ): boolean {
    if (proof.serverPublicKey !== expectedServerPublicKey) return false;
    if (!this.isSubgroupElement(proof.blindedElement) || !this.isSubgroupElement(proof.evaluatedElement)) {
      return false;
    }

    const t2 =
      (modPow(this.g, proof.responseS, this.p) * modPow(proof.serverPublicKey, proof.challengeC, this.p)) %
      this.p;
    const t3 =
      (modPow(proof.blindedElement, proof.responseS, this.p) *
        modPow(proof.evaluatedElement, proof.challengeC, this.p)) %
      this.p;

    const expectedC = hashScalar('WorkSphere::VOPRFDLEQ', [
      proof.keyId,
      proof.serverPublicKey,
      proof.blindedElement,
      proof.evaluatedElement,
      t2,
      t3,
    ]);
    return expectedC === proof.challengeC;
  }

  /**
   * Client Step 3: Verifies the server's DLEQ proof, unblinds Z^(r^-1) = H(x)^sk, and hashes
   * to produce the final deterministic 256-bit VOPRF output token.
   */
  public finalizeClient(
    clientState: BlindedClientState,
    evaluation: VOPRFEvaluationProof,
    expectedServerPublicKey: bigint
  ): { valid: boolean; outputHex?: string; unblindedElement?: bigint; reason?: string } {
    if (evaluation.blindedElement !== clientState.blindedElement) {
      return { valid: false, reason: 'Blinded element does not match client state' };
    }
    if (!this.verifyEvaluationProof(evaluation, expectedServerPublicKey)) {
      return { valid: false, reason: 'Server DLEQ verification failed' };
    }

    const invR = modInverse(clientState.blindScalar, this.q);
    const unblindedElement = modPow(evaluation.evaluatedElement, invR, this.p);
    const outputHex = this.deriveFinalOutput(clientState.input, unblindedElement);
    return { valid: true, outputHex, unblindedElement };
  }

  /**
   * Direct server-side unblinded evaluation F_k(x) for auditing/verifying client tokens.
   */
  public evaluateDirect(serverKey: VOPRFServerKeyPair, input: string): string {
    const point = this.hashToGroup(input);
    const evaluated = modPow(point, serverKey.secretKey, this.p);
    return this.deriveFinalOutput(input, evaluated);
  }

  private deriveFinalOutput(input: string, unblindedElement: bigint): string {
    return createHash('sha256')
      .update(`WorkSphere::VOPRFFinalize|${input}|${unblindedElement.toString(16)}`)
      .digest('hex');
  }

  /**
   * RFC-9497 Batched DLEQ Evaluation: evaluates an array of blinded elements in one server round
   * and emits a SINGLE constant-size composite DLEQ proof covering all N elements simultaneously.
   */
  public blindEvaluateBatch(
    serverKey: VOPRFServerKeyPair,
    blindedElements: readonly bigint[]
  ): BatchedVOPRFEvaluation {
    if (blindedElements.length === 0) {
      throw new Error('At least one blinded element is required');
    }

    const evaluatedElements: bigint[] = [];
    for (const m of blindedElements) {
      if (!this.isSubgroupElement(m)) {
        throw new Error('Blinded element outside order-q subgroup');
      }
      evaluatedElements.push(modPow(m, serverKey.secretKey, this.p));
    }

    const { compositeM, compositeZ, seed } = this.computeCompositePair(
      serverKey.keyId,
      serverKey.publicKey,
      blindedElements,
      evaluatedElements
    );

    const k = randomScalar(this.q);
    const t2 = modPow(this.g, k, this.p);
    const t3 = modPow(compositeM, k, this.p);

    const challengeC = hashScalar('WorkSphere::VOPRFBatchDLEQ', [
      serverKey.keyId,
      seed,
      serverKey.publicKey,
      compositeM,
      compositeZ,
      t2,
      t3,
    ]);
    const responseS = modNorm(k - challengeC * serverKey.secretKey, this.q);

    const batchDigest = createHash('sha256')
      .update(`${serverKey.keyId}|${seed}|${challengeC.toString(16)}|${evaluatedElements.length}`)
      .digest('hex');

    return {
      keyId: serverKey.keyId,
      serverPublicKey: serverKey.publicKey,
      blindedElements: [...blindedElements],
      evaluatedElements,
      challengeC,
      responseS,
      batchDigest,
    };
  }

  private computeCompositePair(
    keyId: string,
    publicKey: bigint,
    blinded: readonly bigint[],
    evaluated: readonly bigint[]
  ): { compositeM: bigint; compositeZ: bigint; seed: string } {
    const h = createHash('sha256');
    h.update(`WorkSphere::VOPRFSeed|${keyId}|${publicKey.toString(16)}`);
    for (let i = 0; i < blinded.length; i++) {
      h.update(`|${blinded[i].toString(16)}:${evaluated[i].toString(16)}`);
    }
    const seed = h.digest('hex');

    let compositeM = 1n;
    let compositeZ = 1n;
    for (let i = 0; i < blinded.length; i++) {
      const di = hashScalar('WorkSphere::VOPRFWeight', [seed, BigInt(i), blinded[i], evaluated[i]]);
      compositeM = (compositeM * modPow(blinded[i], di, this.p)) % this.p;
      compositeZ = (compositeZ * modPow(evaluated[i], di, this.p)) % this.p;
    }

    return { compositeM, compositeZ, seed };
  }

  /**
   * Verifies a constant-size batched VOPRF DLEQ proof and unblinds all client states at once.
   */
  public verifyAndFinalizeBatch(
    clientStates: readonly BlindedClientState[],
    batchEval: BatchedVOPRFEvaluation,
    expectedServerPublicKey: bigint
  ): { valid: boolean; outputs?: string[]; reason?: string } {
    if (batchEval.serverPublicKey !== expectedServerPublicKey) {
      return { valid: false, reason: 'Server public key mismatch' };
    }
    if (
      clientStates.length === 0 ||
      clientStates.length !== batchEval.blindedElements.length ||
      clientStates.length !== batchEval.evaluatedElements.length
    ) {
      return { valid: false, reason: 'Batch length mismatch' };
    }

    for (let i = 0; i < clientStates.length; i++) {
      if (clientStates[i].blindedElement !== batchEval.blindedElements[i]) {
        return { valid: false, reason: `Blinded element mismatch at index ${i}` };
      }
      if (!this.isSubgroupElement(batchEval.evaluatedElements[i])) {
        return { valid: false, reason: `Invalid evaluated element at index ${i}` };
      }
    }

    const { compositeM, compositeZ, seed } = this.computeCompositePair(
      batchEval.keyId,
      batchEval.serverPublicKey,
      batchEval.blindedElements,
      batchEval.evaluatedElements
    );

    const t2 =
      (modPow(this.g, batchEval.responseS, this.p) *
        modPow(batchEval.serverPublicKey, batchEval.challengeC, this.p)) %
      this.p;
    const t3 =
      (modPow(compositeM, batchEval.responseS, this.p) *
        modPow(compositeZ, batchEval.challengeC, this.p)) %
      this.p;

    const expectedC = hashScalar('WorkSphere::VOPRFBatchDLEQ', [
      batchEval.keyId,
      seed,
      batchEval.serverPublicKey,
      compositeM,
      compositeZ,
      t2,
      t3,
    ]);
    if (expectedC !== batchEval.challengeC) {
      return { valid: false, reason: 'Batched DLEQ challenge verification failed' };
    }

    const outputs: string[] = [];
    for (let i = 0; i < clientStates.length; i++) {
      const invR = modInverse(clientStates[i].blindScalar, this.q);
      const unblinded = modPow(batchEval.evaluatedElements[i], invR, this.p);
      outputs.push(this.deriveFinalOutput(clientStates[i].input, unblinded));
    }

    return { valid: true, outputs };
  }

  public serializeBatchEvaluation(batch: BatchedVOPRFEvaluation): string {
    return JSON.stringify({
      keyId: batch.keyId,
      serverPublicKey: batch.serverPublicKey.toString(16),
      blindedElements: batch.blindedElements.map((v) => v.toString(16)),
      evaluatedElements: batch.evaluatedElements.map((v) => v.toString(16)),
      challengeC: batch.challengeC.toString(16),
      responseS: batch.responseS.toString(16),
      batchDigest: batch.batchDigest,
    });
  }

  public deserializeBatchEvaluation(payload: string): BatchedVOPRFEvaluation {
    const raw = JSON.parse(payload) as {
      keyId: string;
      serverPublicKey: string;
      blindedElements: string[];
      evaluatedElements: string[];
      challengeC: string;
      responseS: string;
      batchDigest: string;
    };
    return {
      keyId: raw.keyId,
      serverPublicKey: BigInt(`0x${raw.serverPublicKey}`),
      blindedElements: raw.blindedElements.map((v) => BigInt(`0x${v}`)),
      evaluatedElements: raw.evaluatedElements.map((v) => BigInt(`0x${v}`)),
      challengeC: BigInt(`0x${raw.challengeC}`),
      responseS: BigInt(`0x${raw.responseS}`),
      batchDigest: raw.batchDigest,
    };
  }
}
