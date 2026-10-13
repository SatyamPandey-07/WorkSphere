/**
 * MerkleBadgeLedger.ts
 * Implements a Merkle tree to efficiently store, verify, and issue cryptographic proofs of earned badges.
 * Supports zero-knowledge membership proofs via SnarkJS Groth16 and nullifier tracking
 * to enable privacy-preserving badge verification without revealing public keys or serial numbers (#5420).
 */

import crypto from "crypto";

export interface Badge {
  badgeId: string;
  userId: string;
  issuedAt: number;
  questId: string;
}

export interface AnonymousCredential {
  commitment: string;
  issuedAt: number;
  questId: string;
}

export interface MerkleProof {
  leaf: string;
  root: string;
  proof: string[];
}

export interface Groth16Proof {
  pi_a: string[];
  pi_b: string[][];
  pi_c: string[];
  protocol?: string;
  curve?: string;
}

export interface ZkRedemptionOptions {
  nullifierHash?: string;
  expectedRoot?: string;
  vKey?: unknown;
}

export interface ZkRedemptionResult {
  success: boolean;
  error?: string;
  nullifierHash?: string;
}

async function getSnarkjs(): Promise<{
  groth16: {
    verify: (
      vKey: unknown,
      publicSignals: string[],
      proof: unknown,
    ) => Promise<boolean>;
  };
}> {
  try {
    return await import("snarkjs");
  } catch {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require("snarkjs");
  }
}

async function loadDefaultVKey(): Promise<unknown> {
  try {
    const fs = await import("fs");
    const path = await import("path");
    const vkeyPath = path.join(
      process.cwd(),
      "public",
      "zkp",
      "verification_key.json",
    );
    if (fs.existsSync(vkeyPath)) {
      return JSON.parse(fs.readFileSync(vkeyPath, "utf8"));
    }
  } catch {
    // ignore in environments without filesystem access
  }
  return null;
}

async function releaseCurve(): Promise<void> {
  const g = globalThis as typeof globalThis & {
    curve_bn128?: { terminate: () => Promise<void> };
  };
  if (g.curve_bn128) {
    try {
      await g.curve_bn128.terminate();
    } catch {
      // ignore
    }
  }
}

export class MerkleBadgeLedger {
  private badges: Badge[] = [];
  private leafHashes: string[] = [];
  private rootHash: string | null = null;
  private spentNullifiers: Set<string> = new Set();
  private vKey: unknown = null;

  public static defaultVKey: unknown = null;

  constructor() {}

  /**
   * Issues a new badge and updates the Merkle tree.
   */
  public issueBadge(badge: Badge): void {
    this.badges.push(badge);
    this.rebuildTree();
  }

  /**
   * Issues an anonymous credential using a cryptographic commitment as a Merkle leaf,
   * protecting the nomad's wallet address and badge serial number from public exposure.
   */
  public issueAnonymousCredential(
    commitment: string,
    questId: string = "discount-tier-1",
  ): void {
    this.badges.push({
      badgeId: commitment,
      userId: "anonymous-credential",
      issuedAt: Date.now(),
      questId,
    });
    this.rebuildTree();
  }

  /**
   * Directly inserts a credential leaf hash into the tree and recomputes the root.
   */
  public addCredentialLeaf(leafHash: string): void {
    this.leafHashes.push(leafHash);
    this.rootHash = this.computeRoot(this.leafHashes);
  }

  /**
   * Rebuilds the Merkle tree from the current list of badges.
   */
  private rebuildTree(): void {
    this.leafHashes = this.badges.map((badge) => this.hashBadge(badge));
    this.rootHash = this.computeRoot(this.leafHashes);
  }

  /**
   * Generates a SHA-256 hash of a badge object.
   */
  private hashBadge(badge: Badge): string {
    if (badge.userId === "anonymous-credential") {
      return badge.badgeId;
    }
    const data = `${badge.badgeId}:${badge.userId}:${badge.issuedAt}:${badge.questId}`;
    return crypto.createHash("sha256").update(data).digest("hex");
  }

  /**
   * Recursively computes the Merkle root from an array of hashes.
   */
  private computeRoot(hashes: string[]): string | null {
    if (hashes.length === 0) return null;
    if (hashes.length === 1) return hashes[0];

    const nextLevel: string[] = [];
    for (let i = 0; i < hashes.length; i += 2) {
      const left = hashes[i];
      const right = hashes[i + 1] || left; // Duplicate last if odd number
      const combined = left + right;
      nextLevel.push(
        crypto.createHash("sha256").update(combined).digest("hex"),
      );
    }

    return this.computeRoot(nextLevel);
  }

  /**
   * Generates a Merkle proof for a specific badge.
   */
  public generateProof(badgeId: string, userId: string): MerkleProof | null {
    const badgeIndex = this.badges.findIndex(
      (b) => b.badgeId === badgeId && b.userId === userId,
    );
    if (badgeIndex === -1) return null;

    const leaf = this.leafHashes[badgeIndex];
    const proof: string[] = [];

    if (this.leafHashes.length > 1) {
      const siblingIndex =
        badgeIndex % 2 === 0 ? badgeIndex + 1 : badgeIndex - 1;
      if (this.leafHashes[siblingIndex]) {
        proof.push(this.leafHashes[siblingIndex]);
      }
    }

    return {
      leaf,
      root: this.rootHash || "",
      proof,
    };
  }

  /**
   * Verifies a standard Merkle proof against leaf and root.
   */
  public static verifyProof(proof: MerkleProof): boolean {
    let currentHash = proof.leaf;

    for (const sibling of proof.proof) {
      const combined = currentHash + sibling;
      currentHash = crypto.createHash("sha256").update(combined).digest("hex");
    }

    return currentHash === proof.root;
  }

  /**
   * Computes a deterministic nullifier hash: sha256(secret:passId:salt)
   * Proves pass uniqueness for single-use discount redemption without revealing secrets.
   */
  public static computeNullifierHash(
    secret: string,
    passIdOrScope: string,
    salt: string = "",
  ): string {
    const data = `${secret}:${passIdOrScope}:${salt}`;
    return crypto.createHash("sha256").update(data).digest("hex");
  }

  /**
   * Computes an anonymous credential leaf commitment: sha256(secret:badgeId:questId)
   */
  public static computeCredentialCommitment(
    secret: string,
    badgeId: string,
    questId: string,
  ): string {
    const data = `${secret}:${badgeId}:${questId}`;
    return crypto.createHash("sha256").update(data).digest("hex");
  }

  /**
   * Checks if a nullifier has already been redeemed.
   */
  public isNullifierSpent(nullifierHash: string): boolean {
    return this.spentNullifiers.has(nullifierHash);
  }

  /**
   * Marks a nullifier as redeemed/spent.
   */
  public markNullifierSpent(nullifierHash: string): void {
    this.spentNullifiers.add(nullifierHash);
  }

  /**
   * Returns an array of all spent nullifiers.
   */
  public getSpentNullifiers(): string[] {
    return Array.from(this.spentNullifiers);
  }

  /**
   * Clears all recorded spent nullifiers.
   */
  public resetSpentNullifiers(): void {
    this.spentNullifiers.clear();
  }

  /**
   * Sets the instance verification key for Groth16 proofs.
   */
  public setVerificationKey(vKey: unknown): void {
    this.vKey = vKey;
  }

  /**
   * Sets the global default verification key for Groth16 proofs.
   */
  public static setDefaultVerificationKey(vKey: unknown): void {
    MerkleBadgeLedger.defaultVKey = vKey;
  }

  /**
   * Verifies a Groth16 zero-knowledge proof using SnarkJS.
   */
  public static async verifyZkProof(
    proof: unknown,
    publicSignals: string[],
    vKey?: unknown,
  ): Promise<boolean> {
    if (!proof || !publicSignals || !Array.isArray(publicSignals)) {
      return false;
    }

    const snarkjs = await getSnarkjs();
    const key =
      vKey || MerkleBadgeLedger.defaultVKey || (await loadDefaultVKey());
    if (!key) {
      throw new Error(
        "Verification key not found for Groth16 proof verification",
      );
    }

    try {
      return await snarkjs.groth16.verify(key, publicSignals, proof);
    } catch {
      return false;
    } finally {
      await releaseCurve();
    }
  }

  /**
   * Instance wrapper to verify a Groth16 ZK proof using this ledger's configured verification key.
   */
  public async verifyZkProof(
    proof: unknown,
    publicSignals: string[],
    vKey?: unknown,
  ): Promise<boolean> {
    return MerkleBadgeLedger.verifyZkProof(
      proof,
      publicSignals,
      vKey || this.vKey,
    );
  }

  /**
   * Verifies a Groth16 zero-knowledge proof of badge membership and redeems
   * a single-use cafe discount pass while verifying nullifier uniqueness to prevent double-spending.
   */
  public async redeemDiscountPass(
    proof: unknown,
    publicSignals: string[],
    options?: ZkRedemptionOptions,
  ): Promise<ZkRedemptionResult> {
    if (!proof || !publicSignals || publicSignals.length === 0) {
      return {
        success: false,
        error: "Invalid proof payload: proof and publicSignals are required",
      };
    }

    // Extract nullifier hash: explicit option takes precedence, otherwise infer from signals
    let nullifierHash = options?.nullifierHash;
    if (!nullifierHash) {
      if (publicSignals.length >= 2) {
        if (this.rootHash && publicSignals[0] === this.rootHash) {
          nullifierHash = publicSignals[1];
        } else if (this.rootHash && publicSignals[1] === this.rootHash) {
          nullifierHash = publicSignals[0];
        } else {
          nullifierHash = publicSignals[1];
        }
      } else if (publicSignals.length === 1) {
        nullifierHash = publicSignals[0];
      }
    }

    if (!nullifierHash) {
      return {
        success: false,
        error: "Missing nullifier hash for single-use discount pass",
      };
    }

    // Verify nullifier has not been double-spent
    if (this.isNullifierSpent(nullifierHash)) {
      return {
        success: false,
        error:
          "Double-spending detected: nullifier hash has already been redeemed",
        nullifierHash,
      };
    }

    // Verify Merkle root matches authorized credentials tree
    const expectedRoot = options?.expectedRoot || this.rootHash;
    if (expectedRoot && !publicSignals.includes(expectedRoot)) {
      return {
        success: false,
        error:
          "Merkle root mismatch: proof public signals do not match authorized credential root",
        nullifierHash,
      };
    }

    // Verify Groth16 zero-knowledge proof via SnarkJS
    const vKey = options?.vKey || this.vKey || MerkleBadgeLedger.defaultVKey;
    const isValid = await MerkleBadgeLedger.verifyZkProof(
      proof,
      publicSignals,
      vKey,
    );
    if (!isValid) {
      return {
        success: false,
        error:
          "Invalid Groth16 zero-knowledge proof: counterfeit proof rejected",
        nullifierHash,
      };
    }

    // Record nullifier to prevent double-spending
    this.markNullifierSpent(nullifierHash);

    return {
      success: true,
      nullifierHash,
    };
  }

  public getRootHash(): string | null {
    return this.rootHash;
  }
}
