import crypto from "crypto";
import { NextRequest } from "next/server";
import {
  StripePaymentProvider,
  processVerifiedPaymentEvent,
  type PaymentWebhookEvent,
} from "@/lib/billing/paymentProvider";
import { POST as handleCheckout } from "@/app/api/payments/split/[token]/checkout/route";
import { POST as handlePaymentWebhook } from "@/app/api/webhooks/payment/route";
import { generateSplitPaymentToken } from "@/lib/billing/splitPayment";
import { prisma } from "@/lib/prisma";
import { eventBus } from "@/core/events";

jest.mock("@/lib/prisma", () => {
  const mockBookingGuest = {
    findUnique: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
  };
  const mockBooking = {
    findUnique: jest.fn(),
  };
  return {
    prisma: {
      bookingGuest: mockBookingGuest,
      booking: mockBooking,
      $transaction: jest.fn((cb) => cb(prisma)),
    },
  };
});

jest.mock("@/core/events", () => ({
  eventBus: {
    emit: jest.fn().mockResolvedValue(true),
  },
}));

jest.mock("@/lib/rateLimit", () => ({
  rateLimit: jest.fn().mockResolvedValue(true),
}));

describe("StripePaymentProvider - Checkout & Webhook Settlement", () => {
  const provider = new StripePaymentProvider();
  const webhookSecret = "whsec_test_secret_key_1234567890";

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.STRIPE_WEBHOOK_SECRET = webhookSecret;
    process.env.PAYMENT_WEBHOOK_SECRET = webhookSecret;
  });

  describe("createCheckoutSession", () => {
    it("generates checkout session with server-derived amounts and canonical IDs", async () => {
      const session = await provider.createCheckoutSession({
        bookingId: "b-123456",
        guestId: "g-987654",
        amountCents: 2550,
        currency: "usd",
        guestEmail: "guest@example.com",
        venueName: "Downtown Hub",
        token: "tok_123",
      });

      expect(session.sessionId).toContain("cs_ws_123456_987654_");
      expect(session.checkoutUrl).toContain(session.sessionId);
      expect(session.amountCents).toBe(2550);
      expect(session.currency).toBe("USD");
      expect(session.provider).toBe("stripe");
    });
  });

  describe("verifyAndParseWebhook", () => {
    it("verifies and parses Stripe signature format (t=...,v1=...)", async () => {
      const body = JSON.stringify({
        id: "evt_123",
        type: "checkout.session.completed",
        data: {
          object: {
            id: "cs_123",
            amount_total: 3000,
            currency: "usd",
            metadata: {
              bookingId: "b-1",
              guestId: "g-1",
            },
          },
        },
      });

      const timestamp = Math.floor(Date.now() / 1000).toString();
      const signedPayload = `${timestamp}.${body}`;
      const sig = crypto
        .createHmac("sha256", webhookSecret)
        .update(signedPayload)
        .digest("hex");
      const signatureHeader = `t=${timestamp},v1=${sig}`;

      const parsed = await provider.verifyAndParseWebhook(
        body,
        signatureHeader,
        webhookSecret,
      );

      expect(parsed).not.toBeNull();
      expect(parsed?.status).toBe("COMPLETED");
      expect(parsed?.bookingId).toBe("b-1");
      expect(parsed?.guestId).toBe("g-1");
      expect(parsed?.amountCents).toBe(3000);
      expect(parsed?.currency).toBe("USD");
    });

    it("verifies and parses standard HMAC-SHA256 signature header", async () => {
      const body = JSON.stringify({
        id: "evt_hmac_1",
        eventType: "payment_intent.succeeded",
        paymentReference: "pi_12345",
        bookingId: "b-1",
        guestId: "g-1",
        amountCents: 1500,
        currency: "USD",
      });

      const sig = crypto
        .createHmac("sha256", webhookSecret)
        .update(body)
        .digest("hex");

      const parsed = await provider.verifyAndParseWebhook(
        body,
        `sha256=${sig}`,
        webhookSecret,
      );

      expect(parsed).not.toBeNull();
      expect(parsed?.status).toBe("COMPLETED");
      expect(parsed?.paymentReference).toBe("pi_12345");
      expect(parsed?.amountCents).toBe(1500);
    });

    it("rejects invalid webhook signatures", async () => {
      const body = JSON.stringify({ id: "evt_invalid" });
      const parsed = await provider.verifyAndParseWebhook(
        body,
        "sha256=invalid_signature_hex",
        webhookSecret,
      );

      expect(parsed).toBeNull();
    });

    it("maps failure, cancellation, and refund event types accurately", async () => {
      const generateSigned = (type: string) => {
        const payload = JSON.stringify({
          id: `evt_${type}`,
          type,
          data: {
            object: {
              id: "ref_1",
              metadata: { bookingId: "b-1", guestId: "g-1" },
            },
          },
        });
        const sig = crypto
          .createHmac("sha256", webhookSecret)
          .update(payload)
          .digest("hex");
        return { payload, sig };
      };

      const fail = generateSigned("payment_intent.payment_failed");
      const failParsed = await provider.verifyAndParseWebhook(
        fail.payload,
        fail.sig,
        webhookSecret,
      );
      expect(failParsed?.status).toBe("FAILED");

      const cancel = generateSigned("checkout.session.expired");
      const cancelParsed = await provider.verifyAndParseWebhook(
        cancel.payload,
        cancel.sig,
        webhookSecret,
      );
      expect(cancelParsed?.status).toBe("CANCELLED");

      const refund = generateSigned("charge.refunded");
      const refundParsed = await provider.verifyAndParseWebhook(
        refund.payload,
        refund.sig,
        webhookSecret,
      );
      expect(refundParsed?.status).toBe("REFUNDED");
    });
  });

  describe("processVerifiedPaymentEvent (Idempotent Settlement)", () => {
    it("settles payment on COMPLETED event and emits guest-rsvp event", async () => {
      (prisma.bookingGuest.findUnique as jest.Mock).mockResolvedValue({
        id: "g-1",
        bookingId: "b-1",
        paidAt: null,
        email: "guest@example.com",
      });
      (prisma.bookingGuest.updateMany as jest.Mock).mockResolvedValue({
        count: 1,
      });

      const event: PaymentWebhookEvent = {
        provider: "stripe",
        eventId: "evt-1",
        eventType: "checkout.session.completed",
        paymentReference: "pi_test_123",
        bookingId: "b-1",
        guestId: "g-1",
        amountCents: 2000,
        currency: "USD",
        status: "COMPLETED",
      };

      const res = await processVerifiedPaymentEvent(event);

      expect(res.success).toBe(true);
      expect(res.status).toBe("COMPLETED");
      expect(prisma.bookingGuest.updateMany).toHaveBeenCalledWith({
        where: {
          id: "g-1",
          bookingId: "b-1",
          paidAt: null,
        },
        data: expect.objectContaining({
          paidAmountCents: 2000,
          paidCurrency: "USD",
          paymentReference: "pi_test_123",
          paymentStatus: "COMPLETED",
          status: "ACCEPTED",
        }),
      });
      expect(eventBus.emit).toHaveBeenCalledWith("booking:guest-rsvp", {
        bookingId: "b-1",
        guestId: "g-1",
        guestEmail: "guest@example.com",
        status: "ACCEPTED",
      });
    });

    it("prevents double-spending on duplicate webhook delivery", async () => {
      (prisma.bookingGuest.findUnique as jest.Mock).mockResolvedValue({
        id: "g-1",
        bookingId: "b-1",
        paidAt: new Date("2026-01-01T10:00:00Z"),
        email: "guest@example.com",
      });

      const event: PaymentWebhookEvent = {
        provider: "stripe",
        eventId: "evt-duplicate",
        eventType: "checkout.session.completed",
        paymentReference: "pi_test_123",
        bookingId: "b-1",
        guestId: "g-1",
        amountCents: 2000,
        currency: "USD",
        status: "COMPLETED",
      };

      const res = await processVerifiedPaymentEvent(event);

      expect(res.success).toBe(true);
      expect(res.alreadyProcessed).toBe(true);
      expect(prisma.bookingGuest.updateMany).not.toHaveBeenCalled();
      expect(eventBus.emit).not.toHaveBeenCalled();
    });

    it("updates status on FAILED or CANCELLED without setting paidAt", async () => {
      (prisma.bookingGuest.findUnique as jest.Mock).mockResolvedValue({
        id: "g-1",
        bookingId: "b-1",
        paidAt: null,
      });

      const event: PaymentWebhookEvent = {
        provider: "stripe",
        eventId: "evt-failed",
        eventType: "payment_intent.payment_failed",
        paymentReference: "pi_failed_1",
        bookingId: "b-1",
        guestId: "g-1",
        amountCents: 2000,
        currency: "USD",
        status: "FAILED",
      };

      const res = await processVerifiedPaymentEvent(event);

      expect(res.success).toBe(true);
      expect(res.status).toBe("FAILED");
      expect(prisma.bookingGuest.update).toHaveBeenCalledWith({
        where: { id: "g-1" },
        data: {
          paymentStatus: "FAILED",
          paymentReference: "pi_failed_1",
        },
      });
      expect(prisma.bookingGuest.updateMany).not.toHaveBeenCalled();
    });
  });

  describe("API Route: POST /api/payments/split/[token]/checkout", () => {
    it("creates checkout session using verified token claims and server amounts", async () => {
      const token = generateSplitPaymentToken({
        bookingId: "b-100",
        guestId: "g-200",
        email: "guest200@example.com",
        amount: 35.5,
        currency: "USD",
        venueName: "Desk Co",
        date: "2026-12-01",
        time: "10:00",
      });

      (prisma.booking.findUnique as jest.Mock).mockResolvedValue({
        id: "b-100",
        status: "CONFIRMED",
        venue: { name: "Desk Co" },
        guests: [{ id: "g-200", email: "guest200@example.com", paidAt: null }],
      });

      const req = new NextRequest(
        `http://localhost/api/payments/split/${token}/checkout`,
        { method: "POST" },
      );
      const res = await handleCheckout(req, {
        params: Promise.resolve({ token }),
      });
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.amountCents).toBe(3550);
      expect(data.currency).toBe("USD");
      expect(data.sessionId).toBeDefined();
      expect(data.checkoutUrl).toBeDefined();
    });

    it("rejects checkout when guest is already paid", async () => {
      const token = generateSplitPaymentToken({
        bookingId: "b-100",
        guestId: "g-200",
        email: "guest200@example.com",
        amount: 35.5,
        currency: "USD",
        venueName: "Desk Co",
        date: "2026-12-01",
        time: "10:00",
      });

      (prisma.booking.findUnique as jest.Mock).mockResolvedValue({
        id: "b-100",
        status: "CONFIRMED",
        guests: [
          {
            id: "g-200",
            email: "guest200@example.com",
            paidAt: new Date(),
          },
        ],
      });

      const req = new NextRequest(
        `http://localhost/api/payments/split/${token}/checkout`,
        { method: "POST" },
      );
      const res = await handleCheckout(req, {
        params: Promise.resolve({ token }),
      });
      const data = await res.json();

      expect(res.status).toBe(409);
      expect(data.error).toBe("Guest share is already paid");
    });
  });

  describe("API Route: POST /api/webhooks/payment", () => {
    it("authenticates webhook and settles guest split bill payment", async () => {
      (prisma.bookingGuest.findUnique as jest.Mock).mockResolvedValue({
        id: "g-300",
        bookingId: "b-300",
        paidAt: null,
        email: "guest300@example.com",
      });
      (prisma.bookingGuest.updateMany as jest.Mock).mockResolvedValue({
        count: 1,
      });

      const payload = JSON.stringify({
        id: "evt_live_123",
        type: "checkout.session.completed",
        data: {
          object: {
            id: "cs_test_999",
            amount_total: 4500,
            currency: "usd",
            metadata: {
              bookingId: "b-300",
              guestId: "g-300",
            },
          },
        },
      });

      const timestamp = Math.floor(Date.now() / 1000).toString();
      const signedPayload = `${timestamp}.${payload}`;
      const sig = crypto
        .createHmac("sha256", webhookSecret)
        .update(signedPayload)
        .digest("hex");
      const signatureHeader = `t=${timestamp},v1=${sig}`;

      const req = new Request("http://localhost/api/webhooks/payment", {
        method: "POST",
        headers: {
          "stripe-signature": signatureHeader,
          "content-type": "application/json",
        },
        body: payload,
      });

      const res = await handlePaymentWebhook(req);
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.received).toBe(true);
      expect(data.settlement).toBe("COMPLETED");
      expect(prisma.bookingGuest.updateMany).toHaveBeenCalled();
    });

    it("rejects unauthorized webhook with invalid signature", async () => {
      const req = new Request("http://localhost/api/webhooks/payment", {
        method: "POST",
        headers: {
          "stripe-signature": "t=12345,v1=bad_signature",
          "content-type": "application/json",
        },
        body: JSON.stringify({ id: "evt_fake" }),
      });

      const res = await handlePaymentWebhook(req);
      expect(res.status).toBe(401);
    });
  });
});
