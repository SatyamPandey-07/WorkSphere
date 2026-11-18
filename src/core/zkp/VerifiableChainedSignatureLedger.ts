import { createHash, randomBytes } from 'node:crypto';

/**
 * Verifiable Chained Schnorr Signature Ledger & Checkpoint Prover.
 *
 * Implements a tamper-evident hash-chained signed transaction ledger with:
 *  - Schnorr-signed transactions carrying monotonic per-account nonces (anti-replay)
 *  - Deterministic block assembly with Merkle transaction roots and hash-chained block headers
 *  - Compact light-client block-range proof certificates + transaction inclusion proofs
 *  - Cryptographic equivocation/fork detection if a sequencer signs two conflicting blocks
 *    at the same block height!
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

export interface LedgerKeyPair {
  accountId: string;
  secretKey: bigint;
  publicKey: bigint;
}

export interface SignedLedgerTx {
  txId: string;
  senderId: string;
  senderPubKey: bigint;
  recipientId: string;
  amount: bigint;
  nonce: number;
  txDigest: string;
  sigR: bigint;
  sigS: bigint;
}

export interface LedgerBlockHeader {
  chainId: string;
  height: number;
  previousBlockHash: string;
  txMerkleRoot: string;
  txCount: number;
  sequencerPubKey: bigint;
  blockHash: string;
  seqSigR: bigint;
  seqSigS: bigint;
}

export interface LedgerBlock {
  header: LedgerBlockHeader;
  transactions: SignedLedgerTx[];
}

export interface TxInclusionProof {
  blockHash: string;
  blockHeight: number;
  txIndex: number;
  tx: SignedLedgerTx;
  path: Array<{ direction: 'left' | 'right'; hash: string }>;
  txMerkleRoot: string;
}

export interface SequencerForkProof {
  height: number;
  headerA: LedgerBlockHeader;
  headerB: LedgerBlockHeader;
}

export class VerifiableChainedSignatureLedger {
  public readonly chainId: string;
  public readonly genesisHash: string;
  private readonly sequencer: LedgerKeyPair;
  private blocks: LedgerBlock[] = [];
  private accountNonces = new Map<string, number>();

  constructor(chainId: string, sequencer?: LedgerKeyPair) {
    this.chainId = chainId;
    this.genesisHash = sha256Hex('LEDGER-GENESIS-V1', chainId);
    this.sequencer = sequencer ?? this.generateAccount('sequencer-0');
  }

  public getSequencerPublicKey(): bigint {
    return this.sequencer.publicKey;
  }

  public generateAccount(accountId: string): LedgerKeyPair {
    const secretKey = randomScalar();
    return { accountId, secretKey, publicKey: modPow(BASE_G, secretKey, SAFE_PRIME_P) };
  }

  private signDigest(secretKey: bigint, publicKey: bigint, domain: string, digest: string): { sigR: bigint; sigS: bigint } {
    const k = randomScalar();
    const sigR = modPow(BASE_G, k, SAFE_PRIME_P);
    const c = hashToScalar(domain, sigR.toString(16), publicKey.toString(16), digest);
    return { sigR, sigS: modScalar(k + c * secretKey) };
  }

  private verifySig(publicKey: bigint, domain: string, digest: string, sigR: bigint, sigS: bigint): boolean {
    const c = hashToScalar(domain, sigR.toString(16), publicKey.toString(16), digest);
    return modPow(BASE_G, sigS, SAFE_PRIME_P) === (sigR * modPow(publicKey, c, SAFE_PRIME_P)) % SAFE_PRIME_P;
  }

  public computeTxDigest(senderId: string, senderPubKey: bigint, recipientId: string, amount: bigint, nonce: number): string {
    return sha256Hex('LEDGER-TX-V1', this.chainId, senderId, senderPubKey.toString(16), recipientId, amount.toString(), String(nonce));
  }

  public createSignedTx(sender: LedgerKeyPair, recipientId: string, amount: bigint, nonce: number): SignedLedgerTx {
    if (amount <= 0n || nonce < 0) throw new RangeError('Amount must be > 0 and nonce >= 0');
    const txDigest = this.computeTxDigest(sender.accountId, sender.publicKey, recipientId, amount, nonce);
    const { sigR, sigS } = this.signDigest(sender.secretKey, sender.publicKey, 'LEDGER-TX-SIG', txDigest);
    return {
      txId: txDigest.slice(0, 16),
      senderId: sender.accountId,
      senderPubKey: sender.publicKey,
      recipientId,
      amount,
      nonce,
      txDigest,
      sigR,
      sigS,
    };
  }

  public verifySignedTx(tx: SignedLedgerTx): boolean {
    if (tx.amount <= 0n || tx.nonce < 0) return false;
    const expected = this.computeTxDigest(tx.senderId, tx.senderPubKey, tx.recipientId, tx.amount, tx.nonce);
    if (expected !== tx.txDigest) return false;
    return this.verifySig(tx.senderPubKey, 'LEDGER-TX-SIG', tx.txDigest, tx.sigR, tx.sigS);
  }

  private buildMerkle(digests: string[]): { root: string; levels: string[][] } {
    if (digests.length === 0) {
      const empty = sha256Hex('LEDGER-EMPTY-TXS');
      return { root: empty, levels: [[empty]] };
    }
    const levels: string[][] = [digests.map((d) => sha256Hex('LEDGER-LEAF', d))];
    let cur = levels[0];
    while (cur.length > 1) {
      const next: string[] = [];
      for (let i = 0; i < cur.length; i += 2) {
        next.push(sha256Hex('LEDGER-NODE', cur[i], i + 1 < cur.length ? cur[i + 1] : cur[i]));
      }
      levels.push(next);
      cur = next;
    }
    return { root: cur[0], levels };
  }

  public computeBlockHash(
    height: number,
    previousBlockHash: string,
    txMerkleRoot: string,
    txCount: number,
    sequencerPubKey: bigint,
  ): string {
    return sha256Hex(
      'LEDGER-BLOCK-V1',
      this.chainId,
      String(height),
      previousBlockHash,
      txMerkleRoot,
      String(txCount),
      sequencerPubKey.toString(16),
    );
  }

  public appendBlock(candidateTxs: SignedLedgerTx[]): { block: LedgerBlock; rejectedTxIds: string[] } {
    const validTxs: SignedLedgerTx[] = [];
    const rejectedTxIds: string[] = [];
    const tempNonces = new Map(this.accountNonces);

    for (const tx of candidateTxs) {
      const expectedNonce = tempNonces.get(tx.senderId) ?? 0;
      if (!this.verifySignedTx(tx) || tx.nonce !== expectedNonce) {
        rejectedTxIds.push(tx.txId);
        continue;
      }
      tempNonces.set(tx.senderId, expectedNonce + 1);
      validTxs.push(tx);
    }

    if (validTxs.length === 0) throw new Error('Cannot append block with zero valid transactions');

    this.accountNonces = tempNonces;
    const height = this.blocks.length;
    const previousBlockHash = height === 0 ? this.genesisHash : this.blocks[height - 1].header.blockHash;
    const { root: txMerkleRoot } = this.buildMerkle(validTxs.map((t) => t.txDigest));
    const blockHash = this.computeBlockHash(height, previousBlockHash, txMerkleRoot, validTxs.length, this.sequencer.publicKey);
    const { sigR: seqSigR, sigS: seqSigS } = this.signDigest(this.sequencer.secretKey, this.sequencer.publicKey, 'LEDGER-BLK-SIG', blockHash);

    const header: LedgerBlockHeader = {
      chainId: this.chainId,
      height,
      previousBlockHash,
      txMerkleRoot,
      txCount: validTxs.length,
      sequencerPubKey: this.sequencer.publicKey,
      blockHash,
      seqSigR,
      seqSigS,
    };
    const block: LedgerBlock = { header, transactions: validTxs };
    this.blocks.push(block);
    return { block, rejectedTxIds };
  }

  public verifyHeader(header: LedgerBlockHeader): boolean {
    if (header.chainId !== this.chainId || header.sequencerPubKey !== this.sequencer.publicKey) return false;
    const expectedHash = this.computeBlockHash(
      header.height,
      header.previousBlockHash,
      header.txMerkleRoot,
      header.txCount,
      header.sequencerPubKey,
    );
    if (expectedHash !== header.blockHash) return false;
    return this.verifySig(header.sequencerPubKey, 'LEDGER-BLK-SIG', header.blockHash, header.seqSigR, header.seqSigS);
  }

  public verifyHeaderRange(headers: LedgerBlockHeader[]): boolean {
    if (headers.length === 0) return false;
    for (let i = 0; i < headers.length; i++) {
      const h = headers[i];
      if (!this.verifyHeader(h)) return false;
      if (h.height === 0 && h.previousBlockHash !== this.genesisHash) return false;
      if (i > 0) {
        const prev = headers[i - 1];
        if (h.height !== prev.height + 1 || h.previousBlockHash !== prev.blockHash) return false;
      }
    }
    return true;
  }

  public proveTxInclusion(height: number, txIndex: number): TxInclusionProof {
    const blk = this.blocks[height];
    if (!blk) throw new RangeError(`Block height ${height} not found`);
    if (txIndex < 0 || txIndex >= blk.transactions.length) throw new RangeError('Transaction index out of bounds');

    const { levels } = this.buildMerkle(blk.transactions.map((t) => t.txDigest));
    const path: Array<{ direction: 'left' | 'right'; hash: string }> = [];
    let pos = txIndex;
    for (let lvl = 0; lvl < levels.length - 1; lvl++) {
      const arr = levels[lvl];
      const isRight = pos % 2 === 1;
      const sibPos = isRight ? pos - 1 : (pos + 1 < arr.length ? pos + 1 : pos);
      path.push({ direction: isRight ? 'left' : 'right', hash: arr[sibPos] });
      pos >>= 1;
    }

    return {
      blockHash: blk.header.blockHash,
      blockHeight: height,
      txIndex,
      tx: blk.transactions[txIndex],
      path,
      txMerkleRoot: blk.header.txMerkleRoot,
    };
  }

  public verifyTxInclusion(proof: TxInclusionProof, trustedHeader: LedgerBlockHeader): boolean {
    if (!this.verifyHeader(trustedHeader)) return false;
    if (proof.blockHash !== trustedHeader.blockHash || proof.txMerkleRoot !== trustedHeader.txMerkleRoot) return false;
    if (!this.verifySignedTx(proof.tx)) return false;

    let cur = sha256Hex('LEDGER-LEAF', proof.tx.txDigest);
    for (const step of proof.path) {
      cur = step.direction === 'left'
        ? sha256Hex('LEDGER-NODE', step.hash, cur)
        : sha256Hex('LEDGER-NODE', cur, step.hash);
    }
    return cur === trustedHeader.txMerkleRoot;
  }

  public verifySequencerForkProof(fork: SequencerForkProof): boolean {
    if (fork.headerA.height !== fork.height || fork.headerB.height !== fork.height) return false;
    if (fork.headerA.blockHash === fork.headerB.blockHash) return false;
    return this.verifyHeader(fork.headerA) && this.verifyHeader(fork.headerB);
  }

  public createConflictingHeaderForAudit(height: number, previousBlockHash: string, altRoot: string): LedgerBlockHeader {
    const blockHash = this.computeBlockHash(height, previousBlockHash, altRoot, 1, this.sequencer.publicKey);
    const { sigR: seqSigR, sigS: seqSigS } = this.signDigest(this.sequencer.secretKey, this.sequencer.publicKey, 'LEDGER-BLK-SIG', blockHash);
    return {
      chainId: this.chainId,
      height,
      previousBlockHash,
      txMerkleRoot: altRoot,
      txCount: 1,
      sequencerPubKey: this.sequencer.publicKey,
      blockHash,
      seqSigR,
      seqSigS,
    };
  }

  public serializeHeader(h: LedgerBlockHeader): string {
    return JSON.stringify({
      chainId: h.chainId,
      height: h.height,
      txCount: h.txCount,
      blockHash: h.blockHash,
    });
  }
}
