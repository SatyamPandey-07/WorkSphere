import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { rateLimit } from "@/lib/rateLimit";
import { isAllowedCommit, isPremiumVenue } from "@/lib/zkp/membership";
import {
  verifyMembershipProof,
  isCommitmentRevoked,
} from "@/lib/zkp/verify";
import { issueVenueAccessToken } from "@/lib/zkp/venueAccessToken";
import { isCommitmentRevokedDirectly } from "@/lib/zkp/revocation";

// snarkjs requires Node.js runtime (uses fs, crypto, worker_threads)
export const runtime = "nodejs";

const bodySchema = z.object({
  proof: z.object({
    pi_a: z.array(z.string()).min(2),
    pi_b: z.array(z.array(z.string())).min(2),
    pi_c: z.array(z.string()).min(2),
    protocol: z.string().optional(),
    curve: z.string().optional(),
  }),
  publicSignals: z.array(z.string()).min(1),
  witness: z.array(z.string()).optional(),
});

/**
 * POST /api/venues/[venueId]/zkp-access
 *
 * Verifies a zk-SNARK membership proof for premium venue access.
 * Body carries only proof + publicSignals — never an identity token.
 * On success, returns a signed venue access token (HMAC-SHA256).
 * Nothing about the caller is persisted.
 */
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ venueId: string }> },
) {
  const { venueId } = await ctx.params;

  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    "unknown";
  if (!(await rateLimit(`zkp-access:${ip}`, 10))) {
    return NextResponse.json(
      { error: "Too many requests. Please try again later." },
      { status: 429 },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Validation failed." }, { status: 400 });
  }

  const venue = await prisma.venue.findUnique({
    where: { id: venueId },
    select: { id: true, category: true, rating: true },
  });

  if (!venue) {
    return NextResponse.json({ error: "Venue not found." }, { status: 404 });
  }

  if (!isPremiumVenue(venue)) {
    return NextResponse.json(
      { error: "This venue does not require premium ZKP access." },
      { status: 400 },
    );
  }

  const { proof, publicSignals } = parsed.data;
  const commit = publicSignals[0];

  if (!isAllowedCommit(commit)) {
    return NextResponse.json(
      { allowed: false, error: "Commitment is not a known member." },
      { status: 403 },
    );
  }

  // Server-side revocation check — always runs, never relies on client input.
  if (isCommitmentRevokedDirectly(commit)) {
    return NextResponse.json(
      { allowed: false, error: "Commitment has been revoked." },
      { status: 403 },
    );
  }

  // Optional Merkle witness check for clients that provide it
  const { witness } = parsed.data;
  if (witness) {
    const revoked = await isCommitmentRevoked(commit, witness);
    if (revoked) {
      return NextResponse.json(
        { allowed: false, error: "Commitment has been revoked." },
        { status: 403 },
      );
    }
  }

  let ok = false;
  try {
    ok = await verifyMembershipProof(
      {
        ...proof,
        protocol: proof.protocol ?? "groth16",
        curve: proof.curve ?? "bn128",
      },
      publicSignals,
    );
  } catch {
    return NextResponse.json(
      { allowed: false, error: "Proof verification error." },
      { status: 400 },
    );
  }

  if (!ok) {
    return NextResponse.json(
      { allowed: false, error: "Invalid proof." },
      { status: 403 },
    );
  }

  const accessToken = issueVenueAccessToken(venue.id, commit);

  return NextResponse.json({ allowed: true, venueId: venue.id, accessToken });
}
