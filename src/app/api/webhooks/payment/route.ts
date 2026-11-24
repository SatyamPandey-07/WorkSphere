import { NextResponse } from "next/server";
import { verifyHmacWebhookSignature } from "@/lib/security/hmac";
import {
  defaultPaymentProvider,
  processVerifiedPaymentEvent,
} from "@/lib/billing/paymentProvider";

export const dynamic = "force-dynamic";

/**
 * POST /api/webhooks/payment
 *
 * Webhook handler for external payment notifications.
 * Verifies HMAC-SHA256 signature using constant-time comparison to prevent timing attacks.
 * Supported headers:
 * - Stripe-Signature
 * - X-WorkSphere-Signature: sha256=<hex> or <hex>
 * - X-Payment-Signature: <hex>
 * - X-Hub-Signature-256: sha256=<hex>
 * - Payment-Signature
 */
export async function POST(req: Request) {
  const secret =
    process.env.STRIPE_WEBHOOK_SECRET ||
    process.env.PAYMENT_WEBHOOK_SECRET ||
    process.env.WEBHOOK_SECRET;

  if (!secret) {
    console.error("[webhooks/payment] Missing webhook secret");
    return NextResponse.json(
      { error: "Webhook secret not configured" },
      { status: 500 },
    );
  }

  const signatureHeader =
    req.headers.get("stripe-signature") ||
    req.headers.get("x-worksphere-signature") ||
    req.headers.get("x-payment-signature") ||
    req.headers.get("x-hub-signature-256") ||
    req.headers.get("payment-signature");

  if (!signatureHeader) {
    return NextResponse.json(
      { error: "Missing signature header" },
      { status: 401 },
    );
  }

  let rawBody: string;
  try {
    rawBody = await req.text();
  } catch {
    return NextResponse.json(
      { error: "Invalid request body" },
      { status: 400 },
    );
  }

  // 1. Attempt payment-provider parse & verification (supports Stripe & WorkSphere events)
  const parsedEvent = await defaultPaymentProvider.verifyAndParseWebhook(
    rawBody,
    signatureHeader,
    secret,
  );

  if (parsedEvent) {
    const result = await processVerifiedPaymentEvent(parsedEvent);
    if (!result.success && result.error) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    return NextResponse.json(
      {
        received: true,
        eventId: parsedEvent.eventId,
        status: "processed",
        settlement: result.status,
        alreadyProcessed: result.alreadyProcessed ?? false,
      },
      { status: 200 },
    );
  }

  // 2. Generic HMAC verification fallback for custom payment hooks
  const prefix = signatureHeader.toLowerCase().startsWith("sha256=")
    ? "sha256="
    : "";
  const isValid = verifyHmacWebhookSignature(
    rawBody,
    signatureHeader,
    secret,
    prefix,
  );

  if (!isValid) {
    return NextResponse.json(
      { error: "Invalid webhook signature" },
      { status: 401 },
    );
  }

  try {
    const payload = rawBody ? JSON.parse(rawBody) : {};

    return NextResponse.json(
      {
        received: true,
        eventId: payload.id || payload.eventId || null,
        status: "processed",
      },
      { status: 200 },
    );
  } catch {
    return NextResponse.json(
      { error: "Malformed JSON payload" },
      { status: 400 },
    );
  }
}
