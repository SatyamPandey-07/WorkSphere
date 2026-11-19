/**
 * @file VerifiableHashChainTimeStampingProver.ts
 * @description Cryptographic Linked Hash-Chain Timestamp Authority (TSA) with Skip-List
 * Backlinks, Document Inclusion Receipts, Chronological Precedence Proofs, Sub-Chain
 * Anchor Verification, Tamper Localization, and Portable JSON Serialization.
 * Implements Haber-Stornetta linked timestamping with power-of-two skip pointers so any two
 * documents' relative chronological order and anchor-block membership can be audited cleanly.
 */

import { createHash } from 'node:crypto';

export interface TimestampEntry {
  sequenceNumber: number;
  timestampMs: number;
  documentId: string;
  documentHashHex: string;
  previousLinkHash: string;
  skipLinks: Array<{ targetSeq: number; targetHash: string }>;
  entryHash: string;
}

export interface TimestampReceipt {
  authorityId: string;
  entry: TimestampEntry;
  anchorSeq: number;
  anchorHash: string;
  forwardLinks: Array<{
    sequenceNumber: number;
    timestampMs: number;
    documentId: string;
    documentHashHex: string;
    skipLinks: Array<{ targetSeq: number; targetHash: string }>;
    entryHash: string;
  }>;
  receiptDigest: string;
}

export interface ChronologicalOrderProof {
  authorityId: string;
  earlierDocId: string;
  laterDocId: string;
  earlierSeq: number;
  laterSeq: number;
  chainSegment: TimestampEntry[];
  proofDigest: string;
}

function sha256Hex(data: string): string {
  return createHash('sha256').update(data).digest('hex');
}

function computeEntryHash(
  authorityId: string,
  seq: number,
  timestampMs: number,
  docId: string,
  docHashHex: string,
  prevHash: string,
  skipLinks: ReadonlyArray<{ targetSeq: number; targetHash: string }>
): string {
  const skipStr = skipLinks.map((s) => `${s.targetSeq}:${s.targetHash}`).join(',');
  return sha256Hex(
    `WorkSphere::TSA|${authorityId}|seq:${seq}|ts:${timestampMs}|doc:${docId}|h:${docHashHex}|prev:${prevHash}|skip:${skipStr}`
  );
}

/**
 * Haber-Stornetta Linked Hash-Chain Timestamp Authority with Power-of-Two Skip Pointers.
 */
export class VerifiableHashChainTimeStampingProver {
  private readonly authorityId: string;
  private readonly genesisHash: string;
  private readonly entries: TimestampEntry[] = [];
  private readonly docIndex: Map<string, number> = new Map();
  private lastTimestampMs = 0;

  constructor(authorityId = 'worksphere-tsa-2026', genesisSeed = 'genesis-2026') {
    this.authorityId = authorityId;
    this.genesisHash = sha256Hex(`WorkSphere::TSAGenesis|${authorityId}|${genesisSeed}`);
  }

  public getAuthorityId(): string {
    return this.authorityId;
  }

  public getGenesisHash(): string {
    return this.genesisHash;
  }

  public getChainLength(): number {
    return this.entries.length;
  }

  public getHeadHash(): string {
    return this.entries.length === 0 ? this.genesisHash : this.entries[this.entries.length - 1].entryHash;
  }

  public hashDocument(content: string): string {
    return sha256Hex(`WorkSphere::TSADoc|${content}`);
  }

  /**
   * Computes deterministic power-of-two skip backlink sequence indices (seq - 2, seq - 4, seq - 8, ...).
   */
  private computeSkipBacklinks(seq: number): Array<{ targetSeq: number; targetHash: string }> {
    const links: Array<{ targetSeq: number; targetHash: string }> = [];
    for (let step = 2; step <= seq; step <<= 1) {
      const targetSeq = seq - step;
      links.push({ targetSeq, targetHash: this.entries[targetSeq].entryHash });
    }
    return links;
  }

  /**
   * Appends and cryptographically seals a new timestamped document entry onto the linked chain.
   * Strictly enforces monotonically non-decreasing timestamps and unique document IDs.
   */
  public stampDocument(
    documentId: string,
    documentContent: string,
    timestampMs: number
  ): TimestampEntry {
    if (this.docIndex.has(documentId)) {
      throw new Error(`Document ${documentId} has already been timestamped`);
    }
    if (!Number.isInteger(timestampMs) || timestampMs < this.lastTimestampMs) {
      throw new RangeError(
        `Timestamp ${timestampMs} violates monotonic progression (last=${this.lastTimestampMs})`
      );
    }

    const seq = this.entries.length;
    const documentHashHex = this.hashDocument(documentContent);
    const previousLinkHash = this.getHeadHash();
    const skipLinks = this.computeSkipBacklinks(seq);
    const entryHash = computeEntryHash(
      this.authorityId,
      seq,
      timestampMs,
      documentId,
      documentHashHex,
      previousLinkHash,
      skipLinks
    );

    const entry: TimestampEntry = {
      sequenceNumber: seq,
      timestampMs,
      documentId,
      documentHashHex,
      previousLinkHash,
      skipLinks,
      entryHash,
    };

    this.entries.push(entry);
    this.docIndex.set(documentId, seq);
    this.lastTimestampMs = timestampMs;
    return entry;
  }

  /**
   * Issues an anchored timestamp receipt proving `documentId` was sealed at sequence `entry.sequenceNumber`
   * and cryptographically linked all the way forward to a published anchor hash at `anchorSeq`.
   */
  public issueReceipt(documentId: string, anchorSeq = this.entries.length - 1): TimestampReceipt {
    const seq = this.docIndex.get(documentId);
    if (seq === undefined) throw new Error(`Document ${documentId} not found in TSA chain`);
    if (anchorSeq < seq || anchorSeq >= this.entries.length) {
      throw new RangeError('anchorSeq must be between document sequence and current chain head');
    }

    const entry = this.entries[seq];
    const forwardLinks = [];
    for (let i = seq + 1; i <= anchorSeq; i++) {
      const e = this.entries[i];
      forwardLinks.push({
        sequenceNumber: e.sequenceNumber,
        timestampMs: e.timestampMs,
        documentId: e.documentId,
        documentHashHex: e.documentHashHex,
        skipLinks: e.skipLinks.map((s) => ({ ...s })),
        entryHash: e.entryHash,
      });
    }

    const anchorHash = this.entries[anchorSeq].entryHash;
    const receiptDigest = sha256Hex(
      `WorkSphere::TSAReceipt|${this.authorityId}|${documentId}|${seq}->${anchorSeq}|${anchorHash}`
    );

    return {
      authorityId: this.authorityId,
      entry: { ...entry, skipLinks: entry.skipLinks.map((s) => ({ ...s })) },
      anchorSeq,
      anchorHash,
      forwardLinks,
      receiptDigest,
    };
  }

  /**
   * Publicly verifies a document's timestamp receipt against its content and a published anchor hash.
   */
  public verifyReceipt(
    receipt: TimestampReceipt,
    documentContent: string,
    publishedAnchorHash: string
  ): { valid: boolean; reason?: string } {
    if (receipt.authorityId !== this.authorityId) {
      return { valid: false, reason: 'Authority ID mismatch' };
    }
    if (receipt.anchorHash !== publishedAnchorHash) {
      return { valid: false, reason: 'Anchor hash does not match published anchor' };
    }

    const expectedDocHash = this.hashDocument(documentContent);
    if (expectedDocHash !== receipt.entry.documentHashHex) {
      return { valid: false, reason: 'Document content does not match timestamped hash' };
    }

    const recomputedEntryHash = computeEntryHash(
      receipt.authorityId,
      receipt.entry.sequenceNumber,
      receipt.entry.timestampMs,
      receipt.entry.documentId,
      receipt.entry.documentHashHex,
      receipt.entry.previousLinkHash,
      receipt.entry.skipLinks
    );
    if (recomputedEntryHash !== receipt.entry.entryHash) {
      return { valid: false, reason: 'Entry hash integrity check failed' };
    }

    let prevHash = receipt.entry.entryHash;
    let prevSeq = receipt.entry.sequenceNumber;
    let prevTs = receipt.entry.timestampMs;

    for (const link of receipt.forwardLinks) {
      if (link.sequenceNumber !== prevSeq + 1) {
        return { valid: false, reason: `Non-contiguous sequence at ${link.sequenceNumber}` };
      }
      if (link.timestampMs < prevTs) {
        return { valid: false, reason: `Timestamp regression detected at seq ${link.sequenceNumber}` };
      }
      const expectedH = computeEntryHash(
        receipt.authorityId,
        link.sequenceNumber,
        link.timestampMs,
        link.documentId,
        link.documentHashHex,
        prevHash,
        link.skipLinks
      );
      if (expectedH !== link.entryHash) {
        return { valid: false, reason: `Forward link hash mismatch at seq ${link.sequenceNumber}` };
      }
      prevHash = link.entryHash;
      prevSeq = link.sequenceNumber;
      prevTs = link.timestampMs;
    }

    if (prevSeq !== receipt.anchorSeq || prevHash !== publishedAnchorHash) {
      return { valid: false, reason: 'Forward link chain did not terminate at published anchor hash' };
    }

    return { valid: true };
  }

  /**
   * Produces a verifiable chronological precedence proof demonstrating `earlierDocId` was stamped
   * strictly before `laterDocId`.
   */
  public proveChronologicalOrder(earlierDocId: string, laterDocId: string): ChronologicalOrderProof {
    const seqA = this.docIndex.get(earlierDocId);
    const seqB = this.docIndex.get(laterDocId);
    if (seqA === undefined || seqB === undefined) {
      throw new Error('Both documents must exist in the TSA chain');
    }
    if (seqA >= seqB) {
      throw new Error(`Document ${earlierDocId} (seq=${seqA}) did not precede ${laterDocId} (seq=${seqB})`);
    }

    const chainSegment = this.entries.slice(seqA, seqB + 1).map((e) => ({
      ...e,
      skipLinks: e.skipLinks.map((s) => ({ ...s })),
    }));
    const proofDigest = sha256Hex(
      `WorkSphere::TSAOrder|${this.authorityId}|${earlierDocId}:${seqA}<${laterDocId}:${seqB}|${chainSegment[chainSegment.length - 1].entryHash}`
    );

    return {
      authorityId: this.authorityId,
      earlierDocId,
      laterDocId,
      earlierSeq: seqA,
      laterSeq: seqB,
      chainSegment,
      proofDigest,
    };
  }

  /**
   * Verifies a chronological precedence proof and every internal skip-link backpointer inside the segment.
   */
  public verifyChronologicalOrder(proof: ChronologicalOrderProof): { valid: boolean; reason?: string } {
    if (proof.earlierSeq >= proof.laterSeq || proof.chainSegment.length !== proof.laterSeq - proof.earlierSeq + 1) {
      return { valid: false, reason: 'Invalid chronological segment bounds' };
    }
    const seg = proof.chainSegment;
    if (seg[0].documentId !== proof.earlierDocId || seg[seg.length - 1].documentId !== proof.laterDocId) {
      return { valid: false, reason: 'Segment endpoint document IDs mismatch' };
    }

    const hashBySeq = new Map<number, string>();
    for (let i = 0; i < seg.length; i++) {
      const e = seg[i];
      if (e.sequenceNumber !== proof.earlierSeq + i) {
        return { valid: false, reason: 'Broken sequence numbering in chronological proof' };
      }
      if (i > 0) {
        if (e.previousLinkHash !== seg[i - 1].entryHash) {
          return { valid: false, reason: `Broken hash link at seq ${e.sequenceNumber}` };
        }
        if (e.timestampMs < seg[i - 1].timestampMs) {
          return { valid: false, reason: `Non-monotonic timestamp at seq ${e.sequenceNumber}` };
        }
      }
      const recomputed = computeEntryHash(
        proof.authorityId,
        e.sequenceNumber,
        e.timestampMs,
        e.documentId,
        e.documentHashHex,
        e.previousLinkHash,
        e.skipLinks
      );
      if (recomputed !== e.entryHash) {
        return { valid: false, reason: `Corrupted entry hash at seq ${e.sequenceNumber}` };
      }
      // Verify any skip-links whose target falls inside this segment
      for (const sk of e.skipLinks) {
        const known = hashBySeq.get(sk.targetSeq);
        if (known !== undefined && known !== sk.targetHash) {
          return { valid: false, reason: `Skip-pointer mismatch at seq ${e.sequenceNumber} -> ${sk.targetSeq}` };
        }
      }
      hashBySeq.set(e.sequenceNumber, e.entryHash);
    }

    return { valid: true };
  }

  /**
   * Audits the entire internal TSA chain from genesis to head, returning any corrupted sequence indices.
   */
  public auditFullChain(): { valid: boolean; corruptedSequences: number[]; headHash: string } {
    const corruptedSequences: number[] = [];
    let prevHash = this.genesisHash;
    let prevTs = 0;

    for (let i = 0; i < this.entries.length; i++) {
      const e = this.entries[i];
      const expected = computeEntryHash(
        this.authorityId,
        i,
        e.timestampMs,
        e.documentId,
        e.documentHashHex,
        prevHash,
        e.skipLinks
      );
      const skipOk = e.skipLinks.every((sk) => this.entries[sk.targetSeq]?.entryHash === sk.targetHash);
      if (e.sequenceNumber !== i || e.previousLinkHash !== prevHash || e.timestampMs < prevTs || expected !== e.entryHash || !skipOk) {
        corruptedSequences.push(i);
      }
      prevHash = e.entryHash;
      prevTs = e.timestampMs;
    }

    return {
      valid: corruptedSequences.length === 0,
      corruptedSequences,
      headHash: this.getHeadHash(),
    };
  }

  public serializeReceipt(receipt: TimestampReceipt): string {
    return JSON.stringify(receipt);
  }

  public deserializeReceipt(payload: string): TimestampReceipt {
    return JSON.parse(payload) as TimestampReceipt;
  }
}
