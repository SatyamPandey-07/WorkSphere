import path from "path";
import fs from "fs";
import { verifyMembershipProof, ZkProofPayload } from "./verify";
import { poseidonHash } from "./poseidon";
import {
  isUniversityMerkleRootActive,
  proveStudentMembership,
  type StudentMembershipProofInput,
} from "./studentMembership";
import { prisma } from "@/lib/prisma";

export interface MultiVenueBatchProofItem {
  venueId: string;
  proof: ZkProofPayload["proof"];
  publicSignals: string[];
  signature?: string;
}

export interface MultiVenueBatchVerifyRequest {
  clusterId: string;
  clusterMerkleRoot: string;
  venueProofs: MultiVenueBatchProofItem[];
}

export interface MultiVenueBatchVerifyResponse {
  valid: boolean;
  verifiedCount: number;
  totalCount: number;
  results: {
    index: number;
    venueId: string;
    valid: boolean;
    error?: string;
  }[];
  clusterHash: string;
}

export interface BatchStudentDiscountItem {
  id?: string;
  studentId?: string;
  userId?: string;
  proof: any;
  publicSignals: string[];
  nullifierHash?: string;
  root?: string;
  epoch?: number | string;
  witness?: string;
}

export interface BatchStudentDiscountRequest {
  institutionId?: string;
  epoch?: number | string;
  items?: BatchStudentDiscountItem[];
  studentProofs?: BatchStudentDiscountItem[];
}

export interface BatchStudentDiscountResultItem {
  index: number;
  id?: string;
  userId?: string;
  studentId?: string;
  valid: boolean;
  nullifierHash?: string;
  discountEligible: boolean;
  discountCode?: string;
  discountPercentage?: number;
  error?: string;
}

export interface BatchStudentDiscountResponse {
  valid: boolean;
  verifiedCount: number;
  failedCount: number;
  totalCount: number;
  results: BatchStudentDiscountResultItem[];
  batchHash: string;
}

export interface GenericBatchProofItem {
  id?: string;
  proof: any;
  publicSignals: string[];
}

export interface GenericBatchProofResultItem {
  index: number;
  id?: string;
  valid: boolean;
  error?: string;
}

export interface GenericBatchVerifyResponse {
  valid: boolean;
  verifiedCount: number;
  failedCount: number;
  totalCount: number;
  results: GenericBatchProofResultItem[];
}

export function computeClusterMerkleHash(venueIds: string[]): string {
  if (!venueIds || venueIds.length === 0) return "0";
  const sorted = [...venueIds].sort();
  const hashes = sorted.map((id) =>
    poseidonHash([BigInt(id.replace(/\D/g, "") || "1")]),
  );
  return hashes
    .reduce((acc, h) => poseidonHash([BigInt(acc), BigInt(h)]).toString(), "0");
}

export async function verifyMultiVenueBatchProofs(
  request: MultiVenueBatchVerifyRequest,
): Promise<MultiVenueBatchVerifyResponse> {
  const results: { index: number; venueId: string; valid: boolean; error?: string }[] = [];
  let verifiedCount = 0;

  for (let index = 0; index < request.venueProofs.length; index++) {
    const item = request.venueProofs[index];
    try {
      if (!item || !item.proof || !item.publicSignals || !Array.isArray(item.publicSignals)) {
        results.push({
          index,
          venueId: item?.venueId || `venue-${index}`,
          valid: false,
          error: "Missing or malformed proof payload",
        });
        continue;
      }

      const isValid = await verifyMembershipProof(
        item.proof,
        item.publicSignals,
      );
      if (isValid) {
        verifiedCount++;
        results.push({ index, venueId: item.venueId, valid: true });
      } else {
        results.push({
          index,
          venueId: item.venueId,
          valid: false,
          error: "Invalid ZK proof",
        });
      }
    } catch (err: any) {
      results.push({
        index,
        venueId: item?.venueId || `venue-${index}`,
        valid: false,
        error: err?.message || "Verification failed",
      });
    }
  }

  const clusterHash = computeClusterMerkleHash(
    request.venueProofs.map((v) => v.venueId),
  );

  return {
    valid:
      verifiedCount === request.venueProofs.length &&
      request.venueProofs.length > 0,
    verifiedCount,
    totalCount: request.venueProofs.length,
    results,
    clusterHash,
  };
}

/**
 * Verifies an arbitrary batch of zero-knowledge proofs independently.
 * Isolates failed proofs without halting verification of remaining items.
 */
export async function verifyBatchProofs(
  proofs: GenericBatchProofItem[],
): Promise<GenericBatchVerifyResponse> {
  const items = proofs || [];
  const results: GenericBatchProofResultItem[] = [];
  let verifiedCount = 0;

  for (let index = 0; index < items.length; index++) {
    const item = items[index];
    const itemId = item?.id || `proof-${index}`;

    try {
      if (!item || !item.proof || !item.publicSignals || !Array.isArray(item.publicSignals)) {
        results.push({
          index,
          id: itemId,
          valid: false,
          error: "Missing or malformed proof payload",
        });
        continue;
      }

      const isValid = await verifyMembershipProof(item.proof, item.publicSignals);
      if (isValid) {
        verifiedCount++;
        results.push({
          index,
          id: itemId,
          valid: true,
        });
      } else {
        results.push({
          index,
          id: itemId,
          valid: false,
          error: "Groth16 verification failed for proof",
        });
      }
    } catch (err: any) {
      results.push({
        index,
        id: itemId,
        valid: false,
        error: err?.message || "Verification processing error",
      });
    }
  }

  const totalCount = items.length;
  return {
    valid: verifiedCount === totalCount && totalCount > 0,
    verifiedCount,
    failedCount: totalCount - verifiedCount,
    totalCount,
    results,
  };
}

/**
 * Verifies a batch of zero-knowledge student discount credentials.
 */
export async function verifyBatchStudentDiscountProofs(
  request: BatchStudentDiscountRequest,
): Promise<BatchStudentDiscountResponse> {
  const items = request.items || request.studentProofs || [];
  const results: BatchStudentDiscountResultItem[] = [];
  let verifiedCount = 0;

  // Load verification keys
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const snarkjs = require("snarkjs");
  const studentMembershipVKeyPath = path.join(
    process.cwd(),
    "public",
    "zkp",
    "student_membership_vkey.json",
  );
  const studentPassVKeyPath = path.join(
    process.cwd(),
    "public",
    "zkp",
    "student_access_pass_vkey.json",
  );
  const fallbackVKeyPath = path.join(
    process.cwd(),
    "public",
    "zkp",
    "verification_key.json",
  );

  const seenBatchNullifiers = new Set<string>();

  for (let index = 0; index < items.length; index++) {
    const item = items[index];
    const itemId = item.id || item.studentId || `item-${index + 1}`;

    try {
      if (!item.proof || !item.publicSignals || !Array.isArray(item.publicSignals)) {
        results.push({
          index,
          id: itemId,
          userId: item.userId,
          studentId: item.studentId,
          valid: false,
          discountEligible: false,
          error: "Missing proof or publicSignals in item payload",
        });
        continue;
      }

      // Extract root, epoch, nullifierHash
      let root = item.root ? String(item.root) : String(item.publicSignals[0]);
      let epoch = item.epoch ? Number(item.epoch) : request.epoch ? Number(request.epoch) : 2026;
      let nullifierHash: string | null = item.nullifierHash ? String(item.nullifierHash) : null;

      if (!nullifierHash && item.publicSignals.length >= 3) {
        const sig1 = String(item.publicSignals[1]);
        const sig2 = String(item.publicSignals[2]);
        if (sig1.length <= 6 && !isNaN(Number(sig1))) {
          epoch = Number(sig1);
          nullifierHash = sig2;
        } else if (sig2.length <= 6 && !isNaN(Number(sig2))) {
          epoch = Number(sig2);
          nullifierHash = sig1;
        } else {
          nullifierHash = sig2;
        }
      } else if (!nullifierHash && item.publicSignals.length === 2) {
        if (!isNaN(Number(item.publicSignals[1])) && Number(item.publicSignals[1]) < 100000) {
          epoch = Number(item.publicSignals[1]);
        } else {
          nullifierHash = String(item.publicSignals[1]);
        }
      } else if (!nullifierHash && item.publicSignals.length === 1 && !item.root) {
        nullifierHash = String(item.publicSignals[0]);
      }

      // Check university Merkle root
      if (item.publicSignals.length >= 2 || item.root) {
        const isRootActive = await isUniversityMerkleRootActive(root, epoch);
        if (!isRootActive) {
          results.push({
            index,
            id: itemId,
            userId: item.userId,
            studentId: item.studentId,
            valid: false,
            discountEligible: false,
            error: "Invalid or inactive university Merkle root",
          });
          continue;
        }
      }

      // Check intra-batch nullifier duplicate
      if (nullifierHash) {
        if (seenBatchNullifiers.has(nullifierHash)) {
          results.push({
            index,
            id: itemId,
            userId: item.userId,
            studentId: item.studentId,
            valid: false,
            discountEligible: false,
            nullifierHash,
            error: "Duplicate nullifier detected within the same verification batch",
          });
          continue;
        }
        seenBatchNullifiers.add(nullifierHash);

        // Check persistent nullifier database
        try {
          const existingClaim = await prisma.studentClaimNullifier.findUnique({
            where: { nullifierHash },
          });

          if (existingClaim) {
            results.push({
              index,
              id: itemId,
              userId: item.userId,
              studentId: item.studentId,
              valid: false,
              discountEligible: false,
              nullifierHash,
              error: "Nullifier already spent for student discount",
            });
            continue;
          }
        } catch {
          // Table check fallback
        }
      }

      // Choose verification key
      let keyPath = fallbackVKeyPath;
      if (item.publicSignals.length === 3 && fs.existsSync(studentPassVKeyPath)) {
        keyPath = studentPassVKeyPath;
      } else if (item.publicSignals.length === 2 && fs.existsSync(studentMembershipVKeyPath)) {
        keyPath = studentMembershipVKeyPath;
      } else if (fs.existsSync(studentMembershipVKeyPath)) {
        keyPath = studentMembershipVKeyPath;
      } else if (fs.existsSync(fallbackVKeyPath)) {
        keyPath = fallbackVKeyPath;
      }

      if (!fs.existsSync(keyPath)) {
        results.push({
          index,
          id: itemId,
          userId: item.userId,
          studentId: item.studentId,
          valid: false,
          discountEligible: false,
          error: "Verification key artifact not found on server",
        });
        continue;
      }

      const vKey = JSON.parse(fs.readFileSync(keyPath, "utf-8"));
      let isValid = false;

      try {
        isValid = await snarkjs.groth16.verify(vKey, item.publicSignals, item.proof);
      } catch (err: any) {
        results.push({
          index,
          id: itemId,
          userId: item.userId,
          studentId: item.studentId,
          valid: false,
          discountEligible: false,
          error: err?.message || "Groth16 verification failed",
        });
        continue;
      }

      if (isValid) {
        verifiedCount++;

        // Persist nullifier & user status if userId is provided
        if (item.userId) {
          try {
            if (nullifierHash) {
              await prisma.$transaction([
                prisma.studentClaimNullifier.create({
                  data: {
                    nullifierHash,
                    epoch: Number(epoch) || 2026,
                  },
                }),
                prisma.user.update({
                  where: { id: item.userId },
                  data: { isVerifiedStudent: true },
                }),
              ]);
            } else {
              await prisma.user.update({
                where: { id: item.userId },
                data: { isVerifiedStudent: true },
              });
            }
          } catch {
            // Nullifier or user update error handled
          }
        } else if (nullifierHash) {
          try {
            await prisma.studentClaimNullifier.create({
              data: {
                nullifierHash,
                epoch: Number(epoch) || 2026,
              },
            });
          } catch {
            // Nullifier storage fallback
          }
        }

        results.push({
          index,
          id: itemId,
          userId: item.userId,
          studentId: item.studentId,
          valid: true,
          nullifierHash: nullifierHash || undefined,
          discountEligible: true,
          discountCode: "STUDENT20",
          discountPercentage: 20,
        });
      } else {
        results.push({
          index,
          id: itemId,
          userId: item.userId,
          studentId: item.studentId,
          valid: false,
          discountEligible: false,
          error: "Invalid zero-knowledge proof",
        });
      }
    } catch (err: any) {
      results.push({
        index,
        id: itemId,
        userId: item.userId,
        studentId: item.studentId,
        valid: false,
        discountEligible: false,
        error: err?.message || "Verification processing failed",
      });
    }
  }

  const batchHash = computeClusterMerkleHash(
    items.map((it, i) => it.id || it.studentId || it.userId || String(i)),
  );

  return {
    valid: verifiedCount === items.length && items.length > 0,
    verifiedCount,
    failedCount: items.length - verifiedCount,
    totalCount: items.length,
    results,
    batchHash,
  };
}

// ─── Parallel Web Worker Pool for Batch ZK Proofs (#5067) ────────────────────

export interface BatchStudentProofItem extends StudentMembershipProofInput {
  id?: string;
  studentId?: string;
  userId?: string;
}

export interface BatchStudentProofResultItem {
  id: string;
  studentId?: string;
  userId?: string;
  valid: boolean;
  proof?: any;
  publicSignals?: string[];
  durationMs: number;
  workerIndex?: number;
  error?: string;
}

export interface BatchStudentProofGenerationResult {
  success: boolean;
  completedCount: number;
  failedCount: number;
  totalCount: number;
  results: BatchStudentProofResultItem[];
  totalDurationMs: number;
  proofsPerSecond: number;
  concurrency: number;
  speedupEstimate?: number;
}

export interface BatchProofOptions {
  concurrency?: number;
  onProgress?: (
    completed: number,
    total: number,
    latestResult?: BatchStudentProofResultItem,
  ) => void;
  timeoutMs?: number;
}

export interface BatchWorkerPoolMetrics {
  poolSize: number;
  totalBatchesProcessed: number;
  totalProofsGenerated: number;
  averageProofDurationMs: number;
  throughputProofsPerSec: number;
}

export interface ZkpWorkerInstance {
  id: number;
  busy: boolean;
  execute: (
    input: BatchStudentProofItem,
    options?: BatchProofOptions,
  ) => Promise<{ proof: any; publicSignals: string[]; ms: number }>;
  terminate: () => void;
}

/**
 * Multi-threaded Worker Pool distributing student ZKP witness calculations
 * and Groth16 proof generation across Web Workers matching hardware concurrency.
 */
export class BatchStudentZkpWorkerPool {
  private poolSize: number;
  private workers: ZkpWorkerInstance[] = [];
  private totalProofsGenerated = 0;
  private totalProofDurationMs = 0;
  private totalBatchesProcessed = 0;
  private isTerminated = false;

  constructor(options?: { poolSize?: number }) {
    this.poolSize = this.resolveConcurrency(options?.poolSize);
    this.initPool();
  }

  private resolveConcurrency(customSize?: number): number {
    if (customSize && customSize > 0) return customSize;
    if (typeof navigator !== "undefined" && navigator.hardwareConcurrency) {
      return Math.max(1, navigator.hardwareConcurrency);
    }
    return 4;
  }

  public getPoolSize(): number {
    return this.poolSize;
  }

  public setPoolSize(size: number): void {
    if (size <= 0) throw new RangeError("Pool size must be at least 1");
    this.poolSize = size;
    this.initPool();
  }

  private initPool(): void {
    for (const w of this.workers) {
      try {
        w.terminate();
      } catch {}
    }
    this.workers = [];

    for (let i = 0; i < this.poolSize; i++) {
      this.workers.push(this.createWorkerInstance(i));
    }
  }

  private createWorkerInstance(id: number): ZkpWorkerInstance {
    let worker: Worker | null = null;
    const isBrowserWorker =
      typeof window !== "undefined" && typeof Worker !== "undefined";

    if (isBrowserWorker) {
      try {
        worker = new Worker(
          new URL("../../workers/zkpWorker.ts", import.meta.url),
          { type: "module" },
        );
      } catch {
        worker = null;
      }
    }

    return {
      id,
      busy: false,
      execute: async (input: BatchStudentProofItem, options?: BatchProofOptions) => {
        const start = Date.now();
        if (worker) {
          return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
              cleanup();
              reject(new Error(`ZKP worker #${id} witness calculation timed out`));
            }, options?.timeoutMs || 45000);

            const onMessage = (e: MessageEvent) => {
              if (e.data?.type === "success") {
                cleanup();
                resolve({
                  proof: e.data.proof,
                  publicSignals: e.data.publicSignals,
                  ms: Date.now() - start,
                });
              } else if (e.data?.type === "error") {
                cleanup();
                reject(new Error(e.data.error || "Worker proving failed"));
              }
            };

            const onError = (e: ErrorEvent) => {
              cleanup();
              reject(new Error(e.message || "Worker execution error"));
            };

            const cleanup = () => {
              clearTimeout(timeout);
              worker?.removeEventListener("message", onMessage);
              worker?.removeEventListener("error", onError);
            };

            worker?.addEventListener("message", onMessage);
            worker?.addEventListener("error", onError);

            worker?.postMessage({
              type: "prove-student",
              secret: String(input.secret),
              epoch: input.epoch,
              root: String(input.root),
              pathElements: input.pathElements.map(String),
              pathIndices: input.pathIndices.map(Number),
            });
          });
        }

        // Node.js / In-process snarkjs proving fallback
        const res = await proveStudentMembership(input);
        return {
          proof: res.proof,
          publicSignals: res.publicSignals,
          ms: res.ms || Date.now() - start,
        };
      },
      terminate: () => {
        if (worker) {
          try {
            worker.terminate();
          } catch {}
          worker = null;
        }
      },
    };
  }

  /**
   * Distributes batch zero-knowledge proof generation across the worker pool.
   */
  public async generateBatch(
    items: BatchStudentProofItem[],
    options?: BatchProofOptions,
  ): Promise<BatchStudentProofGenerationResult> {
    if (this.isTerminated) {
      throw new Error("BatchStudentZkpWorkerPool has been terminated");
    }

    if (!items || items.length === 0) {
      return {
        success: true,
        completedCount: 0,
        failedCount: 0,
        totalCount: 0,
        results: [],
        totalDurationMs: 0,
        proofsPerSecond: 0,
        concurrency: this.poolSize,
      };
    }

    const startBatch = Date.now();
    const effectiveConcurrency = Math.min(this.poolSize, items.length);
    const results: BatchStudentProofResultItem[] = new Array(items.length);
    let completedCount = 0;
    let failedCount = 0;
    let nextIndex = 0;

    // Distribute queue dynamically across active workers
    const runWorkerTask = async (worker: ZkpWorkerInstance) => {
      while (nextIndex < items.length) {
        const currentIndex = nextIndex++;
        const item = items[currentIndex];
        const itemId = item.id || item.studentId || `item-${currentIndex + 1}`;

        worker.busy = true;
        try {
          const res = await worker.execute(item, options);
          const resultItem: BatchStudentProofResultItem = {
            id: itemId,
            studentId: item.studentId,
            userId: item.userId,
            valid: true,
            proof: res.proof,
            publicSignals: res.publicSignals,
            durationMs: res.ms,
            workerIndex: worker.id,
          };
          results[currentIndex] = resultItem;
          completedCount++;
          this.totalProofsGenerated++;
          this.totalProofDurationMs += res.ms;
          options?.onProgress?.(completedCount, items.length, resultItem);
        } catch (err: any) {
          const resultItem: BatchStudentProofResultItem = {
            id: itemId,
            studentId: item.studentId,
            userId: item.userId,
            valid: false,
            durationMs: 0,
            workerIndex: worker.id,
            error: err?.message || "Proof generation failed",
          };
          results[currentIndex] = resultItem;
          failedCount++;
          options?.onProgress?.(
            completedCount + failedCount,
            items.length,
            resultItem,
          );
        } finally {
          worker.busy = false;
        }
      }
    };

    const activeWorkers = this.workers.slice(0, effectiveConcurrency);
    await Promise.all(activeWorkers.map((w) => runWorkerTask(w)));

    const totalDurationMs = Math.max(1, Date.now() - startBatch);
    const proofsPerSecond = Number(
      ((completedCount / totalDurationMs) * 1000).toFixed(2),
    );
    this.totalBatchesProcessed++;

    const avgProofDuration =
      completedCount > 0 ? this.totalProofDurationMs / completedCount : 1;
    const speedupEstimate = Number(
      Math.min(
        effectiveConcurrency,
        Math.max(1, (avgProofDuration * completedCount) / totalDurationMs),
      ).toFixed(2),
    );

    return {
      success: completedCount === items.length,
      completedCount,
      failedCount,
      totalCount: items.length,
      results,
      totalDurationMs,
      proofsPerSecond,
      concurrency: effectiveConcurrency,
      speedupEstimate,
    };
  }

  public getMetrics(): BatchWorkerPoolMetrics {
    return {
      poolSize: this.poolSize,
      totalBatchesProcessed: this.totalBatchesProcessed,
      totalProofsGenerated: this.totalProofsGenerated,
      averageProofDurationMs:
        this.totalProofsGenerated > 0
          ? Math.round(this.totalProofDurationMs / this.totalProofsGenerated)
          : 0,
      throughputProofsPerSec:
        this.totalProofDurationMs > 0
          ? Number(
              (
                (this.totalProofsGenerated / this.totalProofDurationMs) *
                1000
              ).toFixed(2),
            )
          : 0,
    };
  }

  public terminate(): void {
    this.isTerminated = true;
    for (const w of this.workers) {
      w.terminate();
    }
    this.workers = [];
  }
}

let globalBatchWorkerPool: BatchStudentZkpWorkerPool | null = null;

export function getBatchZkpWorkerPool(options?: {
  poolSize?: number;
}): BatchStudentZkpWorkerPool {
  if (!globalBatchWorkerPool) {
    globalBatchWorkerPool = new BatchStudentZkpWorkerPool(options);
  } else if (
    options?.poolSize &&
    options.poolSize !== globalBatchWorkerPool.getPoolSize()
  ) {
    globalBatchWorkerPool.setPoolSize(options.poolSize);
  }
  return globalBatchWorkerPool;
}

export async function generateBatchStudentProofs(
  items: BatchStudentProofItem[],
  options?: BatchProofOptions,
): Promise<BatchStudentProofGenerationResult> {
  const pool = getBatchZkpWorkerPool(
    options ? { poolSize: options.concurrency } : undefined,
  );
  return pool.generateBatch(items, options);
}

export { BatchStudentZkpWorkerPool as BatchZkpWorkerPool };


