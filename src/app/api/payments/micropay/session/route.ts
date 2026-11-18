/**
 * route.ts
 * /api/payments/micropay/session
 * Manages live pay-as-you-go micro-billing sessions for desks.
 *
 * Persisted durably in PostgreSQL via Prisma (#8436).
 * Replaces process-local in-memory Map with shared, concurrency-safe storage
 * to guarantee session survival across server restarts and multi-instance consistency.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  MicroPaymentEngine,
  PaymentRail,
  LIVE_EXCHANGE_RATES,
} from "@/lib/payments/microPaymentEngine";
import {
  MicroBillingPersistenceService,
  SessionNotFoundError,
  UnauthorizedSessionAccessError,
} from "@/lib/payments/microBillingPersistence";
import { auth } from "@clerk/nextjs/server";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const action =
      body.action ||
      (body.satoshiAmount !== undefined || body.sats !== undefined
        ? "invoice"
        : "start");

    // Optional user authentication context
    let currentUserId: string | undefined = undefined;
    try {
      const authResult = await auth();
      if (authResult?.userId) {
        currentUserId = authResult.userId;
      }
    } catch {
      // Unauthenticated or optional auth environment
    }

    // Strict satoshi schema validation across all micro-payment actions
    const rawSats =
      body.satoshiAmount ??
      body.sats ??
      body.amountSats ??
      body.satoshis ??
      (body.paymentRail === "lightning" && body.amount !== undefined
        ? body.amount
        : undefined);

    if (rawSats !== undefined) {
      const validation = MicroPaymentEngine.validateSatoshiAmount(rawSats);
      if (!validation.isValid) {
        return NextResponse.json(
          {
            error:
              validation.error ||
              "Invalid satoshi amount: value must be a strictly positive integer (> 0)",
          },
          { status: 400 },
        );
      }
    }

    // Action: Generate micro-payment invoice (e.g. BOLT11 Lightning Invoice)
    if (
      action === "invoice" ||
      action === "create_invoice" ||
      action === "lightning_invoice"
    ) {
      const paymentRail: PaymentRail = body.paymentRail || "lightning";
      const sessionId = body.sessionId || `mbill-${Date.now()}`;

      const amountUsd =
        body.amountUsd !== undefined ? Number(body.amountUsd) : undefined;

      if (paymentRail === "lightning") {
        if (rawSats === undefined) {
          if (amountUsd === undefined || isNaN(amountUsd) || amountUsd <= 0) {
            return NextResponse.json(
              {
                error:
                  "Invalid satoshi amount: value must be strictly positive (> 0)",
              },
              { status: 400 },
            );
          }
        }
      } else if (
        amountUsd !== undefined &&
        (isNaN(amountUsd) || amountUsd <= 0)
      ) {
        return NextResponse.json(
          { error: "Payment amount must be strictly positive (> 0)" },
          { status: 400 },
        );
      }

      const sats = rawSats !== undefined ? Number(rawSats) : undefined;
      const resolvedUsd =
        amountUsd ?? (sats ? sats / LIVE_EXCHANGE_RATES.satsPerUsd : 5.0);

      try {
        const invoice = MicroPaymentEngine.createMicroInvoice(
          sessionId,
          resolvedUsd,
          paymentRail,
          sats,
        );

        return NextResponse.json({
          success: true,
          invoice,
          exchangeRates: LIVE_EXCHANGE_RATES,
        });
      } catch (err: unknown) {
        const msg =
          err instanceof Error ? err.message : "Failed to create micro invoice";
        return NextResponse.json({ error: msg }, { status: 400 });
      }
    }

    if (action === "start") {
      const sessionId =
        body.sessionId ||
        `mbill-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`;
      const deskId = body.deskId || "desk-sf-soma-12";
      const deskName = body.deskName || "Ergonomic Standing Desk 12B";
      const venueName = body.venueName || "SoMa Focus Hub & Roastery";
      const paymentRail: PaymentRail = body.paymentRail || "lightning";
      const hourlyRateUsd = Number(body.hourlyRateUsd) || 4.5;
      const idempotencyKey = body.idempotencyKey || undefined;
      const userId = body.userId || currentUserId || undefined;

      if (
        body.hourlyRateUsd !== undefined &&
        (isNaN(hourlyRateUsd) || hourlyRateUsd <= 0)
      ) {
        return NextResponse.json(
          { error: "Hourly rate must be strictly positive (> 0)" },
          { status: 400 },
        );
      }

      const session = await MicroBillingPersistenceService.createSession({
        sessionId,
        deskId,
        deskName,
        venueName,
        paymentRail,
        hourlyRateUsd,
        userId,
        depositHoldUsd: 10.0,
        idempotencyKey,
      });

      let invoice;
      if (body.generateInvoice) {
        if (
          paymentRail === "lightning" &&
          rawSats === undefined &&
          hourlyRateUsd <= 0
        ) {
          return NextResponse.json(
            {
              error:
                "Invalid satoshi amount: value must be strictly positive (> 0)",
            },
            { status: 400 },
          );
        }
        invoice = MicroPaymentEngine.createMicroInvoice(
          sessionId,
          hourlyRateUsd,
          paymentRail,
          rawSats !== undefined ? Number(rawSats) : undefined,
        );
      }

      return NextResponse.json({
        success: true,
        session,
        ...(invoice ? { invoice } : {}),
      });
    }

    if (action === "settle") {
      const sessionId = body.sessionId;
      if (!sessionId) {
        return NextResponse.json(
          { error: "Missing required parameter: sessionId" },
          { status: 400 },
        );
      }

      let settleResult;
      try {
        settleResult = await MicroBillingPersistenceService.settleSessionAtomic(
          sessionId,
          {
            requestingUserId: currentUserId,
            customSats: rawSats !== undefined ? Number(rawSats) : undefined,
          },
        );
      } catch (err: unknown) {
        if (err instanceof SessionNotFoundError) {
          return NextResponse.json(
            { error: "Micro-billing session not found" },
            { status: 404 },
          );
        }
        if (err instanceof UnauthorizedSessionAccessError) {
          return NextResponse.json(
            { error: "Unauthorized access to micro-billing session" },
            { status: 403 },
          );
        }
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("Invalid settlement amount")) {
          return NextResponse.json({ error: msg }, { status: 400 });
        }
        throw err;
      }

      const { session: updated, receipt } = settleResult;

      let invoice;
      if (body.generateInvoice) {
        const satsToInvoice =
          rawSats !== undefined ? Number(rawSats) : updated.totalAccruedSats;
        if (updated.paymentRail === "lightning") {
          const val = MicroPaymentEngine.validateSatoshiAmount(satsToInvoice);
          if (!val.isValid) {
            return NextResponse.json(
              {
                error:
                  val.error ||
                  "Invalid satoshi amount: value must be strictly positive (> 0)",
              },
              { status: 400 },
            );
          }
        }
        invoice = MicroPaymentEngine.createMicroInvoice(
          sessionId,
          updated.totalAccruedUsd,
          updated.paymentRail,
          satsToInvoice,
        );
      }

      return NextResponse.json({
        success: true,
        session: updated,
        receipt,
        ...(invoice ? { invoice } : {}),
      });
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (error: unknown) {
    const details = error instanceof Error ? error.message : String(error);
    console.error("[POST /api/payments/micropay/session] Error:", error);
    return NextResponse.json(
      { error: "Failed to process micro-billing session", details },
      { status: 500 },
    );
  }
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const sessionId = searchParams.get("sessionId");

    if (!sessionId) {
      return NextResponse.json(
        { error: "Missing required query parameter: sessionId" },
        { status: 400 },
      );
    }

    let currentUserId: string | undefined = undefined;
    try {
      const authResult = await auth();
      if (authResult?.userId) {
        currentUserId = authResult.userId;
      }
    } catch {
      // Unauthenticated
    }

    try {
      const liveSession =
        await MicroBillingPersistenceService.tickSessionAtomic(
          sessionId,
          Date.now(),
          currentUserId,
        );

      return NextResponse.json({
        success: true,
        session: liveSession,
      });
    } catch (err: unknown) {
      if (err instanceof SessionNotFoundError) {
        return NextResponse.json(
          { error: "Session not found" },
          { status: 404 },
        );
      }
      if (err instanceof UnauthorizedSessionAccessError) {
        return NextResponse.json(
          { error: "Unauthorized access to micro-billing session" },
          { status: 403 },
        );
      }
      throw err;
    }
  } catch (error: unknown) {
    const details = error instanceof Error ? error.message : String(error);
    console.error("[GET /api/payments/micropay/session] Error:", error);
    return NextResponse.json(
      { error: "Failed to query session", details },
      { status: 500 },
    );
  }
}
