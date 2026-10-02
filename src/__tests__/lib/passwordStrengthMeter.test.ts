/**
 * Tests for password strength evaluation.
 */

interface PasswordStrength {
  score: number;         // 0-4
  label: "very_weak" | "weak" | "fair" | "strong" | "very_strong";
  suggestions: string[];
}

function evaluatePassword(password: string): PasswordStrength {
  let score = 0;
  const suggestions: string[] = [];

  if (password.length >= 8)  score++;
  else suggestions.push("Use at least 8 characters");

  if (password.length >= 12) score++;
  else if (password.length >= 8) suggestions.push("Use at least 12 characters for extra security");

  if (/[A-Z]/.test(password)) score++;
  else suggestions.push("Add uppercase letters");

  if (/[0-9]/.test(password)) score++;
  else suggestions.push("Add numbers");

  if (/[^A-Za-z0-9]/.test(password)) score++;
  else suggestions.push("Add special characters");

  const labels: PasswordStrength["label"][] = ["very_weak", "weak", "fair", "strong", "very_strong"];
  return { score: Math.min(score, 4), label: labels[Math.min(score, 4)], suggestions };
}

describe("Password strength evaluation", () => {
  it("very weak: short no variety", () => {
    const r = evaluatePassword("abc");
    expect(r.label).toBe("very_weak");
    expect(r.score).toBe(0);
  });

  it("weak: 8 chars lowercase only", () => {
    const r = evaluatePassword("abcdefgh");
    expect(r.score).toBe(1);
  });

  it("fair: 8 chars with uppercase and number", () => {
    const r = evaluatePassword("Abcdef1g");
    expect(r.score).toBe(2);
  });

  it("strong: 12+ chars with uppercase and number", () => {
    const r = evaluatePassword("Abcdefghij1k");
    expect(r.score).toBe(3);
  });

  it("very strong: 12+ chars uppercase number special", () => {
    const r = evaluatePassword("Abcdefghij1!");
    expect(r.score).toBe(4);
    expect(r.label).toBe("very_strong");
  });

  it("suggestions mention missing uppercase", () => {
    const r = evaluatePassword("abcdef12");
    expect(r.suggestions.some((s) => /uppercase/i.test(s))).toBe(true);
  });

  it("suggestions mention missing numbers", () => {
    const r = evaluatePassword("Abcdefgh");
    expect(r.suggestions.some((s) => /number/i.test(s))).toBe(true);
  });

  it("strong password has no uppercase suggestion", () => {
    const r = evaluatePassword("Abcdef12!");
    expect(r.suggestions.some((s) => /uppercase/i.test(s))).toBe(false);
  });
});
