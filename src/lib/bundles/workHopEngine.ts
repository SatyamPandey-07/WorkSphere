/**
 * workHopEngine.ts
 * Core business logic and crypto verification for "Work-Hop" Multi-Venue Day Passes.
 * Handles composite multi-leg workspace scheduling, revenue attribution, and secure QR tokens.
 */

import crypto from "crypto";

export interface WorkHopLeg {
  legIndex: number;
  venueId: string;
  venueName: string;
  venueCategory: string;
  venueAddress?: string | null;
  seatId?: string | null;
  seatNumber?: string | null;
  startTime: string; // e.g. "09:00"
  endTime: string;   // e.g. "12:30"
  durationHours: number;
  amenities: string[];
  allocatedRevenue: number;
  status: "PENDING" | "CHECKED_IN" | "COMPLETED" | "MISSED";
  checkedInAt?: string | null;
}

export interface WorkHopBundle {
  bundleId: string;
  userId: string;
  date: string; // "YYYY-MM-DD"
  title: string;
  tier: "EXPLORER" | "NOMAD_PRO" | "EXECUTIVE";
  totalPrice: number;
  currency: string;
  discountPercentage: number;
  legs: WorkHopLeg[];
  qrToken: string;
  status: "ACTIVE" | "COMPLETED" | "CANCELLED";
  createdAt: string;
}

const PASS_SECRET = process.env.WORKHOP_SECRET || "work-sphere-workhop-pass-secret-key-2026";

/**
 * Calculates dynamic revenue attribution across partner venues for a day pass.
 */
export function calculateRevenueAttribution(
  totalPassPrice: number,
  legs: Array<{ venueId: string; durationHours: number; venueCategory: string }>
): Array<{ venueId: string; allocatedRevenue: number; revenueSharePct: number }> {
  if (legs.length === 0) return [];

  // Base weighting based on duration and venue tier
  const weights = legs.map((leg) => {
    let multiplier = 1.0;
    if (leg.venueCategory === "coworking") multiplier = 1.3;
    if (leg.venueCategory === "library") multiplier = 0.8;
    return leg.durationHours * multiplier;
  });

  const totalWeight = weights.reduce((sum, w) => sum + w, 0) || 1;

  return legs.map((leg, i) => {
    const revenueSharePct = Math.round((weights[i] / totalWeight) * 100);
    const allocatedRevenue = Number(((weights[i] / totalWeight) * totalPassPrice).toFixed(2));
    return {
      venueId: leg.venueId,
      allocatedRevenue,
      revenueSharePct,
    };
  });
}

/**
 * Generates an HMAC-SHA256 signed QR pass token encoding bundle ID, user ID, and valid date.
 */
export function generateWorkHopPassToken(
  bundleId: string,
  userId: string,
  date: string
): string {
  const payload = JSON.stringify({ bundleId, userId, date, issuedAt: Date.now() });
  const hmac = crypto.createHmac("sha256", PASS_SECRET).update(payload).digest("hex");
  return Buffer.from(JSON.stringify({ payload, sig: hmac })).toString("base64url");
}

/**
 * Verifies the validity and signature of a Work-Hop QR pass token.
 */
export function verifyWorkHopPassToken(token: string): {
  isValid: boolean;
  bundleId?: string;
  userId?: string;
  date?: string;
  error?: string;
} {
  try {
    const raw = Buffer.from(token, "base64url").toString("utf-8");
    const { payload, sig } = JSON.parse(raw);

    const expectedHmac = crypto.createHmac("sha256", PASS_SECRET).update(payload).digest("hex");
    if (!crypto.timingSafeEqual(Buffer.from(sig, "hex"), Buffer.from(expectedHmac, "hex"))) {
      return { isValid: false, error: "Invalid cryptographic signature" };
    }

    const data = JSON.parse(payload);
    return {
      isValid: true,
      bundleId: data.bundleId,
      userId: data.userId,
      date: data.date,
    };
  } catch (err: any) {
    return { isValid: false, error: "Malformed pass token" };
  }
}
