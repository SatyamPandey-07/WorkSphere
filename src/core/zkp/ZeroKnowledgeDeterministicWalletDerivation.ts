/**
 * @file ZeroKnowledgeDeterministicWalletDerivation.ts
 * @description BIP32-Style Non-Hardened Hierarchical Deterministic (HD) Key Derivation Engine
 * with Zero-Knowledge Parent-Child Derivation Proofs, Multi-Level Path Verification,
 * Watch-Only Public Derivation, Batch Derivation Auditing, and JSON Serialization.
 * Given parent key (sk_p, pk_p = g^{sk_p}) and chainCode c_p:
 *   tweak = H_scalar(pk_p || chainCode || index)
 *   sk_child = (sk_p + tweak) mod q
 *   pk_child = pk_p * g^{tweak} mod p (computable publicly WITHOUT sk_p!)
 */

import { createHash, randomBytes } from 'node:crypto';

const SUBGROUP_Q = 0x7fffffffffffffffffffffffffffe1d3n;
const SAFE_PRIME_P = 0xffffffffffffffffffffffffffffc3a7n;
const BASE_G = 4n;

export interface HDExtendedKey {
  depth: number;
  path: string;
  chainCodeHex: string;
  publicKey: bigint;
  secretKey?: bigint;
  fingerprint: string;
}

export interface DerivationLinkProof {
  proofId: string;
  parentPublicKey: bigint;
  parentChainCodeHex: string;
  childIndex: number;
  childPublicKey: bigint;
  childChainCodeHex: string;
  tweakScalar: bigint;
  ownershipProof: {
    nonceCommit: bigint;
    challenge: bigint;
    response: bigint;
  };
  linkDigest: string;
}

export interface HDPathAuditProof {
  rootPublicKey: bigint;
  rootChainCodeHex: string;
  derivationIndices: number[];
  derivedPublicKey: bigint;
  stepCommitments: Array<{
    index: number;
    publicKey: bigint;
    chainCodeHex: string;
    tweakScalar: bigint;
  }>;
  auditDigest: string;
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

function computeFingerprint(publicKey: bigint): string {
  return createHash('sha256')
    .update(`WorkSphere::HDFingerprint|${publicKey.toString(16)}`)
    .digest('hex')
    .slice(0, 16);
}

/**
 * Hierarchical Deterministic (HD) Key Derivation & Zero-Knowledge Linkage Prover.
 */
export class ZeroKnowledgeDeterministicWalletDerivation {
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

  /**
   * Derives a master extended key pair (m) from a seed string.
   */
  public createMasterKey(masterSeed: string): HDExtendedKey {
    const secretKey = hashScalar('WorkSphere::HDMasterSecret', [masterSeed]);
    const publicKey = modPow(this.g, secretKey, this.p);
    const chainCodeHex = createHash('sha256')
      .update(`WorkSphere::HDMasterChain|${masterSeed}`)
      .digest('hex');

    return {
      depth: 0,
      path: 'm',
      chainCodeHex,
      publicKey,
      secretKey,
      fingerprint: computeFingerprint(publicKey),
    };
  }

  /**
   * Strips the private key to produce a watch-only public extended key (xpub equivalent).
   */
  public neuterKey(extKey: HDExtendedKey): HDExtendedKey {
    return {
      depth: extKey.depth,
      path: extKey.path,
      chainCodeHex: extKey.chainCodeHex,
      publicKey: extKey.publicKey,
      fingerprint: extKey.fingerprint,
    };
  }

  private computeChildTweak(
    parentPublicKey: bigint,
    parentChainCodeHex: string,
    index: number
  ): { tweakScalar: bigint; childChainCodeHex: string } {
    if (!Number.isInteger(index) || index < 0) {
      throw new RangeError('Non-hardened derivation index must be a non-negative integer');
    }
    const tweakScalar = hashScalar('WorkSphere::HDChildTweak', [
      parentPublicKey,
      parentChainCodeHex,
      BigInt(index),
    ]);
    const childChainCodeHex = createHash('sha256')
      .update(`WorkSphere::HDChildChain|${parentPublicKey.toString(16)}|${parentChainCodeHex}|${index}`)
      .digest('hex');
    return { tweakScalar, childChainCodeHex };
  }

  /**
   * Derives a child extended key (works BOTH with secret key AND watch-only without secret key!).
   */
  public deriveChild(parent: HDExtendedKey, index: number): HDExtendedKey {
    const { tweakScalar, childChainCodeHex } = this.computeChildTweak(
      parent.publicKey,
      parent.chainCodeHex,
      index
    );

    const childPublicKey = (parent.publicKey * modPow(this.g, tweakScalar, this.p)) % this.p;
    const childSecretKey =
      parent.secretKey !== undefined ? modNorm(parent.secretKey + tweakScalar, this.q) : undefined;

    return {
      depth: parent.depth + 1,
      path: `${parent.path}/${index}`,
      chainCodeHex: childChainCodeHex,
      publicKey: childPublicKey,
      secretKey: childSecretKey,
      fingerprint: computeFingerprint(childPublicKey),
    };
  }

  /**
   * Derives a deep path such as [44, 0, 1, 7] from a parent or master key.
   */
  public derivePath(root: HDExtendedKey, indices: readonly number[]): HDExtendedKey {
    let cur = root;
    for (const idx of indices) {
      cur = this.deriveChild(cur, idx);
    }
    return cur;
  }

  /**
   * Produces a zero-knowledge proof linking a parent key to its derived child AND proving
   * knowledge of the child's private key without revealing either secret key.
   */
  public proveChildDerivationLink(
    proofId: string,
    parentWithSecret: HDExtendedKey,
    childIndex: number
  ): DerivationLinkProof {
    if (parentWithSecret.secretKey === undefined) {
      throw new Error('Parent secret key is required to prove ownership linkage');
    }
    const { tweakScalar, childChainCodeHex } = this.computeChildTweak(
      parentWithSecret.publicKey,
      parentWithSecret.chainCodeHex,
      childIndex
    );
    const child = this.deriveChild(parentWithSecret, childIndex);

    const k = randomScalar(this.q);
    const nonceCommit = modPow(this.g, k, this.p);
    const challenge = hashScalar('WorkSphere::HDLinkProof', [
      proofId,
      parentWithSecret.publicKey,
      child.publicKey,
      tweakScalar,
      BigInt(childIndex),
      nonceCommit,
    ]);
    const response = modNorm(k + challenge * child.secretKey!, this.q);

    const linkDigest = createHash('sha256')
      .update(`${proofId}|${parentWithSecret.publicKey.toString(16)}|${child.publicKey.toString(16)}|${childIndex}`)
      .digest('hex');

    return {
      proofId,
      parentPublicKey: parentWithSecret.publicKey,
      parentChainCodeHex: parentWithSecret.chainCodeHex,
      childIndex,
      childPublicKey: child.publicKey,
      childChainCodeHex,
      tweakScalar,
      ownershipProof: { nonceCommit, challenge, response },
      linkDigest,
    };
  }

  /**
   * Publicly verifies a parent-child HD derivation link proof and child key ownership.
   */
  public verifyChildDerivationLink(proof: DerivationLinkProof): { valid: boolean; reason?: string } {
    const { tweakScalar, childChainCodeHex } = this.computeChildTweak(
      proof.parentPublicKey,
      proof.parentChainCodeHex,
      proof.childIndex
    );
    if (tweakScalar !== proof.tweakScalar || childChainCodeHex !== proof.childChainCodeHex) {
      return { valid: false, reason: 'Child tweak or chain code derivation mismatch' };
    }

    const expectedChildPub = (proof.parentPublicKey * modPow(this.g, tweakScalar, this.p)) % this.p;
    if (expectedChildPub !== proof.childPublicKey) {
      return { valid: false, reason: 'Child public key homomorphic shift mismatch' };
    }

    const op = proof.ownershipProof;
    const expectedC = hashScalar('WorkSphere::HDLinkProof', [
      proof.proofId,
      proof.parentPublicKey,
      proof.childPublicKey,
      tweakScalar,
      BigInt(proof.childIndex),
      op.nonceCommit,
    ]);
    if (expectedC !== op.challenge) {
      return { valid: false, reason: 'Ownership proof challenge mismatch' };
    }

    const lhs = modPow(this.g, op.response, this.p);
    const rhs = (op.nonceCommit * modPow(proof.childPublicKey, op.challenge, this.p)) % this.p;
    if (lhs !== rhs) {
      return { valid: false, reason: 'Child key ownership Schnorr proof failed' };
    }

    return { valid: true };
  }

  /**
   * Generates a complete multi-hop HD path derivation audit trail from an xpub root.
   */
  public generatePathAudit(rootPub: HDExtendedKey, indices: readonly number[]): HDPathAuditProof {
    const steps: Array<{ index: number; publicKey: bigint; chainCodeHex: string; tweakScalar: bigint }> = [];
    let cur = this.neuterKey(rootPub);

    for (const index of indices) {
      const { tweakScalar } = this.computeChildTweak(cur.publicKey, cur.chainCodeHex, index);
      cur = this.deriveChild(cur, index);
      steps.push({
        index,
        publicKey: cur.publicKey,
        chainCodeHex: cur.chainCodeHex,
        tweakScalar,
      });
    }

    const auditDigest = createHash('sha256')
      .update(`${rootPub.publicKey.toString(16)}|${indices.join('/')}|${cur.publicKey.toString(16)}`)
      .digest('hex');

    return {
      rootPublicKey: rootPub.publicKey,
      rootChainCodeHex: rootPub.chainCodeHex,
      derivationIndices: [...indices],
      derivedPublicKey: cur.publicKey,
      stepCommitments: steps,
      auditDigest,
    };
  }

  public verifyPathAudit(audit: HDPathAuditProof): boolean {
    if (audit.derivationIndices.length !== audit.stepCommitments.length) return false;
    let curPub = audit.rootPublicKey;
    let curChain = audit.rootChainCodeHex;

    for (let i = 0; i < audit.derivationIndices.length; i++) {
      const idx = audit.derivationIndices[i];
      const step = audit.stepCommitments[i];
      if (step.index !== idx) return false;
      const { tweakScalar, childChainCodeHex } = this.computeChildTweak(curPub, curChain, idx);
      const nextPub = (curPub * modPow(this.g, tweakScalar, this.p)) % this.p;
      if (nextPub !== step.publicKey || childChainCodeHex !== step.chainCodeHex || tweakScalar !== step.tweakScalar) {
        return false;
      }
      curPub = nextPub;
      curChain = childChainCodeHex;
    }

    return curPub === audit.derivedPublicKey;
  }

  public serializeLinkProof(proof: DerivationLinkProof): string {
    return JSON.stringify({
      proofId: proof.proofId,
      parentPublicKey: proof.parentPublicKey.toString(16),
      parentChainCodeHex: proof.parentChainCodeHex,
      childIndex: proof.childIndex,
      childPublicKey: proof.childPublicKey.toString(16),
      childChainCodeHex: proof.childChainCodeHex,
      tweakScalar: proof.tweakScalar.toString(16),
      ownershipProof: {
        nonceCommit: proof.ownershipProof.nonceCommit.toString(16),
        challenge: proof.ownershipProof.challenge.toString(16),
        response: proof.ownershipProof.response.toString(16),
      },
      linkDigest: proof.linkDigest,
    });
  }

  public deserializeLinkProof(payload: string): DerivationLinkProof {
    const raw = JSON.parse(payload) as Record<string, any>;
    return {
      proofId: raw.proofId,
      parentPublicKey: BigInt(`0x${raw.parentPublicKey}`),
      parentChainCodeHex: raw.parentChainCodeHex,
      childIndex: Number(raw.childIndex),
      childPublicKey: BigInt(`0x${raw.childPublicKey}`),
      childChainCodeHex: raw.childChainCodeHex,
      tweakScalar: BigInt(`0x${raw.tweakScalar}`),
      ownershipProof: {
        nonceCommit: BigInt(`0x${raw.ownershipProof.nonceCommit}`),
        challenge: BigInt(`0x${raw.ownershipProof.challenge}`),
        response: BigInt(`0x${raw.ownershipProof.response}`),
      },
      linkDigest: raw.linkDigest,
    };
  }
}
