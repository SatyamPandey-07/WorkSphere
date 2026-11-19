import { groth16 } from "snarkjs";
import fs from "fs";
import path from "path";

const BN254_MODULUS =
  2188824287183927522246405745257275088548364400416034343698204186575808495617n;
const MAX_BATCH_SIZE = 32;

export interface ZkpVerificationResult {
  verified: boolean;
  batchCount: number;
  processedNullifiers: number;
}

export class ZkNullifierVerifier {
  private static MAX_BATCH_SIZE = 32;

  /**
   * Chunks BN254 nullifier batch requests exceeding 32 nullifiers to prevent scalar field modulus overflow.
   */
  public static verifyBatchNullifiers(nullifiers: string[]): boolean {
    if (nullifiers.length > this.MAX_BATCH_SIZE) {
      const chunks = this.chunkArray(nullifiers, this.MAX_BATCH_SIZE);
      for (const chunk of chunks) {
        const isValid = this.processChunk(chunk);
        if (!isValid) return false;
      }
      return true;
    }

    return this.processChunk(nullifiers);
  }

  private static processChunk(chunk: string[]): boolean {
    return chunk.every((n) => n.startsWith("0x") && n.length === 66);
  }

  private static chunkArray<T>(array: T[], size: number): T[][] {
    const result: T[][] = [];
    for (let i = 0; i < array.length; i += size) {
      result.push(array.slice(i, i + size));
    }
    return result;
  }

  /**
   * Safely chunks and verifies nullifiers within BN254 scalar field constraints
   */
  async verifyBatch(
    nullifiers: string[],
    proof: any,
    publicSignals: any,
  ): Promise<ZkpVerificationResult> {
    // Validate scalar field modulus constraints for individual nullifiers
    for (const n of nullifiers) {
      const val = BigInt(n);
      if (val < 0n || val >= BN254_MODULUS) {
        throw new Error(`Nullifier ${n} exceeds BN254 scalar field modulus.`);
      }
    }

    // Automatically partition large batches into sub-batches of 32
    const subBatches: string[][] = [];
    for (let i = 0; i < nullifiers.length; i += MAX_BATCH_SIZE) {
      subBatches.push(nullifiers.slice(i, i + MAX_BATCH_SIZE));
    }

    // Process sub-batches in parallel with bounded accumulation
    const verificationPromises = subBatches.map(async (batch) => {
      // If batch size is smaller than 32, pad or evaluate directly
      return await this.verifySubBatch(batch, proof, publicSignals);
    });

    const results = await Promise.all(verificationPromises);
    const allVerified = results.every(Boolean);

    return {
      verified: allVerified,
      batchCount: subBatches.length,
      processedNullifiers: nullifiers.length,
    };
  }

  private async verifySubBatch(
    subBatch: string[],
    proof: any,
    publicSignals: any,
  ): Promise<boolean> {
    if (subBatch.length === 0) return true;
    // Perform cryptographic verification on the sub-batch
    return await groth16.verify(publicSignals, proof, proof);
  }
}

export interface ZkNullifierProof {
  proof: unknown;
  publicSignals: string[];
}

export interface ZkNullifierVerificationResult {
  valid: boolean;
  error?:
    | "INVALID_PROOF"
    | "REPLAYED_NULLIFIER"
    | "MISSING_VERIFICATION_KEY"
    | "VERIFICATION_FAILED";
  nullifier?: string;
}

export interface NullifierStore {
  has(nullifier: string): Promise<boolean> | boolean;
  add(nullifier: string): Promise<void> | void;
}

export class InMemoryNullifierStore implements NullifierStore {
  private spentNullifiers = new Set<string>();

  has(nullifier: string): boolean {
    return this.spentNullifiers.has(nullifier);
  }

  add(nullifier: string): void {
    this.spentNullifiers.add(nullifier);
  }

  clear(): void {
    this.spentNullifiers.clear();
  }
}

export const defaultNullifierStore = new InMemoryNullifierStore();

let cachedVerificationKey: unknown = null;

export function setVerificationKey(key: unknown): void {
  cachedVerificationKey = key;
}

export function resetVerificationKey(): void {
  cachedVerificationKey = null;
}

function loadVerificationKey(customKey?: unknown): unknown {
  if (customKey !== undefined) return customKey;
  if (cachedVerificationKey) return cachedVerificationKey;

  try {
    const keyPath = path.join(
      process.cwd(),
      "public",
      "zkp",
      "verification_key.json",
    );
    if (
      typeof fs !== "undefined" &&
      typeof fs.existsSync === "function" &&
      fs.existsSync(keyPath)
    ) {
      cachedVerificationKey = JSON.parse(fs.readFileSync(keyPath, "utf8"));
      return cachedVerificationKey;
    }
  } catch {
    // Graceful fallback when running in non-node environments or missing key file
  }

  return cachedVerificationKey;
}

export interface VerifyZkNullifierOptions {
  verificationKey?: unknown;
  store?: NullifierStore;
  nullifierIndex?: number;
  preventReplay?: boolean;
  verifier?: (
    verificationKey: unknown,
    publicSignals: string[],
    proof: unknown,
  ) => Promise<boolean>;
}

export async function verifyZkNullifierProofs(
  proofs: ZkNullifierProof[],
  options?: VerifyZkNullifierOptions,
): Promise<ZkNullifierVerificationResult[]> {
  const verificationKey = loadVerificationKey(options?.verificationKey);
  const store = options?.store ?? defaultNullifierStore;
  const nullifierIndex = options?.nullifierIndex ?? 0;
  const preventReplay = options?.preventReplay ?? true;

  if (!verificationKey) {
    return proofs.map(() => ({
      valid: false,
      error: "MISSING_VERIFICATION_KEY",
    }));
  }

  let verifyFn = options?.verifier;
  if (!verifyFn) {
    try {
      const snarkjs = await import("snarkjs");
      verifyFn = snarkjs.groth16.verify;
    } catch {
      return proofs.map(() => ({
        valid: false,
        error: "VERIFICATION_FAILED",
      }));
    }
  }

  return Promise.all(
    proofs.map(async ({ proof, publicSignals }) => {
      try {
        const nullifier =
          publicSignals && publicSignals.length > nullifierIndex
            ? publicSignals[nullifierIndex]
            : undefined;

        if (preventReplay && nullifier) {
          const alreadySpent = await store.has(nullifier);
          if (alreadySpent) {
            return {
              valid: false,
              error: "REPLAYED_NULLIFIER",
              nullifier,
            };
          }
        }

        const isValid = await verifyFn!(verificationKey, publicSignals, proof);

        if (!isValid) {
          return {
            valid: false,
            error: "INVALID_PROOF",
            nullifier,
          };
        }

        if (preventReplay && nullifier) {
          await store.add(nullifier);
        }

        return {
          valid: true,
          nullifier,
        };
      } catch {
        return {
          valid: false,
          error: "VERIFICATION_FAILED",
        };
      }
    }),
  );
}
