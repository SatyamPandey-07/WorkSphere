import React from "react";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import {
  PasswordStrengthMeter,
  evaluatePasswordStrength,
} from "@/components/ui/PasswordStrengthMeter";

describe("evaluatePasswordStrength", () => {
  it("returns empty result when password is empty string", () => {
    const result = evaluatePasswordStrength("");
    expect(result.strength).toBe("empty");
    expect(result.score).toBe(0);
    expect(result.feedback).toEqual([]);
  });

  it("evaluates short password as weak", () => {
    const result = evaluatePasswordStrength("short");
    expect(result.strength).toBe("weak");
    expect(result.feedback).toContain("At least 8 characters");
  });

  it("evaluates medium complexity password as fair", () => {
    const result = evaluatePasswordStrength("password12");
    expect(result.strength).toBe("fair");
    expect(result.feedback).toContain("Add an uppercase letter");
  });

  it("evaluates complex password as good or strong", () => {
    const goodResult = evaluatePasswordStrength("Password12");
    expect(["good", "strong"]).toContain(goodResult.strength);

    const strongResult = evaluatePasswordStrength("P@ssw0rd2026!!");
    expect(strongResult.strength).toBe("strong");
    expect(strongResult.score).toBe(4);
  });
});

describe("PasswordStrengthMeter Component", () => {
  it("renders nothing when password is empty", () => {
    render(<PasswordStrengthMeter password="" />);
    expect(
      screen.queryByTestId("password-strength-meter"),
    ).not.toBeInTheDocument();
  });

  it("renders meter with weak label and single feedback item by default", () => {
    render(<PasswordStrengthMeter password="abc" />);

    expect(screen.getByTestId("password-strength-meter")).toBeInTheDocument();
    expect(screen.getByTestId("password-strength-label")).toHaveTextContent(
      "Weak",
    );
    expect(
      screen.getByTestId("password-strength-feedback"),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("password-strength-feedback-list"),
    ).not.toBeInTheDocument();
  });

  it("renders all feedback suggestions when showAllFeedback is true", () => {
    render(<PasswordStrengthMeter password="abc" showAllFeedback={true} />);

    expect(
      screen.getByTestId("password-strength-feedback-list"),
    ).toBeInTheDocument();
    const items = screen.getAllByTestId("password-strength-feedback-item");
    expect(items.length).toBeGreaterThan(1);
  });

  it("renders strong styling for high entropy passwords", () => {
    render(<PasswordStrengthMeter password="SuperSecure#Pass992" />);

    expect(screen.getByTestId("password-strength-label")).toHaveTextContent(
      "Strong",
    );
  });
});
