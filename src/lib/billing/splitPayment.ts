/**
 * Split Bill & Guest Pass Payment Engine
 *
 * Provides split bill calculations, signed auto-payment tokens,
 * deep-link generators (WhatsApp, Email), and digital guest pass generation.
 */

import crypto from "crypto";

const SPLIT_SECRET = process.env.SPLIT_PAYMENT_SECRET || "worksphere-split-secret-key-2026";

export interface GuestShare {
  guestId: string;
  email: string;
  name?: string;
  amount: number;
  paid: boolean;
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
export function generateSplitPaymentToken(payload: Omit<SplitTokenPayload, "expiresAt"> & { expiresInHours?: number }): string {
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
  const signature = crypto
    .createHmac("sha256", SPLIT_SECRET)
    .update(base64Data)
    .digest("base64url");

  return `${base64Data}.${signature}`;
}

/**
 * Verifies and decodes a split payment token.
 */
export function verifySplitPaymentToken(token: string): SplitTokenPayload | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 2) return null;

    const [base64Data, signature] = parts;
    const expectedSig = crypto
      .createHmac("sha256", SPLIT_SECRET)
      .update(base64Data)
      .digest("base64url");

    if (signature !== expectedSig) {
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
  guests: Array<{ id: string; email: string; name?: string; paid?: boolean; customAmount?: number }>;
  origin?: string;
}): SplitBillSummary {
  const participantCount = guests.length + 1; // Host + Guests
  const hasCustomAmounts = guests.some((g) => typeof g.customAmount === "number");

  let guestAmounts: number[];
  let hostShare: number;

  if (hasCustomAmounts) {
    guestAmounts = guests.map((g) => g.customAmount ?? Math.round((totalAmount / participantCount) * 100) / 100);
    const guestsSum = guestAmounts.reduce((a, b) => a + b, 0);
    hostShare = Math.max(0, Math.round((totalAmount - guestsSum) * 100) / 100);
  } else {
    const evenShare = Math.round((totalAmount / participantCount) * 100) / 100;
    guestAmounts = guests.map(() => evenShare);
    hostShare = Math.round((totalAmount - evenShare * guests.length) * 100) / 100;
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

    const mailSubj = encodeURIComponent(`Workspace Guest Pass & Split Bill - ${venueName}`);
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
