/**
 * Tests for venue guest pass issuance and management.
 */

interface GuestPass {
  passId: string;
  issuedBy: string;      // member userId who issued it
  guestEmail: string;
  venueId: string;
  validDate: string;     // YYYY-MM-DD
  validFrom: string;     // "HH:MM"
  validUntil: string;    // "HH:MM"
  isUsed: boolean;
  usedAt: number | null;
  expiresAt: number;
}

function isGuestPassValid(pass: GuestPass, nowMs: number): boolean {
  if (pass.isUsed) return false;
  if (nowMs >= pass.expiresAt) return false;
  return true;
}

function useGuestPass(pass: GuestPass, nowMs: number): GuestPass {
  if (!isGuestPassValid(pass, nowMs)) throw new Error("Pass invalid or expired");
  return { ...pass, isUsed: true, usedAt: nowMs };
}

function activePasses(passes: GuestPass[], issuedBy: string, nowMs: number): GuestPass[] {
  return passes.filter((p) => p.issuedBy === issuedBy && isGuestPassValid(p, nowMs));
}

function expiredPasses(passes: GuestPass[], nowMs: number): GuestPass[] {
  return passes.filter((p) => nowMs >= p.expiresAt && !p.isUsed);
}

function passesForDate(passes: GuestPass[], date: string): GuestPass[] {
  return passes.filter((p) => p.validDate === date);
}

const NOW = 1_700_000_000_000;
const PASSES: GuestPass[] = [
  { passId: "gp1", issuedBy: "u1", guestEmail: "a@x.com", venueId: "v1", validDate: "2026-10-15", validFrom: "09:00", validUntil: "17:00", isUsed: false, usedAt: null, expiresAt: NOW + 86_400_000 },
  { passId: "gp2", issuedBy: "u1", guestEmail: "b@x.com", venueId: "v1", validDate: "2026-10-15", validFrom: "10:00", validUntil: "12:00", isUsed: true,  usedAt: NOW - 1000, expiresAt: NOW + 86_400_000 },
  { passId: "gp3", issuedBy: "u2", guestEmail: "c@x.com", venueId: "v1", validDate: "2026-10-16", validFrom: "09:00", validUntil: "17:00", isUsed: false, usedAt: null, expiresAt: NOW - 1 }, // expired
];

describe("Venue guest pass management", () => {
  it("isGuestPassValid: active unused → true", () => {
    expect(isGuestPassValid(PASSES[0], NOW)).toBe(true);
  });

  it("isGuestPassValid: used → false", () => {
    expect(isGuestPassValid(PASSES[1], NOW)).toBe(false);
  });

  it("isGuestPassValid: expired → false", () => {
    expect(isGuestPassValid(PASSES[2], NOW)).toBe(false);
  });

  it("useGuestPass: marks as used", () => {
    const used = useGuestPass(PASSES[0], NOW);
    expect(used.isUsed).toBe(true);
    expect(used.usedAt).toBe(NOW);
  });

  it("useGuestPass: throws on expired", () => {
    expect(() => useGuestPass(PASSES[2], NOW)).toThrow("expired");
  });

  it("activePasses: u1 has 1 active (gp2 is used)", () => {
    expect(activePasses(PASSES, "u1", NOW)).toHaveLength(1);
  });

  it("expiredPasses: gp3 is expired and unused", () => {
    const expired = expiredPasses(PASSES, NOW);
    expect(expired.map((p) => p.passId)).toContain("gp3");
  });

  it("passesForDate: Oct 15 has 2 passes", () => {
    expect(passesForDate(PASSES, "2026-10-15")).toHaveLength(2);
  });
});
