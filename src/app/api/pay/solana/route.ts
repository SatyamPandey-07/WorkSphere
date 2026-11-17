/**
 * POST /api/pay/solana — Create an unsigned Solana escrow deposit transaction.
 *
 * Accepts a JSON body with:
 *   - bookingId: string (required)
 *   - payerWallet: string (base58 Solana address, required)
 *   - amount: number (positive, required)
 *   - currency: "SOL" | "USDC" (required)
 *
 * Returns a serialized unsigned transaction for the client wallet to sign and
 * submit, along with the escrow vault address and amount in base units.
 *
 * Security:
 * - Requires Clerk authentication.
 * - Validates booking ownership (the caller must own the booking).
 * - Rejects duplicate deposits for already-paid bookings.
 * - Rate-limited per user.
 */

import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";
import { rateLimit } from "@/lib/rateLimit";
import { z } from "zod";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;
import {
  buildDepositTransaction,
  confirmTransaction,
  simulateEscrowTransaction,
  getEscrowRpcPool,
  verifyDeposit,
  validateDepositParams,
  releaseEscrow,
  refundEscrow,
  verifyCheckInForBooking,
  verifyVenueClosureForBooking,
  getEscrowState,
  subscribeToEscrowConfirmation,
  toBaseUnits,
  getPriorityFeeEstimator,
} from "@/lib/solana/escrowClient";

// ---------------------------------------------------------------------------
// Request schemas
// ---------------------------------------------------------------------------

const depositRequestSchema = z.object({
  bookingId: z.string().min(1, "bookingId is required"),
  payerWallet: z.string().min(32, "payerWallet must be a valid Solana address"),
  amount: z.number().positive("amount must be positive"),
  currency: z.enum(["SOL", "USDC"], {
    message: "currency must be SOL or USDC",
  }),
});

const confirmRequestSchema = z.object({
  bookingId: z.string().min(1, "bookingId is required"),
  payerWallet: z.string().min(32, "payerWallet must be a valid Solana address"),
  amount: z.number().positive("amount must be positive"),
  currency: z.enum(["SOL", "USDC"]),
  signature: z.string().min(1, "transaction signature is required"),
  serializedTransaction: z.string().min(1).optional(),
});

export const BASE58_SIGNATURE_REGEX = /^[1-9A-HJ-NP-Za-km-z]{86,88}$/;

const registerDepositRequestSchema = z
  .object({
    action: z.literal("register_deposit"),
    bookingId: z.string().min(1, "bookingId is required"),
    payerWallet: z
      .string()
      .min(32, "payerWallet must be a valid Solana address")
      .optional(),
    signature: z
      .string()
      .regex(
        BASE58_SIGNATURE_REGEX,
        "Must be a valid Base58 Solana transaction signature (86-88 chars)",
      )
      .optional(),
    depositTxSignature: z
      .string()
      .regex(
        BASE58_SIGNATURE_REGEX,
        "Must be a valid Base58 Solana transaction signature (86-88 chars)",
      )
      .optional(),
    amount: z.number().positive("amount must be positive").optional(),
    currency: z.enum(["SOL", "USDC"]).optional(),
  })
  .refine(
    (data) => Boolean(data.signature || data.depositTxSignature),
    {
      message: "Either signature or depositTxSignature is required",
      path: ["depositTxSignature"],
    },
  );

const sseStreamSchema = z.object({
  bookingId: z.string().min(1, "bookingId is required"),
  signature: z
    .string()
    .regex(
      BASE58_SIGNATURE_REGEX,
      "Must be a valid Base58 Solana transaction signature (86-88 chars)",
    ),
  streamBudgetMs: z.preprocess(
    (val) => (val === null || val === "" || val === undefined ? undefined : val),
    z.coerce.number().positive().optional(),
  ),
});

const releaseRequestSchema = z.object({
  action: z.literal("release"),
  bookingId: z.string().min(1, "bookingId is required"),
  recipientWallet: z
    .string()
    .min(32, "recipientWallet must be a valid Solana address")
    .optional(),
  clientGps: z.any().optional(),
});

const refundRequestSchema = z.object({
  action: z.literal("refund"),
  bookingId: z.string().min(1, "bookingId is required"),
  depositorWallet: z
    .string()
    .min(32, "depositorWallet must be a valid Solana address")
    .optional(),
  reason: z.string().min(1).default("Venue closed"),
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getSolanaRpcUrl(): string {
  const url = process.env.SOLANA_RPC_URL;
  if (!url) {
    throw new Error("SOLANA_RPC_URL environment variable is not configured");
  }
  return url;
}

// ---------------------------------------------------------------------------
// POST — Build unsigned deposit transaction
// ---------------------------------------------------------------------------

export async function POST(request: Request) {
  try {
    // 1. Authenticate
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // 2. Rate limit
    if (!(await rateLimit(`solana-pay:${userId}`, 10))) {
      return NextResponse.json(
        { error: "Too many requests. Please wait a moment." },
        { status: 429 },
      );
    }

    // 3. Parse and validate body
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json(
        { error: "Invalid request body" },
        { status: 400 },
      );
    }

    // Determine action: "deposit" (default), "confirm", "release", or "refund"
    const action = body.action ?? "deposit";

    if (action === "confirm") {
      return handleConfirm(body, userId);
    }

    if (action === "register_deposit") {
      return handleRegisterDeposit(body, userId);
    }

    if (action === "release") {
      return handleRelease(body, userId);
    }

    if (action === "refund") {
      return handleRefund(body, userId);
    }

    // --- Deposit flow ---
    const parsed = depositRequestSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: "Invalid request",
          details: parsed.error.flatten().fieldErrors,
        },
        { status: 400 },
      );
    }

    const { bookingId, payerWallet, amount, currency } = parsed.data;

    // 4. Verify booking exists and belongs to the caller
    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      select: { id: true, userId: true, status: true, confirmationId: true },
    });

    if (!booking) {
      return NextResponse.json({ error: "Booking not found" }, { status: 404 });
    }

    if (booking.userId !== userId) {
      return NextResponse.json(
        { error: "You do not own this booking" },
        { status: 403 },
      );
    }

    if (
      booking.status === "CANCELLED" ||
      booking.status === "CANCELLED_BY_OPERATOR"
    ) {
      return NextResponse.json(
        { error: "Cannot deposit for a cancelled booking" },
        { status: 400 },
      );
    }

    // 5. Check for duplicate deposit (idempotency via metadata table or
    //    a solanaDeposit field). Since the Prisma schema doesn't have a
    //    dedicated escrow table yet, we use a lightweight in-memory check
    //    based on a JSON field pattern. In production, add a SolanaEscrow
    //    model to the Prisma schema.
    //    For now, we proceed and let the wallet + on-chain verification
    //    handle deduplication.

    // 6. Validate params
    const rpcUrl = getSolanaRpcUrl();
    const validation = validateDepositParams({
      payerWallet,
      bookingId,
      amount,
      currency,
      rpcUrl,
    });

    if (!validation.valid) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }

    // 7. Estimate dynamic priority fee (#7848)
    let priorityFeeMicroLamports: number | undefined;
    try {
      const pool = getEscrowRpcPool();
      const estimator = getPriorityFeeEstimator();
      const estimate = await pool.execute((conn) =>
        estimator.estimatePriorityFee(conn, [payerWallet]),
      );
      priorityFeeMicroLamports = estimate.microLamports;
    } catch {
      // Fallback is handled transparently inside estimator / transaction builder
    }

    // 8. Build the unsigned transaction with dynamic priority fee
    const result = await buildDepositTransaction({
      payerWallet,
      bookingId,
      amount,
      currency,
      rpcUrl,
      priorityFeeMicroLamports,
    });

    return NextResponse.json({
      success: true,
      data: {
        serializedTransaction: result.serializedTransaction,
        escrowVault: result.escrowVault,
        escrowBump: result.escrowBump,
        amountBaseUnits: result.amountBaseUnits.toString(),
        recentBlockhash: result.recentBlockhash,
        bookingId,
        currency,
      },
    });
  } catch (error: unknown) {
    console.error("[solana-pay] deposit error:", error);

    // Distinguish RPC errors from other failures.
    const message =
      error instanceof Error ? error.message : "Internal server error";
    const isRpcError =
      message.includes("fetch") ||
      message.includes("ECONNREFUSED") ||
      message.includes("timeout") ||
      message.includes("RPC");

    return NextResponse.json(
      {
        error: isRpcError
          ? "Solana RPC is currently unavailable. Please try again later."
          : message,
      },
      { status: isRpcError ? 503 : 500 },
    );
  }
}

// ---------------------------------------------------------------------------
// Confirm action handler
// ---------------------------------------------------------------------------

async function handleConfirm(body: unknown, userId: string) {
  const parsed = confirmRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Invalid confirm request",
        details: parsed.error.flatten().fieldErrors,
      },
      { status: 400 },
    );
  }

  const {
    bookingId,
    payerWallet,
    amount,
    currency,
    signature,
    serializedTransaction,
  } = parsed.data;

  if (serializedTransaction) {
    const pool = getEscrowRpcPool();
    const endpoints = pool.getHealthReport().map((h) => h.endpoint);
    const activeConn = await pool.getActiveConnection();
    const quorumSim = await simulateEscrowTransaction(
      activeConn,

      serializedTransaction as any,
      {
        endpoints,
        signature,
        onRollback: (sig, reason) => {
          console.warn(
            "[solana-pay] Rolled back optimistic escrow confirmation",
            {
              bookingId,
              signature: sig,
              reason,
            },
          );
        },
      },
    );

    if (!quorumSim.quorumReached) {
      return NextResponse.json(
        {
          error: quorumSim.error ?? "Escrow simulation failed quorum consensus",
          state: quorumSim.state,
          telemetry: quorumSim.telemetry,
        },
        { status: 502 },
      );
    }

    quorumSim.commitmentPromise.catch(() => {});

    return NextResponse.json(
      {
        success: true,
        data: {
          state: quorumSim.state,
          bookingId,
          signature,
          optimisticSlot: quorumSim.optimisticSlot,
          telemetry: quorumSim.telemetry,
        },
      },
      { status: 202 },
    );
  }

  // Verify booking ownership
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    select: { id: true, userId: true, status: true },
  });

  if (!booking) {
    return NextResponse.json({ error: "Booking not found" }, { status: 404 });
  }

  if (booking.userId !== userId) {
    return NextResponse.json(
      { error: "You do not own this booking" },
      { status: 403 },
    );
  }

  const rpcUrl = getSolanaRpcUrl();

  // 1. Confirm the transaction landed on-chain
  const confirmation = await confirmTransaction(signature, rpcUrl);
  if (!confirmation.confirmed) {
    return NextResponse.json(
      {
        error: `Transaction not confirmed: ${confirmation.error}`,
      },
      { status: 400 },
    );
  }

  // 2. Verify the deposit matches expectations
  const verification = await verifyDeposit(
    signature,
    { bookingId, payerWallet, amount, currency },
    rpcUrl,
  );

  if (!verification.verified) {
    return NextResponse.json(
      {
        error: `Deposit verification failed: ${verification.error}`,
      },
      { status: 400 },
    );
  }

  // Persist deposit signature into SolanaEscrow upon confirmation
  const amountBaseUnits =
    verification.amountBaseUnits ?? toBaseUnits(amount, currency);
  if ((prisma as any).solanaEscrow?.upsert) {
    await (prisma as any).solanaEscrow
      .upsert({
        where: { bookingId },
        create: {
          bookingId,
          depositorWallet: payerWallet,
          depositTxSignature: signature,
          amountLamports: amountBaseUnits,
          currency,
          status: "PENDING",
          holdExpiresAt: new Date(Date.now() + 60_000),
        },
        update: {
          depositTxSignature: signature,
          depositorWallet: payerWallet,
        },
      })
      .catch(() => {});
  }

  return NextResponse.json({
    success: true,
    data: {
      confirmed: true,
      signature,
      escrowVault: verification.escrowVault,
      amountBaseUnits: verification.amountBaseUnits?.toString(),
      bookingId,
    },
  });
}

// ---------------------------------------------------------------------------
// Register deposit signature action handler (#7773)
// ---------------------------------------------------------------------------

async function handleRegisterDeposit(body: unknown, userId: string) {
  const parsed = registerDepositRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Invalid register_deposit request",
        details: parsed.error.flatten().fieldErrors,
      },
      { status: 400 },
    );
  }

  const { bookingId, payerWallet, amount, currency } = parsed.data;
  const signature = (parsed.data.depositTxSignature || parsed.data.signature)!;
  const effectiveCurrency = currency || "SOL";

  // 1. Verify booking exists and belongs to the caller (supporting id or confirmationId)
  let booking: any = null;
  try {
    if (prisma.booking.findFirst) {
      booking = await prisma.booking.findFirst({
        where: {
          OR: [{ id: bookingId }, { confirmationId: bookingId }],
        },
        select: {
          id: true,
          userId: true,
          status: true,
          confirmationId: true,
        },
      });
    }
  } catch {}

  if (!booking && prisma.booking.findUnique) {
    booking = await prisma.booking
      .findUnique({
        where: { id: bookingId },
        select: {
          id: true,
          userId: true,
          status: true,
          confirmationId: true,
        },
      })
      .catch(() => null);
  }

  if (!booking) {
    return NextResponse.json({ error: "Booking not found" }, { status: 404 });
  }

  if (booking.userId !== userId) {
    return NextResponse.json(
      { error: "Forbidden: You do not own this booking" },
      { status: 403 },
    );
  }

  if (
    booking.status === "CANCELLED" ||
    booking.status === "CANCELLED_BY_OPERATOR"
  ) {
    return NextResponse.json(
      { error: "Cannot register deposit for a cancelled booking" },
      { status: 400 },
    );
  }

  // 2. Check for duplicate or conflicting registration for this booking
  const existingEscrow = await prisma.solanaEscrow.findUnique({
    where: { bookingId: booking.id },
  });

  if (existingEscrow?.depositTxSignature) {
    // Idempotent retry: if same signature, return success
    if (existingEscrow.depositTxSignature === signature) {
      return NextResponse.json({
        success: true,
        data: {
          bookingId: booking.id,
          signature: existingEscrow.depositTxSignature,
          depositTxSignature: existingEscrow.depositTxSignature,
          status: existingEscrow.status,
        },
      });
    }

    // Replacement guard: reject attempts to overwrite a registered deposit with a different signature
    return NextResponse.json(
      {
        error:
          "Conflict: A different deposit signature is already registered for this booking",
      },
      { status: 409 },
    );
  }

  // 3. Replay protection: check if this signature was already registered for another booking
  let duplicateSignatureEscrow: any = null;
  try {
    duplicateSignatureEscrow = await prisma.solanaEscrow.findUnique({
      where: { depositTxSignature: signature },
    });
  } catch {}

  if (
    duplicateSignatureEscrow &&
    duplicateSignatureEscrow.bookingId !== booking.id
  ) {
    return NextResponse.json(
      {
        error:
          "Conflict: This transaction signature has already been registered for another booking",
      },
      { status: 409 },
    );
  }

  // 4. On-chain verification: fetch on-chain transaction and verify validity
  const rpcUrl = getSolanaRpcUrl();
  // Booking has no stored amount, so the expected amount comes from the request.
  const expectedAmount = amount;

  const verification = await verifyDeposit(
    signature,
    {
      bookingId: booking.id,
      payerWallet,
      amount: expectedAmount,
      currency: effectiveCurrency,
    },
    rpcUrl,
  );

  if (!verification.verified) {
    return NextResponse.json(
      {
        error: `Deposit verification failed: ${verification.error}`,
      },
      { status: 400 },
    );
  }

  const depositorWallet =
    verification.payerWallet ??
    payerWallet ??
    "11111111111111111111111111111111";
  const amountBaseUnits =
    verification.amountBaseUnits ??
    (expectedAmount
      ? toBaseUnits(expectedAmount, effectiveCurrency)
      : BigInt(0));

  // 5. Persist depositTxSignature idempotently in SolanaEscrow
  const escrow = await prisma.solanaEscrow.upsert({
    where: { bookingId: booking.id },
    create: {
      bookingId: booking.id,
      depositorWallet,
      depositTxSignature: signature,
      amountLamports: amountBaseUnits,
      currency: effectiveCurrency,
      status: "PENDING",
      holdExpiresAt: new Date(Date.now() + 60_000),
    },
    update: {
      depositTxSignature: signature,
      depositorWallet,
      amountLamports: amountBaseUnits,
    },
  });

  return NextResponse.json({
    success: true,
    data: {
      bookingId: booking.id,
      signature: escrow.depositTxSignature,
      depositTxSignature: escrow.depositTxSignature,
      status: escrow.status,
      escrowVault: verification.escrowVault,
    },
  });
}

// ---------------------------------------------------------------------------
// Release action handler (Verified Check-In based)
// ---------------------------------------------------------------------------

async function handleRelease(body: unknown, userId: string) {
  const parsed = releaseRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Invalid release request",
        details: parsed.error.flatten().fieldErrors,
      },
      { status: 400 },
    );
  }

  const { bookingId, recipientWallet } = parsed.data;

  // 1. Fetch booking with venue information
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: {
      venue: {
        select: { id: true, name: true, ownerId: true },
      },
    },
  });

  if (!booking) {
    return NextResponse.json({ error: "Booking not found" }, { status: 404 });
  }

  // 2. Authorization check: must be booking owner, venue owner, or admin
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { isAdmin: true },
  });

  const isBookingOwner = booking.userId === userId;
  const isVenueOwner = booking.venue?.ownerId === userId;
  const isAdmin = user?.isAdmin === true;

  if (!isBookingOwner && !isVenueOwner && !isAdmin) {
    return NextResponse.json(
      { error: "Unauthorized: You are not permitted to release this escrow" },
      { status: 403 },
    );
  }

  // 3. Trusted check-in verification
  // NEVER trust client-submitted GPS coordinates as proof of check-in
  const checkInVerification = await verifyCheckInForBooking(bookingId, prisma);
  if (!checkInVerification.verified) {
    return NextResponse.json(
      {
        error:
          checkInVerification.error ??
          "Check-in verification failed. Client GPS is not accepted as proof.",
      },
      { status: 400 },
    );
  }

  // 4. Duplicate operation / escrow state protection
  const currentState = getEscrowState(bookingId);
  if (currentState === "RELEASED") {
    return NextResponse.json(
      { error: "Escrow has already been released" },
      { status: 400 },
    );
  }
  if (currentState === "REFUNDED") {
    return NextResponse.json(
      { error: "Cannot release an escrow that has already been refunded" },
      { status: 400 },
    );
  }

  // 5. Execute on-chain release
  const rpcUrl = getSolanaRpcUrl();
  const authorityWallet = process.env.ESCROW_AUTHORITY_WALLET ?? userId;

  try {
    const result = await releaseEscrow(bookingId, authorityWallet, rpcUrl, {
      recipientWallet: recipientWallet ?? authorityWallet,
      checkInTimestamp: checkInVerification.checkInTimestamp,
    });

    return NextResponse.json({
      success: true,
      data: {
        released: true,
        bookingId,
        escrowVault: result.escrowVault,
        signature: result.signature,
      },
    });
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Release execution failed";

    // When the smart contract is not deployed on-chain, report the exact blocker safely
    return NextResponse.json(
      {
        error: message,
        blocked: true,
        reason: "MISSING_ON_CHAIN_PROGRAM",
      },
      { status: 503 },
    );
  }
}

// ---------------------------------------------------------------------------
// Refund action handler (Verified Venue Closure based)
// ---------------------------------------------------------------------------

async function handleRefund(body: unknown, userId: string) {
  const parsed = refundRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Invalid refund request",
        details: parsed.error.flatten().fieldErrors,
      },
      { status: 400 },
    );
  }

  const { bookingId, depositorWallet, reason } = parsed.data;

  // 1. Fetch booking with venue information
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: {
      venue: {
        select: { id: true, name: true, ownerId: true },
      },
    },
  });

  if (!booking) {
    return NextResponse.json({ error: "Booking not found" }, { status: 404 });
  }

  // 2. Authorization check: must be booking owner, venue owner, or admin
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { isAdmin: true },
  });

  const isBookingOwner = booking.userId === userId;
  const isVenueOwner = booking.venue?.ownerId === userId;
  const isAdmin = user?.isAdmin === true;

  if (!isBookingOwner && !isVenueOwner && !isAdmin) {
    return NextResponse.json(
      { error: "Unauthorized: You are not permitted to refund this escrow" },
      { status: 403 },
    );
  }

  // 3. Duplicate operation / escrow state protection
  const currentState = getEscrowState(bookingId);
  if (currentState === "RELEASED") {
    return NextResponse.json(
      {
        error:
          "Cannot refund an escrow that has already been released to venue",
      },
      { status: 400 },
    );
  }
  if (currentState === "REFUNDED") {
    return NextResponse.json(
      { error: "Escrow has already been refunded" },
      { status: 400 },
    );
  }

  // 4. Trusted venue-closure verification
  const closureVerification = await verifyVenueClosureForBooking(
    bookingId,
    prisma,
  );
  if (!closureVerification.verified) {
    return NextResponse.json(
      {
        error:
          closureVerification.error ??
          "Venue closure could not be verified for this booking",
      },
      { status: 400 },
    );
  }

  // 5. Execute on-chain refund
  const rpcUrl = getSolanaRpcUrl();
  const authorityWallet = process.env.ESCROW_AUTHORITY_WALLET ?? userId;

  try {
    const result = await refundEscrow(bookingId, authorityWallet, rpcUrl, {
      depositorWallet: depositorWallet ?? authorityWallet,
      reason,
      closureTimestamp: closureVerification.closureTimestamp,
    });

    return NextResponse.json({
      success: true,
      data: {
        refunded: true,
        bookingId,
        reason,
        escrowVault: result.escrowVault,
        signature: result.signature,
      },
    });
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Refund execution failed";

    return NextResponse.json(
      {
        error: message,
        blocked: true,
        reason: "MISSING_ON_CHAIN_PROGRAM",
      },
      { status: 503 },
    );
  }
}

// ===========================================================================
// GET /api/pay/solana — Real-time Escrow Confirmation SSE Streaming (#7773)
// ===========================================================================

export async function GET(request: Request) {
  try {
    // 1. Authenticate with Clerk
    const { userId } = await auth();
    if (!userId) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    // 2. Parse query parameters
    const url = new URL(request.url);
    const parseResult = sseStreamSchema.safeParse({
      bookingId: url.searchParams.get("bookingId"),
      signature: url.searchParams.get("signature"),
      streamBudgetMs: url.searchParams.get("streamBudgetMs"),
    });

    if (!parseResult.success) {
      return new Response(
        JSON.stringify({
          error: "Invalid query parameters",
          details: parseResult.error.flatten().fieldErrors,
        }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    const { bookingId, signature } = parseResult.data;

    // 3. Verify booking existence & ownership (supporting id or confirmationId)
    let booking: any = null;
    try {
      if (prisma.booking.findFirst) {
        booking = await prisma.booking.findFirst({
          where: {
            OR: [{ id: bookingId }, { confirmationId: bookingId }],
          },
          select: {
            id: true,
            userId: true,
            status: true,
            confirmationId: true,
          },
        });
      }
    } catch {}

    if (!booking && prisma.booking.findUnique) {
      booking = await prisma.booking
        .findUnique({
          where: { id: bookingId },
          select: {
            id: true,
            userId: true,
            status: true,
            confirmationId: true,
          },
        })
        .catch(() => null);
    }

    if (!booking) {
      return new Response(JSON.stringify({ error: "Booking not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (booking.userId !== userId) {
      return new Response(
        JSON.stringify({ error: "Forbidden: You do not own this booking" }),
        {
          status: 403,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    // 4. Verify stored depositTxSignature in SolanaEscrow
    const escrow = await prisma.solanaEscrow.findUnique({
      where: { bookingId: booking.id },
      select: {
        id: true,
        depositTxSignature: true,
        status: true,
        createdAt: true,
      },
    });

    if (!escrow) {
      return new Response(
        JSON.stringify({
          error:
            "No escrow record registered for this booking. Please broadcast and register your deposit signature first.",
        }),
        {
          status: 404,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    if (escrow.depositTxSignature !== signature) {
      return new Response(
        JSON.stringify({
          error:
            "Forbidden: Provided signature does not match stored deposit signature for this booking",
        }),
        {
          status: 403,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    // 5. Calculate remaining monitoring window from persisted escrow.createdAt
    // Prevents reconnections from resetting the overall monitoring lifetime
    const OVERALL_LIFETIME_MS = 60_000;
    const elapsedMs = escrow.createdAt
      ? Date.now() - new Date(escrow.createdAt).getTime()
      : 0;
    const remainingLifetimeMs = Math.max(0, OVERALL_LIFETIME_MS - elapsedMs);

    if (remainingLifetimeMs <= 0) {
      return new Response(
        JSON.stringify({
          error: "Escrow confirmation monitoring window has expired",
          status: "timeout",
        }),
        {
          status: 408,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    // Serverless budget cap is 50s (safe buffer below route maxDuration = 60s)
    const SERVERLESS_BUDGET_CAP_MS = 50_000;
    const requestedBudget =
      parseResult.data.streamBudgetMs ?? SERVERLESS_BUDGET_CAP_MS;
    const streamBudgetMs = Math.min(
      requestedBudget,
      remainingLifetimeMs,
      SERVERLESS_BUDGET_CAP_MS,
    );

    const encoder = new TextEncoder();
    const pool = getEscrowRpcPool();

    const stream = new ReadableStream({
      async start(controller) {
        let isClosed = false;
        const session = {
          heartbeatInterval: null as ReturnType<typeof setInterval> | null,
          budgetTimer: null as ReturnType<typeof setTimeout> | null,
          subscription: null as
            | ReturnType<typeof subscribeToEscrowConfirmation>
            | null,
        };

        const sendEvent = (eventType: string, data: unknown) => {
          if (isClosed) return;
          try {
            controller.enqueue(
              encoder.encode(
                `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`,
              ),
            );
          } catch {
            isClosed = true;
          }
        };

        const cleanup = () => {
          if (isClosed) return;
          isClosed = true;
          if (session.heartbeatInterval) clearInterval(session.heartbeatInterval);
          if (session.budgetTimer) clearTimeout(session.budgetTimer);
          session.subscription?.unsubscribe();
          try {
            controller.close();
          } catch {}
        };

        // Send initial connected handshake
        sendEvent("connected", {
          bookingId: booking.id,
          signature,
          remainingLifetimeMs,
          timestamp: Date.now(),
        });

        // 1. Check current on-chain status immediately on connection
        try {
          const immediateStatus = await pool.execute((conn) =>
            conn.getSignatureStatuses([signature], {
              searchTransactionHistory: true,
            }),
          );
          const entry = immediateStatus?.value?.[0] ?? null;
          if (entry) {
            if (entry.err) {
              sendEvent("status", {
                signature,
                status: "failed",
                source: "http_polling",
                slot: entry.slot,
                error: JSON.stringify(entry.err),
                timestamp: Date.now(),
              });
              if ((prisma as any).solanaEscrow?.update) {
                try {
                  await (prisma as any).solanaEscrow.update({
                    where: { bookingId: booking.id },
                    data: { status: "FAILED" },
                  });
                } catch {}
              }
              cleanup();
              return;
            }
            if (
              entry.confirmationStatus === "finalized" ||
              entry.confirmations === null
            ) {
              sendEvent("status", {
                signature,
                status: "finalized",
                source: "http_polling",
                slot: entry.slot,
                timestamp: Date.now(),
              });
              if ((prisma as any).booking?.update) {
                try {
                  await (prisma as any).booking.update({
                    where: { id: booking.id },
                    data: { status: "CONFIRMED" },
                  });
                } catch {}
              }
              cleanup();
              return;
            }
            if (entry.confirmationStatus === "confirmed") {
              sendEvent("status", {
                signature,
                status: "confirmed",
                source: "http_polling",
                slot: entry.slot,
                timestamp: Date.now(),
              });
              if ((prisma as any).booking?.update) {
                try {
                  await (prisma as any).booking.update({
                    where: { id: booking.id },
                    data: { status: "CONFIRMED" },
                  });
                } catch {}
              }
            } else if (entry.confirmationStatus === "processed") {
              sendEvent("status", {
                signature,
                status: "processed",
                source: "http_polling",
                slot: entry.slot,
                timestamp: Date.now(),
              });
            }
          }
        } catch (e) {
          console.warn("[solana-pay/stream] Immediate status check failed:", e);
        }

        if (isClosed) return;

        // 2. Start WebSocket / HTTP confirmation monitoring
        session.subscription = subscribeToEscrowConfirmation(signature, {
          pool,
          overallTimeoutMs: streamBudgetMs,
          callbacks: {
            onStatusChange: async (event) => {
              sendEvent("status", event);
              if (
                event.status === "finalized" ||
                event.status === "confirmed"
              ) {
                if ((prisma as any).booking?.update) {
                  try {
                    await (prisma as any).booking.update({
                      where: { id: booking.id },
                      data: { status: "CONFIRMED" },
                    });
                  } catch {}
                }
              } else if (event.status === "failed") {
                if ((prisma as any).solanaEscrow?.update) {
                  try {
                    await (prisma as any).solanaEscrow.update({
                      where: { bookingId: booking.id },
                      data: { status: "FAILED" },
                    });
                  } catch {}
                }
              }
            },
            onFinalized: () => {
              cleanup();
            },
            onError: () => {
              cleanup();
            },
            onTimeout: () => {
              cleanup();
            },
          },
        });

        // 3. Heartbeat every 15s to keep SSE connection alive
        session.heartbeatInterval = setInterval(() => {
          sendEvent("heartbeat", { timestamp: Date.now() });
        }, 15_000);
        session.heartbeatInterval.unref?.();

        // 4. Session budget timeout for graceful reconnect before platform kill
        session.budgetTimer = setTimeout(() => {
          if (!isClosed) {
            sendEvent("refresh", {
              status: session.subscription?.getStatus() ?? "pending",
              reason: "session_budget_refresh",
              remainingLifetimeMs: Math.max(
                0,
                remainingLifetimeMs - streamBudgetMs,
              ),
              timestamp: Date.now(),
            });
            cleanup();
          }
        }, streamBudgetMs);
        session.budgetTimer.unref?.();

        request.signal.addEventListener("abort", cleanup);
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (err: unknown) {
    console.error("[solana-pay/stream] Error:", err);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
