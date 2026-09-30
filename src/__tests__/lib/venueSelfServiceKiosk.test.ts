/**
 * Tests for venue self-service kiosk check-in flow.
 */

type KioskState = "idle" | "scanning" | "verified" | "checking_in" | "checked_in" | "error";

interface KioskSession {
  sessionId: string;
  venueId: string;
  bookingId: string | null;
  userId: string | null;
  state: KioskState;
  startedAt: number;
  verifiedAt: number | null;
  checkedInAt: number | null;
  errorMessage: string | null;
}

function initSession(venueId: string, nowMs: number): KioskSession {
  return {
    sessionId: `kiosk-${nowMs}`, venueId,
    bookingId: null, userId: null,
    state: "idle", startedAt: nowMs,
    verifiedAt: null, checkedInAt: null, errorMessage: null,
  };
}

function startScan(session: KioskSession): KioskSession {
  if (session.state !== "idle") throw new Error("Kiosk not idle");
  return { ...session, state: "scanning" };
}

function verifyBooking(
  session: KioskSession,
  bookingId: string,
  userId: string,
  nowMs: number
): KioskSession {
  if (session.state !== "scanning") throw new Error("Not in scanning state");
  return { ...session, state: "verified", bookingId, userId, verifiedAt: nowMs };
}

function completeCheckIn(session: KioskSession, nowMs: number): KioskSession {
  if (session.state !== "verified") throw new Error("Booking not verified");
  return { ...session, state: "checked_in", checkedInAt: nowMs };
}

function failSession(session: KioskSession, message: string): KioskSession {
  return { ...session, state: "error", errorMessage: message };
}

function resetKiosk(session: KioskSession, nowMs: number): KioskSession {
  return initSession(session.venueId, nowMs);
}

const NOW = 1_700_000_000_000;

describe("Venue self-service kiosk", () => {
  it("initSession: starts in idle state", () => {
    const session = initSession("v1", NOW);
    expect(session.state).toBe("idle");
    expect(session.bookingId).toBeNull();
  });

  it("startScan: idle → scanning", () => {
    const session = initSession("v1", NOW);
    expect(startScan(session).state).toBe("scanning");
  });

  it("startScan: throws if not idle", () => {
    const scanning = startScan(initSession("v1", NOW));
    expect(() => startScan(scanning)).toThrow("not idle");
  });

  it("verifyBooking: scanning → verified with data", () => {
    const scanning = startScan(initSession("v1", NOW));
    const verified = verifyBooking(scanning, "b1", "u1", NOW);
    expect(verified.state).toBe("verified");
    expect(verified.bookingId).toBe("b1");
    expect(verified.verifiedAt).toBe(NOW);
  });

  it("completeCheckIn: verified → checked_in", () => {
    const scanning = startScan(initSession("v1", NOW));
    const verified = verifyBooking(scanning, "b1", "u1", NOW);
    const checkedIn = completeCheckIn(verified, NOW);
    expect(checkedIn.state).toBe("checked_in");
    expect(checkedIn.checkedInAt).toBe(NOW);
  });

  it("failSession: sets error state and message", () => {
    const scanning = startScan(initSession("v1", NOW));
    const failed = failSession(scanning, "Invalid QR code");
    expect(failed.state).toBe("error");
    expect(failed.errorMessage).toBe("Invalid QR code");
  });

  it("resetKiosk: returns to idle state", () => {
    const failed = failSession(startScan(initSession("v1", NOW)), "Error");
    const reset = resetKiosk(failed, NOW + 1000);
    expect(reset.state).toBe("idle");
    expect(reset.errorMessage).toBeNull();
  });
});
