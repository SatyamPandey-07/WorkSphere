/** @jest-environment jsdom */

import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { OfflineDraftCountBadge } from "@/components/navigation/OfflineDraftCountBadge";
import { TopNav } from "@/components/TopNav";
import { DraftStore, BOOKING_DRAFT_EVENTS } from "@/worker/bookingSync/DraftStore";
import * as useOfflineDraftCountModule from "@/hooks/useOfflineDraftCount";

// Mock next/navigation
const mockPush = jest.fn();
jest.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ push: mockPush, replace: jest.fn() }),
}));

// Mock @clerk/nextjs
jest.mock("@clerk/nextjs", () => ({
  useUser: () => ({ isSignedIn: false }),
  useClerk: () => ({ signOut: jest.fn() }),
}));

// Mock non-target TopNav subcomponents to keep test focused
jest.mock("@/components/ThemeToggle", () => ({
  ThemeToggle: () => <div data-testid="theme-toggle" />,
}));
jest.mock("@/components/NetworkStatusPill", () => ({
  NetworkStatusPill: () => <div data-testid="network-status-pill" />,
}));
jest.mock("@/components/sync/OfflineSyncStatusBadge", () => ({
  OfflineSyncStatusBadge: () => <div data-testid="offline-sync-status-badge" />,
}));
jest.mock("@/components/offline/OfflineConflictBadge", () => ({
  OfflineConflictBadge: () => <div data-testid="offline-conflict-badge" />,
}));
jest.mock("@/components/Header/StorageUsageWarningBadge", () => ({
  StorageUsageWarningBadge: () => <div data-testid="storage-usage-warning-badge" />,
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

describe("OfflineDraftCountBadge & Navbar Integration (#9883)", () => {
  let draftStore: DraftStore;

  beforeEach(async () => {
    jest.clearAllMocks();
    draftStore = new DraftStore();
    await draftStore.clearAll();
  });

  afterEach(async () => {
    await draftStore.clearAll();
  });

  it("hides badge when count is zero", async () => {
    render(<OfflineDraftCountBadge customStore={draftStore} />);
    await waitFor(() => {
      expect(
        screen.queryByTestId("offline-draft-count-badge")
      ).not.toBeInTheDocument();
    });
  });

  it("displays correct singular text when count is 1", async () => {
    await draftStore.createDraft({
      id: "draft-1",
      venueId: "v1",
      userId: "u1",
      payload: {},
    });

    render(<OfflineDraftCountBadge customStore={draftStore} />);

    await waitFor(() => {
      const badge = screen.getByTestId("offline-draft-count-badge");
      expect(badge).toBeInTheDocument();
      expect(screen.getByTestId("offline-draft-count-badge-text")).toHaveTextContent(
        "1 Offline Draft"
      );
      expect(badge).toHaveAttribute(
        "aria-label",
        "1 pending offline booking draft. Click to view bookings."
      );
    });
  });

  it("displays correct plural text when count is greater than 1", async () => {
    await draftStore.createDraft({
      id: "draft-1",
      venueId: "v1",
      userId: "u1",
      payload: {},
    });
    await draftStore.createDraft({
      id: "draft-2",
      venueId: "v2",
      userId: "u2",
      payload: {},
    });

    render(<OfflineDraftCountBadge customStore={draftStore} />);

    await waitFor(() => {
      const badge = screen.getByTestId("offline-draft-count-badge");
      expect(badge).toBeInTheDocument();
      expect(screen.getByTestId("offline-draft-count-badge-text")).toHaveTextContent(
        "2 Offline Drafts"
      );
      expect(badge).toHaveAttribute(
        "aria-label",
        "2 pending offline booking drafts. Click to view bookings."
      );
    });
  });

  it("updates badge count reactively when a draft is created", async () => {
    render(<OfflineDraftCountBadge customStore={draftStore} />);

    await waitFor(() => {
      expect(screen.queryByTestId("offline-draft-count-badge")).not.toBeInTheDocument();
    });

    await draftStore.createDraft({
      id: "draft-new",
      venueId: "v-new",
      userId: "u-new",
      payload: {},
    });

    await waitFor(() => {
      expect(screen.getByTestId("offline-draft-count-badge-text")).toHaveTextContent(
        "1 Offline Draft"
      );
    });
  });

  it("updates badge count reactively when a draft is synchronized", async () => {
    await draftStore.createDraft({
      id: "draft-syncing",
      venueId: "v-sync",
      userId: "u-sync",
      payload: {},
    });

    render(<OfflineDraftCountBadge customStore={draftStore} />);

    await waitFor(() => {
      expect(screen.getByTestId("offline-draft-count-badge-text")).toHaveTextContent(
        "1 Offline Draft"
      );
    });

    // Simulate synchronization: delete from store and dispatch sync event
    await draftStore.deleteDraft("draft-syncing");
    window.dispatchEvent(
      new CustomEvent(BOOKING_DRAFT_EVENTS.SYNCED, {
        detail: { draftId: "draft-syncing", venueId: "v-sync" },
      })
    );

    await waitFor(() => {
      expect(screen.queryByTestId("offline-draft-count-badge")).not.toBeInTheDocument();
    });
  });

  it("updates badge count reactively when a draft is deleted", async () => {
    await draftStore.createDraft({
      id: "draft-del-1",
      venueId: "v1",
      userId: "u1",
      payload: {},
    });
    await draftStore.createDraft({
      id: "draft-del-2",
      venueId: "v2",
      userId: "u2",
      payload: {},
    });

    render(<OfflineDraftCountBadge customStore={draftStore} />);

    await waitFor(() => {
      expect(screen.getByTestId("offline-draft-count-badge-text")).toHaveTextContent(
        "2 Offline Drafts"
      );
    });

    await draftStore.deleteDraft("draft-del-1");

    await waitFor(() => {
      expect(screen.getByTestId("offline-draft-count-badge-text")).toHaveTextContent(
        "1 Offline Draft"
      );
    });
  });

  it("navigates to destination route on click", async () => {
    await draftStore.createDraft({
      id: "draft-click",
      venueId: "v1",
      userId: "u1",
      payload: {},
    });

    render(
      <OfflineDraftCountBadge
        customStore={draftStore}
        destinationRoute="/dashboard"
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId("offline-draft-count-badge")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("offline-draft-count-badge"));
    expect(mockPush).toHaveBeenCalledWith("/dashboard");
  });

  it("calls custom onClick when provided", async () => {
    const handleCustomClick = jest.fn();
    await draftStore.createDraft({
      id: "draft-click-custom",
      venueId: "v1",
      userId: "u1",
      payload: {},
    });

    render(
      <OfflineDraftCountBadge
        customStore={draftStore}
        onClick={handleCustomClick}
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId("offline-draft-count-badge")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("offline-draft-count-badge"));
    expect(handleCustomClick).toHaveBeenCalledTimes(1);
    expect(mockPush).not.toHaveBeenCalled();
  });

  it("handles storage errors safely without crashing Navbar rendering", () => {
    jest.spyOn(useOfflineDraftCountModule, "useOfflineDraftCount").mockReturnValue({
      count: 0,
      isLoading: false,
      refreshCount: jest.fn().mockRejectedValue(new Error("IDB failure")),
    });

    expect(() => render(<TopNav />)).not.toThrow();
    expect(screen.queryByTestId("offline-draft-count-badge")).not.toBeInTheDocument();
  });

  it("cleans up event listeners and broadcast channel on unmount", () => {
    jest.restoreAllMocks();
    const removeEventListenerSpy = jest.spyOn(window, "removeEventListener");
    const { unmount } = render(<OfflineDraftCountBadge customStore={draftStore} />);

    unmount();

    expect(removeEventListenerSpy).toHaveBeenCalledWith(
      BOOKING_DRAFT_EVENTS.CHANGED,
      expect.any(Function)
    );
    expect(removeEventListenerSpy).toHaveBeenCalledWith(
      BOOKING_DRAFT_EVENTS.SYNCED,
      expect.any(Function)
    );
    expect(removeEventListenerSpy).toHaveBeenCalledWith(
      "online",
      expect.any(Function)
    );
  });

  it("updates count across tabs via BroadcastChannel message", async () => {
    class MockBroadcastChannel {
      static channels: Map<string, Set<MockBroadcastChannel>> = new Map();
      name: string;
      onmessage: ((event: MessageEvent) => void) | null = null;

      constructor(name: string) {
        this.name = name;
        if (!MockBroadcastChannel.channels.has(name)) {
          MockBroadcastChannel.channels.set(name, new Set());
        }
        MockBroadcastChannel.channels.get(name)!.add(this);
      }

      postMessage(data: any) {
        const peers = MockBroadcastChannel.channels.get(this.name);
        if (peers) {
          peers.forEach((peer) => {
            if (peer !== this && peer.onmessage) {
              peer.onmessage(new MessageEvent("message", { data }));
            }
          });
        }
      }

      close() {
        const peers = MockBroadcastChannel.channels.get(this.name);
        if (peers) {
          peers.delete(this);
        }
      }
    }

    const originalBroadcastChannel = global.BroadcastChannel;
    (global as any).BroadcastChannel = MockBroadcastChannel;

    try {
      render(<OfflineDraftCountBadge customStore={draftStore} />);

      await waitFor(() => {
        expect(screen.queryByTestId("offline-draft-count-badge")).not.toBeInTheDocument();
      });

      // Another tab creates a draft and posts a message via BroadcastChannel
      await draftStore.createDraft({
        id: "draft-cross-tab",
        venueId: "v1",
        userId: "u1",
        payload: {},
      });

      const senderChannel = new MockBroadcastChannel("worksphere:booking-drafts-channel");
      senderChannel.postMessage({ action: "save", draftId: "draft-cross-tab" });

      await waitFor(() => {
        expect(screen.getByTestId("offline-draft-count-badge-text")).toHaveTextContent(
          "1 Offline Draft"
        );
      });

      senderChannel.close();
    } finally {
      (global as any).BroadcastChannel = originalBroadcastChannel;
    }
  });
});
