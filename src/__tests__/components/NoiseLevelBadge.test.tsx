import React from "react";
import { render, screen } from "@testing-library/react";
import {
  NoiseLevelBadge,
  parseNoiseLevel,
  NOISE_LEVEL_MAP,
} from "@/components/ui/NoiseLevelBadge";

describe("NoiseLevelBadge component", () => {
  it("returns null when noiseLevel is undefined and showUnknown is false", () => {
    const { container } = render(<NoiseLevelBadge />);
    expect(container.firstChild).toBeNull();
  });

  it("returns null when noiseLevel is unrecognized and showUnknown is false", () => {
    const { container } = render(<NoiseLevelBadge noiseLevel="unknown-noise" />);
    expect(container.firstChild).toBeNull();
  });

  it("renders unknown fallback badge when showUnknown is true and noiseLevel is missing", () => {
    render(<NoiseLevelBadge showUnknown />);
    const badge = screen.getByRole("status");
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveTextContent("Unknown Noise");
    expect(badge).toHaveAttribute("aria-label", "Ambient noise level: Unknown");
  });

  it("renders quiet tier with emerald styling, icon, and label", () => {
    render(<NoiseLevelBadge noiseLevel="quiet" />);
    const badge = screen.getByRole("status");
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveTextContent("Quiet Focus");
    expect(badge).toHaveAttribute(
      "aria-label",
      "Ambient noise level: Quiet Focus (< 50 dB)",
    );
    expect(badge.className).toContain("text-emerald-700");
  });

  it("renders moderate tier with amber styling, icon, and label", () => {
    render(<NoiseLevelBadge noiseLevel="moderate" />);
    const badge = screen.getByRole("status");
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveTextContent("Moderate Ambience");
    expect(badge).toHaveAttribute(
      "aria-label",
      "Ambient noise level: Moderate Ambience (50-70 dB)",
    );
    expect(badge.className).toContain("text-amber-700");
  });

  it("renders loud tier with rose styling, icon, and label", () => {
    render(<NoiseLevelBadge noiseLevel="loud" />);
    const badge = screen.getByRole("status");
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveTextContent("Lively & Energetic");
    expect(badge).toHaveAttribute(
      "aria-label",
      "Ambient noise level: Lively & Energetic (> 70 dB)",
    );
    expect(badge.className).toContain("text-rose-700");
  });

  it("renders short label when variant is 'compact'", () => {
    render(<NoiseLevelBadge noiseLevel="quiet" variant="compact" />);
    const badge = screen.getByRole("status");
    expect(badge).toHaveTextContent("Quiet");
    expect(badge).not.toHaveTextContent("Quiet Focus");
  });

  it("applies transparent styling when variant is 'subtle'", () => {
    render(<NoiseLevelBadge noiseLevel="quiet" variant="subtle" />);
    const badge = screen.getByRole("status");
    expect(badge.className).toContain("bg-transparent");
  });

  it("displays decibel range when showDecibels is true", () => {
    render(<NoiseLevelBadge noiseLevel="quiet" showDecibels />);
    const badge = screen.getByRole("status");
    expect(badge).toHaveTextContent("(< 50 dB)");
  });

  it("applies size classes correctly for sm, md, and lg", () => {
    const { rerender } = render(<NoiseLevelBadge noiseLevel="quiet" size="sm" />);
    expect(screen.getByRole("status").className).toContain("text-[11px]");

    rerender(<NoiseLevelBadge noiseLevel="quiet" size="lg" />);
    expect(screen.getByRole("status").className).toContain("text-sm");
  });

  it("applies custom className", () => {
    render(<NoiseLevelBadge noiseLevel="quiet" className="custom-test-class" />);
    expect(screen.getByRole("status").className).toContain("custom-test-class");
  });
});

describe("parseNoiseLevel helper", () => {
  it("returns null for null, undefined, or empty strings", () => {
    expect(parseNoiseLevel(null)).toBeNull();
    expect(parseNoiseLevel(undefined)).toBeNull();
    expect(parseNoiseLevel("")).toBeNull();
    expect(parseNoiseLevel("   ")).toBeNull();
  });

  it("correctly parses case-insensitive quiet aliases", () => {
    expect(parseNoiseLevel("quiet")).toBe("quiet");
    expect(parseNoiseLevel("QUIET")).toBe("quiet");
    expect(parseNoiseLevel("Silent")).toBe("quiet");
    expect(parseNoiseLevel("calm")).toBe("quiet");
  });

  it("correctly parses case-insensitive moderate aliases", () => {
    expect(parseNoiseLevel("moderate")).toBe("moderate");
    expect(parseNoiseLevel("MODERATE")).toBe("moderate");
    expect(parseNoiseLevel("Medium")).toBe("moderate");
    expect(parseNoiseLevel("average")).toBe("moderate");
  });

  it("correctly parses case-insensitive loud and lively aliases", () => {
    expect(parseNoiseLevel("loud")).toBe("loud");
    expect(parseNoiseLevel("LOUD")).toBe("loud");
    expect(parseNoiseLevel("noisy")).toBe("loud");
    expect(parseNoiseLevel("lively")).toBe("loud");
    expect(parseNoiseLevel("energetic")).toBe("loud");
    expect(parseNoiseLevel("high")).toBe("loud");
  });

  it("returns null for non-matching strings", () => {
    expect(parseNoiseLevel("random-string")).toBeNull();
  });
});
