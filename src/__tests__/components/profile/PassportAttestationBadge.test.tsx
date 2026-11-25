import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { PassportAttestationBadge } from "@/components/profile/PassportAttestationBadge";
import type { PassportStamp } from "@/lib/zkp/nomadProof";

// Mock global fetch for testing server attestation calls
const originalFetch = global.fetch;

describe("PassportAttestationBadge Component", () => {
  const verifiedStamp: PassportStamp = {
    stampId: "STAMP-VERIFIED-001",
    badgeType: "NOMAD_100_HOURS",
    tierTitle: "100-Hour Focus Master",
    epoch: 2026,
    issuedAt: "2026-10-15T10:30:00.000Z",
    nullifierHash:
      "a1b2c3d4e5f60718293a4b5c6d7e8f90123456789abcdef0123456789abcdef0",
    verificationSignature:
      "8f7e2a9b3c4d5e6f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f",
    svgMarkup: "<svg></svg>",
    venueName: "Tokyo Focus Hub",
  };

  const pendingOfflineStamp: PassportStamp = {
    stampId: "STAMP-PENDING-002",
    badgeType: "NOMAD_50_HOURS",
    tierTitle: "50-Hour Focus Veteran",
    epoch: 2026,
    issuedAt: "2026-10-16T14:00:00.000Z",
    nullifierHash:
      "e4d909c290d0fb1ca068ffaddf22cbd0ffd823ef45a2789123456789abcdef01",
    verificationSignature: "",
    svgMarkup: "<svg></svg>",
    venueName: "Lisbon Nomad Hub",
  };

  const invalidStamp: PassportStamp = {
    stampId: "STAMP-INVALID-003",
    badgeType: "MULTI_CITY_EXPLORER",
    tierTitle: "Multi-City Explorer",
    epoch: 2026,
    issuedAt: "2026-10-17T09:00:00.000Z",
    nullifierHash:
      "11223344556677889900aabbccddeeff11223344556677889900aabbccddeeff",
    verificationSignature: "invalid_tampered_signature",
    svgMarkup: "<svg></svg>",
    venueName: "Berlin Hub",
  };

  afterEach(() => {
    jest.restoreAllMocks();
    global.fetch = originalFetch;
  });

  it("1. Renders verified badge when server attestation is valid", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        status: "verified",
        verified: true,
        timestamp: verifiedStamp.issuedAt,
        signatureFingerprint: "8f7e2a9b...1c2d3e4f",
      }),
    } as Response);

    render(<PassportAttestationBadge stamp={verifiedStamp} />);

    await waitFor(() => {
      expect(screen.getByText("Verified")).toBeInTheDocument();
    });

    const badgeBtn = screen.getByRole("button", {
      name: /attestation: verified/i,
    });
    expect(badgeBtn).toBeInTheDocument();
    expect(badgeBtn).toHaveAttribute("aria-expanded", "false");
  });

  it("2. Renders pending badge for offline stamp without calling server verification", async () => {
    const fetchSpy = jest.fn();
    global.fetch = fetchSpy;

    render(<PassportAttestationBadge stamp={pendingOfflineStamp} />);

    await waitFor(() => {
      expect(screen.getByText("Pending")).toBeInTheDocument();
    });

    // Offline stamp with empty signature detects pending state directly
    expect(fetchSpy).not.toHaveBeenCalled();

    const badgeBtn = screen.getByRole("button", {
      name: /attestation: pending/i,
    });
    expect(badgeBtn).toBeInTheDocument();
  });

  it("3. Renders invalid status when server rejects attestation", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        success: false,
        status: "invalid",
        verified: false,
        error: "Cryptographic attestation signature mismatch or invalid.",
      }),
    } as Response);

    render(<PassportAttestationBadge stamp={invalidStamp} />);

    await waitFor(() => {
      expect(screen.getByText("Invalid")).toBeInTheDocument();
    });

    const badgeBtn = screen.getByRole("button", {
      name: /attestation: invalid/i,
    });
    expect(badgeBtn).toBeInTheDocument();
  });

  it("4. Handles missing or unavailable attestation data safely", async () => {
    const brokenStamp: PassportStamp = {
      stampId: "",
      badgeType: "",
      nullifierHash: "",
      epoch: 2026,
      issuedAt: "",
      verificationSignature: "",
      svgMarkup: "",
      tierTitle: "",
    };

    render(<PassportAttestationBadge stamp={brokenStamp} />);

    await waitFor(() => {
      expect(screen.getByText("Invalid")).toBeInTheDocument();
    });
  });

  it("5. Displays attestation timestamp and signature fingerprint on badge click", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        status: "verified",
        verified: true,
        timestamp: verifiedStamp.issuedAt,
        signatureFingerprint: "8f7e2a9b...1c2d3e4f",
      }),
    } as Response);

    render(
      <PassportAttestationBadge stamp={verifiedStamp} testId="test-badge" />,
    );

    await waitFor(() => {
      expect(screen.getByText("Verified")).toBeInTheDocument();
    });

    const badgeBtn = screen.getByTestId("test-badge");
    expect(screen.queryByTestId("test-badge-details")).not.toBeInTheDocument();

    // Click to open details
    fireEvent.click(badgeBtn);

    expect(screen.getByTestId("test-badge-details")).toBeInTheDocument();
    expect(screen.getByTestId("test-badge-fingerprint")).toHaveTextContent(
      "8f7e2a9b...1c2d3e4f",
    );
    expect(screen.getByTestId("test-badge-timestamp")).toBeInTheDocument();
    expect(badgeBtn).toHaveAttribute("aria-expanded", "true");

    // Click again to close details
    fireEvent.click(badgeBtn);
    expect(screen.queryByTestId("test-badge-details")).not.toBeInTheDocument();
  });

  it("6. Supports keyboard activation via Enter and Space", async () => {
    render(
      <PassportAttestationBadge
        stamp={verifiedStamp}
        initialStatus="verified"
        testId="keyboard-badge"
      />,
    );

    const badgeBtn = screen.getByTestId("keyboard-badge");
    expect(
      screen.queryByTestId("keyboard-badge-details"),
    ).not.toBeInTheDocument();

    // Trigger Enter key
    fireEvent.keyDown(badgeBtn, { key: "Enter" });
    expect(screen.getByTestId("keyboard-badge-details")).toBeInTheDocument();

    // Trigger Space key
    fireEvent.keyDown(badgeBtn, { key: " " });
    expect(
      screen.queryByTestId("keyboard-badge-details"),
    ).not.toBeInTheDocument();
  });

  it("7. Shows pending notice and fallback in details when pending stamp is clicked", async () => {
    render(
      <PassportAttestationBadge
        stamp={pendingOfflineStamp}
        initialStatus="pending"
        testId="pending-badge"
      />,
    );

    const badgeBtn = screen.getByTestId("pending-badge");
    fireEvent.click(badgeBtn);

    expect(screen.getByTestId("pending-badge-details")).toBeInTheDocument();
    expect(screen.getByTestId("pending-badge-fingerprint")).toHaveTextContent(
      /pending server attestation/i,
    );
    expect(
      screen.getByText(
        /offline stamp waiting to sync with authoritative server/i,
      ),
    ).toBeInTheDocument();
  });
});
