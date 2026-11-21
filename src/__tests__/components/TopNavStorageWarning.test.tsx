import React from "react";
import { render, screen } from "@testing-library/react";
import { TopNav } from "@/components/TopNav";
import * as useStorageQuotaModule from "@/hooks/useStorageQuota";

// Mock @clerk/nextjs
jest.mock("@clerk/nextjs", () => ({
  useUser: () => ({ isSignedIn: false }),
  useClerk: () => ({ signOut: jest.fn() }),
}));

// Mock next/navigation
jest.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
}));

// Mock theme toggle and others
jest.mock("@/components/ThemeToggle", () => ({
  ThemeToggle: () => <div data-testid="theme-toggle" />,
}));
jest.mock("@/components/NetworkStatusPill", () => ({
  NetworkStatusPill: () => <div data-testid="network-status-pill" />,
}));
jest.mock("@/components/offline/OfflineConflictBadge", () => ({
  OfflineConflictBadge: () => <div data-testid="offline-conflict-badge" />,
}));
jest.mock("@/components/ui/QuickSearchTrigger", () => ({
  QuickSearchTrigger: () => <div data-testid="quick-search-trigger" />,
}));
jest.mock("@/components/analytics/LanternPowerRing", () => ({
  LanternPowerRing: () => <div data-testid="lantern-power-ring" />,
}));
jest.mock("@/components/OfflineSyncProgressBar", () => ({
  OfflineSyncProgressBar: () => <div data-testid="offline-sync-progress-bar" />,
}));

describe("TopNav StorageUsageWarningBadge integration (#7946)", () => {
  const mockUseStorageQuota = jest.spyOn(
    useStorageQuotaModule,
    "useStorageQuota",
  );

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("does not render storage warning badge in header when quota usage is 80% or below", () => {
    mockUseStorageQuota.mockReturnValue({
      usageBytes: 800 * 1024 * 1024,
      quotaBytes: 1000 * 1024 * 1024,
      usagePercentage: 80,
      remainingBytes: 200 * 1024 * 1024,
      usageMB: 800,
      quotaMB: 1000,
      remainingMB: 200,
      isOverWarningThreshold: false,
      isEstimateAvailable: true,
      refresh: jest.fn(),
    });

    render(<TopNav />);

    expect(
      screen.queryByTestId("storage-usage-warning-badge"),
    ).not.toBeInTheDocument();
  });

  it("renders storage warning badge in header when quota usage is strictly over 80%", () => {
    mockUseStorageQuota.mockReturnValue({
      usageBytes: 850 * 1024 * 1024,
      quotaBytes: 1000 * 1024 * 1024,
      usagePercentage: 85,
      remainingBytes: 150 * 1024 * 1024,
      usageMB: 850,
      quotaMB: 1000,
      remainingMB: 150,
      isOverWarningThreshold: true,
      isEstimateAvailable: true,
      refresh: jest.fn(),
    });

    render(<TopNav />);

    expect(
      screen.getByTestId("storage-usage-warning-badge"),
    ).toBeInTheDocument();
  });
});
