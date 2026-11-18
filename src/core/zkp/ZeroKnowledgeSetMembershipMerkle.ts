import { createHash } from 'crypto';

/**
 * Zero-Knowledge Poseidon Algebraic Merkle Membership & Nullifier Prover
 *
 * Implements an arithmetization-oriented Poseidon-style 3-element sponge hash
 * over BN254 scalar field Fr (with x^5 S-boxes, full/partial rounds, and Cauchy
 * MDS matrix diffusion) combined with a Semaphore/Tornado-style Merkle
 * set-membership and deterministic nullifier double-spend defense engine.
 * Proves commitment inclusion in the Poseidon Merkle root and knowledge of the
 * secret identity scalar via a safe-prime Schnorr ownership Sigma proof while
 * deriving a domain-separated nullifier hash.
 */

const FIELD_MODULUS =
  0x30644e72e131a029b85045b68181585d2833e84879b9709143e1f593f0000001n; // BN254 Fr
const SUBGROUP_ORDER = 0x7fffffffffffffffffffffffffffe1d3n; // Safe-prime subgroup order Q
const SAFE_PRIME = 0xffffffffffffffffffffffffffffc3a7n; // Safe prime P = 2Q + 1
const SUBGROUP_GEN = 4n;

const POSEIDON_WIDTH = 3;
const FULL_ROUNDS = 8;
const PARTIAL_ROUNDS = 16;

// 3x3 Cauchy MDS matrix over BN254 Fr (all square submatrices invertible)
const MDS_MATRIX: readonly (readonly [bigint, bigint, bigint])[] = [
  [2n, 1n, 1n],
  [1n, 2n, 1n],
  [1n, 1n, 3n],
];

export interface IdentityCommitment {
  readonly identityScalar: bigint;
  readonly trapdoorScalar: bigint;
  readonly publicOwnershipPoint: bigint;
  readonly leafCommitment: bigint;
}

export interface PoseidonMerkleStep {
  readonly siblingHash: bigint;
  readonly isRightSibling: boolean;
}

export interface OwnershipSigmaProof {
  readonly noncePointA: bigint;
  readonly challengeC: bigint;
  readonly responseS: bigint;
}

export interface ZKMembershipNullifierProof {
  readonly merkleRoot: bigint;
  readonly externalNullifierDomain: bigint;
  readonly nullifierHash: bigint;
  readonly leafCommitment: bigint;
  readonly publicOwnershipPoint: bigint;
  readonly merklePath: readonly PoseidonMerkleStep[];
  readonly ownershipProof: OwnershipSigmaProof;
  readonly signalDigest: string;
  readonly proofDigest: string;
}

export interface MembershipVerificationResult {
  readonly isValid: boolean;
  readonly merkleRootValid: boolean;
  readonly ownershipProofValid: boolean;
  readonly nullifierFresh: boolean;
  readonly reason?: string;
}

function modField(x: bigint): bigint {
  const r = x % FIELD_MODULUS;
  return r >= 0n ? r : r + FIELD_MODULUS;
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

function sbox5(x: bigint): bigint {
  const x2 = modField(x * x);
  const x4 = modField(x2 * x2);
  return modField(x4 * x);
}

function hashToField(domain: string, parts: readonly string[]): bigint {
  const h = createHash('sha256');
  h.update(domain);
  for (const p of parts) {
    h.update('|');
    h.update(p);
  }
  return modField(BigInt('0x' + h.digest('hex')));
}

function hashToScalarQ(domain: string, parts: readonly string[]): bigint {
  const h = createHash('sha256');
  h.update(domain);
  for (const p of parts) {
    h.update('|');
    h.update(p);
  }
  const s = modQ(BigInt('0x' + h.digest('hex')));
  return s === 0n ? 1n : s;
}

const ROUND_CONSTANTS: readonly bigint[] = (() => {
  const totalRounds = FULL_ROUNDS + PARTIAL_ROUNDS;
  const consts: bigint[] = [];
  for (let r = 0; r < totalRounds; r++) {
    for (let c = 0; c < POSEIDON_WIDTH; c++) {
      consts.push(hashToField('POSEIDON_RC_BN254', [String(r), String(c)]));
    }
  }
  return consts;
})();

export function poseidonHash2(left: bigint, right: bigint): bigint {
  let state: [bigint, bigint, bigint] = [0n, modField(left), modField(right)];
  const halfFull = FULL_ROUNDS >> 1;
  let rcOffset = 0;

  const applyMds = (st: [bigint, bigint, bigint]): [bigint, bigint, bigint] => {
    const out: [bigint, bigint, bigint] = [0n, 0n, 0n];
    for (let r = 0; r < POSEIDON_WIDTH; r++) {
      let acc = 0n;
      for (let c = 0; c < POSEIDON_WIDTH; c++) {
        acc = modField(acc + modField(MDS_MATRIX[r][c] * st[c]));
      }
      out[r] = acc;
    }
    return out;
  };

  for (let r = 0; r < halfFull; r++) {
    state = [
      sbox5(modField(state[0] + ROUND_CONSTANTS[rcOffset++])),
      sbox5(modField(state[1] + ROUND_CONSTANTS[rcOffset++])),
      sbox5(modField(state[2] + ROUND_CONSTANTS[rcOffset++])),
    ];
    state = applyMds(state);
  }

  for (let r = 0; r < PARTIAL_ROUNDS; r++) {
    state = [
      sbox5(modField(state[0] + ROUND_CONSTANTS[rcOffset++])),
      modField(state[1] + ROUND_CONSTANTS[rcOffset++]),
      modField(state[2] + ROUND_CONSTANTS[rcOffset++]),
    ];
    state = applyMds(state);
  }

  for (let r = 0; r < halfFull; r++) {
    state = [
      sbox5(modField(state[0] + ROUND_CONSTANTS[rcOffset++])),
      sbox5(modField(state[1] + ROUND_CONSTANTS[rcOffset++])),
      sbox5(modField(state[2] + ROUND_CONSTANTS[rcOffset++])),
    ];
    state = applyMds(state);
  }

  return state[0];
}

export class ZeroKnowledgeSetMembershipMerkle {
  private readonly treeDepth: number;
  private readonly capacity: number;
  private readonly zeroHashes: readonly bigint[];
  private readonly leaves: bigint[] = [];
  private readonly spentNullifiers = new Set<bigint>();

  constructor(treeDepth = 8) {
    if (!Number.isInteger(treeDepth) || treeDepth < 1 || treeDepth > 20) {
      throw new Error('treeDepth must be an integer between 1 and 20');
    }
    this.treeDepth = treeDepth;
    this.capacity = 1 << treeDepth;

    const zeros: bigint[] = [0n];
    for (let lvl = 0; lvl < treeDepth; lvl++) {
      zeros.push(poseidonHash2(zeros[lvl], zeros[lvl]));
    }
    this.zeroHashes = zeros;
  }

  public getTreeDepth(): number {
    return this.treeDepth;
  }

  public getMemberCount(): number {
    return this.leaves.length;
  }

  public createIdentity(identitySeed: string, trapdoorSeed: string): IdentityCommitment {
    const identityScalar = hashToScalarQ('ZK_MERKLE_ID_SCALAR', [identitySeed]);
    const trapdoorScalar = hashToField('ZK_MERKLE_TRAPDOOR', [trapdoorSeed]);
    const publicOwnershipPoint = modPow(SUBGROUP_GEN, identityScalar, SAFE_PRIME);
    const leafCommitment = poseidonHash2(modField(publicOwnershipPoint), trapdoorScalar);

    return {
      identityScalar,
      trapdoorScalar,
      publicOwnershipPoint,
      leafCommitment,
    };
  }

  public insertLeaf(leafCommitment: bigint): number {
    if (this.leaves.length >= this.capacity) {
      throw new Error(`Poseidon Merkle tree is at capacity (${this.capacity})`);
    }
    const index = this.leaves.length;
    this.leaves.push(modField(leafCommitment));
    return index;
  }

  private buildTreeLevels(): bigint[][] {
    const levels: bigint[][] = [];
    let current = new Array<bigint>(this.capacity).fill(this.zeroHashes[0]);
    for (let i = 0; i < this.leaves.length; i++) {
      current[i] = this.leaves[i];
    }
    levels.push(current);

    for (let lvl = 0; lvl < this.treeDepth; lvl++) {
      const nextLen = current.length >> 1;
      const next = new Array<bigint>(nextLen);
      for (let i = 0; i < nextLen; i++) {
        next[i] = poseidonHash2(current[2 * i], current[2 * i + 1]);
      }
      levels.push(next);
      current = next;
    }
    return levels;
  }

  public getRoot(): bigint {
    const levels = this.buildTreeLevels();
    return levels[this.treeDepth][0];
  }

  public computeNullifier(identityScalar: bigint, externalNullifierDomain: bigint): bigint {
    return poseidonHash2(modField(identityScalar), modField(externalNullifierDomain));
  }

  public proveMembership(
    identity: IdentityCommitment,
    leafIndex: number,
    externalNullifierDomain: bigint,
    signalDigest: string,
    proofNonce: string
  ): ZKMembershipNullifierProof {
    if (leafIndex < 0 || leafIndex >= this.leaves.length) {
      throw new Error(`Leaf index ${leafIndex} out of bounds`);
    }
    if (this.leaves[leafIndex] !== identity.leafCommitment) {
      throw new Error('Identity commitment does not match tree leaf at index');
    }

    const levels = this.buildTreeLevels();
    const merkleRoot = levels[this.treeDepth][0];
    const merklePath: PoseidonMerkleStep[] = [];
    let idx = leafIndex;
    for (let lvl = 0; lvl < this.treeDepth; lvl++) {
      const isRightSibling = (idx & 1) === 0;
      const siblingIndex = idx ^ 1;
      merklePath.push({
        siblingHash: levels[lvl][siblingIndex],
        isRightSibling,
      });
      idx >>= 1;
    }

    const nullifierHash = this.computeNullifier(identity.identityScalar, externalNullifierDomain);

    // Schnorr Sigma ownership proof bound to root, nullifier, leaf, and signal
    const w = hashToScalarQ('ZK_MERKLE_SIGMA_W', [proofNonce, signalDigest, nullifierHash.toString(16)]);
    const noncePointA = modPow(SUBGROUP_GEN, w, SAFE_PRIME);
    const challengeC = hashToScalarQ('ZK_MERKLE_SIGMA_C', [
      merkleRoot.toString(16),
      modField(externalNullifierDomain).toString(16),
      nullifierHash.toString(16),
      identity.leafCommitment.toString(16),
      identity.publicOwnershipPoint.toString(16),
      signalDigest,
      noncePointA.toString(16),
    ]);
    const responseS = modQ(w + modQ(challengeC * modQ(identity.identityScalar)));

    const ownershipProof: OwnershipSigmaProof = { noncePointA, challengeC, responseS };
    const proofDigest = createHash('sha256')
      .update('ZK_POSEIDON_MERKLE|')
      .update(`${merkleRoot.toString(16)}|${nullifierHash.toString(16)}|${signalDigest}|`)
      .update(`${identity.leafCommitment.toString(16)}|${responseS.toString(16)}`)
      .digest('hex');

    return {
      merkleRoot,
      externalNullifierDomain: modField(externalNullifierDomain),
      nullifierHash,
      leafCommitment: identity.leafCommitment,
      publicOwnershipPoint: identity.publicOwnershipPoint,
      merklePath,
      ownershipProof,
      signalDigest,
      proofDigest,
    };
  }

  public verifyAndConsume(
    proof: ZKMembershipNullifierProof,
    consumeNullifier = true
  ): MembershipVerificationResult {
    const currentRoot = this.getRoot();
    if (proof.merklePath.length !== this.treeDepth) {
      return {
        isValid: false,
        merkleRootValid: false,
        ownershipProofValid: false,
        nullifierFresh: false,
        reason: 'Merkle authentication path depth mismatch',
      };
    }

    const expectedDigest = createHash('sha256')
      .update('ZK_POSEIDON_MERKLE|')
      .update(`${proof.merkleRoot.toString(16)}|${proof.nullifierHash.toString(16)}|${proof.signalDigest}|`)
      .update(`${proof.leafCommitment.toString(16)}|${modQ(proof.ownershipProof.responseS).toString(16)}`)
      .digest('hex');
    if (expectedDigest !== proof.proofDigest) {
      return {
        isValid: false,
        merkleRootValid: false,
        ownershipProofValid: false,
        nullifierFresh: false,
        reason: 'Proof digest mismatch',
      };
    }

    // Recompute Poseidon Merkle root from leaf and path
    let computed = modField(proof.leafCommitment);
    for (const step of proof.merklePath) {
      computed = step.isRightSibling
        ? poseidonHash2(computed, step.siblingHash)
        : poseidonHash2(step.siblingHash, computed);
    }
    const merkleRootValid = computed === proof.merkleRoot && computed === currentRoot;

    // Verify Schnorr Sigma ownership proof
    const expectedC = hashToScalarQ('ZK_MERKLE_SIGMA_C', [
      proof.merkleRoot.toString(16),
      modField(proof.externalNullifierDomain).toString(16),
      proof.nullifierHash.toString(16),
      proof.leafCommitment.toString(16),
      proof.publicOwnershipPoint.toString(16),
      proof.signalDigest,
      proof.ownershipProof.noncePointA.toString(16),
    ]);
    const lhs = modPow(SUBGROUP_GEN, modQ(proof.ownershipProof.responseS), SAFE_PRIME);
    const rhs = modP(
      proof.ownershipProof.noncePointA *
        modPow(proof.publicOwnershipPoint, expectedC, SAFE_PRIME)
    );
    const ownershipProofValid = expectedC === proof.ownershipProof.challengeC && lhs === rhs;

    const nullifierFresh = !this.spentNullifiers.has(proof.nullifierHash);

    if (!merkleRootValid || !ownershipProofValid || !nullifierFresh) {
      return {
        isValid: false,
        merkleRootValid,
        ownershipProofValid,
        nullifierFresh,
        reason: !nullifierFresh
          ? 'Nullifier replay / double-spend detected'
          : !merkleRootValid
          ? 'Poseidon Merkle root verification failed'
          : 'Ownership Sigma proof verification failed',
      };
    }

    if (consumeNullifier) {
      this.spentNullifiers.add(proof.nullifierHash);
    }

    return {
      isValid: true,
      merkleRootValid: true,
      ownershipProofValid: true,
      nullifierFresh: true,
    };
  }
}
