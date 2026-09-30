/**
 * Tests for user account suspension and reinstatement logic.
 */

type SuspensionReason = "payment_failed" | "policy_violation" | "fraud_suspected" | "abuse" | "inactivity";

interface AccountStatus {
  userId: string;
  isActive: boolean;
  isSuspended: boolean;
  suspendedAt: number | null;
  suspendedUntil: number | null;  // null = indefinite
  suspensionReason: SuspensionReason | null;
  strikeCount: number;
}

function isAccountSuspended(status: AccountStatus, nowMs: number): boolean {
  if (!status.isSuspended) return false;
  if (status.suspendedUntil === null) return true; // indefinite
  return nowMs < status.suspendedUntil;
}

function canLogin(status: AccountStatus, nowMs: number): boolean {
  return status.isActive && !isAccountSuspended(status, nowMs);
}

function suspendAccount(
  status: AccountStatus,
  reason: SuspensionReason,
  durationMs: number | null,
  nowMs: number
): AccountStatus {
  return {
    ...status,
    isSuspended: true,
    suspendedAt: nowMs,
    suspendedUntil: durationMs !== null ? nowMs + durationMs : null,
    suspensionReason: reason,
    strikeCount: status.strikeCount + 1,
  };
}

function reinstateAccount(status: AccountStatus): AccountStatus {
  return {
    ...status,
    isSuspended: false,
    suspendedAt: null,
    suspendedUntil: null,
    suspensionReason: null,
  };
}

const NOW = 1_700_000_000_000;
const ACTIVE: AccountStatus = {
  userId: "u1", isActive: true, isSuspended: false,
  suspendedAt: null, suspendedUntil: null, suspensionReason: null, strikeCount: 0,
};

describe("User account suspension", () => {
  it("canLogin: active account → true", () => {
    expect(canLogin(ACTIVE, NOW)).toBe(true);
  });

  it("canLogin: suspended account → false", () => {
    const suspended = suspendAccount(ACTIVE, "policy_violation", 86_400_000, NOW);
    expect(canLogin(suspended, NOW)).toBe(false);
  });

  it("canLogin: suspension expired → true", () => {
    const suspended = suspendAccount(ACTIVE, "policy_violation", 86_400_000, NOW);
    expect(canLogin(suspended, NOW + 2 * 86_400_000)).toBe(true);
  });

  it("suspendAccount: increments strikeCount", () => {
    const suspended = suspendAccount(ACTIVE, "abuse", null, NOW);
    expect(suspended.strikeCount).toBe(1);
  });

  it("suspendAccount: indefinite suspension", () => {
    const suspended = suspendAccount(ACTIVE, "fraud_suspected", null, NOW);
    expect(isAccountSuspended(suspended, NOW + 99_999_999_999)).toBe(true);
  });

  it("reinstateAccount: clears suspension", () => {
    const suspended = suspendAccount(ACTIVE, "inactivity", 86_400_000, NOW);
    const reinstated = reinstateAccount(suspended);
    expect(reinstated.isSuspended).toBe(false);
    expect(reinstated.suspensionReason).toBeNull();
  });

  it("reinstateAccount: preserves strikeCount", () => {
    const suspended = suspendAccount(ACTIVE, "abuse", null, NOW);
    expect(reinstateAccount(suspended).strikeCount).toBe(1);
  });
});
