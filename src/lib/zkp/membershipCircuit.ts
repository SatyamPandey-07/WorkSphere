/**
 * Shared primitives for the anonymous paid-membership circuit
 * (`circuits/membership_verifier.circom`).
 *
 * The circuit and this module MUST describe the same relation or every honest
 * proof is rejected:
 *
 *   leaf        = Poseidon(identitySecret, epoch)
 *   parent      = Poseidon(left, right)
 *   publicRoot  = Merkle root after `MEMBERSHIP_TREE_DEPTH` levels
 *
 * Only the public Merkle root and epoch leave the browser. The identity secret
 * and Merkle path stay private inputs of the Groth16 witness.
 *
 * This module is dependency-light (Poseidon only) so it can be imported by the
 * Web Worker, the API route and tests alike.
 */

import { BN254_SCALAR_FIELD, poseidonHash } from "./poseidon";

/** Depth used by the circuit (`MembershipVerifier(16)`). */
export const MEMBERSHIP_TREE_DEPTH = 16;

/** Browser path of the compiled witness generator. */
export const MEMBERSHIP_WASM_PATH = "/zkp/membership_verifier.wasm";

/** Browser path of the Groth16 proving key. */
export const MEMBERSHIP_ZKEY_PATH = "/zkp/membership_verifier.zkey";

/** Server path of the Groth16 verification key (relative to the repo root). */
export const MEMBERSHIP_VERIFICATION_KEY_FILE =
  "public/zkp/membership_verifier_vkey.json";

/** Browser path of the verification key (used by the worker verify path). */
export const MEMBERSHIP_VERIFICATION_KEY_URL =
  "/zkp/membership_verifier_vkey.json";

/**
 * How old a membership epoch may be before venue access is refused.
 *
 * An epoch is the unix-second start of a membership period, so the default
 * covers a calendar month plus a small grace window.
 */
export const MEMBERSHIP_DEFAULT_EPOCH_MAX_AGE_SECONDS = 32 * 24 * 60 * 60;

/** Tolerated clock skew for a client that is slightly ahead of the server. */
export const MEMBERSHIP_EPOCH_FUTURE_SKEW_SECONDS = 5 * 60;

export interface Groth16Proof {
  pi_a: string[];
  pi_b: string[][];
  pi_c: string[];
  protocol?: string;
  curve?: string;
}

export interface MembershipProofBundle {
  proof: Groth16Proof;
  publicSignals: string[];
}

export interface MembershipProofInput {
  identitySecret: string;
  epoch: string;
  root: string;
  pathElements: string[];
  pathIndices: string[];
}

export type MembershipRootPolicy = "explicit" | "dev-open" | "locked";

export interface MembershipRootEntry {
  root: string;
  /** When set, the root is only valid for this epoch. */
  epoch?: number;
}

export interface ValidationResult<T> {
  valid: boolean;
  value?: T;
  error?: string;
}

function toBigInt(value: unknown): bigint | null {
  if (typeof value === "bigint") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value) || !Number.isInteger(value)) return null;
    return BigInt(value);
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!/^-?\d+$/.test(trimmed)) return null;
    try {
      return BigInt(trimmed);
    } catch {
      return null;
    }
  }
  return null;
}

/** Normalizes a decimal field element into [0, BN254_SCALAR_FIELD). */
export function normalizeFieldElement(value: unknown): string | null {
  const parsed = toBigInt(value);
  if (parsed === null) return null;
  const reduced = ((parsed % BN254_SCALAR_FIELD) + BN254_SCALAR_FIELD) % BN254_SCALAR_FIELD;
  return reduced.toString();
}

/** Normalizes a unix-second epoch. Values in milliseconds are accepted. */
export function normalizeMembershipEpoch(value: unknown): number | null {
  const parsed = toBigInt(value);
  if (parsed === null || parsed <= 0n) return null;
  if (parsed > BigInt(Number.MAX_SAFE_INTEGER)) return null;

  const numeric = Number(parsed);
  // Be forgiving when a caller passes `Date.now()` instead of seconds.
  if (numeric > 10_000_000_000) return Math.floor(numeric / 1000);
  return Math.floor(numeric);
}

/**
 * Validates and normalizes the private witness inputs.
 *
 * Path indices are restricted to 0/1 here as well as in the circuit (the
 * `s * (1 - s) === 0` mux constraint), so malformed input fails with a clear
 * error instead of an unsatisfiable witness.
 */
export function validateMembershipProofInput(
  input: Partial<Record<keyof MembershipProofInput, unknown>>,
): ValidationResult<MembershipProofInput> {
  if (!input || typeof input !== "object") {
    return { valid: false, error: "Proof inputs must be an object" };
  }

  const identitySecret = normalizeFieldElement(input.identitySecret);
  if (!identitySecret || identitySecret === "0") {
    return { valid: false, error: "identitySecret must be a non-zero field element" };
  }

  const epoch = normalizeMembershipEpoch(input.epoch);
  if (epoch === null) {
    return { valid: false, error: "epoch must be a positive unix timestamp" };
  }

  const root = normalizeFieldElement(input.root);
  if (!root) {
    return { valid: false, error: "root must be a field element" };
  }

  const pathElements = input.pathElements;
  const pathIndices = input.pathIndices;

  if (!Array.isArray(pathElements) || pathElements.length !== MEMBERSHIP_TREE_DEPTH) {
    return {
      valid: false,
      error: `pathElements must contain exactly ${MEMBERSHIP_TREE_DEPTH} siblings`,
    };
  }

  if (!Array.isArray(pathIndices) || pathIndices.length !== MEMBERSHIP_TREE_DEPTH) {
    return {
      valid: false,
      error: `pathIndices must contain exactly ${MEMBERSHIP_TREE_DEPTH} bits`,
    };
  }

  const normalizedElements: string[] = [];
  for (const element of pathElements) {
    const normalized = normalizeFieldElement(element);
    if (normalized === null) {
      return { valid: false, error: "pathElements contains a non-numeric sibling" };
    }
    normalizedElements.push(normalized);
  }

  const normalizedIndices: string[] = [];
  for (const index of pathIndices) {
    const normalized = normalizeFieldElement(index);
    if (normalized !== "0" && normalized !== "1") {
      return { valid: false, error: "pathIndices contains a value that is not 0 or 1" };
    }
    normalizedIndices.push(normalized);
  }

  return {
    valid: true,
    value: {
      identitySecret,
      epoch: String(epoch),
      root,
      pathElements: normalizedElements,
      pathIndices: normalizedIndices,
    },
  };
}

/** Public signals are ordered `[root, epoch]` by the circuit. */
export function parseMembershipPublicSignals(
  publicSignals: unknown,
): ValidationResult<{ root: string; epoch: number; epochRaw: string }> {
  if (!Array.isArray(publicSignals) || publicSignals.length !== 2) {
    return { valid: false, error: "publicSignals must contain exactly [root, epoch]" };
  }

  const root = normalizeFieldElement(publicSignals[0]);
  if (!root) {
    return { valid: false, error: "Public Merkle root is not a field element" };
  }

  const epoch = normalizeMembershipEpoch(publicSignals[1]);
  if (epoch === null) {
    return { valid: false, error: "Public epoch is not a positive unix timestamp" };
  }

  const epochRaw = normalizeFieldElement(publicSignals[1]);
  if (!epochRaw) {
    return { valid: false, error: "Public epoch is not a field element" };
  }

  return { valid: true, value: { root, epoch, epochRaw } };
}

/**
 * Rejects proofs whose epoch is in the future or older than the configured
 * membership period. This is the server-side expiry check that makes a stolen
 * proof useless after its epoch ends.
 */
export function isMembershipEpochFresh(
  epoch: number,
  options: {
    nowSeconds?: number;
    maxAgeSeconds?: number;
    futureSkewSeconds?: number;
  } = {},
): boolean {
  if (!Number.isFinite(epoch) || epoch <= 0) return false;

  const nowSeconds = options.nowSeconds ?? Math.floor(Date.now() / 1000);
  const maxAgeSeconds =
    options.maxAgeSeconds ?? MEMBERSHIP_DEFAULT_EPOCH_MAX_AGE_SECONDS;
  const futureSkewSeconds =
    options.futureSkewSeconds ?? MEMBERSHIP_EPOCH_FUTURE_SKEW_SECONDS;

  if (epoch > nowSeconds + futureSkewSeconds) return false;
  if (nowSeconds - epoch > maxAgeSeconds) return false;
  return true;
}

/**
 * Parses `MEMBERSHIP_MERKLE_ROOTS` into `root` or `root:epoch` entries.
 * Commas or semicolons may separate entries.
 */
export function parseMembershipRoots(
  raw: string | undefined = process.env.MEMBERSHIP_MERKLE_ROOTS,
): MembershipRootEntry[] {
  if (!raw || !raw.trim()) return [];

  return raw
    .split(/[,;]/)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const separator = entry.lastIndexOf(":");
      if (separator > 0) {
        const root = normalizeFieldElement(entry.slice(0, separator));
        const epoch = normalizeMembershipEpoch(entry.slice(separator + 1));
        if (root && epoch !== null) return { root, epoch };
      }
      const root = normalizeFieldElement(entry);
      return root ? { root } : null;
    })
    .filter((entry): entry is MembershipRootEntry => entry !== null);
}

/**
 * Returns whether `root` is an active membership root for `epoch`.
 *
 * Policy:
 * - `explicit`  — one or more `MEMBERSHIP_MERKLE_ROOTS` entries are configured.
 * - `dev-open`  — no roots configured and `NODE_ENV !== "production"`, so local
 *                 demos/tests can exercise the full flow without seeding config.
 * - `locked`    — no roots configured in production; every proof is rejected.
 */
export function getMembershipRootPolicy(
  entries: MembershipRootEntry[] = parseMembershipRoots(),
  nodeEnv: string | undefined = process.env.NODE_ENV,
): MembershipRootPolicy {
  if (entries.length > 0) return "explicit";
  return nodeEnv === "production" ? "locked" : "dev-open";
}

export function isMembershipRootActive(
  root: string,
  epoch: number,
  entries: MembershipRootEntry[] = parseMembershipRoots(),
): boolean {
  const policy = getMembershipRootPolicy(entries);
  if (policy === "dev-open") {
    return Boolean(normalizeFieldElement(root));
  }
  if (policy === "locked") return false;

  const normalizedRoot = normalizeFieldElement(root);
  if (!normalizedRoot) return false;

  return entries.some(
    (entry) =>
      entry.root === normalizedRoot &&
      (entry.epoch === undefined || entry.epoch === epoch),
  );
}

/** Leaf commitment: Poseidon(identitySecret, epoch). */
export function computeMembershipLeaf(
  identitySecret: bigint | string | number,
  epoch: bigint | string | number,
): bigint {
  const secret = toBigInt(identitySecret);
  const epochValue = toBigInt(epoch);
  if (secret === null || epochValue === null) {
    throw new Error("Membership leaf inputs must be integers");
  }
  const normalizedSecret =
    ((secret % BN254_SCALAR_FIELD) + BN254_SCALAR_FIELD) % BN254_SCALAR_FIELD;
  const normalizedEpoch =
    ((epochValue % BN254_SCALAR_FIELD) + BN254_SCALAR_FIELD) % BN254_SCALAR_FIELD;
  return poseidonHash([normalizedSecret, normalizedEpoch]);
}

/**
 * Anonymous commitment returned to the venue. It binds the token to the
 * verified `(root, epoch)` pair but cannot be linked back to a member.
 */
export function computeMembershipAccessCommitment(
  root: string,
  epoch: number,
): string {
  return poseidonHash([BigInt(root), BigInt(epoch)]).toString();
}

/** Zero hashes for an empty tree: zeroHashes[0] = 0. */
export function getMembershipZeroHashes(
  depth = MEMBERSHIP_TREE_DEPTH,
): bigint[] {
  const zeroHashes: bigint[] = [0n];
  for (let i = 1; i <= depth; i++) {
    zeroHashes[i] = poseidonHash([zeroHashes[i - 1], zeroHashes[i - 1]]);
  }
  return zeroHashes;
}

export interface MembershipMerkleProof {
  leaf: bigint;
  root: bigint;
  pathElements: bigint[];
  pathIndices: number[];
}

/**
 * In-memory depth-16 Poseidon Merkle tree used to enroll members and to build
 * witnesses. Kept in sync with `StudentMembershipTree`, which implements the
 * same relation for the academic circuit.
 */
export class MembershipMerkleTree {
  public readonly depth: number;
  private readonly zeroHashes: bigint[];
  private readonly leaves: bigint[] = [];

  constructor(depth = MEMBERSHIP_TREE_DEPTH) {
    this.depth = depth;
    this.zeroHashes = getMembershipZeroHashes(depth);
  }

  public insert(leaf: bigint | string | number): number {
    if (this.leaves.length >= 2 ** this.depth) {
      throw new Error(`Membership tree is full (capacity ${2 ** this.depth})`);
    }
    const index = this.leaves.length;
    this.leaves.push(BigInt(leaf));
    return index;
  }

  public insertMember(secret: bigint | string | number, epoch: bigint | string | number): number {
    return this.insert(computeMembershipLeaf(secret, epoch));
  }

  public getRoot(): bigint {
    if (this.leaves.length === 0) return this.zeroHashes[this.depth];

    let level = new Map<number, bigint>();
    this.leaves.forEach((leaf, index) => level.set(index, leaf));

    for (let depth = 0; depth < this.depth; depth++) {
      level = this.parentLevel(level, depth);
    }

    return level.get(0) ?? this.zeroHashes[this.depth];
  }

  public getProof(leafIndex: number): MembershipMerkleProof {
    if (leafIndex < 0 || leafIndex >= this.leaves.length) {
      throw new Error(`Leaf index ${leafIndex} out of bounds`);
    }

    let level = new Map<number, bigint>();
    this.leaves.forEach((leaf, index) => level.set(index, leaf));

    let index = leafIndex;
    const pathElements: bigint[] = [];
    const pathIndices: number[] = [];

    for (let depth = 0; depth < this.depth; depth++) {
      const isRight = index % 2 === 1;
      const siblingIndex = isRight ? index - 1 : index + 1;
      pathElements.push(level.get(siblingIndex) ?? this.zeroHashes[depth]);
      pathIndices.push(isRight ? 1 : 0);
      level = this.parentLevel(level, depth);
      index = Math.floor(index / 2);
    }

    return {
      leaf: this.leaves[leafIndex],
      root: this.getRoot(),
      pathElements,
      pathIndices,
    };
  }

  private parentLevel(
    level: Map<number, bigint>,
    depth: number,
  ): Map<number, bigint> {
    const parents = new Map<number, bigint>();
    const processed = new Set<number>();
    const zero = this.zeroHashes[depth];

    for (const [index, value] of level.entries()) {
      const parent = Math.floor(index / 2);
      if (processed.has(parent)) continue;
      processed.add(parent);

      const isEven = index % 2 === 0;
      const left = isEven ? value : level.get(index - 1) ?? zero;
      const right = isEven ? level.get(index + 1) ?? zero : value;
      parents.set(parent, poseidonHash([left, right]));
    }

    return parents;
  }
}

/**
 * Pure mirror of the circuit relation, used to sanity-check witnesses before
 * proving and to test the Merkle helpers without artifacts.
 */
export function verifyMembershipPath(
  root: bigint | string,
  identitySecret: bigint | string | number,
  epoch: bigint | string | number,
  pathElements: (bigint | string)[],
  pathIndices: (number | string)[],
): boolean {
  if (
    pathElements.length !== MEMBERSHIP_TREE_DEPTH ||
    pathIndices.length !== MEMBERSHIP_TREE_DEPTH
  ) {
    return false;
  }

  let current = computeMembershipLeaf(identitySecret, epoch);

  for (let depth = 0; depth < MEMBERSHIP_TREE_DEPTH; depth++) {
    const sibling = toBigInt(pathElements[depth]);
    const index = toBigInt(pathIndices[depth]);

    if (sibling === null || (index !== 0n && index !== 1n)) return false;

    const left = index === 0n ? current : sibling;
    const right = index === 0n ? sibling : current;
    current = poseidonHash([left, right]);
  }

  return current === BigInt(root);
}
