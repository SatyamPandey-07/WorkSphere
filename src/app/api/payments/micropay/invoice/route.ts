/**
 * route.ts
 * /api/payments/micropay/invoice
 * Generates BOLT11 Lightning Network invoices and USDC pay payloads.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  MicroPaymentEngine,
  PaymentRail,
  LIVE_EXCHANGE_RATES,
} from "@/lib/payments/microPaymentEngine";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const sessionId = body.sessionId || `session-${Date.now()}`;
    const paymentRail: PaymentRail = body.paymentRail || "lightning";

    const rawSats =
      body.satoshiAmount ??
      body.sats ??
      body.amountSats ??
      body.satoshis ??
      (paymentRail === "lightning" && body.amount !== undefined ? body.amount : undefined);

    if (rawSats !== undefined) {
      const validation = MicroPaymentEngine.validateSatoshiAmount(rawSats);
      if (!validation.isValid) {
        return NextResponse.json(
          {
            error:
              validation.error ||
              "Invalid satoshi amount: value must be a strictly positive integer (> 0)",
          },
          { status: 400 }
        );
      }
    }

    const amountUsd = body.amountUsd !== undefined ? Number(body.amountUsd) : undefined;
    if (paymentRail === "lightning") {
      if (rawSats === undefined) {
        if (amountUsd === undefined || isNaN(amountUsd) || amountUsd <= 0) {
          return NextResponse.json(
            { error: "Invalid satoshi amount: value must be strictly positive (> 0)" },
            { status: 400 }
          );
        }
      }
    } else if (amountUsd !== undefined && (isNaN(amountUsd) || amountUsd <= 0)) {
      return NextResponse.json(
        { error: "Payment amount must be strictly positive (> 0)" },
        { status: 400 }
      );
    }

    const sats = rawSats !== undefined ? Number(rawSats) : undefined;
    const resolvedUsd =
      amountUsd ?? (sats ? sats / LIVE_EXCHANGE_RATES.satsPerUsd : 5.0);

    const invoice = MicroPaymentEngine.createMicroInvoice(
      sessionId,
      resolvedUsd,
      paymentRail,
      sats
    );

    return NextResponse.json({
      success: true,
      invoice,
      exchangeRates: LIVE_EXCHANGE_RATES,
    });
  } catch (error: unknown) {
    const details = error instanceof Error ? error.message : String(error);
    console.error("[POST /api/payments/micropay/invoice] Error:", error);
    return NextResponse.json(
      { error: "Failed to generate micro-payment invoice", details },
      { status: 500 }
    );
  }
}
