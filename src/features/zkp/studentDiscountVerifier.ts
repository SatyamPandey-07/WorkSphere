/**
 * studentDiscountVerifier.ts
 *
 * Client-side and server-side verification orchestrator for Student Discount ZKP.
 * Integrates IndexedDB proof verification caching (#9500) with SnarkJS Groth16 verification.
 *
 * Expected flow:
 * 1. Receive proof, public signals, Merkle root, and verification context.
 * 2. Generate the deterministic cache key.
 * 3. Check IndexedDB for a valid cached verification.
 * 4. If a valid cache hit exists, return the successful verification result immediately.
 * 5. If no valid cache entry exists, invoke the existing SnarkJS verification function.
 * 6. If verification returns true, store the successful result in IndexedDB.
 * 7. If verification returns false, do not cache it.
 * 8. If verification throws, preserve existing error-handling behavior and do not cache the result.
 */

import {
  getCachedVerification,
  cacheVerifiedProof,
  type VerificationCacheOptions,
  type VerificationInput,
} from "../../lib/zkp/proofCache";

export interface StudentDiscountVerificationParams {
  proof: unknown;
  publicSignals: (string | number | bigint)[];
  merkleRoot?: string;
  epoch?: number | string;
  circuitId?: string;
  vKey?: unknown;
  vKeyFingerprint?: string;
  cacheOptions?: VerificationCacheOptions;
}

export interface StudentDiscountVerificationResult {
  isValid: boolean;
  fromCache: boolean;
  latencyMs: number;
  reason?: string;
}

/** In-flight cache promises to deduplicate concurrent verification requests for the same proof */
const pendingVerifications = new Map<string, Promise<StudentDiscountVerificationResult>>();

/**
 * Loads default student membership verification key if not provided.
 */
export async function loadDefaultStudentVerificationKey(): Promise<unknown | null> {
  // If in browser, fetch from static asset
  if (typeof window !== "undefined" && typeof fetch === "function") {
    try {
      const res = await fetch("/zkp/student_membership_vkey.json");
      if (res.ok) {
        return await res.json();
      }
    } catch {
      // ignore
    }
  }

  // If in Node / Server environment
  try {
    const fs = await import("fs");
    const path = await import("path");
    const vkeyPath = path.join(
      process.cwd(),
      "public",
      "zkp",
      "student_membership_vkey.json",
    );
    if (fs.existsSync(vkeyPath)) {
      return JSON.parse(fs.readFileSync(vkeyPath, "utf-8"));
    }
  } catch {
    // ignore
  }

  return null;
}

/**
 * Verifies a student discount Groth16 zero-knowledge proof, querying client IndexedDB cache
 * first to avoid expensive pairing operations on previously verified proofs.
 */
export async function verifyStudentDiscountProof(
  params: StudentDiscountVerificationParams,
  snarkjsVerifier?: (
    vKey: unknown,
    publicSignals: string[],
    proof: unknown,
  ) => Promise<boolean>,
): Promise<StudentDiscountVerificationResult> {
  const start = performance.now();
  const {
    proof,
    publicSignals,
    merkleRoot,
    circuitId = "student_membership",
    vKeyFingerprint,
    cacheOptions = {},
  } = params;

  // Basic validation
  if (!proof || !publicSignals || !Array.isArray(publicSignals) || publicSignals.length === 0) {
    return {
      isValid: false,
      fromCache: false,
      latencyMs: performance.now() - start,
      reason: "Missing or malformed proof/publicSignals",
    };
  }

  // Deduce root if not explicitly provided
  const effectiveRoot = merkleRoot ?? (publicSignals.length >= 1 ? String(publicSignals[0]) : undefined);

  // Load vKey if needed
  let effectiveVKey = params.vKey;
  if (!effectiveVKey && !vKeyFingerprint) {
    effectiveVKey = await loadDefaultStudentVerificationKey();
  }

  const verificationInput: VerificationInput = {
    proof,
    publicSignals,
    merkleRoot: effectiveRoot,
    circuitId,
    vKey: effectiveVKey,
    vKeyFingerprint,
  };

  // Step 1: Check client-side IndexedDB cache
  try {
    const cached = await getCachedVerification(verificationInput, cacheOptions);
    if (cached.hit) {
      return {
        isValid: true,
        fromCache: true,
        latencyMs: performance.now() - start,
      };
    }
  } catch (err) {
    // Caching check failed, fall back to SnarkJS verification
    console.warn("[StudentDiscountVerifier] Cache lookup failed, falling back to SnarkJS:", err);
  }

  // Step 2: Handle concurrency deduplication for in-flight verifications of the same proof
  let cacheKey: string | null = null;
  try {
    const { computeVerificationCacheKey } = await import("../../lib/zkp/proofCache");
    const res = await computeVerificationCacheKey(verificationInput);
    cacheKey = res.cacheKey;
  } catch {
    // Synchronous fallback cacheKey calculation using JSON if import fails
    try {
      cacheKey = JSON.stringify({
        p: (proof as any)?.pi_a,
        s: publicSignals,
        c: circuitId,
      });
    } catch {
      // ignore
    }
  }

  if (cacheKey && pendingVerifications.has(cacheKey)) {
    return pendingVerifications.get(cacheKey)!;
  }

  const runVerificationPromise = (async (): Promise<StudentDiscountVerificationResult> => {
    // Step 3: Perform SnarkJS Groth16 verification
    const stringSignals = publicSignals.map((s) =>
      typeof s === "bigint" ? s.toString() : String(s),
    );

    let isValid = false;
    try {
      if (snarkjsVerifier) {
        isValid = await snarkjsVerifier(effectiveVKey, stringSignals, proof);
      } else {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const snarkjs = require("snarkjs");
        isValid = await snarkjs.groth16.verify(effectiveVKey, stringSignals, proof);
      }
    } finally {
      // Terminate BN128 curve memory in node if applicable
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

    // Step 4: If verification succeeded, store in IndexedDB
    if (isValid) {
      try {
        await cacheVerifiedProof(verificationInput, cacheOptions);
      } catch (cacheErr) {
        // Caching error must never fail authentication
        console.warn("[StudentDiscountVerifier] Failed to cache verified proof:", cacheErr);
      }
    }

    return {
      isValid,
      fromCache: false,
      latencyMs: performance.now() - start,
    };
  })();

  if (cacheKey) {
    pendingVerifications.set(cacheKey, runVerificationPromise);
    runVerificationPromise
      .catch(() => {})
      .finally(() => {
        pendingVerifications.delete(cacheKey!);
      });
  }

  return runVerificationPromise;
}
