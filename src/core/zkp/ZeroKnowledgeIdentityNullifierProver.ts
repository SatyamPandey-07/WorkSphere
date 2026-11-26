import { createHash, randomBytes } from 'node:crypto';

/**
 * Zero-Knowledge Semaphore-Style Anonymous Identity & Scoped Nullifier Prover.
 *
 * Allows a member of a registered identity group (Merkle tree of identity commitments)
 * to broadcast an arbitrary signal/message on a topic (externalNullifier) while proving:
 *  1. Membership in the identity group's committed Merkle root (via LSAG ring + Merkle anchor
 *     OR zero-knowledge Chaum-Pedersen membership + DLEQ nullifier derivation)
 *  2. Deterministic topic-scoped nullifier N = H2G(externalNullifier)^{identitySecret} so
 *     the SAME user can signal at most ONCE per topic without linking their signals across
 *     different topics or exposing which group member signaled!
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

export interface AnonymousIdentity {
  identitySecret: bigint;
  identityCommitment: bigint; // g^{identitySecret}
}

export interface SemaphoreSignalProof {
  groupId: string;
  groupRoot: string;
  memberCommitments: bigint[];
  externalNullifier: string;
  signal: string;
  nullifierHash: bigint; // H2G(groupId || externalNullifier)^{identitySecret}
  c0: bigint;
  responses: bigint[];
}

export interface SignalAdmissionResult {
  admitted: boolean;
  duplicateNullifier: boolean;
  nullifierTag: string;
  reason?: string;
}

export class ZeroKnowledgeIdentityNullifierProver {
  public readonly groupId: string;
  private members: bigint[] = [];
  private spentNullifiers = new Set<string>();

  constructor(groupId: string) {
    this.groupId = groupId;
  }

  public createIdentity(secret?: bigint): AnonymousIdentity {
    const identitySecret = secret !== undefined ? modScalar(secret) : randomScalar();
    if (identitySecret === 0n) throw new Error('Identity secret must be non-zero');
    return {
      identitySecret,
      identityCommitment: modPow(BASE_G, identitySecret, SAFE_PRIME_P),
    };
  }

  public addMember(identityCommitment: bigint): number {
    if (this.members.includes(identityCommitment)) {
      throw new Error('Identity commitment already registered in group');
    }
    this.members.push(identityCommitment);
    return this.members.length - 1;
  }

  public addMembers(commitments: bigint[]): string {
    for (const c of commitments) this.addMember(c);
    return this.computeGroupRoot(this.members);
  }

  public computeGroupRoot(commitments: bigint[] = this.members): string {
    if (commitments.length === 0) return sha256Hex('SEMAPHORE-EMPTY', this.groupId);
    let lvl = commitments.map((c, idx) => sha256Hex('SEMAPHORE-LEAF', this.groupId, String(idx), c.toString(16)));
    while (lvl.length > 1) {
      const next: string[] = [];
      for (let i = 0; i < lvl.length; i += 2) {
        next.push(sha256Hex('SEMAPHORE-NODE', lvl[i], i + 1 < lvl.length ? lvl[i + 1] : lvl[i]));
      }
      lvl = next;
    }
    return lvl[0];
  }

  public hashScopeToSubgroup(externalNullifier: string): bigint {
    const hex = sha256Hex('SEMAPHORE-SCOPE-H2G-V1', this.groupId, externalNullifier);
    const raw = (BigInt('0x' + hex.slice(0, 32)) % (SAFE_PRIME_P - 3n)) + 2n;
    const qr = (raw * raw) % SAFE_PRIME_P;
    return qr === 1n ? BASE_G : qr;
  }

  private ringStepChallenge(
    groupRoot: string,
    externalNullifier: string,
    signal: string,
    nullifierHash: bigint,
    L: bigint,
    R: bigint,
  ): bigint {
    return hashToScalar(
      'SEMAPHORE-RING-STEP-V1',
      this.groupId,
      groupRoot,
      externalNullifier,
      signal,
      nullifierHash.toString(16),
      L.toString(16),
      R.toString(16),
    );
  }

  /**
   * Proves anonymous group membership + deterministic scoped nullifier + bound signal message.
   */
  public generateSignalProof(
    identity: AnonymousIdentity,
    externalNullifier: string,
    signal: string,
  ): SemaphoreSignalProof {
    const n = this.members.length;
    if (n < 2) throw new Error('Anonymous identity group requires at least 2 members');
    const signerIdx = this.members.indexOf(identity.identityCommitment);
    if (signerIdx === -1) throw new Error('Identity commitment is not a registered group member');
    if (modPow(BASE_G, identity.identitySecret, SAFE_PRIME_P) !== identity.identityCommitment) {
      throw new Error('Identity secret does not match commitment');
    }

    const groupRoot = this.computeGroupRoot(this.members);
    const H = this.hashScopeToSubgroup(externalNullifier);
    const nullifierHash = modPow(H, identity.identitySecret, SAFE_PRIME_P);

    const challenges = new Array<bigint>(n).fill(0n);
    const responses = new Array<bigint>(n).fill(0n);

    const u = randomScalar();
    const Ls = modPow(BASE_G, u, SAFE_PRIME_P);
    const Rs = modPow(H, u, SAFE_PRIME_P);

    let nextIdx = (signerIdx + 1) % n;
    challenges[nextIdx] = this.ringStepChallenge(groupRoot, externalNullifier, signal, nullifierHash, Ls, Rs);

    while (nextIdx !== signerIdx) {
      const si = randomScalar();
      responses[nextIdx] = si;
      const ci = challenges[nextIdx];
      const Li = (modPow(BASE_G, si, SAFE_PRIME_P) * modPow(this.members[nextIdx], ci, SAFE_PRIME_P)) % SAFE_PRIME_P;
      const Ri = (modPow(H, si, SAFE_PRIME_P) * modPow(nullifierHash, ci, SAFE_PRIME_P)) % SAFE_PRIME_P;
      const after = (nextIdx + 1) % n;
      challenges[after] = this.ringStepChallenge(groupRoot, externalNullifier, signal, nullifierHash, Li, Ri);
      nextIdx = after;
    }

    responses[signerIdx] = modScalar(u - challenges[signerIdx] * identity.identitySecret);

    return {
      groupId: this.groupId,
      groupRoot,
      memberCommitments: [...this.members],
      externalNullifier,
      signal,
      nullifierHash,
      c0: challenges[0],
      responses,
    };
  }

  public verifySignalProof(proof: SemaphoreSignalProof, expectedGroupRoot?: string): boolean {
    if (proof.groupId !== this.groupId) return false;
    const n = proof.memberCommitments.length;
    if (n < 2 || proof.responses.length !== n) return false;
    if (proof.nullifierHash <= 1n || proof.nullifierHash >= SAFE_PRIME_P) return false;

    const computedRoot = this.computeGroupRoot(proof.memberCommitments);
    if (computedRoot !== proof.groupRoot) return false;
    if (expectedGroupRoot && expectedGroupRoot !== proof.groupRoot) return false;

    const H = this.hashScopeToSubgroup(proof.externalNullifier);
    let c = proof.c0;
    for (let i = 0; i < n; i++) {
      const si = proof.responses[i];
      const Li = (modPow(BASE_G, si, SAFE_PRIME_P) * modPow(proof.memberCommitments[i], c, SAFE_PRIME_P)) % SAFE_PRIME_P;
      const Ri = (modPow(H, si, SAFE_PRIME_P) * modPow(proof.nullifierHash, c, SAFE_PRIME_P)) % SAFE_PRIME_P;
      c = this.ringStepChallenge(proof.groupRoot, proof.externalNullifier, proof.signal, proof.nullifierHash, Li, Ri);
    }

    return c === proof.c0;
  }

  public verifyAndRecordSignal(proof: SemaphoreSignalProof, expectedGroupRoot?: string): SignalAdmissionResult {
    const nullifierTag = `${proof.externalNullifier}:${proof.nullifierHash.toString(16)}`;
    if (!this.verifySignalProof(proof, expectedGroupRoot)) {
      return { admitted: false, duplicateNullifier: false, nullifierTag, reason: 'Invalid ZK signal proof' };
    }
    if (this.spentNullifiers.has(nullifierTag)) {
      return { admitted: false, duplicateNullifier: true, nullifierTag, reason: 'Nullifier already spent for this topic' };
    }
    this.spentNullifiers.add(nullifierTag);
    return { admitted: true, duplicateNullifier: false, nullifierTag };
  }

  public serializeProof(proof: SemaphoreSignalProof): string {
    return JSON.stringify({
      groupId: proof.groupId,
      groupRoot: proof.groupRoot,
      memberCount: proof.memberCommitments.length,
      externalNullifier: proof.externalNullifier,
      signal: proof.signal,
      nullifierHash: proof.nullifierHash.toString(16),
    });
  }
}
