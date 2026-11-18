/**
 * @file VerifiableAuditLogHashTreeProver.ts
 * @description Dual-Layer Epoch-Sealed Cryptographic Audit Log Tree with Per-Epoch Merkle Roots,
 * Cross-Epoch Hash-Chained Checkpoint Anchors, Event Inclusion Verification, Historical Epoch
 * Tamper Audits, Multi-Event Batch Verification, and Portable JSON Serialization.
 */

import { createHash } from 'node:crypto';

export interface AuditLogEvent {
  eventId: string;
  actorId: string;
  action: string;
  timestampMs: number;
  payloadHashHex: string;
}

export interface SealedEpochBlock {
  epochIndex: number;
  previousEpochHash: string;
  eventCount: number;
  eventsMerkleRoot: string;
  minTimestampMs: number;
  maxTimestampMs: number;
  epochHash: string;
}

export interface DualLayerEventProof {
  logId: string;
  epochIndex: number;
  eventIndexInEpoch: number;
  event: AuditLogEvent;
  eventLeafHash: string;
  merklePath: Array<{ direction: 'left' | 'right'; siblingHash: string }>;
  epochBlock: SealedEpochBlock;
  forwardEpochHeaders: SealedEpochBlock[];
  anchorEpochHash: string;
  proofDigest: string;
}

function sha256Hex(data: string): string {
  return createHash('sha256').update(data).digest('hex');
}

function hashEvent(event: AuditLogEvent): string {
  return sha256Hex(
    `WorkSphere::AuditEvt|${event.eventId}|${event.actorId}|${event.action}|${event.timestampMs}|${event.payloadHashHex}`
  );
}

function hashMerklePair(leftHex: string, rightHex: string): string {
  return createHash('sha256')
    .update('\x01')
    .update(Buffer.from(leftHex, 'hex'))
    .update(Buffer.from(rightHex, 'hex'))
    .digest('hex');
}

function computeEpochHeaderHash(
  logId: string,
  epochIndex: number,
  previousEpochHash: string,
  eventCount: number,
  eventsMerkleRoot: string,
  minTimestampMs: number,
  maxTimestampMs: number
): string {
  return sha256Hex(
    `WorkSphere::AuditEpoch|${logId}|ep:${epochIndex}|prev:${previousEpochHash}|n:${eventCount}|root:${eventsMerkleRoot}|t:${minTimestampMs}..${maxTimestampMs}`
  );
}

interface InternalEpochStore {
  block: SealedEpochBlock;
  events: AuditLogEvent[];
  levels: string[][];
}

/**
 * Dual-Layer Epoch-Sealed Audit Log Tree (Intra-Epoch Merkle Tree + Inter-Epoch Hash Chain).
 */
export class VerifiableAuditLogHashTreeProver {
  private readonly logId: string;
  private readonly genesisHash: string;
  private readonly epochs: InternalEpochStore[] = [];
  private readonly pendingEvents: AuditLogEvent[] = [];
  private readonly eventLocator: Map<string, { epochIndex: number; eventIndex: number }> = new Map();

  constructor(logId = 'worksphere-audit-log', genesisSeed = 'genesis-audit-2026') {
    this.logId = logId;
    this.genesisHash = sha256Hex(`WorkSphere::AuditLogGenesis|${logId}|${genesisSeed}`);
  }

  public getLogId(): string {
    return this.logId;
  }

  public getGenesisHash(): string {
    return this.genesisHash;
  }

  public getSealedEpochCount(): number {
    return this.epochs.length;
  }

  public getLatestAnchorHash(): string {
    return this.epochs.length === 0
      ? this.genesisHash
      : this.epochs[this.epochs.length - 1].block.epochHash;
  }

  /**
   * Buffers a new audit event into the open current epoch.
   */
  public recordEvent(
    eventId: string,
    actorId: string,
    action: string,
    payload: string,
    timestampMs: number
  ): AuditLogEvent {
    if (this.eventLocator.has(eventId) || this.pendingEvents.some((e) => e.eventId === eventId)) {
      throw new Error(`Duplicate audit eventId: ${eventId}`);
    }
    const evt: AuditLogEvent = {
      eventId,
      actorId,
      action,
      timestampMs,
      payloadHashHex: sha256Hex(payload),
    };
    this.pendingEvents.push(evt);
    return evt;
  }

  private buildMerkleLevels(events: readonly AuditLogEvent[]): string[][] {
    let padded = 1;
    while (padded < events.length) padded <<= 1;
    const base: string[] = [];
    const padHash = sha256Hex('WorkSphere::AuditPad');

    for (let i = 0; i < padded; i++) {
      base.push(i < events.length ? hashEvent(events[i]) : padHash);
    }

    const levels: string[][] = [base];
    let cur = base;
    while (cur.length > 1) {
      const next: string[] = [];
      for (let i = 0; i < cur.length; i += 2) {
        next.push(hashMerklePair(cur[i], cur[i + 1]));
      }
      levels.push(next);
      cur = next;
    }
    return levels;
  }

  /**
   * Seals all buffered events into an immutable Merkle-rooted epoch block linked to the prior epoch.
   */
  public sealCurrentEpoch(): SealedEpochBlock {
    if (this.pendingEvents.length === 0) {
      throw new Error('Cannot seal an empty epoch with zero buffered events');
    }

    const epochIndex = this.epochs.length;
    const events = this.pendingEvents.splice(0, this.pendingEvents.length);
    const levels = this.buildMerkleLevels(events);
    const eventsMerkleRoot = levels[levels.length - 1][0];
    const previousEpochHash = this.getLatestAnchorHash();

    let minTimestampMs = events[0].timestampMs;
    let maxTimestampMs = events[0].timestampMs;
    for (let i = 0; i < events.length; i++) {
      const ts = events[i].timestampMs;
      if (ts < minTimestampMs) minTimestampMs = ts;
      if (ts > maxTimestampMs) maxTimestampMs = ts;
      this.eventLocator.set(events[i].eventId, { epochIndex, eventIndex: i });
    }

    const epochHash = computeEpochHeaderHash(
      this.logId,
      epochIndex,
      previousEpochHash,
      events.length,
      eventsMerkleRoot,
      minTimestampMs,
      maxTimestampMs
    );

    const block: SealedEpochBlock = {
      epochIndex,
      previousEpochHash,
      eventCount: events.length,
      eventsMerkleRoot,
      minTimestampMs,
      maxTimestampMs,
      epochHash,
    };

    this.epochs.push({ block, events, levels });
    return block;
  }

  /**
   * Generates a dual-layer inclusion proof proving `eventId` is inside its epoch's Merkle tree
   * AND that epoch is chained all the way to the latest (or specified) published anchor hash!
   */
  public generateEventProof(
    eventId: string,
    anchorEpochIndex = this.epochs.length - 1
  ): DualLayerEventProof {
    const loc = this.eventLocator.get(eventId);
    if (!loc) throw new Error(`Event ${eventId} not found in any sealed epoch`);
    if (anchorEpochIndex < loc.epochIndex || anchorEpochIndex >= this.epochs.length) {
      throw new RangeError('Invalid anchorEpochIndex');
    }

    const store = this.epochs[loc.epochIndex];
    const event = store.events[loc.eventIndex];
    const merklePath: Array<{ direction: 'left' | 'right'; siblingHash: string }> = [];

    let idx = loc.eventIndex;
    for (let lvl = 0; lvl < store.levels.length - 1; lvl++) {
      const isRight = (idx & 1) === 1;
      const sibIdx = isRight ? idx - 1 : idx + 1;
      merklePath.push({
        direction: isRight ? 'left' : 'right',
        siblingHash: store.levels[lvl][sibIdx],
      });
      idx >>= 1;
    }

    const forwardEpochHeaders: SealedEpochBlock[] = [];
    for (let ep = loc.epochIndex + 1; ep <= anchorEpochIndex; ep++) {
      forwardEpochHeaders.push({ ...this.epochs[ep].block });
    }

    const anchorEpochHash = this.epochs[anchorEpochIndex].block.epochHash;
    const proofDigest = sha256Hex(
      `WorkSphere::DualAuditProof|${this.logId}|${eventId}|ep:${loc.epochIndex}->${anchorEpochIndex}|${anchorEpochHash}`
    );

    return {
      logId: this.logId,
      epochIndex: loc.epochIndex,
      eventIndexInEpoch: loc.eventIndex,
      event: { ...event },
      eventLeafHash: store.levels[0][loc.eventIndex],
      merklePath,
      epochBlock: { ...store.block },
      forwardEpochHeaders,
      anchorEpochHash,
      proofDigest,
    };
  }

  /**
   * Publicly verifies a dual-layer audit proof against a published anchor hash.
   */
  public verifyEventProof(
    proof: DualLayerEventProof,
    publishedAnchorHash: string,
    expectedPayload?: string
  ): { valid: boolean; reason?: string } {
    if (proof.logId !== this.logId) return { valid: false, reason: 'Log ID mismatch' };
    if (proof.anchorEpochHash !== publishedAnchorHash) {
      return { valid: false, reason: 'Anchor hash does not match published anchor' };
    }
    if (expectedPayload !== undefined && sha256Hex(expectedPayload) !== proof.event.payloadHashHex) {
      return { valid: false, reason: 'Event payload hash does not match expectedPayload' };
    }

    const recomputedLeaf = hashEvent(proof.event);
    if (recomputedLeaf !== proof.eventLeafHash) {
      return { valid: false, reason: 'Event leaf hash mismatch' };
    }

    let curHash = recomputedLeaf;
    for (const step of proof.merklePath) {
      curHash =
        step.direction === 'left'
          ? hashMerklePair(step.siblingHash, curHash)
          : hashMerklePair(curHash, step.siblingHash);
    }
    if (curHash !== proof.epochBlock.eventsMerkleRoot) {
      return { valid: false, reason: 'Intra-epoch Merkle root mismatch' };
    }

    // Verify epoch header hash and forward epoch chain to anchor
    const recomputedEpHash = computeEpochHeaderHash(
      proof.logId,
      proof.epochBlock.epochIndex,
      proof.epochBlock.previousEpochHash,
      proof.epochBlock.eventCount,
      proof.epochBlock.eventsMerkleRoot,
      proof.epochBlock.minTimestampMs,
      proof.epochBlock.maxTimestampMs
    );
    if (recomputedEpHash !== proof.epochBlock.epochHash) {
      return { valid: false, reason: 'Epoch block header hash mismatch' };
    }

    let prevHash = proof.epochBlock.epochHash;
    let prevEp = proof.epochBlock.epochIndex;
    for (const hdr of proof.forwardEpochHeaders) {
      if (hdr.epochIndex !== prevEp + 1 || hdr.previousEpochHash !== prevHash) {
        return { valid: false, reason: `Broken inter-epoch chain at epoch ${hdr.epochIndex}` };
      }
      const h = computeEpochHeaderHash(
        proof.logId,
        hdr.epochIndex,
        hdr.previousEpochHash,
        hdr.eventCount,
        hdr.eventsMerkleRoot,
        hdr.minTimestampMs,
        hdr.maxTimestampMs
      );
      if (h !== hdr.epochHash) {
        return { valid: false, reason: `Corrupted forward epoch header at epoch ${hdr.epochIndex}` };
      }
      prevHash = hdr.epochHash;
      prevEp = hdr.epochIndex;
    }

    if (prevHash !== publishedAnchorHash) {
      return { valid: false, reason: 'Forward epoch chain does not terminate at published anchor hash' };
    }

    return { valid: true };
  }

  /**
   * Batch-verifies multiple dual-layer event proofs across different epochs against one anchor.
   */
  public batchVerifyProofs(
    proofs: readonly DualLayerEventProof[],
    publishedAnchorHash: string
  ): { allValid: boolean; verifiedEventIds: string[]; failedEventIds: string[] } {
    const verifiedEventIds: string[] = [];
    const failedEventIds: string[] = [];
    for (const p of proofs) {
      if (this.verifyEventProof(p, publishedAnchorHash).valid) {
        verifiedEventIds.push(p.event.eventId);
      } else {
        failedEventIds.push(p.event.eventId);
      }
    }
    return {
      allValid: proofs.length > 0 && failedEventIds.length === 0,
      verifiedEventIds,
      failedEventIds,
    };
  }

  public serializeProof(proof: DualLayerEventProof): string {
    return JSON.stringify(proof);
  }

  public deserializeProof(payload: string): DualLayerEventProof {
    return JSON.parse(payload) as DualLayerEventProof;
  }
}
