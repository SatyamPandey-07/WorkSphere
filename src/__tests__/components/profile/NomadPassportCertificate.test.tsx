import React from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { NomadPassportCertificate } from "@/components/profile/NomadPassportCertificate";
import confetti from "canvas-confetti";
import type { PassportStamp } from "@/lib/zkp/nomadProof";

// Mock canvas-confetti
jest.mock("canvas-confetti", () => {
  const mockConfetti = jest.fn();
  (mockConfetti as any).create = jest.fn(() => jest.fn());
  return mockConfetti;
});

// Mock NomadPassportCoin child component
jest.mock("@/components/profile/NomadPassportCoin", () => ({
  __esModule: true,
  default: ({ stamp }: any) => (
    <div data-testid="mock-nomad-passport-coin">
      Coin for {stamp?.tierTitle || "Default"}
    </div>
  ),
  NomadPassportCoinSkeleton: () => <div data-testid="mock-coin-skeleton" />,
}));

const mockDownloadNomadPassportPngBadge = jest
  .fn()
  .mockResolvedValue(undefined);
jest.mock("@/lib/profile/badgeGenerator", () => ({
  downloadNomadPassportPngBadge: (...args: any[]) =>
    mockDownloadNomadPassportPngBadge(...args),
  getNomadPassportPngFilename: (name: string) =>
    `nomad-passport-${name.toLowerCase().replace(/\s+/g, "-")}.png`,
}));

describe("NomadPassportCertificate Component", () => {
  const originalClipboard = navigator.clipboard;
  const originalMatchMedia = window.matchMedia;

  const mockStamp: PassportStamp = {
    stampId: "stamp-9606-test",
    badgeType: "gold",
    tierTitle: "Nomad Vanguard",
    venueName: "Tokyo Innovation Space",
    epoch: 12,
    nullifierHash: "0x1234567890abcdef1234567890abcdef",
    verificationSignature: "zk-sig-9606-verified",
    countryCode: "JP",
    countryName: "Japan",
  };

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();

    // Default mock for navigator.clipboard
    Object.defineProperty(navigator, "clipboard", {
      value: {
        writeText: jest.fn().mockResolvedValue(undefined),
      },
      writable: true,
      configurable: true,
    });

    // Default mock for matchMedia (prefers-reduced-motion: false)
    window.matchMedia = jest.fn().mockImplementation((query) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: jest.fn(),
      removeListener: jest.fn(),
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      dispatchEvent: jest.fn(),
    }));
  });

  afterEach(() => {
    jest.useRealTimers();
    Object.defineProperty(navigator, "clipboard", {
      value: originalClipboard,
      writable: true,
      configurable: true,
    });
    window.matchMedia = originalMatchMedia;
  });

  it("renders certificate title, user info, stamp info, and copy button", () => {
    render(
      <NomadPassportCertificate
        stamp={mockStamp}
        userName="Alice Nomad"
        userId="user-123"
      />,
    );

    expect(screen.getByText("Nomad Passport Certificate")).toBeInTheDocument();
    expect(screen.getByText("Alice Nomad")).toBeInTheDocument();
    expect(screen.getByText(/Tokyo Innovation Space/)).toBeInTheDocument();
    expect(screen.getByTestId("mock-nomad-passport-coin")).toBeInTheDocument();

    const copyBtn = screen.getByRole("button", {
      name: "Copy Nomad Passport Link",
    });
    expect(copyBtn).toBeInTheDocument();
    expect(copyBtn).toHaveTextContent("Copy Nomad Passport Link");
  });

  it("copies canonical URL to clipboard on click and announces exact required message", async () => {
    const onCopySuccess = jest.fn();

    render(
      <NomadPassportCertificate
        stamp={mockStamp}
        referralUrl="https://worksphere.app/passport/alice-nomad"
        onCopySuccess={onCopySuccess}
      />,
    );

    const copyBtn = screen.getByRole("button", {
      name: "Copy Nomad Passport Link",
    });
    await act(async () => {
      fireEvent.click(copyBtn);
    });

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      "https://worksphere.app/passport/alice-nomad",
    );
    expect(onCopySuccess).toHaveBeenCalledWith(
      "https://worksphere.app/passport/alice-nomad",
    );

    // Assert live region status announcement
    const liveRegion = screen.getByTestId("copy-status-announcement");
    expect(liveRegion).toHaveAttribute("role", "status");
    expect(liveRegion).toHaveAttribute("aria-live", "polite");
    expect(liveRegion).toHaveTextContent("Profile link copied to clipboard!");

    // Button updates state
    expect(screen.getByText("Copied!")).toBeInTheDocument();
    expect(screen.getByTestId("copy-success-badge")).toHaveTextContent(
      "Profile link copied to clipboard!",
    );

    // After 3 seconds, button state resets to idle
    act(() => {
      jest.advanceTimersByTime(3000);
    });

    expect(screen.getByText("Copy Nomad Passport Link")).toBeInTheDocument();
  });

  it("generates structured verification URL if no referralUrl prop is provided", async () => {
    render(
      <NomadPassportCertificate stamp={mockStamp} userId="nomad-dev-42" />,
    );

    const copyBtn = screen.getByRole("button", {
      name: "Copy Nomad Passport Link",
    });
    await act(async () => {
      fireEvent.click(copyBtn);
    });

    expect(navigator.clipboard.writeText).toHaveBeenCalledTimes(1);
    const copiedUrl = (navigator.clipboard.writeText as jest.Mock).mock
      .calls[0][0];
    expect(copiedUrl).toContain("/verify/nomad-passport?");
    expect(copiedUrl).toContain("stampId=stamp-9606-test");
    expect(copiedUrl).toContain("ref=nomad-dev-42");
    expect(copiedUrl).toContain("country=JP");
  });

  it("triggers confetti animation on successful copy", async () => {
    render(<NomadPassportCertificate stamp={mockStamp} />);

    const copyBtn = screen.getByRole("button", {
      name: "Copy Nomad Passport Link",
    });
    await act(async () => {
      fireEvent.click(copyBtn);
    });

    // confetti.create or direct confetti should be invoked
    expect((confetti as any).create).toHaveBeenCalled();
  });

  it("respects prefers-reduced-motion and suppresses confetti animation", async () => {
    window.matchMedia = jest.fn().mockImplementation((query) => ({
      matches: query.includes("prefers-reduced-motion: reduce"),
      media: query,
      onchange: null,
      addListener: jest.fn(),
      removeListener: jest.fn(),
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      dispatchEvent: jest.fn(),
    }));

    render(<NomadPassportCertificate stamp={mockStamp} />);

    const copyBtn = screen.getByRole("button", {
      name: "Copy Nomad Passport Link",
    });
    await act(async () => {
      fireEvent.click(copyBtn);
    });

    // Clipboard write still succeeds
    expect(navigator.clipboard.writeText).toHaveBeenCalled();
    // But confetti was NOT triggered
    expect((confetti as any).create).not.toHaveBeenCalled();
    expect(confetti).not.toHaveBeenCalled();
  });

  it("handles clipboard rejection, suppresses confetti, and displays manual copy fallback", async () => {
    (navigator.clipboard.writeText as jest.Mock).mockRejectedValue(
      new Error("Permission denied"),
    );
    const onCopyError = jest.fn();

    render(
      <NomadPassportCertificate
        stamp={mockStamp}
        referralUrl="https://worksphere.app/passport/manual"
        onCopyError={onCopyError}
      />,
    );

    const copyBtn = screen.getByRole("button", {
      name: "Copy Nomad Passport Link",
    });
    await act(async () => {
      fireEvent.click(copyBtn);
    });

    expect(onCopyError).toHaveBeenCalledWith(expect.any(Error));
    // Confetti must NOT trigger on error
    expect((confetti as any).create).not.toHaveBeenCalled();
    expect(confetti).not.toHaveBeenCalled();

    // Manual fallback is rendered
    const fallbackContainer = screen.getByTestId("manual-copy-fallback");
    expect(fallbackContainer).toBeInTheDocument();
    const input = screen.getByLabelText("Nomad Passport Link URL");
    expect(input).toHaveValue("https://worksphere.app/passport/manual");

    // Live region announces failure
    const liveRegion = screen.getByTestId("copy-status-announcement");
    expect(liveRegion).toHaveTextContent(
      "Failed to copy link. Please copy manually.",
    );
  });

  it("handles environment without navigator.clipboard gracefully", async () => {
    // Delete navigator.clipboard
    Object.defineProperty(navigator, "clipboard", {
      value: undefined,
      writable: true,
      configurable: true,
    });

    render(
      <NomadPassportCertificate
        stamp={mockStamp}
        referralUrl="https://worksphere.app/passport/no-clipboard"
      />,
    );

    const copyBtn = screen.getByRole("button", {
      name: "Copy Nomad Passport Link",
    });
    await act(async () => {
      fireEvent.click(copyBtn);
    });

    // Should display manual fallback
    expect(screen.getByTestId("manual-copy-fallback")).toBeInTheDocument();
  });

  describe("Download Nomad Passport PNG Badge (#9721)", () => {
    it("renders download badge button with accessible ARIA label", () => {
      render(
        <NomadPassportCertificate stamp={mockStamp} userName="Alex Nomad" />,
      );

      const downloadBtn = screen.getByTestId("download-passport-badge-btn");
      expect(downloadBtn).toBeInTheDocument();
      expect(downloadBtn).toHaveTextContent("Download Badge (PNG)");
      expect(downloadBtn).toHaveAttribute(
        "aria-label",
        "Download Nomad Passport Badge (PNG)",
      );
    });

    it("downloads PNG badge and displays success confirmation upon clicking button", async () => {
      const onDownloadSuccess = jest.fn();
      render(
        <NomadPassportCertificate
          stamp={mockStamp}
          userName="Alex Nomad"
          onDownloadBadgeSuccess={onDownloadSuccess}
        />,
      );

      const downloadBtn = screen.getByTestId("download-passport-badge-btn");
      await act(async () => {
        fireEvent.click(downloadBtn);
      });

      expect(mockDownloadNomadPassportPngBadge).toHaveBeenCalledWith(
        expect.objectContaining({
          displayName: "Alex Nomad",
          rank: "Nomad Vanguard",
          verifiedCheckIns: 12,
        }),
        2,
      );

      expect(downloadBtn).toHaveTextContent("Badge Downloaded!");
      expect(onDownloadSuccess).toHaveBeenCalledWith(
        "nomad-passport-alex-nomad.png",
      );

      const liveRegion = screen.getByTestId("copy-status-announcement");
      expect(liveRegion).toHaveTextContent(
        "Nomad passport badge downloaded as nomad-passport-alex-nomad.png!",
      );

      // Fast-forward reset timer
      act(() => {
        jest.advanceTimersByTime(3000);
      });

      expect(downloadBtn).toHaveTextContent("Download Badge (PNG)");
    });

    it("handles PNG badge download errors gracefully", async () => {
      const onDownloadError = jest.fn();
      mockDownloadNomadPassportPngBadge.mockRejectedValueOnce(
        new Error("Canvas export failed"),
      );

      render(
        <NomadPassportCertificate
          stamp={mockStamp}
          userName="Alex Nomad"
          onDownloadBadgeError={onDownloadError}
        />,
      );

      const downloadBtn = screen.getByTestId("download-passport-badge-btn");
      await act(async () => {
        fireEvent.click(downloadBtn);
      });

      expect(downloadBtn).toHaveTextContent("Download Failed");
      expect(onDownloadError).toHaveBeenCalledWith(expect.any(Error));

      const liveRegion = screen.getByTestId("copy-status-announcement");
      expect(liveRegion).toHaveTextContent(
        "Failed to generate passport badge image.",
      );
    });
  });
});
