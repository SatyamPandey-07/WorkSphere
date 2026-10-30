import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import PWABannerDefault, {
  PWABanner,
  OfflineIndicator,
  OfflineSyncNotice,
  InstallAppButton,
  IOSInstallOverlay,
  SyncManager,
} from "@/components/pwa/PWAComponents";
import * as usePWAModule from "@/hooks/usePWA";

jest.mock("@/lib/federated/weightDb", () => ({
  purgeStaleWeights: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("@/lib/offlineReviewSync", () => ({
  flushPendingReviewsClientFallback: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("@/hooks/useReviewConflictWorker", () => ({
  useReviewConflictWorker: () => ({
    activeConflict: null,
    setActiveConflict: jest.fn(),
    resolveConflict: jest.fn(),
  }),
}));

jest.mock("@/components/offline/ReviewConflictResolutionDialog", () => ({
  ReviewConflictResolutionDialog: () => null,
}));

jest.mock("@/hooks/usePWA", () => ({
  useSyncWorker: jest.fn(),
  useServiceWorker: jest.fn(),
  useInstallPrompt: jest.fn(),
  useOfflineSyncNotice: jest.fn(),
  usePeriodicAvailabilitySync: jest.fn(),
  usePeriodicFavoriteVenuesSync: jest.fn(),
}));

describe("PWAComponents Suite", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
    (usePWAModule.useServiceWorker as jest.Mock).mockReturnValue({
      isOnline: true,
    });
    (usePWAModule.useInstallPrompt as jest.Mock).mockReturnValue({
      canInstall: true,
      install: jest.fn().mockResolvedValue("accepted"),
    });
    (usePWAModule.useOfflineSyncNotice as jest.Mock).mockReturnValue({
      notice: null,
      dismiss: jest.fn(),
    });
  });

  it("exports PWABanner default identical to named export", () => {
    expect(PWABannerDefault).toBe(PWABanner);
  });

  describe("OfflineIndicator", () => {
    it("renders nothing when online", () => {
      (usePWAModule.useServiceWorker as jest.Mock).mockReturnValue({
        isOnline: true,
      });

      const { container } = render(<OfflineIndicator />);
      expect(container.firstChild).toBeNull();
    });

    it("renders offline banner when offline", () => {
      (usePWAModule.useServiceWorker as jest.Mock).mockReturnValue({
        isOnline: false,
      });

      render(<OfflineIndicator />);
      const indicator = screen.getByTestId("offline-indicator");
      expect(indicator).toBeInTheDocument();
      expect(indicator).toHaveTextContent("You're offline");
    });

    it("accepts custom className and data-testid overrides", () => {
      (usePWAModule.useServiceWorker as jest.Mock).mockReturnValue({
        isOnline: false,
      });

      render(
        <OfflineIndicator
          className="custom-offline-class"
          data-testid="custom-offline"
        />
      );

      const indicator = screen.getByTestId("custom-offline");
      expect(indicator).toBeInTheDocument();
      expect(indicator.className).toContain("custom-offline-class");
    });
  });

  describe("OfflineSyncNotice", () => {
    it("renders nothing when notice is null", () => {
      (usePWAModule.useOfflineSyncNotice as jest.Mock).mockReturnValue({
        notice: null,
        dismiss: jest.fn(),
      });

      const { container } = render(<OfflineSyncNotice />);
      expect(container.firstChild).toBeNull();
    });

    it("renders toast when notice exists and handles dismiss button", () => {
      const mockDismiss = jest.fn();
      (usePWAModule.useOfflineSyncNotice as jest.Mock).mockReturnValue({
        notice: { action: "ADD", attempts: 3 },
        dismiss: mockDismiss,
      });

      render(<OfflineSyncNotice />);

      const notice = screen.getByTestId("offline-sync-notice");
      expect(notice).toBeInTheDocument();
      expect(notice).toHaveTextContent("Couldn't sync your changes");
      expect(notice).toHaveTextContent("save");
      expect(notice).toHaveTextContent("3 attempts");

      const dismissBtn = screen.getByRole("button", { name: /dismiss/i });
      fireEvent.click(dismissBtn);
      expect(mockDismiss).toHaveBeenCalledTimes(1);
    });

    it("renders 'remove' verb when action is REMOVE", () => {
      (usePWAModule.useOfflineSyncNotice as jest.Mock).mockReturnValue({
        notice: { action: "REMOVE", attempts: 5 },
        dismiss: jest.fn(),
      });

      render(<OfflineSyncNotice />);
      expect(screen.getByTestId("offline-sync-notice")).toHaveTextContent("remove");
    });

    it("accepts custom className and data-testid overrides", () => {
      (usePWAModule.useOfflineSyncNotice as jest.Mock).mockReturnValue({
        notice: { action: "ADD", attempts: 1 },
        dismiss: jest.fn(),
      });

      render(
        <OfflineSyncNotice
          className="custom-notice-style"
          data-testid="custom-notice"
        />
      );

      const notice = screen.getByTestId("custom-notice");
      expect(notice).toBeInTheDocument();
      expect(notice.className).toContain("custom-notice-style");
    });
  });

  describe("InstallAppButton", () => {
    it("renders nothing when canInstall is false", () => {
      (usePWAModule.useInstallPrompt as jest.Mock).mockReturnValue({
        canInstall: false,
        install: jest.fn(),
      });

      const { container } = render(<InstallAppButton />);
      expect(container.firstChild).toBeNull();
    });

    it("renders button when canInstall is true and calls install on click", async () => {
      const mockInstall = jest.fn().mockResolvedValue("accepted");
      (usePWAModule.useInstallPrompt as jest.Mock).mockReturnValue({
        canInstall: true,
        install: mockInstall,
      });

      render(<InstallAppButton />);

      const btn = screen.getByTestId("install-app-btn");
      expect(btn).toBeInTheDocument();
      expect(btn).toHaveTextContent("Install App");

      fireEvent.click(btn);
      await waitFor(() => {
        expect(mockInstall).toHaveBeenCalledTimes(1);
      });
    });

    it("opens IOSInstallOverlay when install returns 'ios'", async () => {
      const mockInstall = jest.fn().mockResolvedValue("ios");
      (usePWAModule.useInstallPrompt as jest.Mock).mockReturnValue({
        canInstall: true,
        install: mockInstall,
      });

      render(<InstallAppButton />);

      fireEvent.click(screen.getByTestId("install-app-btn"));

      expect(await screen.findByTestId("ios-install-overlay")).toBeInTheDocument();
    });

    it("accepts custom className and data-testid overrides", () => {
      (usePWAModule.useInstallPrompt as jest.Mock).mockReturnValue({
        canInstall: true,
        install: jest.fn(),
      });

      render(
        <InstallAppButton
          className="custom-install-btn"
          data-testid="my-install-btn"
        />
      );

      const btn = screen.getByTestId("my-install-btn");
      expect(btn).toBeInTheDocument();
      expect(btn.className).toContain("custom-install-btn");
    });
  });

  describe("IOSInstallOverlay", () => {
    it("renders modal, instructions, and triggers onClose", () => {
      const handleClose = jest.fn();
      render(<IOSInstallOverlay onClose={handleClose} />);

      const overlay = screen.getByTestId("ios-install-overlay");
      expect(overlay).toBeInTheDocument();
      expect(screen.getByText("Install WorkSphere")).toBeInTheDocument();
      expect(screen.getByText("Tap the Share button")).toBeInTheDocument();

      // Click got it button
      const gotItBtn = screen.getByRole("button", { name: /got it/i });
      fireEvent.click(gotItBtn);
      expect(handleClose).toHaveBeenCalledTimes(1);
    });

    it("triggers onClose when backdrop is clicked", () => {
      const handleClose = jest.fn();
      render(<IOSInstallOverlay onClose={handleClose} />);

      const overlay = screen.getByTestId("ios-install-overlay");
      fireEvent.click(overlay);
      expect(handleClose).toHaveBeenCalledTimes(1);
    });

    it("accepts custom className and data-testid overrides", () => {
      render(
        <IOSInstallOverlay
          onClose={jest.fn()}
          className="custom-overlay-style"
          data-testid="my-overlay"
        />
      );

      const overlay = screen.getByTestId("my-overlay");
      expect(overlay).toBeInTheDocument();
      expect(overlay.className).toContain("custom-overlay-style");
    });
  });

  describe("PWABanner", () => {
    it("renders banner when online, installable, and not dismissed", () => {
      localStorage.setItem("pwa-banner-dismissed", "false");

      render(<PWABanner />);

      expect(screen.getByTestId("pwa-banner")).toBeInTheDocument();
      expect(screen.getByText("Install Now")).toBeInTheDocument();
      expect(screen.getByText("Maybe Later")).toBeInTheDocument();
    });

    it("hides banner when dismissed in localStorage", () => {
      localStorage.setItem("pwa-banner-dismissed", "true");

      const { container } = render(<PWABanner />);
      expect(container.firstChild).toBeNull();
    });

    it("hides banner when offline", () => {
      localStorage.setItem("pwa-banner-dismissed", "false");
      (usePWAModule.useServiceWorker as jest.Mock).mockReturnValue({
        isOnline: false,
      });

      const { container } = render(<PWABanner />);
      expect(container.firstChild).toBeNull();
    });

    it("dismisses banner and updates localStorage when 'Maybe Later' is clicked", () => {
      localStorage.setItem("pwa-banner-dismissed", "false");

      render(<PWABanner />);

      const laterBtn = screen.getByText("Maybe Later");
      fireEvent.click(laterBtn);

      expect(localStorage.getItem("pwa-banner-dismissed")).toBe("true");
      expect(screen.queryByTestId("pwa-banner")).not.toBeInTheDocument();
    });

    it("triggers install action and handles 'ios' response", async () => {
      localStorage.setItem("pwa-banner-dismissed", "false");
      const mockInstall = jest.fn().mockResolvedValue("ios");
      (usePWAModule.useInstallPrompt as jest.Mock).mockReturnValue({
        canInstall: true,
        install: mockInstall,
      });

      render(<PWABanner />);

      const installBtn = screen.getByText("Install Now");
      fireEvent.click(installBtn);

      expect(await screen.findByTestId("ios-install-overlay")).toBeInTheDocument();
    });

    it("accepts custom className and data-testid overrides", () => {
      localStorage.setItem("pwa-banner-dismissed", "false");

      render(
        <PWABanner
          className="custom-banner-class"
          data-testid="my-pwa-banner"
        />
      );

      const banner = screen.getByTestId("my-pwa-banner");
      expect(banner).toBeInTheDocument();
      expect(banner.className).toContain("custom-banner-class");
    });
  });

  describe("SyncManager", () => {
    it("renders conflict resolution dialog wrapper without crashing", () => {
      const { container } = render(<SyncManager />);
      expect(usePWAModule.useSyncWorker).toHaveBeenCalled();
      expect(usePWAModule.usePeriodicAvailabilitySync).toHaveBeenCalled();
      expect(usePWAModule.usePeriodicFavoriteVenuesSync).toHaveBeenCalled();
    });
  });
});
