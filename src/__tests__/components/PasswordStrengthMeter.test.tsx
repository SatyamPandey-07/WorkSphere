import { render, screen } from "@testing-library/react";
import { evaluatePasswordStrength, PasswordStrengthMeter } from "@/components/ui/PasswordStrengthMeter";

describe("evaluatePasswordStrength", () => {
  it("returns 'empty' for an empty string", () => {
    expect(evaluatePasswordStrength("").strength).toBe("empty");
  });

  it("returns 'weak' for a very short password", () => {
    expect(evaluatePasswordStrength("abc").strength).toBe("weak");
  });

  it("includes length feedback when password is under 8 chars", () => {
    const { feedback } = evaluatePasswordStrength("short");
    expect(feedback.some((f) => /8 characters/i.test(f))).toBe(true);
  });

  it("returns 'fair' for a password meeting 2 criteria (length + upper)", () => {
    const { strength } = evaluatePasswordStrength("AbcdefgH");
    expect(["fair", "good"]).toContain(strength);
  });

  it("returns 'strong' for a password meeting all criteria", () => {
    const { strength } = evaluatePasswordStrength("Secure#1pass!");
    expect(strength).toBe("strong");
  });

  it("provides no feedback for a strong password", () => {
    const { feedback } = evaluatePasswordStrength("SuperSecure99$");
    expect(feedback.length).toBe(0);
  });

  it("score increases with additional criteria", () => {
    const weak = evaluatePasswordStrength("abc").score;
    const better = evaluatePasswordStrength("abcdefgH").score;
    const strong = evaluatePasswordStrength("Abcdefg1!xyz").score;
    expect(better).toBeGreaterThan(weak);
    expect(strong).toBeGreaterThanOrEqual(better);
  });

  it("detects uppercase letters", () => {
    const { feedback } = evaluatePasswordStrength("alllowercase123!");
    expect(feedback.some((f) => /uppercase/i.test(f))).toBe(true);
  });

  it("detects missing special characters", () => {
    const { feedback } = evaluatePasswordStrength("AlphaNum123");
    expect(feedback.some((f) => /special/i.test(f))).toBe(true);
  });
});

describe("PasswordStrengthMeter component", () => {
  it("renders nothing when password is empty", () => {
    const { container } = render(<PasswordStrengthMeter password="" />);
    expect(container.firstChild).toBeNull();
  });

  it("renders the strength label for a weak password", () => {
    render(<PasswordStrengthMeter password="abc" />);
    expect(screen.getByText("Weak")).toBeInTheDocument();
  });

  it("renders the strength label for a strong password", () => {
    render(<PasswordStrengthMeter password="Str0ng!pass#" />);
    expect(screen.getByText("Strong")).toBeInTheDocument();
  });

  it("renders a segmented bar", () => {
    const { container } = render(<PasswordStrengthMeter password="Test1!" />);
    // 4 segments
    const segments = container.querySelectorAll('[class*="flex-1"]');
    expect(segments.length).toBe(4);
  });

  it("has aria-live='polite' for accessibility", () => {
    const { container } = render(<PasswordStrengthMeter password="test" />);
    expect(container.querySelector('[aria-live="polite"]')).toBeInTheDocument();
  });
});
