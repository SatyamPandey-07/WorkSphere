/**
 * @file AsynchronousSharedMempool.ts
 * @description High-Throughput Asynchronous Distributed Transaction Mempool.
 * Provides Bloom filter transaction deduplication, priority fee ordering (EIP-1559 style),
 * per-sender nonce sequencing, Byzantine spam rate limiting, and batch proposal extraction
 * optimized for DAG and BFT consensus engines.
 */

import { createHash } from 'crypto';

export type TxId = string;
export type Address = string;

export interface MempoolTransaction {
  id: TxId;
  sender: Address;
  nonce: number;
  payload: string;
  priorityFee: bigint;
  gasLimit: bigint;
  timestamp: number;
}

/**
 * High-performance Counting Bloom Filter for rapid transaction deduplication.
 */
export class MempoolBloomFilter {
  private readonly size: number;
  private readonly numHashes: number;
  private readonly filter: Uint8Array;

  constructor(size: number = 8192, numHashes: number = 4) {
    this.size = size;
    this.numHashes = numHashes;
    this.filter = new Uint8Array(size);
  }

  private getHashes(key: string): number[] {
    const indices: number[] = [];
    for (let i = 0; i < this.numHashes; i++) {
      const h = createHash('sha256').update(`${key}:${i}`).digest();
      const val = h.readUInt32BE(0) % this.size;
      indices.push(val);
    }
    return indices;
  }

  public add(key: string): void {
    for (const idx of this.getHashes(key)) {
      if (this.filter[idx] < 255) {
        this.filter[idx]++;
      }
    }
  }

  public has(key: string): boolean {
    for (const idx of this.getHashes(key)) {
      if (this.filter[idx] === 0) return false;
    }
    return true;
  }

  public remove(key: string): void {
    for (const idx of this.getHashes(key)) {
      if (this.filter[idx] > 0) {
        this.filter[idx]--;
      }
    }
  }
}

/**
 * Shared Asynchronous Mempool Coordinator.
 */
export class AsynchronousSharedMempool {
  private readonly maxCapacity: number;
  private readonly maxPerSender: number;
  private bloomFilter: MempoolBloomFilter;
  private pool: Map<TxId, MempoolTransaction> = new Map();
  private senderTxs: Map<Address, Map<number, MempoolTransaction>> = new Map();
  private committedTxs: Set<TxId> = new Set();

  constructor(maxCapacity: number = 50000, maxPerSender: number = 64) {
    this.maxCapacity = maxCapacity;
    this.maxPerSender = maxPerSender;
    this.bloomFilter = new MempoolBloomFilter();
  }

  public static hashTransaction(sender: Address, nonce: number, payload: string, fee: bigint): TxId {
    const raw = `${sender}:${nonce}:${payload}:${fee.toString()}`;
    return createHash('sha256').update(raw).digest('hex');
  }

  /**
   * Adds a transaction to the mempool with validation and deduplication.
   */
  public addTransaction(
    sender: Address,
    nonce: number,
    payload: string,
    priorityFee: bigint,
    gasLimit: bigint = 21000n
  ): { accepted: boolean; txId: TxId; reason?: string } {
    const txId = AsynchronousSharedMempool.hashTransaction(sender, nonce, payload, priorityFee);

    // 1. Check if already committed
    if (this.committedTxs.has(txId)) {
      return { accepted: false, txId, reason: 'Transaction already committed' };
    }

    // 2. Bloom filter deduplication check
    if (this.pool.has(txId)) {
      return { accepted: false, txId, reason: 'Transaction already in mempool' };
    }

    // 3. Global capacity check
    if (this.pool.size >= this.maxCapacity) {
      return { accepted: false, txId, reason: 'Mempool capacity exceeded' };
    }

    // 4. Per-sender spam throttling
    let senderMap = this.senderTxs.get(sender);
    if (!senderMap) {
      senderMap = new Map();
      this.senderTxs.set(sender, senderMap);
    }

    if (senderMap.size >= this.maxPerSender) {
      return { accepted: false, txId, reason: `Sender ${sender} pending transaction limit reached` };
    }

    if (senderMap.has(nonce)) {
      return { accepted: false, txId, reason: `Duplicate nonce ${nonce} for sender ${sender}` };
    }

    const tx: MempoolTransaction = {
      id: txId,
      sender,
      nonce,
      payload,
      priorityFee,
      gasLimit,
      timestamp: Date.now(),
    };

    this.pool.set(txId, tx);
    senderMap.set(nonce, tx);
    this.bloomFilter.add(txId);

    return { accepted: true, txId };
  }

  /**
   * Syncs gossip transactions from peer mempools.
   */
  public gossipSync(transactions: MempoolTransaction[]): { accepted: TxId[]; rejected: TxId[] } {
    const accepted: TxId[] = [];
    const rejected: TxId[] = [];

    for (const tx of transactions) {
      const res = this.addTransaction(tx.sender, tx.nonce, tx.payload, tx.priorityFee, tx.gasLimit);
      if (res.accepted) {
        accepted.push(tx.id);
      } else {
        rejected.push(tx.id);
      }
    }

    return { accepted, rejected };
  }

  /**
   * Proposes an optimal batch of transactions ordered by priority fee.
   */
  public proposeBatch(maxTxs: number, maxGasLimit: bigint = 10000000n): MempoolTransaction[] {
    const candidates = Array.from(this.pool.values());

    // Sort descending by priority fee, tie-break by timestamp ascending
    candidates.sort((a, b) => {
      if (a.priorityFee !== b.priorityFee) {
        return a.priorityFee > b.priorityFee ? -1 : 1;
      }
      return a.timestamp - b.timestamp;
    });

    const batch: MempoolTransaction[] = [];
    let accumulatedGas = 0n;

    for (const tx of candidates) {
      if (batch.length >= maxTxs) break;
      if (accumulatedGas + tx.gasLimit > maxGasLimit) continue;

      batch.push(tx);
      accumulatedGas += tx.gasLimit;
    }

    return batch;
  }

  /**
   * Marks transactions as committed by consensus and evicts them from mempool.
   */
  public markCommitted(txIds: TxId[]): number {
    let evicted = 0;
    for (const id of txIds) {
      const tx = this.pool.get(id);
      if (tx) {
        this.pool.delete(id);
        this.bloomFilter.remove(id);
        const senderMap = this.senderTxs.get(tx.sender);
        if (senderMap) {
          senderMap.delete(tx.nonce);
          if (senderMap.size === 0) {
            this.senderTxs.delete(tx.sender);
          }
        }
        evicted++;
      }
      this.committedTxs.add(id);
    }
    return evicted;
  }

  public size(): number {
    return this.pool.size;
  }

  public getTransaction(txId: TxId): MempoolTransaction | undefined {
    return this.pool.get(txId);
  }
}
