/// <reference types="jest" />
import React from "react";
import { render, screen, act } from "@testing-library/react";
import "@testing-library/jest-dom";
import { NetworkStatusPill } from "@/components/NetworkStatusPill";
import * as offlineSyncModule from "@/hooks/useOfflineSync";

const mockToast = jest.fn();
jest.mock("@/components/ui/Toast", () => ({
  useToast: () => ({ toast: mockToast }),
}));

jest.mock("@/hooks/useOfflineSync");

describe("NetworkStatusPill", () => {
  const mockUseOfflineSync = jest.spyOn(offlineSyncModule, "useOfflineSync");

  beforeEach(() => {
    jest.useFakeTimers();
    mockToast.mockClear();
    mockUseOfflineSync.mockReturnValue({
      isOffline: false,
      hasPendingChanges: false,
      isSyncing: false,
      pendingCount: 0,
    });
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  it("displays green 'Live' badge when online by default", () => {
    render(<NetworkStatusPill />);
    const badge = screen.getByRole("status");
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveTextContent("Live");
    expect(badge.className).toContain("bg-emerald-50");
  });

  it("renders nothing when online if showLive is false", () => {
    const { container } = render(<NetworkStatusPill showLive={false} />);
    expect(container.firstChild).toBeNull();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("displays amber 'Offline · Local Mode' badge when disconnected without pending mutations", () => {
    mockUseOfflineSync.mockReturnValue({
      isOffline: true,
      hasPendingChanges: false,
      isSyncing: false,
      pendingCount: 0,
    });

    render(<NetworkStatusPill />);

    const badge = screen.getByRole("status");
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveTextContent("Offline · Local Mode");
    expect(badge).not.toHaveTextContent("(");
    expect(badge).toHaveAttribute("aria-live", "polite");
    expect(badge.className).toContain("bg-amber-50");
  });

  it("displays pending mutations count when offline", () => {
    mockUseOfflineSync.mockReturnValue({
      isOffline: true,
      hasPendingChanges: true,
      isSyncing: false,
      pendingCount: 3,
    });

    render(<NetworkStatusPill />);

    const badge = screen.getByRole("status");
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveTextContent("Offline · Local Mode (3)");
  });

  it("supports pendingCount prop override", () => {
    mockUseOfflineSync.mockReturnValue({
      isOffline: true,
      hasPendingChanges: true,
      isSyncing: false,
      pendingCount: 1,
    });

    render(<NetworkStatusPill pendingCount={5} />);

    const badge = screen.getByRole("status");
    expect(badge).toHaveTextContent("Offline · Local Mode (5)");
  });

  it("transitions to green 'Back online' badge when connectivity resumes and returns to 'Live'", () => {
    const { rerender } = render(
      <NetworkStatusPill onlineFlashDurationMs={2000} />,
    );

    // 1. Go offline
    mockUseOfflineSync.mockReturnValue({
      isOffline: true,
      hasPendingChanges: false,
      isSyncing: false,
      pendingCount: 0,
    });
    rerender(<NetworkStatusPill onlineFlashDurationMs={2000} />);
    expect(screen.getByRole("status")).toHaveTextContent(
      "Offline · Local Mode",
    );

    // 2. Go back online
    mockUseOfflineSync.mockReturnValue({
      isOffline: false,
      hasPendingChanges: false,
      isSyncing: false,
      pendingCount: 0,
    });
    rerender(<NetworkStatusPill onlineFlashDurationMs={2000} />);

    const badge = screen.getByRole("status");
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveTextContent("Back online");
    expect(badge.className).toContain("bg-emerald-50");

    // 3. Fast-forward timer by 2000ms - returns to Live
    act(() => {
      jest.advanceTimersByTime(2000);
    });

    expect(screen.getByRole("status")).toHaveTextContent("Live");
  });

  it("fades out and removes 'Back online' badge after duration expires when showLive is false", () => {
    const { rerender, container } = render(
      <NetworkStatusPill showLive={false} onlineFlashDurationMs={2000} />,
    );

    // 1. Offline
    mockUseOfflineSync.mockReturnValue({
      isOffline: true,
      hasPendingChanges: false,
      isSyncing: false,
      pendingCount: 0,
    });
    rerender(
      <NetworkStatusPill showLive={false} onlineFlashDurationMs={2000} />,
    );
    expect(screen.getByText(/Offline · Local Mode/)).toBeInTheDocument();

    // 2. Online
    mockUseOfflineSync.mockReturnValue({
      isOffline: false,
      hasPendingChanges: false,
      isSyncing: false,
      pendingCount: 0,
    });
    rerender(
      <NetworkStatusPill showLive={false} onlineFlashDurationMs={2000} />,
    );
    expect(screen.getByText("Back online")).toBeInTheDocument();

    // 3. Fast-forward timer by 2000ms
    act(() => {
      jest.advanceTimersByTime(2000);
    });

    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(container.firstChild).toBeNull();
  });

  it("triggers toast notification on window online and offline events", () => {
    render(<NetworkStatusPill />);

    act(() => {
      window.dispatchEvent(new Event("offline"));
    });
    expect(mockToast).toHaveBeenCalledWith(
      "You are offline. Running in local mode.",
      "warning",
    );

    act(() => {
      window.dispatchEvent(new Event("online"));
    });
    expect(mockToast).toHaveBeenCalledWith(
      "Back online. Live data restored.",
      "success",
    );
  });

  it("applies custom className", () => {
    mockUseOfflineSync.mockReturnValue({
      isOffline: true,
      hasPendingChanges: false,
      isSyncing: false,
      pendingCount: 0,
    });

    render(<NetworkStatusPill className="custom-test-class" />);

    const badge = screen.getByRole("status");
    expect(badge.className).toContain("custom-test-class");
  });
});

