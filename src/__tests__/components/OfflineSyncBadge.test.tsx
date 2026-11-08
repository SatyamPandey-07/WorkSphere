import React from "react";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { OfflineSyncBadge } from "@/components/Header/OfflineSyncBadge";
import * as offlineSyncHook from "@/hooks/useOfflineSync";

jest.mock("@/hooks/useOfflineSync");

describe("OfflineSyncBadge", () => {
  it("renders accessible role status and aria-label when offline", () => {
    jest.spyOn(offlineSyncHook, "useOfflineSync").mockReturnValue({
      isOffline: true,
      hasPendingChanges: true,
      isSyncing: false,
    } as any);

    render(<OfflineSyncBadge />);

    const badge = screen.getByRole("status");
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveAttribute("aria-label", "Offline (Pending Sync)");
  });

  it("renders nothing when online without pending changes or syncing", () => {
    jest.spyOn(offlineSyncHook, "useOfflineSync").mockReturnValue({
      isOffline: false,
      hasPendingChanges: false,
      isSyncing: false,
    } as any);

    const { container } = render(<OfflineSyncBadge />);
    expect(container.firstChild).toBeNull();
  });
});
