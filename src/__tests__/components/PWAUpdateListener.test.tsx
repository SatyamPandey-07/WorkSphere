import { render, screen, act, fireEvent } from "@testing-library/react";
import { PWAUpdateListener } from "@/components/PWAUpdateListener";

// Mock useToast
const toastMock = jest.fn();
jest.mock("@/components/ui/Toast", () => ({
  useToast: () => ({ toast: toastMock }),
}));

describe("PWAUpdateListener", () => {
  let mockPostMessage: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    mockPostMessage = jest.fn();

    // Mock navigator.serviceWorker with getRegistration
    Object.defineProperty(navigator, "serviceWorker", {
      value: {
        register: jest.fn().mockResolvedValue({
          update: jest.fn(),
        }),
        getRegistration: jest.fn().mockResolvedValue(null),
        ready: Promise.resolve(null),
        addEventListener: jest.fn(),
        removeEventListener: jest.fn(),
      },
      writable: true,
      configurable: true,
    });
  });

  it("renders nothing (no visible UI) initially when no update is waiting", () => {
    const { container } = render(<PWAUpdateListener />);
    expect(container.firstChild).toBeNull();
  });

  it("shows toast when 'pwa-update-available' event fires", () => {
    render(<PWAUpdateListener />);

    act(() => {
      window.dispatchEvent(new CustomEvent("pwa-update-available"));
    });

    expect(toastMock).toHaveBeenCalledWith(
      expect.stringContaining("version"),
      expect.anything(),
      expect.anything(),
    );
  });

  it("detects service worker waiting state from registration and renders accessible banner with 'Update available' message", async () => {
    const mockWaitingWorker = {
      postMessage: mockPostMessage,
    } as unknown as ServiceWorker;

    (navigator.serviceWorker.getRegistration as jest.Mock).mockResolvedValue({
      waiting: mockWaitingWorker,
      installing: null,
      addEventListener: jest.fn(),
    });

    await act(async () => {
      render(<PWAUpdateListener />);
    });

    const alertBanner = screen.getByRole("alert");
    expect(alertBanner).toBeInTheDocument();
    expect(screen.getByText("Update available")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Refresh Now" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Dismiss/i }),
    ).toBeInTheDocument();
  });

  it("posts { type: 'SKIP_WAITING' } message to the waiting service worker and reloads when clicking 'Refresh Now'", () => {
    render(<PWAUpdateListener />);

    const mockWaitingWorker = {
      postMessage: mockPostMessage,
    } as unknown as ServiceWorker;

    act(() => {
      window.dispatchEvent(
        new CustomEvent("pwa-update-available", { detail: mockWaitingWorker }),
      );
    });

    expect(screen.getByText("Update available")).toBeInTheDocument();
    const refreshButton = screen.getByRole("button", { name: "Refresh Now" });

    fireEvent.click(refreshButton);

    expect(mockPostMessage).toHaveBeenCalledWith({ type: "SKIP_WAITING" });
  });

  it("dismisses the banner when 'Dismiss' button is clicked", () => {
    render(<PWAUpdateListener />);

    const mockWaitingWorker = {
      postMessage: mockPostMessage,
    } as unknown as ServiceWorker;

    act(() => {
      window.dispatchEvent(
        new CustomEvent("pwa-update-available", { detail: mockWaitingWorker }),
      );
    });

    expect(screen.getByText("Update available")).toBeInTheDocument();
    const dismissButton = screen.getByRole("button", { name: /Dismiss/i });

    fireEvent.click(dismissButton);

    expect(screen.queryByText("Update available")).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("does not crash on unmount", () => {
    const { unmount } = render(<PWAUpdateListener />);
    expect(() => unmount()).not.toThrow();
  });
});
