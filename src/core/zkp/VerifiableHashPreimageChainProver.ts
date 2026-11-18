import { createHash, randomBytes } from 'node:crypto';

/**
 * Verifiable Hash Preimage Chain Prover (PayWord / Micro-Payment & Skip-Anchor Engine).
 *
 * Constructs a forward-secure one-way hash chain:
 *   h_0 = secretSeed
 *   h_i = SHA-256('PREIMAGE-STEP' || chainId || h_{i-1})  for i = 1..N
 *   anchorRoot = h_N
 *
 * Features:
 *  - Step-by-step monotonic payment/voucher redemption revealing h_{N-k} to pay k units
 *    (any verifier checks H^k(h_{N-k}) == anchorRoot)
 *  - Deterministic power-of-2 checkpoint skip table (Merkle-committed checkpoints) allowing
 *    fast verification of long jumps without iterating from the tip
 *  - Stateful replay & rollback protection rejecting stale or duplicate redemptions.
 */

function sha256Hex(...parts: string[]): string {
  const h = createHash('sha256');
  for (const p of parts) {
    h.update(p);
    h.update('|');
  }
  return h.digest('hex');
}

export interface PreimageChainCommitment {
  chainId: string;
  length: number;
  anchorRoot: string; // h_length
  checkpointStep: number;
  checkpointMerkleRoot: string;
  checkpointCount: number;
}

export interface CheckpointInclusionProof {
  checkpointIndex: number; // chain index = checkpointIndex * checkpointStep
  checkpointHash: string;
  siblings: Array<{ direction: 'left' | 'right'; hash: string }>;
  checkpointMerkleRoot: string;
}

export interface PreimageRedemptionVoucher {
  chainId: string;
  redeemedUnits: number; // k units => preimage is h_{length - k}
  preimage: string;
  anchorRoot: string;
  nearestCheckpoint?: CheckpointInclusionProof;
  stepsToCheckpoint?: number;
}

export class VerifiableHashPreimageChainProver {
  private readonly chainId: string;
  private readonly length: number;
  private readonly checkpointStep: number;
  private readonly nodes: string[]; // nodes[0] = seed, nodes[length] = anchorRoot
  private readonly checkpoints: string[];
  private readonly checkpointMerkleRoot: string;
  private highestRedeemedUnits = 0;

  constructor(chainId: string, length: number, checkpointStep = 16, seedHex?: string) {
    if (length < 4 || length > 10000) {
      throw new RangeError('Chain length must be in [4, 10000]');
    }
    if (checkpointStep < 1 || checkpointStep > length) {
      throw new RangeError('checkpointStep must be in [1, length]');
    }
    this.chainId = chainId;
    this.length = length;
    this.checkpointStep = checkpointStep;

    const seed = seedHex ?? randomBytes(32).toString('hex');
    this.nodes = new Array<string>(length + 1);
    this.nodes[0] = seed;
    for (let i = 1; i <= length; i++) {
      this.nodes[i] = this.stepHash(this.nodes[i - 1]);
    }

    this.checkpoints = [];
    for (let idx = 0; idx <= length; idx += checkpointStep) {
      this.checkpoints.push(this.nodes[idx]);
    }
    if (length % checkpointStep !== 0) {
      this.checkpoints.push(this.nodes[length]);
    }
    this.checkpointMerkleRoot = this.computeMerkleRoot(this.checkpoints);
  }

  public stepHash(value: string): string {
    return sha256Hex('PREIMAGE-STEP-V1', this.chainId, value);
  }

  public iterateHash(value: string, steps: number): string {
    let cur = value;
    for (let i = 0; i < steps; i++) {
      cur = this.stepHash(cur);
    }
    return cur;
  }

  private hashMerkleLeaf(idx: number, hashVal: string): string {
    return sha256Hex('CP-LEAF-V1', String(idx), hashVal);
  }

  private hashMerkleNode(left: string, right: string): string {
    return sha256Hex('CP-NODE-V1', left, right);
  }

  private computeMerkleRoot(items: string[]): string {
    let level = items.map((v, i) => this.hashMerkleLeaf(i, v));
    while (level.length > 1) {
      const next: string[] = [];
      for (let i = 0; i < level.length; i += 2) {
        const left = level[i];
        const right = i + 1 < level.length ? level[i + 1] : left;
        next.push(this.hashMerkleNode(left, right));
      }
      level = next;
    }
    return level[0];
  }

  private buildCheckpointProof(cpIdx: number): CheckpointInclusionProof {
    let level = this.checkpoints.map((v, i) => this.hashMerkleLeaf(i, v));
    const siblings: Array<{ direction: 'left' | 'right'; hash: string }> = [];
    let pos = cpIdx;

    while (level.length > 1) {
      const isRight = pos % 2 === 1;
      const sibPos = isRight ? pos - 1 : (pos + 1 < level.length ? pos + 1 : pos);
      siblings.push({ direction: isRight ? 'left' : 'right', hash: level[sibPos] });

      const next: string[] = [];
      for (let i = 0; i < level.length; i += 2) {
        const left = level[i];
        const right = i + 1 < level.length ? level[i + 1] : left;
        next.push(this.hashMerkleNode(left, right));
      }
      level = next;
      pos = pos >> 1;
    }

    return {
      checkpointIndex: cpIdx,
      checkpointHash: this.checkpoints[cpIdx],
      siblings,
      checkpointMerkleRoot: this.checkpointMerkleRoot,
    };
  }

  public verifyCheckpointProof(proof: CheckpointInclusionProof): boolean {
    let cur = this.hashMerkleLeaf(proof.checkpointIndex, proof.checkpointHash);
    for (const s of proof.siblings) {
      cur = s.direction === 'left'
        ? this.hashMerkleNode(s.hash, cur)
        : this.hashMerkleNode(cur, s.hash);
    }
    return cur === proof.checkpointMerkleRoot;
  }

  public getCommitment(): PreimageChainCommitment {
    return {
      chainId: this.chainId,
      length: this.length,
      anchorRoot: this.nodes[this.length],
      checkpointStep: this.checkpointStep,
      checkpointMerkleRoot: this.checkpointMerkleRoot,
      checkpointCount: this.checkpoints.length,
    };
  }

  public issueVoucher(redeemedUnits: number): PreimageRedemptionVoucher {
    if (redeemedUnits < 1 || redeemedUnits > this.length) {
      throw new RangeError(`redeemedUnits must be in [1, ${this.length}]`);
    }
    const targetNodeIdx = this.length - redeemedUnits;
    const preimage = this.nodes[targetNodeIdx];

    // Find nearest checkpoint >= targetNodeIdx for O(checkpointStep) fast verification
    const cpIdx = Math.ceil(targetNodeIdx / this.checkpointStep);
    const cpChainIdx = Math.min(cpIdx * this.checkpointStep, this.length);
    const actualCpIdx = cpChainIdx === this.length ? this.checkpoints.length - 1 : cpIdx;
    const stepsToCheckpoint = cpChainIdx - targetNodeIdx;

    return {
      chainId: this.chainId,
      redeemedUnits,
      preimage,
      anchorRoot: this.nodes[this.length],
      nearestCheckpoint: this.buildCheckpointProof(actualCpIdx),
      stepsToCheckpoint,
    };
  }

  public verifyVoucherFull(commitment: PreimageChainCommitment, voucher: PreimageRedemptionVoucher): boolean {
    if (
      voucher.chainId !== commitment.chainId ||
      voucher.anchorRoot !== commitment.anchorRoot ||
      voucher.redeemedUnits < 1 ||
      voucher.redeemedUnits > commitment.length
    ) {
      return false;
    }
    return this.iterateHash(voucher.preimage, voucher.redeemedUnits) === commitment.anchorRoot;
  }

  public verifyVoucherFastCheckpoint(commitment: PreimageChainCommitment, voucher: PreimageRedemptionVoucher): boolean {
    if (!voucher.nearestCheckpoint || voucher.stepsToCheckpoint === undefined) return false;
    if (voucher.nearestCheckpoint.checkpointMerkleRoot !== commitment.checkpointMerkleRoot) return false;
    if (!this.verifyCheckpointProof(voucher.nearestCheckpoint)) return false;

    const targetNodeIdx = commitment.length - voucher.redeemedUnits;
    const isLastCp = voucher.nearestCheckpoint.checkpointIndex === commitment.checkpointCount - 1;
    const expectedCpNodeIdx = isLastCp
      ? commitment.length
      : voucher.nearestCheckpoint.checkpointIndex * commitment.checkpointStep;
    if (expectedCpNodeIdx - targetNodeIdx !== voucher.stepsToCheckpoint) return false;
    if (voucher.stepsToCheckpoint < 0) return false;

    return this.iterateHash(voucher.preimage, voucher.stepsToCheckpoint) === voucher.nearestCheckpoint.checkpointHash;
  }

  public redeemMonotonic(
    commitment: PreimageChainCommitment,
    voucher: PreimageRedemptionVoucher,
  ): { accepted: boolean; deltaUnits: number; totalRedeemed: number; reason?: string } {
    if (!this.verifyVoucherFastCheckpoint(commitment, voucher)) {
      return { accepted: false, deltaUnits: 0, totalRedeemed: this.highestRedeemedUnits, reason: 'Invalid cryptographic voucher' };
    }
    if (voucher.redeemedUnits <= this.highestRedeemedUnits) {
      return {
        accepted: false,
        deltaUnits: 0,
        totalRedeemed: this.highestRedeemedUnits,
        reason: `Replay/rollback rejected: ${voucher.redeemedUnits} <= ${this.highestRedeemedUnits}`,
      };
    }
    const deltaUnits = voucher.redeemedUnits - this.highestRedeemedUnits;
    this.highestRedeemedUnits = voucher.redeemedUnits;
    return { accepted: true, deltaUnits, totalRedeemed: this.highestRedeemedUnits };
  }

  public serializeVoucher(voucher: PreimageRedemptionVoucher): string {
    return JSON.stringify({
      chainId: voucher.chainId,
      redeemedUnits: voucher.redeemedUnits,
      preimage: voucher.preimage,
      stepsToCheckpoint: voucher.stepsToCheckpoint,
    });
  }
}
