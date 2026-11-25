import { NextResponse } from "next/server";
import { verifyHmacWebhookSignature } from "@/lib/security/hmac";

export const dynamic = "force-dynamic";

/**
 * POST /api/webhooks/payment
 *
 * Webhook handler for external payment notifications.
 * Verifies HMAC-SHA256 signature using constant-time comparison to prevent timing attacks.
 * Supported headers:
 * - X-WorkSphere-Signature: sha256=<hex> or <hex>
 * - X-Payment-Signature: <hex>
 * - Stripe-Signature / Provider-Signature
 */
export async function POST(req: Request) {
  const secret = process.env.PAYMENT_WEBHOOK_SECRET || process.env.WEBHOOK_SECRET;

  if (!secret) {
    console.error("[webhooks/payment] Missing webhook secret");
    return NextResponse.json(
      { error: "Webhook secret not configured" },
      { status: 500 },
    );
  }

  const signatureHeader =
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

  const prefix = signatureHeader.toLowerCase().startsWith("sha256=") ? "sha256=" : "";
  const isValid = verifyHmacWebhookSignature(rawBody, signatureHeader, secret, prefix);

  if (!isValid) {
    return NextResponse.json(
      { error: "Invalid webhook signature" },
      { status: 401 },
    );
  }

  try {
    const payload = rawBody ? JSON.parse(rawBody) : {};

    // Process payment event
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
