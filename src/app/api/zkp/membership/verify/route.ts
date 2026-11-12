/**
 * POST /api/zkp/membership/verify
 *
 * Verifies an anonymous paid-membership Groth16 proof and, on success, issues a
 * short-lived signed venue access token.
 *
 * The request never contains a name, email, wallet address or Clerk user id.
 * Only the proof and its two public signals (`[root, epoch]`) are accepted.
 * Invalid, tampered or expired proofs are rejected with 401.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { evaluateMembershipProof } from "@/lib/zkp/membershipVerification";
import { issueVenueAccessToken } from "@/lib/zkp/venueAccessToken";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VENUE_ACCESS_TOKEN_TTL_MS = 60 * 60 * 1000;

const ScalarSchema = z.union([z.string(), z.number()]);

const MembershipVerifySchema = z.object({
  proof: z
    .object({
      pi_a: z.array(ScalarSchema),
      pi_b: z.array(z.array(ScalarSchema)),
      pi_c: z.array(ScalarSchema),
    })
    .passthrough(),
  publicSignals: z.array(ScalarSchema).length(2),
  venueId: z.string().trim().min(1).max(200).optional(),
});

function unauthorized(
  code: string,
  reason: string,
  latencyMs: number,
): NextResponse {
  return NextResponse.json(
    {
      success: false,
      verified: false,
      allowed: false,
      error: reason,
      code,
      verificationLatencyMs: latencyMs,
    },
    { status: 401, headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(req: NextRequest) {
  const startedAt = Date.now();

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json(
      { success: false, verified: false, allowed: false, error: "Invalid JSON body" },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  const parsed = MembershipVerifySchema.safeParse(raw);
  if (!parsed.success) {
    return unauthorized(
      "MALFORMED_PROOF",
      "Request must contain a Groth16 proof and [root, epoch] public signals",
      0,
    );
  }

  const { proof, publicSignals, venueId } = parsed.data;

  // snarkjs expects decimal strings; accepting numbers keeps JSON clients easy.
  const normalizedProof = {
    ...proof,
    pi_a: proof.pi_a.map(String),
    pi_b: proof.pi_b.map((row) => row.map(String)),
    pi_c: proof.pi_c.map(String),
  };

  const decision = await evaluateMembershipProof({
    proof: normalizedProof,
    publicSignals: publicSignals.map(String),
  });

  if (!decision.ok) {
    // 401 is required for expired/invalid credentials; 500 only when the
    // verifier itself is unavailable.
    if (decision.status === 500) {
      return NextResponse.json(
        {
          success: false,
          verified: false,
          allowed: false,
          error: decision.reason,
          code: decision.code,
          verificationLatencyMs: decision.latencyMs,
        },
        { status: 500, headers: { "Cache-Control": "no-store" } },
      );
    }
    return unauthorized(decision.code, decision.reason, decision.latencyMs);
  }

  const targetVenue = venueId ?? "worksphere:any-venue";
  const accessToken = issueVenueAccessToken(targetVenue, decision.commitment);
  const expiresAt = Date.now() + VENUE_ACCESS_TOKEN_TTL_MS;
  const totalLatencyMs = Date.now() - startedAt;

  return NextResponse.json(
    {
      success: true,
      verified: true,
      allowed: true,
      /** Explicit signal that no identity fields were disclosed or stored. */
      identityDisclosed: false,
      venueId: targetVenue,
      // Public only: membership root, epoch and an unlinkable commitment.
      root: decision.root,
      epoch: decision.epoch,
      commitment: decision.commitment,
      accessToken,
      expiresAt,
      verificationLatencyMs: decision.latencyMs,
      totalLatencyMs,
    },
    {
      status: 200,
      headers: {
        "Cache-Control": "no-store",
        "Server-Timing": `zkp-verify;dur=${decision.latencyMs}`,
      },
    },
  );
}
