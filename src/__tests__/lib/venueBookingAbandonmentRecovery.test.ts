/**
 * Tests for booking abandonment detection and recovery.
 */

interface AbandonedSession {
  sessionId: string;
  userId: string;
  venueId: string;
  lastStage: string;
  cartValueCents: number;
  abandonedAt: number;
  recoveryAttempts: number;
  recovered: boolean;
  recoveredAt: number | null;
}

function shouldSendRecovery(
  session: AbandonedSession,
  nowMs: number,
  maxAttempts = 3,
  cooldownMs = 24 * 3600_000
): boolean {
  if (session.recovered) return false;
  if (session.recoveryAttempts >= maxAttempts) return false;
  const lastAttemptAt = session.abandonedAt + session.recoveryAttempts * cooldownMs;
  return nowMs >= lastAttemptAt + cooldownMs;
}

function recoveryMessageType(session: AbandonedSession): "gentle_reminder" | "discount_offer" | "urgency_message" {
  if (session.recoveryAttempts === 0) return "gentle_reminder";
  if (session.recoveryAttempts === 1 && session.cartValueCents > 5000) return "discount_offer";
  return "urgency_message";
}

function recordRecoveryAttempt(session: AbandonedSession): AbandonedSession {
  return { ...session, recoveryAttempts: session.recoveryAttempts + 1 };
}

function markRecovered(session: AbandonedSession, nowMs: number): AbandonedSession {
  return { ...session, recovered: true, recoveredAt: nowMs };
}

function recoveryRate(sessions: AbandonedSession[]): number {
  if (sessions.length === 0) return 0;
  return Math.round((sessions.filter((s) => s.recovered).length / sessions.length) * 100);
}

const NOW = 1_700_000_000_000;
const SESSION: AbandonedSession = {
  sessionId: "ab1", userId: "u1", venueId: "v1",
  lastStage: "payment", cartValueCents: 8000,
  abandonedAt: NOW - 25 * 3600_000, recoveryAttempts: 0, recovered: false, recoveredAt: null,
};

describe("Booking abandonment recovery", () => {
  it("shouldSendRecovery: 25h since abandon, 24h cooldown → true", () => {
    expect(shouldSendRecovery(SESSION, NOW)).toBe(true);
  });

  it("shouldSendRecovery: recently abandoned → false", () => {
    const recent = { ...SESSION, abandonedAt: NOW - 1000 };
    expect(shouldSendRecovery(recent, NOW)).toBe(false);
  });

  it("shouldSendRecovery: already recovered → false", () => {
    const recovered = markRecovered(SESSION, NOW - 1000);
    expect(shouldSendRecovery(recovered, NOW)).toBe(false);
  });

  it("shouldSendRecovery: max attempts → false", () => {
    const maxed = { ...SESSION, recoveryAttempts: 3 };
    expect(shouldSendRecovery(maxed, NOW)).toBe(false);
  });

  it("recoveryMessageType: first attempt → gentle_reminder", () => {
    expect(recoveryMessageType(SESSION)).toBe("gentle_reminder");
  });

  it("recoveryMessageType: second attempt + high value → discount_offer", () => {
    const secondAttempt = { ...SESSION, recoveryAttempts: 1 };
    expect(recoveryMessageType(secondAttempt)).toBe("discount_offer");
  });

  it("markRecovered: sets recovered flag", () => {
    const recovered = markRecovered(SESSION, NOW);
    expect(recovered.recovered).toBe(true);
    expect(recovered.recoveredAt).toBe(NOW);
  });

  it("recoveryRate: 1 of 3 recovered = 33%", () => {
    const sessions = [SESSION, { ...SESSION, sessionId: "ab2", recovered: true, recoveredAt: NOW - 1000 }, { ...SESSION, sessionId: "ab3" }];
    expect(recoveryRate(sessions)).toBe(33);
  });
});
