/**
 * @file ZeroKnowledgeMerkleLogRollupProver.ts
 * @description Batched State-Transition Rollup Prover with Merkle State Roots, Strict Account Nonce
 * Enforcement, Balance Conservation Proofs, Per-Batch Cryptographic Witness Digests, Fraud-Proof
 * Bisection Auditing, and Portable JSON Serialization.
 */

import { createHash } from 'node:crypto';

export interface RollupAccount {
  accountId: string;
  balance: bigint;
  nonce: number;
}

export interface RollupTransferTx {
  txId: string;
  fromAccountId: string;
  toAccountId: string;
  amount: bigint;
  fee: bigint;
  nonce: number;
}

export interface RollupBatchProof {
  batchId: string;
  batchNumber: number;
  preStateRoot: string;
  postStateRoot: string;
  txCount: number;
  transactions: RollupTransferTx[];
  intermediateRoots: string[]; // root after every tx for O(log k) fraud bisection!
  totalFeesCollected: bigint;
  totalSupplyInvariant: bigint;
  txListRoot: string;
  batchDigest: string;
}

function sha256Hex(data: string): string {
  return createHash('sha256').update(data).digest('hex');
}

function hashAccountLeaf(acc: RollupAccount): string {
  return sha256Hex(`WorkSphere::RollupAcct|${acc.accountId}|bal:${acc.balance}|n:${acc.nonce}`);
}

function hashPair(left: string, right: string): string {
  return createHash('sha256')
    .update('\x01')
    .update(Buffer.from(left, 'hex'))
    .update(Buffer.from(right, 'hex'))
    .digest('hex');
}

function computeMerkleRoot(hashes: readonly string[]): string {
  if (hashes.length === 0) return sha256Hex('WorkSphere::RollupEmpty');
  let level = [...hashes];
  while (level.length > 1) {
    const next: string[] = [];
    for (let i = 0; i < level.length; i += 2) {
      const left = level[i];
      const right = level[i + 1] ?? left;
      next.push(hashPair(left, right));
    }
    level = next;
  }
  return level[0];
}

/**
 * Deterministic Verifiable State-Transition Rollup Sequencer & Fraud-Proof Verifier.
 */
export class ZeroKnowledgeMerkleLogRollupProver {
  private readonly accounts: Map<string, RollupAccount> = new Map();
  private readonly feeCollectorId: string;
  private batchCounter = 0;

  constructor(feeCollectorId = 'treasury:fees') {
    this.feeCollectorId = feeCollectorId;
    this.accounts.set(feeCollectorId, { accountId: feeCollectorId, balance: 0n, nonce: 0 });
  }

  public initAccount(accountId: string, initialBalance: bigint): void {
    if (initialBalance < 0n) throw new RangeError('Initial balance must be non-negative');
    if (this.accounts.has(accountId)) throw new Error(`Account ${accountId} already exists`);
    this.accounts.set(accountId, { accountId, balance: initialBalance, nonce: 0 });
  }

  public getAccount(accountId: string): RollupAccount | undefined {
    const a = this.accounts.get(accountId);
    return a ? { ...a } : undefined;
  }

  public computeStateRootFromMap(stateMap: ReadonlyMap<string, RollupAccount>): string {
    const sortedKeys = Array.from(stateMap.keys()).sort();
    const leaves = sortedKeys.map((k) => hashAccountLeaf(stateMap.get(k)!));
    return computeMerkleRoot(leaves);
  }

  public getStateRoot(): string {
    return this.computeStateRootFromMap(this.accounts);
  }

  public getTotalSupply(stateMap: ReadonlyMap<string, RollupAccount> = this.accounts): bigint {
    let total = 0n;
    for (const acc of stateMap.values()) total += acc.balance;
    return total;
  }

  public snapshotAccounts(): Map<string, RollupAccount> {
    const copy = new Map<string, RollupAccount>();
    for (const [k, v] of this.accounts.entries()) copy.set(k, { ...v });
    return copy;
  }

  private applyTxOnMap(stateMap: Map<string, RollupAccount>, tx: RollupTransferTx): void {
    if (tx.amount < 0n || tx.fee < 0n) throw new RangeError(`Negative amount/fee in ${tx.txId}`);
    if (tx.fromAccountId === tx.toAccountId) throw new Error(`Self-transfer disallowed in ${tx.txId}`);

    const sender = stateMap.get(tx.fromAccountId);
    const receiver = stateMap.get(tx.toAccountId);
    const collector = stateMap.get(this.feeCollectorId);
    if (!sender || !receiver || !collector) {
      throw new Error(`Unknown account referenced in ${tx.txId}`);
    }
    if (sender.nonce !== tx.nonce) {
      throw new Error(`Invalid nonce for ${tx.fromAccountId}: expected ${sender.nonce}, got ${tx.nonce}`);
    }
    const totalDebit = tx.amount + tx.fee;
    if (sender.balance < totalDebit) {
      throw new Error(`Insufficient balance for ${tx.fromAccountId} in ${tx.txId}`);
    }

    sender.balance -= totalDebit;
    sender.nonce += 1;
    receiver.balance += tx.amount;
    collector.balance += tx.fee;
  }

  /**
   * Executes a batch of transfer transactions atomically, checks global supply conservation,
   * records per-tx intermediate roots for bisection fraud proofs, and emits a RollupBatchProof.
   */
  public executeRollupBatch(
    batchId: string,
    transactions: readonly RollupTransferTx[]
  ): RollupBatchProof {
    if (transactions.length === 0) throw new Error('Rollup batch must contain at least one transaction');
    const preStateRoot = this.getStateRoot();
    const preSupply = this.getTotalSupply();

    // Execute on staging copy so failed batches leave state untouched (atomic!)
    const staged = this.snapshotAccounts();
    const intermediateRoots: string[] = [];
    let totalFeesCollected = 0n;

    for (const tx of transactions) {
      this.applyTxOnMap(staged, tx);
      totalFeesCollected += tx.fee;
      intermediateRoots.push(this.computeStateRootFromMap(staged));
    }

    const postSupply = this.getTotalSupply(staged);
    if (postSupply !== preSupply) {
      throw new Error('Critical rollup invariant violation: total supply mutated');
    }

    // Commit staged state
    this.accounts.clear();
    for (const [k, v] of staged.entries()) this.accounts.set(k, v);
    this.batchCounter += 1;

    const postStateRoot = intermediateRoots[intermediateRoots.length - 1];
    const txListRoot = computeMerkleRoot(
      transactions.map((tx) =>
        sha256Hex(`${tx.txId}|${tx.fromAccountId}->${tx.toAccountId}|${tx.amount}|f:${tx.fee}|n:${tx.nonce}`)
      )
    );
    const batchDigest = sha256Hex(
      `WorkSphere::RollupBatch|${batchId}|#${this.batchCounter}|${preStateRoot}->${postStateRoot}|${txListRoot}`
    );

    return {
      batchId,
      batchNumber: this.batchCounter,
      preStateRoot,
      postStateRoot,
      txCount: transactions.length,
      transactions: transactions.map((t) => ({ ...t })),
      intermediateRoots,
      totalFeesCollected,
      totalSupplyInvariant: postSupply,
      txListRoot,
      batchDigest,
    };
  }

  /**
   * Independent light-verifier / fraud-proof challenger: replays `batch` from a pre-state snapshot
   * and pinpoints the EXACT first fraudulent transaction index if any intermediate root diverges!
   */
  public verifyAndLocateFraud(
    preStateSnapshot: ReadonlyMap<string, RollupAccount>,
    batch: RollupBatchProof
  ): { valid: boolean; firstDivergentTxIndex?: number; reason?: string } {
    if (this.computeStateRootFromMap(preStateSnapshot) !== batch.preStateRoot) {
      return { valid: false, reason: 'Pre-state snapshot does not match batch.preStateRoot' };
    }
    if (batch.transactions.length !== batch.txCount || batch.intermediateRoots.length !== batch.txCount) {
      return { valid: false, reason: 'Batch transaction or intermediate root count mismatch' };
    }

    const replay = new Map<string, RollupAccount>();
    for (const [k, v] of preStateSnapshot.entries()) replay.set(k, { ...v });
    let fees = 0n;

    for (let i = 0; i < batch.transactions.length; i++) {
      try {
        this.applyTxOnMap(replay, batch.transactions[i]);
      } catch (e) {
        return { valid: false, firstDivergentTxIndex: i, reason: (e as Error).message };
      }
      fees += batch.transactions[i].fee;
      const expectedRoot = this.computeStateRootFromMap(replay);
      if (expectedRoot !== batch.intermediateRoots[i]) {
        return {
          valid: false,
          firstDivergentTxIndex: i,
          reason: `Fraudulent intermediate state root detected at tx index ${i}`,
        };
      }
    }

    const finalRoot = this.computeStateRootFromMap(replay);
    if (finalRoot !== batch.postStateRoot) {
      return { valid: false, reason: 'Final postStateRoot mismatch' };
    }
    if (fees !== batch.totalFeesCollected || this.getTotalSupply(replay) !== batch.totalSupplyInvariant) {
      return { valid: false, reason: 'Fee total or supply conservation invariant mismatch' };
    }

    return { valid: true };
  }

  public serializeBatchProof(batch: RollupBatchProof): string {
    return JSON.stringify({
      ...batch,
      totalFeesCollected: batch.totalFeesCollected.toString(),
      totalSupplyInvariant: batch.totalSupplyInvariant.toString(),
      transactions: batch.transactions.map((t) => ({
        ...t,
        amount: t.amount.toString(),
        fee: t.fee.toString(),
      })),
    });
  }

  public deserializeBatchProof(payload: string): RollupBatchProof {
    const raw = JSON.parse(payload) as Record<string, any>;
    return {
      ...raw,
      totalFeesCollected: BigInt(raw.totalFeesCollected),
      totalSupplyInvariant: BigInt(raw.totalSupplyInvariant),
      transactions: raw.transactions.map((t: Record<string, any>) => ({
        ...t,
        amount: BigInt(t.amount),
        fee: BigInt(t.fee),
      })),
    } as RollupBatchProof;
  }
}
