/**
 * Server-side verification engine for venue membership proofs.
 *
 * Verifies the Groth16 proof, enforces epoch freshness and checks the Merkle
 * root against the active membership registry. No identity data is accepted,
 * stored or logged: the caller only sends the proof and its two public signals.
 */

import path from "path";
import {
  MEMBERSHIP_VERIFICATION_KEY_FILE,
  computeMembershipAccessCommitment,
  isMembershipEpochFresh,
  isMembershipRootActive,
  parseMembershipPublicSignals,
  type MembershipRootEntry,
} from "./membershipCircuit";

export type MembershipVerificationErrorCode =
  | "MALFORMED_PROOF"
  | "EXPIRED_EPOCH"
  | "INACTIVE_ROOT"
  | "INVALID_PROOF"
  | "VERIFIER_UNAVAILABLE";

export interface MembershipVerificationPayload {
  proof: unknown;
  publicSignals: unknown;
}

export type MembershipVerificationDecision =
  | {
      ok: true;
      status: 200;
      root: string;
      epoch: number;
      commitment: string;
      latencyMs: number;
    }
  | {
      ok: false;
      status: 401 | 500;
      code: MembershipVerificationErrorCode;
      reason: string;
      latencyMs: number;
    };

export interface MembershipVerifierDependencies {
  /** Injectable clock for deterministic tests. */
  nowSeconds?: () => number;
  /** Injectable root registry; defaults to MEMBERSHIP_MERKLE_ROOTS. */
  roots?: MembershipRootEntry[];
  /** Injectable vkey loader; defaults to public/zkp/membership_verifier_vkey.json. */
  loadVerificationKey?: () => Promise<unknown>;
  /** Injectable Groth16 verifier; defaults to snarkjs.groth16.verify. */
  verifyProof?: (
    verificationKey: unknown,
    publicSignals: string[],
    proof: unknown,
  ) => Promise<boolean>;
}

/** Verification key is read once per process; it changes only on redeploy. */
let cachedVerificationKey: unknown | null = null;

async function defaultLoadVerificationKey(): Promise<unknown> {
  if (cachedVerificationKey) return cachedVerificationKey;

  const file = path.join(process.cwd(), MEMBERSHIP_VERIFICATION_KEY_FILE);
  const fs = await import("fs/promises");
  const raw = await fs.readFile(file, "utf8");
  cachedVerificationKey = JSON.parse(raw) as unknown;
  return cachedVerificationKey;
}

async function defaultVerifyProof(
  verificationKey: unknown,
  publicSignals: string[],
  proof: unknown,
): Promise<boolean> {
  const snarkjs = await import("snarkjs");
  return snarkjs.groth16.verify(
    verificationKey as Parameters<typeof snarkjs.groth16.verify>[0],
    publicSignals,
    proof as Parameters<typeof snarkjs.groth16.verify>[2],
  );
}

/** Drops the cached verification key (deploy rotation / tests). */
export function resetMembershipVerificationKeyCache(): void {
  cachedVerificationKey = null;
}

function releaseCurve(): void {
  const g = globalThis as typeof globalThis & {
    curve_bn128?: { terminate: () => Promise<void> };
  };
  if (g.curve_bn128) {
    void g.curve_bn128.terminate().catch(() => undefined);
  }
}

function isProofShape(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const proof = value as Record<string, unknown>;
  return (
    Array.isArray(proof.pi_a) &&
    Array.isArray(proof.pi_b) &&
    Array.isArray(proof.pi_c) &&
    proof.pi_a.length >= 2 &&
    proof.pi_b.length >= 2 &&
    proof.pi_c.length >= 2
  );
}

/**
 * Evaluates a membership proof.
 *
 * Order matters: cheap checks (signal shape, epoch freshness, root registry)
 * run before the pairing check, so expired or unknown-root proofs are rejected
 * without paying for Groth16 verification.
 */
export async function evaluateMembershipProof(
  payload: MembershipVerificationPayload,
  dependencies: MembershipVerifierDependencies = {},
): Promise<MembershipVerificationDecision> {
  const startedAt = Date.now();
  const elapsed = () => Math.max(0, Date.now() - startedAt);

  const fail = (
    status: 401 | 500,
    code: MembershipVerificationErrorCode,
    reason: string,
  ): MembershipVerificationDecision => ({
    ok: false,
    status,
    code,
    reason,
    latencyMs: elapsed(),
  });

  if (!isProofShape(payload?.proof)) {
    return fail(401, "MALFORMED_PROOF", "Missing or malformed Groth16 proof");
  }

  const signals = parseMembershipPublicSignals(payload.publicSignals);
  if (!signals.valid || !signals.value) {
    return fail(401, "MALFORMED_PROOF", signals.error ?? "Invalid public signals");
  }

  const { root, epoch } = signals.value;
  const nowSeconds = dependencies.nowSeconds ?? (() => Math.floor(Date.now() / 1000));

  if (!isMembershipEpochFresh(epoch, { nowSeconds: nowSeconds() })) {
    return fail(
      401,
      "EXPIRED_EPOCH",
      "Membership proof epoch has expired; request a fresh proof",
    );
  }

  if (!isMembershipRootActive(root, epoch, dependencies.roots)) {
    return fail(401, "INACTIVE_ROOT", "Unknown or inactive membership Merkle root");
  }

  let verificationKey: unknown;
  try {
    verificationKey = await (dependencies.loadVerificationKey ??
      defaultLoadVerificationKey)();
  } catch {
    return fail(500, "VERIFIER_UNAVAILABLE", "Membership verifier is unavailable");
  }

  let valid = false;
  try {
    valid = await (dependencies.verifyProof ?? defaultVerifyProof)(
      verificationKey,
      payload.publicSignals as string[],
      payload.proof,
    );
  } catch {
    valid = false;
  } finally {
    releaseCurve();
  }

  if (!valid) {
    return fail(401, "INVALID_PROOF", "Zero-knowledge membership proof is invalid");
  }

  return {
    ok: true,
    status: 200,
    root,
    epoch,
    commitment: computeMembershipAccessCommitment(root, epoch),
    latencyMs: elapsed(),
  };
}
