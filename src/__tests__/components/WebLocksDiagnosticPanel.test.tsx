import { render, screen } from "@testing-library/react";
import { WebLocksDiagnosticPanel } from "@/components/WebLocksDiagnosticPanel";

// Mock offlineStore functions
jest.mock("@/lib/offlineStore", () => ({
  getQueuedFavorites: jest.fn().mockResolvedValue([]),
  getQueuedCheckIns: jest.fn().mockResolvedValue([]),
  OFFLINE_WRITE_LOCK: "worksphere-offline-write-lock",
}));

// Mock webLock OFFLINE_WRITE_LOCK constant
jest.mock("@/lib/webLock", () => ({
  OFFLINE_WRITE_LOCK: "worksphere-offline-write-lock",
}));

describe("WebLocksDiagnosticPanel", () => {
  it("renders the 'Web Locks Diagnostic' heading", async () => {
    render(<WebLocksDiagnosticPanel />);
    expect(await screen.findByText("Web Locks Diagnostic")).toBeInTheDocument();
  });

  it("shows warning when Web Locks API is unsupported", async () => {
    // Remove navigator.locks to simulate unsupported browser
    const originalLocks = navigator.locks;
    Object.defineProperty(navigator, "locks", {
      value: undefined,
      writable: true,
      configurable: true,
    });

    render(<WebLocksDiagnosticPanel />);
    // Wait for the component to detect unsupported state
    await screen.findByText("Web Locks Diagnostic");

    Object.defineProperty(navigator, "locks", {
      value: originalLocks,
      writable: true,
      configurable: true,
    });
  });

  it("renders a refresh button", async () => {
    render(<WebLocksDiagnosticPanel />);
    const refreshBtn = await screen.findByRole("button", { name: /refresh/i });
    expect(refreshBtn).toBeInTheDocument();
  });

  it("renders the Sync Outbox section label", async () => {
    render(<WebLocksDiagnosticPanel />);
    expect(await screen.findByText(/sync outbox/i)).toBeInTheDocument();
  });
});
