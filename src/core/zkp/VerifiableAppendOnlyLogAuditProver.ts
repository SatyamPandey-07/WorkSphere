import { createHash, randomBytes } from 'node:crypto';

/**
 * Verifiable Append-Only Transparency Log Audit & Gossip Equivocation Prover.
 *
 * Implements a Signed Tree Head (STH) transparency log auditor supporting:
 *  - Schnorr-signed Signed Tree Heads (STH) binding (logId, treeSize, timestampMs, rootHash)
 *  - RFC 6962-compatible binary Merkle tree hashing (0x00 leaf / 0x01 node domain separation)
 *  - Gossip auditor verifying STH signatures, leaf inclusion proofs, and append-only consistency
 *    between pairs of STHs observed by independent witnesses
 *  - Cryptographic Split-View Equivocation Fraud Proof detection if a malicious log operator
 *    signs two conflicting STHs at the SAME treeSize with different rootHashes!
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

function hashLeaf(data: string): string {
  return createHash('sha256').update(Buffer.from([0x00])).update(data, 'utf8').digest('hex');
}

function hashNode(leftHex: string, rightHex: string): string {
  return createHash('sha256')
    .update(Buffer.from([0x01]))
    .update(Buffer.from(leftHex, 'hex'))
    .update(Buffer.from(rightHex, 'hex'))
    .digest('hex');
}

function largestPowerOfTwoLessThan(n: number): number {
  let k = 1;
  while ((k << 1) < n) k <<= 1;
  return k;
}

export interface LogOperatorKeys {
  logId: string;
  secretKey: bigint;
  publicKey: bigint;
}

export interface SignedTreeHead {
  logId: string;
  treeSize: number;
  timestampMs: number;
  rootHash: string;
  sigR: bigint;
  sigS: bigint;
}

export interface LogEntryInclusionProof {
  logId: string;
  leafIndex: number;
  leafData: string;
  sth: SignedTreeHead;
  auditPath: string[];
}

export interface GossipConsistencyBundle {
  olderSTH: SignedTreeHead;
  newerSTH: SignedTreeHead;
  consistencyPath: string[];
}

export interface SplitViewEquivocationProof {
  logId: string;
  treeSize: number;
  sthA: SignedTreeHead;
  sthB: SignedTreeHead;
}

export class VerifiableAppendOnlyLogAuditProver {
  private readonly operator: LogOperatorKeys;
  private entries: string[] = [];

  constructor(logId: string, operatorSecret?: bigint) {
    const secretKey = operatorSecret !== undefined ? modScalar(operatorSecret) : randomScalar();
    if (secretKey === 0n) throw new Error('Operator secret must be non-zero');
    this.operator = {
      logId,
      secretKey,
      publicKey: modPow(BASE_G, secretKey, SAFE_PRIME_P),
    };
  }

  public getPublicKey(): bigint {
    return this.operator.publicKey;
  }

  public getLogId(): string {
    return this.operator.logId;
  }

  private sthDigest(logId: string, treeSize: number, timestampMs: number, rootHash: string): string {
    return sha256Hex('LOG-STH-V1', logId, String(treeSize), String(timestampMs), rootHash);
  }

  public signTreeHead(treeSize: number, timestampMs: number, rootHash: string): SignedTreeHead {
    const digest = this.sthDigest(this.operator.logId, treeSize, timestampMs, rootHash);
    const k = randomScalar();
    const sigR = modPow(BASE_G, k, SAFE_PRIME_P);
    const c = hashToScalar('LOG-STH-SIG-V1', sigR.toString(16), this.operator.publicKey.toString(16), digest);
    const sigS = modScalar(k + c * this.operator.secretKey);
    return { logId: this.operator.logId, treeSize, timestampMs, rootHash, sigR, sigS };
  }

  public verifySTH(sth: SignedTreeHead, expectedPublicKey = this.operator.publicKey): boolean {
    if (sth.logId !== this.operator.logId || sth.treeSize < 0) return false;
    const digest = this.sthDigest(sth.logId, sth.treeSize, sth.timestampMs, sth.rootHash);
    const c = hashToScalar('LOG-STH-SIG-V1', sth.sigR.toString(16), expectedPublicKey.toString(16), digest);
    return modPow(BASE_G, sth.sigS, SAFE_PRIME_P) === (sth.sigR * modPow(expectedPublicKey, c, SAFE_PRIME_P)) % SAFE_PRIME_P;
  }

  private mth(start: number, end: number): string {
    const n = end - start;
    if (n === 0) return createHash('sha256').update('').digest('hex');
    if (n === 1) return hashLeaf(this.entries[start]);
    const k = largestPowerOfTwoLessThan(n);
    return hashNode(this.mth(start, start + k), this.mth(start + k, end));
  }

  public appendAndSignHead(items: string[], timestampMs = Date.now()): SignedTreeHead {
    if (items.length === 0) throw new Error('Must append at least one log entry');
    for (const item of items) this.entries.push(item);
    const rootHash = this.mth(0, this.entries.length);
    return this.signTreeHead(this.entries.length, timestampMs, rootHash);
  }

  private buildInclusionPath(index: number, start: number, end: number): string[] {
    const n = end - start;
    if (n === 1) return [];
    const k = largestPowerOfTwoLessThan(n);
    if (index < k) {
      return [...this.buildInclusionPath(index, start, start + k), this.mth(start + k, end)];
    }
    return [...this.buildInclusionPath(index - k, start + k, end), this.mth(start, start + k)];
  }

  public proveEntryInclusion(leafIndex: number, sth: SignedTreeHead): LogEntryInclusionProof {
    if (leafIndex < 0 || leafIndex >= sth.treeSize || sth.treeSize > this.entries.length) {
      throw new RangeError('Leaf index or STH size out of bounds');
    }
    return {
      logId: this.operator.logId,
      leafIndex,
      leafData: this.entries[leafIndex],
      sth,
      auditPath: this.buildInclusionPath(leafIndex, 0, sth.treeSize),
    };
  }

  public verifyEntryInclusion(proof: LogEntryInclusionProof): boolean {
    if (!this.verifySTH(proof.sth)) return false;
    if (proof.leafIndex < 0 || proof.leafIndex >= proof.sth.treeSize) return false;

    let fn = proof.leafIndex;
    let sn = proof.sth.treeSize - 1;
    let r = hashLeaf(proof.leafData);

    for (const p of proof.auditPath) {
      if (sn === 0) return false;
      if ((fn & 1) === 1 || fn === sn) {
        r = hashNode(p, r);
        while (fn !== 0 && (fn & 1) === 0) {
          fn >>= 1;
          sn >>= 1;
        }
      } else {
        r = hashNode(r, p);
      }
      fn >>= 1;
      sn >>= 1;
    }

    return sn === 0 && r === proof.sth.rootHash;
  }

  private subproof(m: number, start: number, end: number, complete: boolean): string[] {
    const n = end - start;
    if (m === n) return complete ? [] : [this.mth(start, end)];
    const k = largestPowerOfTwoLessThan(n);
    if (m <= k) {
      return [...this.subproof(m, start, start + k, complete), this.mth(start + k, end)];
    }
    return [...this.subproof(m - k, start + k, end, false), this.mth(start, start + k)];
  }

  public proveGossipConsistency(olderSTH: SignedTreeHead, newerSTH: SignedTreeHead): GossipConsistencyBundle {
    if (olderSTH.treeSize < 1 || newerSTH.treeSize < olderSTH.treeSize || newerSTH.treeSize > this.entries.length) {
      throw new RangeError('Invalid STH sizes for consistency proof');
    }
    const consistencyPath = olderSTH.treeSize === newerSTH.treeSize
      ? []
      : this.subproof(olderSTH.treeSize, 0, newerSTH.treeSize, true);
    return { olderSTH, newerSTH, consistencyPath };
  }

  public verifyGossipConsistency(bundle: GossipConsistencyBundle): boolean {
    const { olderSTH, newerSTH, consistencyPath } = bundle;
    if (!this.verifySTH(olderSTH) || !this.verifySTH(newerSTH)) return false;
    const first = olderSTH.treeSize;
    const second = newerSTH.treeSize;
    if (first < 1 || second < first) return false;
    if (first === second) return consistencyPath.length === 0 && olderSTH.rootHash === newerSTH.rootHash;
    if (consistencyPath.length === 0) return false;

    const nodes = [...consistencyPath];
    let fn = first - 1;
    let sn = second - 1;
    if ((first & (first - 1)) === 0) nodes.unshift(olderSTH.rootHash);

    while ((fn & 1) === 1) {
      fn >>= 1;
      sn >>= 1;
    }

    let fr = nodes[0];
    let sr = nodes[0];
    for (let i = 1; i < nodes.length; i++) {
      if (sn === 0) return false;
      const c = nodes[i];
      if ((fn & 1) === 1 || fn === sn) {
        fr = hashNode(c, fr);
        sr = hashNode(c, sr);
        while (fn !== 0 && (fn & 1) === 0) {
          fn >>= 1;
          sn >>= 1;
        }
      } else {
        sr = hashNode(sr, c);
      }
      fn >>= 1;
      sn >>= 1;
    }

    return sn === 0 && fr === olderSTH.rootHash && sr === newerSTH.rootHash;
  }

  public verifySplitViewEquivocation(proof: SplitViewEquivocationProof): boolean {
    if (proof.sthA.logId !== proof.logId || proof.sthB.logId !== proof.logId) return false;
    if (proof.sthA.treeSize !== proof.treeSize || proof.sthB.treeSize !== proof.treeSize) return false;
    if (proof.sthA.rootHash === proof.sthB.rootHash) return false;
    return this.verifySTH(proof.sthA) && this.verifySTH(proof.sthB);
  }

  public serializeSTH(sth: SignedTreeHead): string {
    return JSON.stringify({
      logId: sth.logId,
      treeSize: sth.treeSize,
      timestampMs: sth.timestampMs,
      rootHash: sth.rootHash,
    });
  }
}
