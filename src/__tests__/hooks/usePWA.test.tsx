import { render, screen, act, fireEvent } from "@testing-library/react";
import { PWAUpdateListener } from "@/components/PWAUpdateListener";
import { ToastProvider } from "@/components/ui/Toast";
import "@testing-library/jest-dom";

describe("PWA Update Flow", () => {
  let mockPostMessage: jest.Mock;

  beforeAll(() => {
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: jest.fn().mockImplementation((query) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: jest.fn(), // Deprecated
        removeListener: jest.fn(), // Deprecated
        addEventListener: jest.fn(),
        removeEventListener: jest.fn(),
        dispatchEvent: jest.fn(),
      })),
    });
  });

  beforeEach(() => {
    mockPostMessage = jest.fn();

    // Mock navigator.serviceWorker
    Object.defineProperty(navigator, "serviceWorker", {
      value: {
        register: jest.fn().mockResolvedValue({
          update: jest.fn(),
        }),
        addEventListener: jest.fn(),
        removeEventListener: jest.fn(),
      },
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  const renderWithProvider = () => {
    return render(
      <ToastProvider>
        <PWAUpdateListener />
      </ToastProvider>,
    );
  };

  test("toast shown when update available", () => {
    renderWithProvider();

    // Dispatch custom event
    const mockWorker = {
      postMessage: mockPostMessage,
    } as unknown as ServiceWorker;
    act(() => {
      window.dispatchEvent(
        new CustomEvent("pwa-update-available", { detail: mockWorker }),
      );
    });

    // Toast should be shown
    expect(screen.getByText("New version available.")).toBeInTheDocument();
    expect(screen.getByText("Click here to reload")).toBeInTheDocument();
  });

  test("reload action works (posts SKIP_WAITING)", () => {
    renderWithProvider();

    const mockWorker = {
      postMessage: mockPostMessage,
    } as unknown as ServiceWorker;
    act(() => {
      window.dispatchEvent(
        new CustomEvent("pwa-update-available", { detail: mockWorker }),
      );
    });

    const actionBtn = screen.getByText("Click here to reload");
    fireEvent.click(actionBtn);

    expect(mockPostMessage).toHaveBeenCalledWith({ type: "SKIP_WAITING" });
  });

  test("handles duplicate update events cleanly", () => {
    renderWithProvider();

    const mockWorker = {
      postMessage: mockPostMessage,
    } as unknown as ServiceWorker;

    act(() => {
      window.dispatchEvent(
        new CustomEvent("pwa-update-available", { detail: mockWorker }),
      );
      window.dispatchEvent(
        new CustomEvent("pwa-update-available", { detail: mockWorker }),
      );
    });

    const toasts = screen.getAllByText("New version available.");
    expect(toasts.length).toBe(2);
  });
});
