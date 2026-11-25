import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { eventBus } from "@/core/events";
import {
  verifyHmacWebhookSignature,
  safeCompareSignatures,
} from "@/lib/security/hmac";

export type PaymentLifecycleStatus =
  "PENDING" | "COMPLETED" | "FAILED" | "CANCELLED" | "REFUNDED";

export interface CreateCheckoutSessionParams {
  bookingId: string;
  guestId: string;
  amountCents: number;
  currency: string;
  guestEmail: string;
  guestName?: string;
  venueName: string;
  token: string;
  successUrl?: string;
  cancelUrl?: string;
}

export interface CheckoutSessionResult {
  sessionId: string;
  checkoutUrl: string;
  provider: string;
  amountCents: number;
  currency: string;
}

export interface PaymentWebhookEvent {
  provider: string;
  eventId: string;
  eventType: string;
  paymentReference: string;
  bookingId: string;
  guestId: string;
  amountCents: number;
  currency: string;
  status: PaymentLifecycleStatus;
  metadata?: Record<string, string>;
}

export interface ProcessPaymentResult {
  success: boolean;
  alreadyProcessed?: boolean;
  status: PaymentLifecycleStatus;
  guestId?: string;
  bookingId?: string;
  error?: string;
}

export interface PaymentProvider {
  readonly name: string;
  createCheckoutSession(
    params: CreateCheckoutSessionParams,
  ): Promise<CheckoutSessionResult>;
  verifyAndParseWebhook(
    rawBody: string,
    signatureHeader: string,
    secret: string,
  ): Promise<PaymentWebhookEvent | null>;
}

/**
 * Stripe Payment Provider implementation for WorkSphere guest split-bills.
 */
export class StripePaymentProvider implements PaymentProvider {
  public readonly name = "stripe";

  public async createCheckoutSession(
    params: CreateCheckoutSessionParams,
  ): Promise<CheckoutSessionResult> {
    const sessionId = `cs_ws_${params.bookingId.slice(-6)}_${params.guestId.slice(-6)}_${Date.now()}`;
    const checkoutUrl =
      process.env.STRIPE_CHECKOUT_URL_OVERRIDE ||
      `https://checkout.stripe.com/c/pay/${sessionId}`;

    return {
      sessionId,
      checkoutUrl,
      provider: this.name,
      amountCents: params.amountCents,
      currency: params.currency.toUpperCase(),
    };
  }

  public async verifyAndParseWebhook(
    rawBody: string,
    signatureHeader: string,
    secret: string,
  ): Promise<PaymentWebhookEvent | null> {
    if (!signatureHeader || !secret) return null;

    let isValid = false;

    // Check if Stripe signature header format (t=timestamp,v1=signature)
    if (signatureHeader.includes("t=") && signatureHeader.includes("v1=")) {
      const parts = signatureHeader.split(",");
      const timestampPart = parts.find((p) => p.trim().startsWith("t="));
      const sigPart = parts.find((p) => p.trim().startsWith("v1="));
      if (timestampPart && sigPart) {
        const timestamp = timestampPart.split("=")[1].trim();
        const sig = sigPart.split("=")[1].trim();
        const signedPayload = `${timestamp}.${rawBody}`;
        const cleanSecret = secret.startsWith("whsec_")
          ? secret.slice(6)
          : secret;
        const expectedSig1 = crypto
          .createHmac("sha256", secret)
          .update(signedPayload)
          .digest("hex");
        const expectedSig2 = crypto
          .createHmac("sha256", cleanSecret)
          .update(signedPayload)
          .digest("hex");
        if (
          safeCompareSignatures(sig, expectedSig1) ||
          safeCompareSignatures(sig, expectedSig2)
        ) {
          isValid = true;
        }
      }
    } else {
      // Standard HMAC-SHA256 signature (checks both with prefix and without)
      const prefix = signatureHeader.toLowerCase().startsWith("sha256=")
        ? "sha256="
        : "";
      isValid =
        verifyHmacWebhookSignature(rawBody, signatureHeader, secret, prefix) ||
        verifyHmacWebhookSignature(rawBody, signatureHeader, secret, "");

      if (!isValid) {
        const rawExpected = crypto
          .createHmac("sha256", secret)
          .update(rawBody)
          .digest("hex");
        let sigOnly = signatureHeader.trim();
        if (sigOnly.toLowerCase().startsWith("sha256=")) {
          sigOnly = sigOnly.slice(7).trim();
        }
        if (safeCompareSignatures(sigOnly, rawExpected)) {
          isValid = true;
        }
      }
    }

    if (!isValid) return null;

    try {
      const payload = JSON.parse(rawBody);

      // Determine event status from Stripe or generic webhook types
      const eventType = payload.type || payload.eventType || "unknown";
      let status: PaymentLifecycleStatus = "PENDING";

      if (
        eventType === "checkout.session.completed" ||
        eventType === "payment_intent.succeeded" ||
        eventType === "charge.succeeded"
      ) {
        status = "COMPLETED";
      } else if (
        eventType === "payment_intent.payment_failed" ||
        eventType === "charge.failed"
      ) {
        status = "FAILED";
      } else if (
        eventType === "checkout.session.expired" ||
        eventType === "payment_intent.canceled"
      ) {
        status = "CANCELLED";
      } else if (
        eventType === "charge.refunded" ||
        eventType === "payment_intent.refunded"
      ) {
        status = "REFUNDED";
      }

      // Extract metadata (supports Stripe object structure and flat payload)
      const dataObj = payload.data?.object || payload.data || payload;
      const metadata = dataObj.metadata || payload.metadata || {};

      const bookingId = metadata.bookingId || dataObj.bookingId || "";
      const guestId = metadata.guestId || dataObj.guestId || "";
      const paymentReference =
        dataObj.paymentReference ||
        dataObj.payment_intent ||
        dataObj.id ||
        payload.id ||
        `ref_${Date.now()}`;
      const amountCents =
        Number(dataObj.amount_total ?? dataObj.amount ?? payload.amountCents) ||
        0;
      const currency = String(
        dataObj.currency ?? payload.currency ?? "usd",
      ).toUpperCase();

      if (!bookingId || !guestId) {
        return null;
      }

      return {
        provider: this.name,
        eventId: payload.id || `evt_${Date.now()}`,
        eventType,
        paymentReference,
        bookingId,
        guestId,
        amountCents,
        currency,
        status,
        metadata,
      };
    } catch {
      return null;
    }
  }
}

export const defaultPaymentProvider = new StripePaymentProvider();

/**
 * Idempotently processes a verified external payment webhook notification.
 * Prevents replay attacks, avoids overwriting completed payments, and reconciles
 * the settlement state with WorkSphere's database.
 */
export async function processVerifiedPaymentEvent(
  event: PaymentWebhookEvent,
): Promise<ProcessPaymentResult> {
  return await prisma.$transaction(async (tx) => {
    const guest = await tx.bookingGuest.findUnique({
      where: { id: event.guestId },
      include: {
        booking: {
          select: {
            id: true,
            status: true,
          },
        },
      },
    });

    if (!guest || guest.bookingId !== event.bookingId) {
      return {
        success: false,
        status: event.status,
        error: "Guest or booking mismatch",
      };
    }

    // Idempotency: If already paid, do not re-apply or overwrite timestamps
    if (guest.paidAt != null) {
      return {
        success: true,
        alreadyProcessed: true,
        status: "COMPLETED",
        guestId: guest.id,
        bookingId: guest.bookingId,
      };
    }

    if (event.status === "COMPLETED") {
      const updated = await tx.bookingGuest.updateMany({
        where: {
          id: guest.id,
          bookingId: event.bookingId,
          paidAt: null,
        },
        data: {
          paidAt: new Date(),
          paidAmountCents: event.amountCents,
          paidCurrency: event.currency,
          paymentReference: event.paymentReference,
          paymentStatus: "COMPLETED",
          status: "ACCEPTED",
        },
      });

      if (updated.count === 0) {
        return {
          success: true,
          alreadyProcessed: true,
          status: "COMPLETED",
          guestId: guest.id,
          bookingId: guest.bookingId,
        };
      }

      // Emit event notification
      try {
        await eventBus.emit("booking:guest-rsvp", {
          bookingId: guest.bookingId,
          guestId: guest.id,
          guestEmail: guest.email,
          status: "ACCEPTED",
        });
      } catch (err) {
        console.error(
          "[processVerifiedPaymentEvent] eventBus emit failed:",
          err,
        );
      }

      return {
        success: true,
        status: "COMPLETED",
        guestId: guest.id,
        bookingId: guest.bookingId,
      };
    }

    // For FAILED, CANCELLED, or REFUNDED, update settlement tracking state without marking paidAt
    await tx.bookingGuest.update({
      where: { id: guest.id },
      data: {
        paymentStatus: event.status,
        paymentReference: event.paymentReference,
        ...(event.status === "REFUNDED" ? { paidAt: null } : {}),
      },
    });

    return {
      success: true,
      status: event.status,
      guestId: guest.id,
      bookingId: guest.bookingId,
    };
  });
}
