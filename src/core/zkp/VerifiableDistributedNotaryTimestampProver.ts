import { createHash, randomBytes } from 'node:crypto';

/**
 * Verifiable Decentralized Threshold Notary Timestamping Authority (TSA) Prover.
 *
 * Implements an RFC 3161-inspired decentralized threshold timestamping notary network:
 *  - Batches N document digests into a canonical Merkle timestamp batch anchored to a
 *    monotonic epoch timestamp & external chain block height
 *  - A (t, n) quorum of independent notary servers each Schnorr-sign the batch root header,
 *    creating a tamper-proof ThresholdTimestampHeader (isolating invalid/duplicate notaries)
 *  - Issues compact self-contained DocumentTimestampReceipts (Merkle inclusion path +
 *    quorum-signed header) verifiable offline against ONLY the notary public key set!
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

export interface NotaryAuthoritySigner {
  notaryId: string;
  secretKey: bigint;
  publicKey: bigint;
}

export interface NotaryAttestation {
  notaryId: string;
  sigR: bigint;
  sigS: bigint;
}

export interface ThresholdTimestampHeader {
  networkId: string;
  batchSeq: number;
  utcTimestampMs: number;
  anchorBlockHeight: number;
  previousHeaderHash: string;
  docMerkleRoot: string;
  documentCount: number;
  headerHash: string;
  attestations: NotaryAttestation[];
}

export interface DocumentTimestampReceipt {
  documentId: string;
  documentHash: string;
  leafIndex: number;
  merklePath: Array<{ direction: 'left' | 'right'; hash: string }>;
  header: ThresholdTimestampHeader;
}

export class VerifiableDistributedNotaryTimestampProver {
  public readonly networkId: string;
  public readonly quorumThreshold: number;
  public readonly genesisHeaderHash: string;
  private notaries = new Map<string, bigint>();
  private headers: ThresholdTimestampHeader[] = [];

  constructor(networkId: string, quorumThreshold: number) {
    if (quorumThreshold < 1) throw new RangeError('quorumThreshold must be >= 1');
    this.networkId = networkId;
    this.quorumThreshold = quorumThreshold;
    this.genesisHeaderHash = sha256Hex('NOTARY-TSA-GENESIS-V1', networkId);
  }

  public registerNotary(notaryId: string): NotaryAuthoritySigner {
    if (this.notaries.has(notaryId)) throw new Error(`Notary "${notaryId}" already registered`);
    const secretKey = randomScalar();
    const publicKey = modPow(BASE_G, secretKey, SAFE_PRIME_P);
    this.notaries.set(notaryId, publicKey);
    return { notaryId, secretKey, publicKey };
  }

  public hashDocument(content: string): string {
    return sha256Hex('NOTARY-DOC-V1', content);
  }

  private hashLeaf(documentId: string, documentHash: string): string {
    return sha256Hex('NOTARY-LEAF-V1', documentId, documentHash);
  }

  private hashNode(left: string, right: string): string {
    return sha256Hex('NOTARY-NODE-V1', left, right);
  }

  private buildMerkle(docs: Array<{ documentId: string; documentHash: string }>): { root: string; levels: string[][] } {
    const levels: string[][] = [docs.map((d) => this.hashLeaf(d.documentId, d.documentHash))];
    let cur = levels[0];
    while (cur.length > 1) {
      const next: string[] = [];
      for (let i = 0; i < cur.length; i += 2) {
        next.push(this.hashNode(cur[i], i + 1 < cur.length ? cur[i + 1] : cur[i]));
      }
      levels.push(next);
      cur = next;
    }
    return { root: cur[0], levels };
  }

  public computeHeaderHash(
    batchSeq: number,
    utcTimestampMs: number,
    anchorBlockHeight: number,
    previousHeaderHash: string,
    docMerkleRoot: string,
    documentCount: number,
  ): string {
    return sha256Hex(
      'NOTARY-HEADER-V1',
      this.networkId,
      String(batchSeq),
      String(utcTimestampMs),
      String(anchorBlockHeight),
      previousHeaderHash,
      docMerkleRoot,
      String(documentCount),
    );
  }

  private signHeader(notary: NotaryAuthoritySigner, headerHash: string): NotaryAttestation {
    const k = randomScalar();
    const sigR = modPow(BASE_G, k, SAFE_PRIME_P);
    const c = hashToScalar('NOTARY-SIG-V1', sigR.toString(16), notary.publicKey.toString(16), headerHash);
    return { notaryId: notary.notaryId, sigR, sigS: modScalar(k + c * notary.secretKey) };
  }

  private verifyAttestation(pubKey: bigint, headerHash: string, att: NotaryAttestation): boolean {
    const c = hashToScalar('NOTARY-SIG-V1', att.sigR.toString(16), pubKey.toString(16), headerHash);
    return modPow(BASE_G, att.sigS, SAFE_PRIME_P) === (att.sigR * modPow(pubKey, c, SAFE_PRIME_P)) % SAFE_PRIME_P;
  }

  public stampDocumentBatch(params: {
    documents: Array<{ documentId: string; content: string }>;
    utcTimestampMs: number;
    anchorBlockHeight: number;
    signingNotaries: NotaryAuthoritySigner[];
  }): { header: ThresholdTimestampHeader; receipts: Record<string, DocumentTimestampReceipt>; rejectedNotaries: string[] } {
    if (params.documents.length === 0) throw new Error('Document batch cannot be empty');
    const prev = this.headers.length > 0 ? this.headers[this.headers.length - 1] : null;
    if (prev && (params.utcTimestampMs < prev.utcTimestampMs || params.anchorBlockHeight < prev.anchorBlockHeight)) {
      throw new Error('Timestamp and anchorBlockHeight must be monotonically non-decreasing');
    }

    const hashedDocs = params.documents.map((d) => ({
      documentId: d.documentId,
      documentHash: this.hashDocument(d.content),
    }));
    const { root: docMerkleRoot, levels } = this.buildMerkle(hashedDocs);

    const batchSeq = this.headers.length;
    const previousHeaderHash = prev ? prev.headerHash : this.genesisHeaderHash;
    const headerHash = this.computeHeaderHash(
      batchSeq,
      params.utcTimestampMs,
      params.anchorBlockHeight,
      previousHeaderHash,
      docMerkleRoot,
      hashedDocs.length,
    );

    const seen = new Set<string>();
    const attestations: NotaryAttestation[] = [];
    const rejectedNotaries: string[] = [];

    for (const notary of params.signingNotaries) {
      const regPub = this.notaries.get(notary.notaryId);
      if (!regPub || regPub !== notary.publicKey || seen.has(notary.notaryId)) {
        rejectedNotaries.push(notary.notaryId);
        continue;
      }
      seen.add(notary.notaryId);
      attestations.push(this.signHeader(notary, headerHash));
    }

    if (attestations.length < this.quorumThreshold) {
      throw new Error(`Insufficient notary attestations: ${attestations.length} < ${this.quorumThreshold}`);
    }

    const header: ThresholdTimestampHeader = {
      networkId: this.networkId,
      batchSeq,
      utcTimestampMs: params.utcTimestampMs,
      anchorBlockHeight: params.anchorBlockHeight,
      previousHeaderHash,
      docMerkleRoot,
      documentCount: hashedDocs.length,
      headerHash,
      attestations,
    };
    this.headers.push(header);

    const receipts: Record<string, DocumentTimestampReceipt> = {};
    for (let idx = 0; idx < hashedDocs.length; idx++) {
      const merklePath: Array<{ direction: 'left' | 'right'; hash: string }> = [];
      let pos = idx;
      for (let lvl = 0; lvl < levels.length - 1; lvl++) {
        const arr = levels[lvl];
        const isRight = pos % 2 === 1;
        const sibPos = isRight ? pos - 1 : (pos + 1 < arr.length ? pos + 1 : pos);
        merklePath.push({ direction: isRight ? 'left' : 'right', hash: arr[sibPos] });
        pos >>= 1;
      }
      receipts[hashedDocs[idx].documentId] = {
        documentId: hashedDocs[idx].documentId,
        documentHash: hashedDocs[idx].documentHash,
        leafIndex: idx,
        merklePath,
        header,
      };
    }

    return { header, receipts, rejectedNotaries };
  }

  public verifyHeader(header: ThresholdTimestampHeader): boolean {
    if (header.networkId !== this.networkId || header.documentCount < 1) return false;
    const expectedHash = this.computeHeaderHash(
      header.batchSeq,
      header.utcTimestampMs,
      header.anchorBlockHeight,
      header.previousHeaderHash,
      header.docMerkleRoot,
      header.documentCount,
    );
    if (expectedHash !== header.headerHash) return false;

    const seen = new Set<string>();
    for (const att of header.attestations) {
      const pub = this.notaries.get(att.notaryId);
      if (!pub || seen.has(att.notaryId)) return false;
      if (!this.verifyAttestation(pub, header.headerHash, att)) return false;
      seen.add(att.notaryId);
    }
    return seen.size >= this.quorumThreshold;
  }

  public verifyReceipt(receipt: DocumentTimestampReceipt, rawDocumentContent?: string): boolean {
    if (!this.verifyHeader(receipt.header)) return false;
    if (rawDocumentContent !== undefined && this.hashDocument(rawDocumentContent) !== receipt.documentHash) {
      return false;
    }
    let cur = this.hashLeaf(receipt.documentId, receipt.documentHash);
    for (const step of receipt.merklePath) {
      cur = step.direction === 'left'
        ? this.hashNode(step.hash, cur)
        : this.hashNode(cur, step.hash);
    }
    return cur === receipt.header.docMerkleRoot;
  }

  public verifyTimestampChain(headers: ThresholdTimestampHeader[]): boolean {
    if (headers.length === 0) return false;
    for (let i = 0; i < headers.length; i++) {
      const h = headers[i];
      if (!this.verifyHeader(h)) return false;
      if (h.batchSeq === 0 && h.previousHeaderHash !== this.genesisHeaderHash) return false;
      if (i > 0) {
        const prev = headers[i - 1];
        if (
          h.batchSeq !== prev.batchSeq + 1 ||
          h.previousHeaderHash !== prev.headerHash ||
          h.utcTimestampMs < prev.utcTimestampMs ||
          h.anchorBlockHeight < prev.anchorBlockHeight
        ) {
          return false;
        }
      }
    }
    return true;
  }

  public serializeReceipt(receipt: DocumentTimestampReceipt): string {
    return JSON.stringify({
      documentId: receipt.documentId,
      documentHash: receipt.documentHash,
      batchSeq: receipt.header.batchSeq,
      utcTimestampMs: receipt.header.utcTimestampMs,
      notaryCount: receipt.header.attestations.length,
    });
  }
}
