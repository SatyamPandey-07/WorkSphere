/**
 * Tests for passkey rotation schedule prompting logic.
 *
 * Covers: credential older than 90 days needs rotation, newer does not,
 * exactly 90 days triggers rotation (boundary), and the needsRotation flag.
 * Self-contained — no external imports.
 */

// ─── Minimal rotation schedule implementation used only by these tests ────────

interface PasskeyCredential {
  id: string;
  createdAt: Date;
}

interface RotationCheckResult {
  needsRotation: boolean;
  daysSinceCreation: number;
}

const ROTATION_THRESHOLD_DAYS = 90;

function checkPasskeyRotation(
  credential: PasskeyCredential,
  now: Date = new Date()
): RotationCheckResult {
  const msPerDay = 1000 * 60 * 60 * 24;
  const daysSinceCreation = Math.floor(
    (now.getTime() - credential.createdAt.getTime()) / msPerDay
  );
  return {
    needsRotation: daysSinceCreation >= ROTATION_THRESHOLD_DAYS,
    daysSinceCreation,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

function daysAgo(days: number, from: Date = new Date("2025-07-01T12:00:00Z")): Date {
  return new Date(from.getTime() - days * 24 * 60 * 60 * 1000);
}

const REFERENCE_NOW = new Date("2025-07-01T12:00:00Z");

describe("checkPasskeyRotation", () => {
  describe("credential older than 90 days", () => {
    it("marks a 91-day-old credential as needing rotation", () => {
      const cred: PasskeyCredential = {
        id: "pk-old",
        createdAt: daysAgo(91, REFERENCE_NOW),
      };
      const { needsRotation } = checkPasskeyRotation(cred, REFERENCE_NOW);
      expect(needsRotation).toBe(true);
    });

    it("marks a 180-day-old credential as needing rotation", () => {
      const cred: PasskeyCredential = {
        id: "pk-very-old",
        createdAt: daysAgo(180, REFERENCE_NOW),
      };
      const { needsRotation } = checkPasskeyRotation(cred, REFERENCE_NOW);
      expect(needsRotation).toBe(true);
    });

    it("reports the correct daysSinceCreation for an old credential", () => {
      const cred: PasskeyCredential = {
        id: "pk-100",
        createdAt: daysAgo(100, REFERENCE_NOW),
      };
      const { daysSinceCreation } = checkPasskeyRotation(cred, REFERENCE_NOW);
      expect(daysSinceCreation).toBe(100);
    });
  });

  describe("credential newer than 90 days", () => {
    it("does not flag a 1-day-old credential for rotation", () => {
      const cred: PasskeyCredential = {
        id: "pk-new",
        createdAt: daysAgo(1, REFERENCE_NOW),
      };
      const { needsRotation } = checkPasskeyRotation(cred, REFERENCE_NOW);
      expect(needsRotation).toBe(false);
    });

    it("does not flag a 45-day-old credential for rotation", () => {
      const cred: PasskeyCredential = {
        id: "pk-mid",
        createdAt: daysAgo(45, REFERENCE_NOW),
      };
      const { needsRotation } = checkPasskeyRotation(cred, REFERENCE_NOW);
      expect(needsRotation).toBe(false);
    });

    it("does not flag an 89-day-old credential for rotation", () => {
      const cred: PasskeyCredential = {
        id: "pk-89",
        createdAt: daysAgo(89, REFERENCE_NOW),
      };
      const { needsRotation } = checkPasskeyRotation(cred, REFERENCE_NOW);
      expect(needsRotation).toBe(false);
    });
  });

  describe("boundary condition: exactly 90 days", () => {
    it("flags a credential that is exactly 90 days old as needing rotation", () => {
      const cred: PasskeyCredential = {
        id: "pk-boundary",
        createdAt: daysAgo(90, REFERENCE_NOW),
      };
      const { needsRotation } = checkPasskeyRotation(cred, REFERENCE_NOW);
      expect(needsRotation).toBe(true);
    });

    it("reports daysSinceCreation as exactly 90 at the boundary", () => {
      const cred: PasskeyCredential = {
        id: "pk-boundary-days",
        createdAt: daysAgo(90, REFERENCE_NOW),
      };
      const { daysSinceCreation } = checkPasskeyRotation(cred, REFERENCE_NOW);
      expect(daysSinceCreation).toBe(90);
    });
  });

  describe("needsRotation flag shape", () => {
    it("result always contains needsRotation boolean and daysSinceCreation number", () => {
      const cred: PasskeyCredential = {
        id: "pk-shape",
        createdAt: daysAgo(30, REFERENCE_NOW),
      };
      const result = checkPasskeyRotation(cred, REFERENCE_NOW);
      expect(typeof result.needsRotation).toBe("boolean");
      expect(typeof result.daysSinceCreation).toBe("number");
    });

    it("needsRotation is false when credential was just created", () => {
      const cred: PasskeyCredential = {
        id: "pk-fresh",
        createdAt: REFERENCE_NOW,
      };
      const { needsRotation, daysSinceCreation } = checkPasskeyRotation(
        cred,
        REFERENCE_NOW
      );
      expect(needsRotation).toBe(false);
      expect(daysSinceCreation).toBe(0);
    });
  });
});
