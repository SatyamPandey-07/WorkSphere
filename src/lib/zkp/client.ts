"use client";

import { computeMembershipCommit } from "@/lib/zkp/commitment";
import type { ZkProofPayload } from "@/lib/zkp/verify";

/**
 * Browser helper — generates the zk proof locally (<1s for this circuit)
 * then posts only { proof, publicSignals } to the API.
 */
export async function proveAndRequestPremiumAccess(input: {
  identityToken: string;
  venueId: string;
}): Promise<{ allowed: boolean; proveMs: number; error?: string }> {
  let proveMs = 0;
  let proof: ZkProofPayload["proof"];
  let publicSignals: string[];

  try {
    const snarkjs = await import("snarkjs");
    const expectedCommit = computeMembershipCommit(input.identityToken);
    const started = Date.now();
    const result = await snarkjs.groth16.fullProve(
      {
        identityToken: input.identityToken,
        expectedCommit,
      },
      "/zkp/premium_membership.wasm",
      "/zkp/premium_membership.zkey",
    );
    proveMs = Date.now() - started;
    proof = result.proof;
    publicSignals = result.publicSignals;
  } catch {
    return { allowed: false, proveMs: 0, error: "Could not build proof." };
  }

  const res = await fetch(`/api/venues/${input.venueId}/zkp-access`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ proof, publicSignals }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    return {
      allowed: false,
      proveMs,
      error: data.error ?? "Verification failed.",
    };
  }

  return { allowed: !!data.allowed, proveMs };
}
