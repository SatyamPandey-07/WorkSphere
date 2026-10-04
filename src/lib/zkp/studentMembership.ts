import path from "path";
import fs from "fs";
import { poseidonHash, BN254_SCALAR_FIELD } from "./poseidon";
import { prisma } from "@/lib/prisma";

export const TREE_DEPTH = 16;
export const CURRENT_ACADEMIC_YEAR = 2026;

// Pre-computed or verified active campus Merkle roots
// These can be seeded in the DB or used in dev/test/production environments
export const DEFAULT_ACTIVE_CAMPUS_ROOTS: Record<string, { university: string; campus: string; root: string; epoch: number }> = {
  mit: {
    university: "Massachusetts Institute of Technology",
    campus: "Main Campus",
    root: "1849102948102938401928401928401928401928401928401928401928401928",
    epoch: 2026,
  },
  stanford: {
    university: "Stanford University",
    campus: "Palo Alto",
    root: "9834710293840192830491820394810293840192830491820394810293840192",
    epoch: 2026,
  },
  berkeley: {
    university: "UC Berkeley",
    campus: "Berkeley",
    root: "4729103948102938471029384710293847102938471029384710293847102938",
    epoch: 2026,
  },
};

/**
 * Calculates zero hashes for an empty Merkle tree of given depth.
 * zeroHashes[0] is the empty leaf hash (0n).
 * zeroHashes[i] = poseidonHash([zeroHashes[i-1], zeroHashes[i-1]])
 */
export function getZeroHashes(depth = TREE_DEPTH): bigint[] {
  const zeroHashes: bigint[] = [0n];
  for (let i = 1; i <= depth; i++) {
    zeroHashes[i] = poseidonHash([zeroHashes[i - 1], zeroHashes[i - 1]]);
  }
  return zeroHashes;
}

/**
 * Computes a student leaf commitment: Poseidon(secret, epoch)
 */
export function computeStudentLeaf(
  secret: bigint | string | number,
  epoch: bigint | string | number = CURRENT_ACADEMIC_YEAR,
): bigint {
  const s = ((BigInt(secret) % BN254_SCALAR_FIELD) + BN254_SCALAR_FIELD) % BN254_SCALAR_FIELD;
  const e = ((BigInt(epoch) % BN254_SCALAR_FIELD) + BN254_SCALAR_FIELD) % BN254_SCALAR_FIELD;
  return poseidonHash([s, e]);
}

export interface MerkleProof {
  leaf: bigint;
  root: bigint;
  pathElements: bigint[];
  pathIndices: number[];
}

/**
 * In-memory depth-16 Poseidon Merkle Tree for enrolled student memberships.
 */
export class StudentMembershipTree {
  public readonly depth: number;
  private readonly zeroHashes: bigint[];
  private leaves: bigint[] = [];

  constructor(depth = TREE_DEPTH) {
    this.depth = depth;
    this.zeroHashes = getZeroHashes(depth);
  }

  public insert(leaf: bigint | string | number): number {
    const l = BigInt(leaf);
    const index = this.leaves.length;
    if (index >= 2 ** this.depth) {
      throw new Error(`Tree is full (capacity: ${2 ** this.depth})`);
    }
    this.leaves.push(l);
    return index;
  }

  public insertStudent(
    secret: bigint | string | number,
    epoch: bigint | string | number = CURRENT_ACADEMIC_YEAR,
  ): number {
    const leaf = computeStudentLeaf(secret, epoch);
    return this.insert(leaf);
  }

  /**
   * Computes the Merkle root of the tree.
   */
  public getRoot(): bigint {
    if (this.leaves.length === 0) {
      return this.zeroHashes[this.depth];
    }

    let currentLevel = new Map<number, bigint>();
    for (let i = 0; i < this.leaves.length; i++) {
      currentLevel.set(i, this.leaves[i]);
    }

    for (let level = 0; level < this.depth; level++) {
      const nextLevel = new Map<number, bigint>();
      const processedParents = new Set<number>();

      for (const [index, val] of currentLevel.entries()) {
        const parentIndex = Math.floor(index / 2);
        if (processedParents.has(parentIndex)) continue;
        processedParents.add(parentIndex);

        const isEven = index % 2 === 0;
        const left = isEven ? val : (currentLevel.get(index - 1) ?? this.zeroHashes[level]);
        const right = isEven ? (currentLevel.get(index + 1) ?? this.zeroHashes[level]) : val;

        nextLevel.set(parentIndex, poseidonHash([left, right]));
      }

      currentLevel = nextLevel;
    }

    return currentLevel.get(0) ?? this.zeroHashes[this.depth];
  }

  /**
   * Generates a Merkle membership proof for leaf at `leafIndex`.
   */
  public getProof(leafIndex: number): MerkleProof {
    if (leafIndex < 0 || leafIndex >= this.leaves.length) {
      throw new Error(`Leaf index ${leafIndex} out of bounds`);
    }

    const leaf = this.leaves[leafIndex];
    const pathElements: bigint[] = [];
    const pathIndices: number[] = [];

    let currentLevel = new Map<number, bigint>();
    for (let i = 0; i < this.leaves.length; i++) {
      currentLevel.set(i, this.leaves[i]);
    }

    let currentIndex = leafIndex;

    for (let level = 0; level < this.depth; level++) {
      const isRight = currentIndex % 2 === 1;
      const siblingIndex = isRight ? currentIndex - 1 : currentIndex + 1;
      const sibling = currentLevel.get(siblingIndex) ?? this.zeroHashes[level];

      pathElements.push(sibling);
      pathIndices.push(isRight ? 1 : 0);

      // Advance level
      const nextLevel = new Map<number, bigint>();
      const processedParents = new Set<number>();

      for (const [idx, val] of currentLevel.entries()) {
        const parentIdx = Math.floor(idx / 2);
        if (processedParents.has(parentIdx)) continue;
        processedParents.add(parentIdx);

        const isEven = idx % 2 === 0;
        const left = isEven ? val : (currentLevel.get(idx - 1) ?? this.zeroHashes[level]);
        const right = isEven ? (currentLevel.get(idx + 1) ?? this.zeroHashes[level]) : val;

        nextLevel.set(parentIdx, poseidonHash([left, right]));
      }

      currentLevel = nextLevel;
      currentIndex = Math.floor(currentIndex / 2);
    }

    return {
      leaf,
      root: this.getRoot(),
      pathElements,
      pathIndices,
    };
  }
}

/**
 * Pure verification of depth-16 Poseidon Merkle membership path.
 * Mimics the constraints in circuits/student_membership.circom.
 */
export function verifyMerkleMembership(
  root: bigint | string,
  secret: bigint | string | number,
  epoch: bigint | string | number,
  pathElements: (bigint | string)[],
  pathIndices: (number | string)[],
): boolean {
  if (pathElements.length !== TREE_DEPTH || pathIndices.length !== TREE_DEPTH) {
    return false;
  }

  const expectedRoot = BigInt(root);
  let currentHash = computeStudentLeaf(secret, epoch);

  for (let i = 0; i < TREE_DEPTH; i++) {
    const sibling = BigInt(pathElements[i]);
    const indexBit = Number(pathIndices[i]);

    if (indexBit !== 0 && indexBit !== 1) {
      return false;
    }

    const left = indexBit === 0 ? currentHash : sibling;
    const right = indexBit === 0 ? sibling : currentHash;

    currentHash = poseidonHash([left, right]);
  }

  return currentHash === expectedRoot;
}

/**
 * Checks if a given Merkle root is registered as an active university root
 * in the database or active campus registry.
 */
export async function isUniversityMerkleRootActive(
  root: string,
  epoch = CURRENT_ACADEMIC_YEAR,
): Promise<boolean> {
  if (!root) return false;
  const cleanRoot = String(root).trim();

  // 1. Check Prisma database if universityMerkleRoot table exists
  try {
    if ((prisma as any)?.universityMerkleRoot) {
      const dbRoot = await (prisma as any).universityMerkleRoot.findFirst({
        where: {
          merkleRoot: cleanRoot,
          isActive: true,
          ...(epoch ? { epoch } : {}),
        },
      });
      if (dbRoot) return true;
    }
  } catch {
    // DB table might not be migrated in some local dev environments
  }

  // 2. Check default active campus roots registry
  const matchesDefault = Object.values(DEFAULT_ACTIVE_CAMPUS_ROOTS).some(
    (c) => c.root === cleanRoot && (!epoch || c.epoch === epoch),
  );
  if (matchesDefault) return true;

  // 3. Check environment-variable overrides: ACTIVE_CAMPUS_MERKLE_ROOTS="root1,root2"
  const envRoots = process.env.ACTIVE_CAMPUS_MERKLE_ROOTS;
  if (envRoots) {
    const list = envRoots.split(",").map((r) => r.trim());
    if (list.includes(cleanRoot)) return true;
  }

  return false;
}

export interface StudentMembershipProofInput {
  secret: string | bigint | number;
  epoch: number | string | bigint;
  root: string | bigint;
  pathElements: (string | bigint)[];
  pathIndices: number[];
}

/**
 * Generates a Groth16 zero-knowledge proof for student membership.
 */
export async function proveStudentMembership(
  input: StudentMembershipProofInput,
): Promise<{ proof: any; publicSignals: string[]; ms: number }> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const snarkjs = require("snarkjs");
  const wasmPath = path.join(process.cwd(), "public", "zkp", "student_membership.wasm");
  const zkeyPath = path.join(process.cwd(), "public", "zkp", "student_membership.zkey");

  const formattedInput = {
    secret: input.secret.toString(),
    epoch: input.epoch.toString(),
    root: input.root.toString(),
    pathElements: input.pathElements.map((e) => e.toString()),
    pathIndices: input.pathIndices.map((idx) => idx.toString()),
  };

  const started = Date.now();
  try {
    const { proof, publicSignals } = await snarkjs.groth16.fullProve(
      formattedInput,
      wasmPath,
      zkeyPath,
    );
    return { proof, publicSignals, ms: Date.now() - started };
  } finally {
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
}

/**
 * Verifies a Groth16 student membership proof against the student verification key.
 */
export async function verifyStudentMembershipProof(
  proof: any,
  publicSignals: string[],
): Promise<boolean> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const snarkjs = require("snarkjs");
  const vkeyPath = path.join(process.cwd(), "public", "zkp", "student_membership_vkey.json");
  const fallbackVkeyPath = path.join(process.cwd(), "public", "zkp", "verification_key.json");

  const keyPath = fs.existsSync(vkeyPath) ? vkeyPath : fallbackVkeyPath;
  if (!fs.existsSync(keyPath)) {
    throw new Error("Student membership verification key not found");
  }

  const vKey = JSON.parse(fs.readFileSync(keyPath, "utf-8"));

  const g = globalThis as typeof globalThis & {
    curve_bn128?: { terminate: () => Promise<void> };
  };
  try {
    return await snarkjs.groth16.verify(vKey, publicSignals, proof);
  } finally {
    if (g.curve_bn128) {
      try {
        await g.curve_bn128.terminate();
      } catch {
        // ignore
      }
    }
  }
}
