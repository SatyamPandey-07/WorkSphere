import fs from "fs";
import path from "path";

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

        const isValid = await verifyFn!(
          verificationKey,
          publicSignals,
          proof,
        );

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
