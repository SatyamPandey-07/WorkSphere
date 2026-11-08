/**
 * Additional edge case tests for password strength meter (Issue #1839).
 */

import { evaluatePasswordStrength } from "@/components/ui/PasswordStrengthMeter";

describe("Password strength edge cases", () => {
  it("only uppercase letters — missing lowercase, number, special char", () => {
    const { feedback } = evaluatePasswordStrength("ABCDEFGH");
    expect(feedback.length).toBeGreaterThan(0);
  });

  it("only numbers — missing uppercase, special char", () => {
    const { score } = evaluatePasswordStrength("12345678");
    expect(score).toBeLessThan(4); // not strong
  });

  it("very long password with all criteria = strong", () => {
    const { strength } = evaluatePasswordStrength("Abcdefghijk1!xyz$99");
    expect(strength).toBe("strong");
  });

  it("12+ character password with upper+digit+special = strong", () => {
    const { strength } = evaluatePasswordStrength("Tr0ub4dor&3");
    expect(strength).toBe("strong");
  });

  it("password with only special chars is weak", () => {
    const { strength } = evaluatePasswordStrength("!@#$%^&*");
    expect(strength).toBe("weak"); // no uppercase, no digits, length < 12
  });

  it("length 8 with uppercase only = fair or good", () => {
    const { strength } = evaluatePasswordStrength("ABCDEFGH");
    expect(["fair", "good"]).toContain(strength);
  });

  it("8 char with upper + number + special = good", () => {
    const { strength } = evaluatePasswordStrength("Abc1!xyz");
    expect(["good", "strong"]).toContain(strength);
  });

  it("score is between 0 and 4 inclusive", () => {
    ["", "abc", "Abc123!", "Abc123!xyz$"].forEach((pw) => {
      const { score } = evaluatePasswordStrength(pw);
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(4);
    });
  });

  it("whitespace-only password is empty strength", () => {
    const { strength } = evaluatePasswordStrength("        ");
    // 8 spaces — technically 8 chars but no meaningful criteria
    // at minimum should be 'weak' since length ≥ 8 but no other criteria
    expect(["empty", "weak"]).toContain(strength);
  });
});
