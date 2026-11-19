import { createHash } from 'node:crypto';

/**
 * Verifiable Audit Trail Compression & Epoch Archival Prover.
 *
 * Compresses unbounded audit logs into constant-size verifiable archival checkpoints:
 *  - Events are grouped into sealed epochs E_0, E_1, ..., E_{k-1}, each with an intra-epoch
 *    Merkle tree root, event count, and cumulative hash-chain digest linking E_i -> E_{i-1}.
 *  - Multiple contiguous historical epochs [startEpoch..endEpoch] can be compressed into a
 *    SINGLE constant-size CompressedArchivalSummary anchored by a Merkle tree of epoch headers
 *    and boundary chain links, enabling O(log(epochs) + log(events)) historical event audits
 *    even after raw intermediate epoch bodies are pruned from hot storage!
 */

function sha256Hex(...parts: string[]): string {
  const h = createHash('sha256');
  for (const p of parts) {
    h.update(p);
    h.update('|');
  }
  return h.digest('hex');
}

export interface AuditLogEvent {
  eventId: string;
  actor: string;
  action: string;
  timestampMs: number;
  payloadHash: string;
}

export interface SealedAuditEpoch {
  epochNumber: number;
  previousChainHash: string;
  eventCount: number;
  merkleRoot: string;
  epochHeaderHash: string;
  chainHash: string;
  eventDigests: string[];
}

export interface MerkleStep {
  direction: 'left' | 'right';
  hash: string;
}

export interface CompressedArchivalSummary {
  streamId: string;
  startEpoch: number;
  endEpoch: number;
  entryChainHash: string; // previousChainHash of startEpoch
  exitChainHash: string;  // chainHash of endEpoch
  totalEventCount: number;
  epochHeadersMerkleRoot: string;
  summaryDigest: string;
}

export interface ArchivedEventInclusionProof {
  streamId: string;
  epochNumber: number;
  eventIndex: number;
  event: AuditLogEvent;
  intraEpochPath: MerkleStep[];
  epochHeader: Omit<SealedAuditEpoch, 'eventDigests'>;
  epochInSummaryPath: MerkleStep[];
  summary: CompressedArchivalSummary;
}

export class VerifiableAuditTrailCompressionProver {
  public readonly streamId: string;
  private readonly genesisHash: string;
  private epochs: SealedAuditEpoch[] = [];

  constructor(streamId: string) {
    this.streamId = streamId;
    this.genesisHash = sha256Hex('AUDIT-GENESIS-V1', streamId);
  }

  public hashEvent(ev: AuditLogEvent): string {
    return sha256Hex(
      'AUDIT-EVENT-V1',
      ev.eventId,
      ev.actor,
      ev.action,
      String(ev.timestampMs),
      ev.payloadHash,
    );
  }

  private hashMerkleNode(left: string, right: string): string {
    return sha256Hex('AUDIT-MERKLE-NODE-V1', left, right);
  }

  private buildMerkleTree(leaves: string[]): { root: string; levels: string[][] } {
    if (leaves.length === 0) {
      const empty = sha256Hex('AUDIT-EMPTY-MERKLE');
      return { root: empty, levels: [[empty]] };
    }
    const levels: string[][] = [leaves.map((l) => sha256Hex('AUDIT-MERKLE-LEAF-V1', l))];
    let cur = levels[0];
    while (cur.length > 1) {
      const next: string[] = [];
      for (let i = 0; i < cur.length; i += 2) {
        const right = i + 1 < cur.length ? cur[i + 1] : cur[i];
        next.push(this.hashMerkleNode(cur[i], right));
      }
      levels.push(next);
      cur = next;
    }
    return { root: cur[0], levels };
  }

  private extractMerklePath(levels: string[][], index: number): MerkleStep[] {
    const path: MerkleStep[] = [];
    let pos = index;
    for (let lvl = 0; lvl < levels.length - 1; lvl++) {
      const arr = levels[lvl];
      const isRight = pos % 2 === 1;
      const sibPos = isRight ? pos - 1 : (pos + 1 < arr.length ? pos + 1 : pos);
      path.push({ direction: isRight ? 'left' : 'right', hash: arr[sibPos] });
      pos >>= 1;
    }
    return path;
  }

  private verifyMerklePath(leafRaw: string, path: MerkleStep[], expectedRoot: string): boolean {
    let cur = sha256Hex('AUDIT-MERKLE-LEAF-V1', leafRaw);
    for (const step of path) {
      cur = step.direction === 'left'
        ? this.hashMerkleNode(step.hash, cur)
        : this.hashMerkleNode(cur, step.hash);
    }
    return cur === expectedRoot;
  }

  public computeEpochHeaderHash(
    epochNumber: number,
    previousChainHash: string,
    eventCount: number,
    merkleRoot: string,
  ): string {
    return sha256Hex(
      'AUDIT-EPOCH-HEADER-V1',
      this.streamId,
      String(epochNumber),
      previousChainHash,
      String(eventCount),
      merkleRoot,
    );
  }

  public computeChainHash(previousChainHash: string, epochHeaderHash: string): string {
    return sha256Hex('AUDIT-CHAIN-LINK-V1', this.streamId, previousChainHash, epochHeaderHash);
  }

  public sealEpoch(events: AuditLogEvent[]): SealedAuditEpoch {
    if (events.length === 0) throw new Error('Cannot seal an empty audit epoch');
    const epochNumber = this.epochs.length;
    const previousChainHash = epochNumber === 0 ? this.genesisHash : this.epochs[epochNumber - 1].chainHash;
    const eventDigests = events.map((e) => this.hashEvent(e));
    const { root: merkleRoot } = this.buildMerkleTree(eventDigests);
    const epochHeaderHash = this.computeEpochHeaderHash(epochNumber, previousChainHash, events.length, merkleRoot);
    const chainHash = this.computeChainHash(previousChainHash, epochHeaderHash);

    const sealed: SealedAuditEpoch = {
      epochNumber,
      previousChainHash,
      eventCount: events.length,
      merkleRoot,
      epochHeaderHash,
      chainHash,
      eventDigests,
    };
    this.epochs.push(sealed);
    return { ...sealed, eventDigests: [...eventDigests] };
  }

  public getEpochCount(): number {
    return this.epochs.length;
  }

  public verifyEpochChainContinuity(startEpoch = 0, endEpoch = this.epochs.length - 1): boolean {
    if (startEpoch < 0 || endEpoch >= this.epochs.length || startEpoch > endEpoch) return false;
    let expectedPrev = startEpoch === 0 ? this.genesisHash : this.epochs[startEpoch - 1].chainHash;
    for (let i = startEpoch; i <= endEpoch; i++) {
      const ep = this.epochs[i];
      if (ep.epochNumber !== i || ep.previousChainHash !== expectedPrev) return false;
      const h = this.computeEpochHeaderHash(ep.epochNumber, ep.previousChainHash, ep.eventCount, ep.merkleRoot);
      if (h !== ep.epochHeaderHash) return false;
      const ch = this.computeChainHash(ep.previousChainHash, ep.epochHeaderHash);
      if (ch !== ep.chainHash) return false;
      expectedPrev = ch;
    }
    return true;
  }

  private computeSummaryDigest(s: Omit<CompressedArchivalSummary, 'summaryDigest'>): string {
    return sha256Hex(
      'AUDIT-SUMMARY-V1',
      s.streamId,
      String(s.startEpoch),
      String(s.endEpoch),
      s.entryChainHash,
      s.exitChainHash,
      String(s.totalEventCount),
      s.epochHeadersMerkleRoot,
    );
  }

  public compressEpochRange(startEpoch: number, endEpoch: number): CompressedArchivalSummary {
    if (startEpoch < 0 || endEpoch >= this.epochs.length || startEpoch > endEpoch) {
      throw new RangeError(`Invalid compression range [${startEpoch}, ${endEpoch}]`);
    }
    const slice = this.epochs.slice(startEpoch, endEpoch + 1);
    const totalEventCount = slice.reduce((acc, ep) => acc + ep.eventCount, 0);
    const { root: epochHeadersMerkleRoot } = this.buildMerkleTree(slice.map((ep) => ep.epochHeaderHash));
    const base = {
      streamId: this.streamId,
      startEpoch,
      endEpoch,
      entryChainHash: slice[0].previousChainHash,
      exitChainHash: slice[slice.length - 1].chainHash,
      totalEventCount,
      epochHeadersMerkleRoot,
    };
    return { ...base, summaryDigest: this.computeSummaryDigest(base) };
  }

  public proveArchivedEventInclusion(
    startEpoch: number,
    endEpoch: number,
    targetEpoch: number,
    eventIndex: number,
    event: AuditLogEvent,
  ): ArchivedEventInclusionProof {
    if (targetEpoch < startEpoch || targetEpoch > endEpoch || endEpoch >= this.epochs.length) {
      throw new RangeError('Target epoch outside compressed archival range');
    }
    const ep = this.epochs[targetEpoch];
    if (eventIndex < 0 || eventIndex >= ep.eventDigests.length) {
      throw new RangeError('Event index out of bounds');
    }
    if (this.hashEvent(event) !== ep.eventDigests[eventIndex]) {
      throw new Error('Provided event does not match sealed epoch digest');
    }

    const summary = this.compressEpochRange(startEpoch, endEpoch);
    const intraTree = this.buildMerkleTree(ep.eventDigests);
    const intraEpochPath = this.extractMerklePath(intraTree.levels, eventIndex);

    const slice = this.epochs.slice(startEpoch, endEpoch + 1);
    const headerTree = this.buildMerkleTree(slice.map((e) => e.epochHeaderHash));
    const epochInSummaryPath = this.extractMerklePath(headerTree.levels, targetEpoch - startEpoch);

    const { eventDigests: _omit, ...epochHeader } = ep;
    return {
      streamId: this.streamId,
      epochNumber: targetEpoch,
      eventIndex,
      event,
      intraEpochPath,
      epochHeader,
      epochInSummaryPath,
      summary,
    };
  }

  public verifyArchivedEventInclusion(proof: ArchivedEventInclusionProof): boolean {
    const { summary, epochHeader } = proof;
    if (proof.streamId !== this.streamId || summary.streamId !== this.streamId) return false;
    if (proof.epochNumber < summary.startEpoch || proof.epochNumber > summary.endEpoch) return false;
    if (this.computeSummaryDigest(summary) !== summary.summaryDigest) return false;

    const recomputedHeaderHash = this.computeEpochHeaderHash(
      epochHeader.epochNumber,
      epochHeader.previousChainHash,
      epochHeader.eventCount,
      epochHeader.merkleRoot,
    );
    if (recomputedHeaderHash !== epochHeader.epochHeaderHash) return false;
    if (this.computeChainHash(epochHeader.previousChainHash, epochHeader.epochHeaderHash) !== epochHeader.chainHash) {
      return false;
    }

    // Check 1: event digest included in epoch Merkle root
    const eventDigest = this.hashEvent(proof.event);
    if (!this.verifyMerklePath(eventDigest, proof.intraEpochPath, epochHeader.merkleRoot)) {
      return false;
    }

    // Check 2: epochHeaderHash included in compressed archival summary Merkle root
    return this.verifyMerklePath(epochHeader.epochHeaderHash, proof.epochInSummaryPath, summary.epochHeadersMerkleRoot);
  }

  public verifySequentialSummaries(summaries: CompressedArchivalSummary[]): boolean {
    if (summaries.length === 0) return false;
    for (let i = 0; i < summaries.length; i++) {
      const s = summaries[i];
      if (this.computeSummaryDigest(s) !== s.summaryDigest) return false;
      if (i > 0) {
        const prev = summaries[i - 1];
        if (s.startEpoch !== prev.endEpoch + 1 || s.entryChainHash !== prev.exitChainHash) return false;
      }
    }
    return true;
  }

  public serializeSummary(summary: CompressedArchivalSummary): string {
    return JSON.stringify(summary);
  }
}
