/**
 * Tests for two-factor authentication flow management.
 */

type TwoFaMethod = "totp" | "sms" | "email" | "authenticator_app";

interface TwoFaConfig {
  userId: string;
  enabled: boolean;
  method: TwoFaMethod;
  setupAt: number;
  backupCodes: string[];
  lastUsedAt: number | null;
}

function isTwoFaEnabled(config: TwoFaConfig): boolean {
  return config.enabled;
}

function hasBackupCodes(config: TwoFaConfig): boolean {
  return config.backupCodes.length > 0;
}

function useBackupCode(config: TwoFaConfig, code: string): TwoFaConfig | null {
  const index = config.backupCodes.indexOf(code);
  if (index === -1) return null;
  return {
    ...config,
    backupCodes: config.backupCodes.filter((_, i) => i !== index),
  };
}

function generateBackupCodes(count = 8): string[] {
  const codes: string[] = [];
  for (let i = 0; i < count; i++) {
    codes.push(
      Math.random().toString(36).substring(2, 10).toUpperCase()
    );
  }
  return codes;
}

const NOW = 1_700_000_000_000;
const CONFIG: TwoFaConfig = {
  userId: "u1", enabled: true, method: "totp",
  setupAt: NOW - 86_400_000,
  backupCodes: ["CODE1234", "BACK5678", "SAFE9012"],
  lastUsedAt: NOW - 3_600_000,
};

describe("Two-factor authentication", () => {
  it("isTwoFaEnabled: enabled → true", () => {
    expect(isTwoFaEnabled(CONFIG)).toBe(true);
  });

  it("isTwoFaEnabled: disabled → false", () => {
    expect(isTwoFaEnabled({ ...CONFIG, enabled: false })).toBe(false);
  });

  it("hasBackupCodes: non-empty → true", () => {
    expect(hasBackupCodes(CONFIG)).toBe(true);
  });

  it("hasBackupCodes: empty → false", () => {
    expect(hasBackupCodes({ ...CONFIG, backupCodes: [] })).toBe(false);
  });

  it("useBackupCode: valid code removes it", () => {
    const updated = useBackupCode(CONFIG, "CODE1234");
    expect(updated!.backupCodes).not.toContain("CODE1234");
    expect(updated!.backupCodes).toHaveLength(2);
  });

  it("useBackupCode: invalid code → null", () => {
    expect(useBackupCode(CONFIG, "INVALID")).toBeNull();
  });

  it("useBackupCode: immutable", () => {
    useBackupCode(CONFIG, "CODE1234");
    expect(CONFIG.backupCodes).toHaveLength(3);
  });

  it("generateBackupCodes: returns correct count", () => {
    expect(generateBackupCodes(8)).toHaveLength(8);
  });

  it("generateBackupCodes: each code is unique", () => {
    const codes = generateBackupCodes(8);
    expect(new Set(codes).size).toBe(8);
  });
});
