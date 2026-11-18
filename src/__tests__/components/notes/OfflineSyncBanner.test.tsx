/** @jest-environment jsdom */
import React from "react";
import { render, screen } from "@testing-library/react";
import { OfflineSyncBanner } from "@/components/notes/OfflineSyncBanner";

describe("OfflineSyncBanner", () => {
  it("does not render when connected and fully synced", () => {
    const { container } = render(
      <OfflineSyncBanner
        status="connected"
        pendingCount={0}
        isLocalPersistenceReady={true}
        isSyncing={false}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders warning banner when offline with local IndexedDB fallback active", () => {
    render(
      <OfflineSyncBanner
        status="disconnected"
        pendingCount={3}
        isLocalPersistenceReady={true}
      />,
    );
    const banner = screen.getByTestId("offline-sync-banner");
    expect(banner).toBeInTheDocument();
    expect(banner).toHaveAttribute("data-persistence-ready", "true");
    expect(
      screen.getByText(
        /You're offline\. Your changes are saved locally and will sync when you're reconnected\./i,
      ),
    ).toBeInTheDocument();
    expect(screen.getByTestId("pending-sync-counter")).toHaveTextContent(
      "3 pending changes",
    );
  });

  it("handles singular pending change correctly", () => {
    render(
      <OfflineSyncBanner
        status="disconnected"
        pendingCount={1}
        isLocalPersistenceReady={true}
      />,
    );
    expect(screen.getByTestId("pending-sync-counter")).toHaveTextContent(
      "1 pending change",
    );
  });

  it("handles empty pending state (0 changes) correctly", () => {
    render(
      <OfflineSyncBanner
        status="disconnected"
        pendingCount={0}
        isLocalPersistenceReady={true}
      />,
    );
    expect(screen.getByTestId("pending-sync-counter")).toHaveTextContent(
      "0 pending changes",
    );
  });

  it("honestly displays persistence failure when local persistence is unavailable", () => {
    render(
      <OfflineSyncBanner
        status="disconnected"
        pendingCount={2}
        isLocalPersistenceReady={false}
      />,
    );
    const banner = screen.getByTestId("offline-sync-banner");
    expect(banner).toBeInTheDocument();
    expect(banner).toHaveAttribute("data-persistence-ready", "false");
    expect(banner).toHaveAttribute("role", "alert");
    expect(
      screen.getByText(
        /You're offline\. Local persistence is unavailable — changes may not be saved locally\./i,
      ),
    ).toBeInTheDocument();
    expect(screen.getByTestId("pending-sync-counter")).toHaveTextContent(
      "Persistence Unavailable",
    );
  });

  it("displays syncing status when reconnecting and actively flushing updates", () => {
    render(
      <OfflineSyncBanner
        status="connected"
        pendingCount={5}
        isLocalPersistenceReady={true}
        isSyncing={true}
      />,
    );
    const banner = screen.getByTestId("offline-sync-banner");
    expect(banner).toBeInTheDocument();
    expect(banner).toHaveAttribute("data-syncing", "true");
    expect(
      screen.getByText(/Syncing changes with server\.\.\./i),
    ).toBeInTheDocument();
    expect(screen.getByTestId("pending-sync-counter")).toHaveTextContent(
      "5 pending changes",
    );
  });
});
