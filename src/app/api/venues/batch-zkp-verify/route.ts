import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { rateLimit } from "@/lib/rateLimit";
import { verifyZkNullifierProofs } from "@/lib/crypto/zkNullifierVerifier";

export const runtime = "nodejs";

const MAX_BATCH_SIZE = 20;

const publicSignalSchema = z.string().trim().min(1);

const proofItemSchema = z.object({
  ticketId: z.string().trim().min(1).optional(),
  nullifierHash: z.string().trim().min(1).optional(),
  proof: z.object({
    pi_a: z.array(z.string()).min(2),
    pi_b: z.array(z.array(z.string()).min(2)).min(2),
    pi_c: z.array(z.string()).min(2),
    protocol: z.string().optional(),
    curve: z.string().optional(),
  }),
  publicSignals: z.tuple([
    publicSignalSchema,
    publicSignalSchema,
    publicSignalSchema,
    publicSignalSchema,
  ]),
});

const bodySchema = z.object({
  venueId: z.string().trim().min(1),
  proofs: z.array(proofItemSchema).min(1).max(MAX_BATCH_SIZE),
});

export type TicketVerificationStatus =
  | "verified"
  | "invalid_proof"
  | "already_consumed"
  | "duplicate_in_batch"
  | "invalid_payload";

export interface TicketVerificationResult {
  ticketId: string;
  valid: boolean;
  consumed: boolean;
  status: TicketVerificationStatus;
  reason?: string;
  nullifierHash?: string;
  index: number;
}

export interface BatchZkpVerifyResponse {
  results: TicketVerificationResult[];
  summary: {
    total: number;
    verified: number;
    consumed: number;
    rejected: number;
  };
}

function isUniqueConstraintError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const candidate = error as { code?: unknown; message?: unknown };
  return (
    candidate.code === "P2002" ||
    (typeof candidate.message === "string" &&
      candidate.message.includes("Unique constraint"))
  );
}

export async function POST(req: NextRequest) {
  // 1. Authentication Check via Clerk
  const { userId, sessionClaims } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // 2. Parse request JSON body
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  // 3. Request schema validation
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed.", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { venueId, proofs } = parsed.data;

  // 4. Rate Limiting check (IP & user scoped)
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    "127.0.0.1";
  const rateLimitKey = `zkp-batch:${userId}:${venueId}:${ip}`;
  const isAllowed = await rateLimit(rateLimitKey, 20);
  if (!isAllowed) {
    return NextResponse.json(
      { error: "Too many requests. Please try again later." },
      { status: 429 },
    );
  }

  // 5. Venue Existence & Authorization Verification
  const venue = await prisma.venue.findFirst({
    where: { OR: [{ id: venueId }, { placeId: venueId }] },
    select: { id: true, name: true, ownerId: true, creatorId: true },
  });

  if (!venue) {
    return NextResponse.json({ error: "Venue not found." }, { status: 404 });
  }

  const role = (
    (sessionClaims?.metadata as Record<string, any>)?.role ||
    (sessionClaims as Record<string, any>)?.role ||
    (sessionClaims as Record<string, any>)?.org_role
  )?.toLowerCase();

  const isVenueAuthorized =
    venue.ownerId === userId ||
    venue.creatorId === userId ||
    role === "manager" ||
    role === "venue_manager" ||
    role === "admin" ||
    role === "super_admin";

  if (!isVenueAuthorized) {
    return NextResponse.json(
      { error: "Forbidden: Venue manager access required." },
      { status: 403 },
    );
  }

  // 6. Pre-validate public signals per proof item
  // publicSignals order: [merkleRoot, signalNullifierHash, signalVenueId, epochSignal]
  const initialResults: TicketVerificationResult[] = [];
  const validForCryptoVerification: {
    index: number;
    proof: unknown;
    publicSignals: string[];
    nullifierHash: string;
    epoch: number;
  }[] = [];

  for (let index = 0; index < proofs.length; index++) {
    const item = proofs[index];
    const ticketId =
      item.ticketId || item.nullifierHash || `ticket-${index + 1}`;
    const [merkleRoot, signalNullifierHash, signalVenueId, epochSignal] =
      item.publicSignals;
    const epoch = Number(epochSignal);

    const explicitNullifier = item.nullifierHash;
    const nullifierMismatch =
      explicitNullifier && explicitNullifier !== signalNullifierHash;

    if (
      merkleRoot === "" ||
      signalNullifierHash === "" ||
      signalVenueId !== venueId ||
      nullifierMismatch ||
      !Number.isSafeInteger(epoch) ||
      epoch <= 0
    ) {
      initialResults.push({
        index,
        ticketId,
        valid: false,
        consumed: false,
        status: "invalid_payload",
        reason:
          "Public signals must include a valid merkleRoot, matching nullifier, target venueId, and positive integer epoch.",
        nullifierHash: signalNullifierHash || undefined,
      });
      continue;
    }

    validForCryptoVerification.push({
      index,
      proof: item.proof,
      publicSignals: item.publicSignals,
      nullifierHash: signalNullifierHash,
      epoch,
    });
  }

  // 7. Execute Cryptographic Verification for structurally valid items
  let cryptoResults: Awaited<ReturnType<typeof verifyZkNullifierProofs>> = [];
  if (validForCryptoVerification.length > 0) {
    try {
      cryptoResults = await verifyZkNullifierProofs(
        validForCryptoVerification.map(({ proof, publicSignals }) => ({
          proof,
          publicSignals,
        })),
        { preventReplay: false },
      );
    } catch {
      return NextResponse.json(
        { error: "ZK proof verifier is unavailable." },
        { status: 500 },
      );
    }
  }

  // 8. Map cryptographic results and detect duplicate nullifiers within the same batch
  const intermediateResults: TicketVerificationResult[] = [...initialResults];
  const seenBatchNullifiers = new Set<string>();
  const candidatesForPersistence: {
    index: number;
    ticketId: string;
    nullifierHash: string;
    epoch: number;
  }[] = [];

  validForCryptoVerification.forEach((item, i) => {
    const origItem = proofs[item.index];
    const ticketId =
      origItem.ticketId || origItem.nullifierHash || `ticket-${item.index + 1}`;
    const isCryptoValid = cryptoResults[i]?.valid === true;

    if (!isCryptoValid) {
      intermediateResults.push({
        index: item.index,
        ticketId,
        valid: false,
        consumed: false,
        status: "invalid_proof",
        reason: "Zero-knowledge proof verification failed.",
        nullifierHash: item.nullifierHash,
      });
      return;
    }

    // Check duplicate within the same submitted batch
    if (seenBatchNullifiers.has(item.nullifierHash)) {
      intermediateResults.push({
        index: item.index,
        ticketId,
        valid: true,
        consumed: false,
        status: "duplicate_in_batch",
        reason: "Duplicate nullifier detected within the same batch.",
        nullifierHash: item.nullifierHash,
      });
      return;
    }

    seenBatchNullifiers.add(item.nullifierHash);
    candidatesForPersistence.push({
      index: item.index,
      ticketId,
      nullifierHash: item.nullifierHash,
      epoch: item.epoch,
    });
  });

  // 9. Atomic Nullifier Consumption: Check-and-consume independently
  // Concurrency-safe per-item consumption using individual transactions/inserts
  // with ON CONFLICT / unique constraint isolation.
  if (candidatesForPersistence.length > 0) {
    await Promise.all(
      candidatesForPersistence.map(async (candidate) => {
        try {
          await prisma.venueCheckInNullifier.create({
            data: {
              nullifierHash: candidate.nullifierHash,
              epoch: candidate.epoch,
              venueId,
            },
          });
          intermediateResults.push({
            index: candidate.index,
            ticketId: candidate.ticketId,
            valid: true,
            consumed: true,
            status: "verified",
            nullifierHash: candidate.nullifierHash,
          });
        } catch (error) {
          if (isUniqueConstraintError(error)) {
            intermediateResults.push({
              index: candidate.index,
              ticketId: candidate.ticketId,
              valid: true,
              consumed: false,
              status: "already_consumed",
              reason: "Nullifier has already been consumed for this epoch.",
              nullifierHash: candidate.nullifierHash,
            });
          } else {
            intermediateResults.push({
              index: candidate.index,
              ticketId: candidate.ticketId,
              valid: true,
              consumed: false,
              status: "already_consumed",
              reason: "Failed to persist nullifier due to storage conflict.",
              nullifierHash: candidate.nullifierHash,
            });
          }
        }
      }),
    );
  }

  // 10. Sort results by original input array index for stable, deterministic ordering
  intermediateResults.sort((a, b) => a.index - b.index);

  // 11. Compile summary statistics
  const total = intermediateResults.length;
  const verified = intermediateResults.filter((r) => r.valid).length;
  const consumed = intermediateResults.filter((r) => r.consumed).length;
  const rejected = total - consumed;

  const response: BatchZkpVerifyResponse = {
    results: intermediateResults,
    summary: {
      total,
      verified,
      consumed,
      rejected,
    },
  };

  return NextResponse.json(response, { status: 200 });
}
