import React from "react";
import { render, screen } from "@testing-library/react";
import {
  NoiseLevelBadge,
  parseNoiseLevel,
  NOISE_LEVEL_MAP,
  MachSpeedBadge,
  getMachSpeedTier,
  parseMachSpeed,
  MACH_SPEED_MAP,
} from "@/components/ui/NoiseLevelBadge";

describe("NoiseLevelBadge component", () => {
  it("returns null when noiseLevel is undefined and showUnknown is false", () => {
    const { container } = render(<NoiseLevelBadge />);
    expect(container.firstChild).toBeNull();
  });

  it("returns null when noiseLevel is unrecognized and showUnknown is false", () => {
    const { container } = render(
      <NoiseLevelBadge noiseLevel="unknown-noise" />,
    );
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
    const { rerender } = render(
      <NoiseLevelBadge noiseLevel="quiet" size="sm" />,
    );
    expect(screen.getByRole("status").className).toContain("text-[11px]");

    rerender(<NoiseLevelBadge noiseLevel="quiet" size="lg" />);
    expect(screen.getByRole("status").className).toContain("text-sm");
  });

  it("applies custom className", () => {
    render(
      <NoiseLevelBadge noiseLevel="quiet" className="custom-test-class" />,
    );
    expect(screen.getByRole("status").className).toContain("custom-test-class");
  });

  it("renders with data-testid='noise-level-badge'", () => {
    render(<NoiseLevelBadge noiseLevel="quiet" />);
    expect(screen.getByTestId("noise-level-badge")).toBeInTheDocument();
  });

  it("accepts numeric decibel input directly in NoiseLevelBadge", () => {
    render(<NoiseLevelBadge noiseLevel={42} />);
    expect(screen.getByTestId("noise-level-badge")).toHaveTextContent(
      "Quiet Focus",
    );
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

  it("correctly parses numeric decibel values into appropriate tiers", () => {
    expect(parseNoiseLevel(35)).toBe("quiet");
    expect(parseNoiseLevel(49.5)).toBe("quiet");
    expect(parseNoiseLevel(50)).toBe("moderate");
    expect(parseNoiseLevel(65)).toBe("moderate");
    expect(parseNoiseLevel(70)).toBe("moderate");
    expect(parseNoiseLevel(75)).toBe("loud");
    expect(parseNoiseLevel(90)).toBe("loud");
  });

  it("correctly parses formatted decibel string inputs", () => {
    expect(parseNoiseLevel("45 dB")).toBe("quiet");
    expect(parseNoiseLevel("60 dB")).toBe("moderate");
    expect(parseNoiseLevel("85 dB")).toBe("loud");
  });

  it("returns null for non-matching strings or invalid numbers", () => {
    expect(parseNoiseLevel("random-string")).toBeNull();
    expect(parseNoiseLevel(-5)).toBeNull();
    expect(parseNoiseLevel(NaN)).toBeNull();
  });
});

describe("MachSpeedBadge component (#6175)", () => {
  it("returns null when downloadMbps is undefined and showUnknown is false", () => {
    const { container } = render(<MachSpeedBadge />);
    expect(container.firstChild).toBeNull();
  });

  it("returns null when downloadMbps is 0 or negative and showUnknown is false", () => {
    const { container } = render(<MachSpeedBadge downloadMbps={0} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders unknown speed badge fallback when showUnknown is true", () => {
    render(<MachSpeedBadge showUnknown />);
    const badge = screen.getByRole("status");
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveTextContent("Unknown Speed");
    expect(badge).toHaveAttribute(
      "aria-label",
      "Aerospace WiFi speed: Unknown",
    );
  });

  it("renders Subsonic (<50 Mbps) tier with jet icon and sky color styling", () => {
    render(<MachSpeedBadge downloadMbps={30} />);
    const badge = screen.getByRole("status");
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveTextContent("Subsonic (<50 Mbps)");
    expect(badge.className).toContain("text-sky-700");
    expect(screen.getByTestId("jet-icon")).toBeInTheDocument();
  });

  it("renders Supersonic (50-250 Mbps) tier with jet icon and violet color styling", () => {
    render(<MachSpeedBadge downloadMbps={120} />);
    const badge = screen.getByRole("status");
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveTextContent("Supersonic (50-250 Mbps)");
    expect(badge.className).toContain("text-violet-700");
    expect(screen.getByTestId("jet-icon")).toBeInTheDocument();
  });

  it("renders Hypersonic Mach 5 (>250 Mbps) tier with jet icon and emerald color styling", () => {
    render(<MachSpeedBadge downloadMbps={450} />);
    const badge = screen.getByRole("status");
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveTextContent("Hypersonic Mach 5 (>250 Mbps)");
    expect(badge.className).toContain("text-emerald-700");
    expect(screen.getByTestId("jet-icon")).toBeInTheDocument();
  });

  it("renders short label when variant is 'compact'", () => {
    render(<MachSpeedBadge downloadMbps={300} variant="compact" />);
    const badge = screen.getByRole("status");
    expect(badge).toHaveTextContent("Hypersonic Mach 5");
    expect(badge).not.toHaveTextContent("(>250 Mbps)");
  });

  it("renders transparent background when variant is 'subtle'", () => {
    render(<MachSpeedBadge downloadMbps={150} variant="subtle" />);
    const badge = screen.getByRole("status");
    expect(badge.className).toContain("bg-transparent");
  });

  it("renders accessible tooltip with exact verified download and upload speeds", () => {
    render(<MachSpeedBadge downloadMbps={500} uploadMbps={250} />);
    const badge = screen.getByRole("status");
    expect(badge).toHaveAttribute(
      "title",
      expect.stringContaining("Verified WiFi: 500 Mbps down / 250 Mbps up"),
    );

    const tooltip = screen.getByTestId("mach-speed-tooltip");
    expect(tooltip).toBeInTheDocument();
    expect(tooltip).toHaveTextContent("500 Mbps");
    expect(tooltip).toHaveTextContent("250 Mbps");
    expect(tooltip).toHaveTextContent("Mach 5+");
  });

  it("applies size classes correctly for sm, md, and lg", () => {
    const { rerender } = render(
      <MachSpeedBadge downloadMbps={100} size="sm" />,
    );
    expect(screen.getByRole("status").className).toContain("text-[11px]");

    rerender(<MachSpeedBadge downloadMbps={100} size="lg" />);
    expect(screen.getByRole("status").className).toContain("text-sm");
  });

  it("accepts speed prop as string and parses correctly", () => {
    render(<MachSpeedBadge speed="85 Mbps" />);
    const badge = screen.getByRole("status");
    expect(badge).toHaveTextContent("Supersonic (50-250 Mbps)");
  });
});

describe("getMachSpeedTier & parseMachSpeed helpers (#6175)", () => {
  it("returns null for invalid inputs", () => {
    expect(getMachSpeedTier(null)).toBeNull();
    expect(getMachSpeedTier(undefined)).toBeNull();
    expect(getMachSpeedTier(-10)).toBeNull();
    expect(getMachSpeedTier(0)).toBeNull();
    expect(parseMachSpeed(null)).toBeNull();
    expect(parseMachSpeed("")).toBeNull();
    expect(parseMachSpeed("invalid")).toBeNull();
  });

  it("classifies speeds below 50 Mbps as subsonic", () => {
    expect(getMachSpeedTier(1)).toBe("subsonic");
    expect(getMachSpeedTier(25)).toBe("subsonic");
    expect(getMachSpeedTier(49.9)).toBe("subsonic");
    expect(parseMachSpeed("45 Mbps")).toBe("subsonic");
  });

  it("classifies speeds between 50 and 250 Mbps as supersonic", () => {
    expect(getMachSpeedTier(50)).toBe("supersonic");
    expect(getMachSpeedTier(100)).toBe("supersonic");
    expect(getMachSpeedTier(250)).toBe("supersonic");
    expect(parseMachSpeed("200")).toBe("supersonic");
  });

  it("classifies speeds above 250 Mbps as hypersonic", () => {
    expect(getMachSpeedTier(250.1)).toBe("hypersonic");
    expect(getMachSpeedTier(500)).toBe("hypersonic");
    expect(getMachSpeedTier(1000)).toBe("hypersonic");
    expect(parseMachSpeed("800 Mbps")).toBe("hypersonic");
  });

  it("exports valid MACH_SPEED_MAP configuration", () => {
    expect(MACH_SPEED_MAP.subsonic.label).toBe("Subsonic (<50 Mbps)");
    expect(MACH_SPEED_MAP.supersonic.label).toBe("Supersonic (50-250 Mbps)");
    expect(MACH_SPEED_MAP.hypersonic.label).toBe(
      "Hypersonic Mach 5 (>250 Mbps)",
    );
    expect(NOISE_LEVEL_MAP.quiet.label).toBe("Quiet Focus");
  });
});
