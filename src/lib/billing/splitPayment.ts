/**
 * Split Bill & Guest Pass Payment Engine
 *
 * Provides split bill calculations, signed auto-payment tokens,
 * deep-link generators (WhatsApp, Email), and digital guest pass generation.
 */

import crypto from "crypto";

export const INSECURE_DEFAULT_SECRET = "worksphere-split-secret-key-2026";
export const MIN_SPLIT_SECRET_LENGTH = 32;

/**
 * Retrieves and validates the signing secret for split payment tokens.
 * Fails closed in production if SPLIT_PAYMENT_SECRET is missing, weak, or insecure default.
 */
export function getSplitPaymentSecret(): string {
  const secret = process.env.SPLIT_PAYMENT_SECRET?.trim();
  const isProduction = process.env.NODE_ENV === "production";

  if (isProduction) {
    if (!secret) {
      throw new Error(
        "SPLIT_PAYMENT_SECRET environment variable is missing in production. Token operations failed closed.",
      );
    }
    if (secret === INSECURE_DEFAULT_SECRET) {
      throw new Error(
        "SPLIT_PAYMENT_SECRET is set to an insecure default value in production. A secure high-entropy secret is required.",
      );
    }
    if (secret.length < MIN_SPLIT_SECRET_LENGTH) {
      throw new Error(
        `SPLIT_PAYMENT_SECRET is too short in production (${secret.length} chars). Minimum length is ${MIN_SPLIT_SECRET_LENGTH} characters.`,
      );
    }
    return secret;
  }

  // Non-production (test/development)
  if (secret) {
    return secret;
  }

  return INSECURE_DEFAULT_SECRET;
}

export interface GuestShare {
  guestId: string;
  email: string;
  name?: string;
  amount: number;
  paid: boolean;
  paymentStatus?: string;
  paymentReference?: string;
  paymentToken: string;
  paymentUrl: string;
  shareLinks: {
    whatsapp: string;
    email: string;
    copy: string;
  };
}

export interface SplitBillSummary {
  bookingId: string;
  venueName: string;
  totalAmount: number;
  currency: string;
  hostShare: number;
  guestShares: GuestShare[];
  totalGuests: number;
  paidCount: number;
  allPaid: boolean;
}

export interface SplitTokenPayload {
  bookingId: string;
  guestId: string;
  email: string;
  name?: string;
  amount: number;
  currency: string;
  venueName: string;
  date: string;
  time: string;
  expiresAt: number;
}

/**
 * Creates a signed, tamper-proof payment token for a guest.
 */
export function generateSplitPaymentToken(
  payload: Omit<SplitTokenPayload, "expiresAt"> & { expiresInHours?: number },
): string {
  const expiresInHours = payload.expiresInHours ?? 72;
  const expiresAt = Date.now() + expiresInHours * 60 * 60 * 1000;

  const data: SplitTokenPayload = {
    bookingId: payload.bookingId,
    guestId: payload.guestId,
    email: payload.email,
    name: payload.name,
    amount: payload.amount,
    currency: payload.currency || "USD",
    venueName: payload.venueName,
    date: payload.date,
    time: payload.time,
    expiresAt,
  };

  const json = JSON.stringify(data);
  const base64Data = Buffer.from(json).toString("base64url");
  const secret = getSplitPaymentSecret();
  const signature = crypto
    .createHmac("sha256", secret)
    .update(base64Data)
    .digest("base64url");

  return `${base64Data}.${signature}`;
}

/**
 * Verifies and decodes a split payment token.
 */
export function verifySplitPaymentToken(
  token: string,
): SplitTokenPayload | null {
  const secret = getSplitPaymentSecret();
  try {
    const parts = token.split(".");
    if (parts.length !== 2) return null;

    const [base64Data, signature] = parts;
    const expectedSig = crypto
      .createHmac("sha256", secret)
      .update(base64Data)
      .digest("base64url");

    const provided = Buffer.from(signature, "base64url");
    const expected = Buffer.from(expectedSig, "base64url");
    if (
      provided.length !== expected.length ||
      !crypto.timingSafeEqual(provided, expected)
    ) {
      return null;
    }

    const json = Buffer.from(base64Data, "base64url").toString("utf-8");
    const payload = JSON.parse(json) as SplitTokenPayload;

    if (Date.now() > payload.expiresAt) {
      return null; // Expired
    }

    return payload;
  } catch {
    return null;
  }
}

/**
 * Calculates even or weighted split amounts.
 * Uses integer minor units (cents) to avoid floating-point drift
 * and ensures total allocations reconcile exactly to the total bill amount.
 */
export function calculateSplitBill({
  bookingId,
  venueName,
  date,
  time,
  totalAmount,
  currency = "USD",
  guests,
  origin = "http://localhost:3000",
}: {
  bookingId: string;
  venueName: string;
  date: string;
  time: string;
  totalAmount: number;
  currency?: string;
  guests: Array<{
    id: string;
    email: string;
    name?: string;
    paid?: boolean;
    customAmount?: number;
  }>;
  origin?: string;
}): SplitBillSummary {
  if (!Number.isFinite(totalAmount) || totalAmount < 0) {
    throw new Error("totalAmount must be a finite non-negative number");
  }

  for (const guest of guests) {
    if (typeof guest.customAmount === "number") {
      if (!Number.isFinite(guest.customAmount) || guest.customAmount < 0) {
        throw new Error("customAmount must be a finite non-negative number");
      }
    }
  }

  const totalCents = Math.round(totalAmount * 100);
  const participantCount = guests.length + 1; // Host + Guests
  const hasCustomAmounts = guests.some(
    (g) => typeof g.customAmount === "number",
  );

  let guestAmounts: number[];
  let hostShare: number;

  if (hasCustomAmounts) {
    guestAmounts = guests.map(
      (g) =>
        g.customAmount ??
        Math.round((totalAmount / participantCount) * 100) / 100,
    );
    const guestsSumCents = guestAmounts.reduce(
      (sum, amt) => sum + Math.round(amt * 100),
      0,
    );
    if (guestsSumCents > totalCents) {
      throw new Error(
        "Total custom guest allocations exceeds total bill amount",
      );
    }
    hostShare = Math.max(0, Math.round(totalCents - guestsSumCents) / 100);
  } else {
    const evenShare = Math.round((totalAmount / participantCount) * 100) / 100;
    guestAmounts = guests.map(() => evenShare);
    hostShare =
      Math.round((totalAmount - evenShare * guests.length) * 100) / 100;
  }

  const guestShares: GuestShare[] = guests.map((guest, idx) => {
    const amount = guestAmounts[idx];
    const token = generateSplitPaymentToken({
      bookingId,
      guestId: guest.id,
      email: guest.email,
      name: guest.name,
      amount,
      currency,
      venueName,
      date,
      time,
    });

    const paymentUrl = `${origin}/pay/split/${token}`;
    const guestLabel = guest.name || guest.email.split("@")[0];

    const waText = encodeURIComponent(
      `Hey ${guestLabel}! Here is your guest pass & split payment link ($${amount.toFixed(2)} ${currency}) for our workspace session at ${venueName} on ${date} at ${time}:\n${paymentUrl}`,
    );
    const whatsapp = `https://wa.me/?text=${waText}`;

    const mailSubj = encodeURIComponent(
      `Workspace Guest Pass & Split Bill - ${venueName}`,
    );
    const mailBody = encodeURIComponent(
      `Hi ${guestLabel},\n\nYou've been invited to join a workspace booking at ${venueName} on ${date} at ${time}.\n\nYour split share is $${amount.toFixed(2)} ${currency}.\nClick here to complete payment and unlock your digital Guest Pass with WiFi credentials:\n${paymentUrl}\n\nSee you there!`,
    );
    const emailLink = `mailto:${guest.email}?subject=${mailSubj}&body=${mailBody}`;

    return {
      guestId: guest.id,
      email: guest.email,
      name: guest.name,
      amount,
      paid: Boolean(guest.paid),
      paymentStatus:
        guest.paymentStatus || (guest.paid ? "COMPLETED" : "PENDING"),
      paymentReference: guest.paymentReference,
      paymentToken: token,
      paymentUrl,
      shareLinks: {
        whatsapp,
        email: emailLink,
        copy: paymentUrl,
      },
    };
  });

  const paidCount = guestShares.filter((g) => g.paid).length;

  return {
    bookingId,
    venueName,
    totalAmount,
    currency,
    hostShare,
    guestShares,
    totalGuests: guests.length,
    paidCount,
    allPaid: paidCount === guests.length,
  };
}
