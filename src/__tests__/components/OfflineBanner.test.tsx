import {
  render,
  screen,
  fireEvent,
  act,
  renderHook,
  waitFor,
} from "@testing-library/react";
import "@testing-library/jest-dom";
import React from "react";
import { OfflineBanner, useOfflineStatus } from "@/components/ui/OfflineBanner";
import { ToastProvider } from "@/components/ui/Toast";

// Mock fetch globally
global.fetch = jest.fn(() =>
  Promise.resolve({
    ok: true,
    status: 200,
  }),
) as jest.Mock;

describe("OfflineBanner Component & useOfflineStatus Hook (#4144, #4410)", () => {
  let originalOnLine: boolean;

  beforeAll(() => {
    originalOnLine = navigator.onLine;
  });

  afterAll(() => {
    Object.defineProperty(navigator, "onLine", {
      value: originalOnLine,
      writable: true,
      configurable: true,
    });
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("useOfflineStatus Hook", () => {
    it("reflects initial browser navigator online status", () => {
      Object.defineProperty(navigator, "onLine", {
        value: true,
        writable: true,
        configurable: true,
      });

      const { result } = renderHook(() => useOfflineStatus(), {
        wrapper: ToastProvider,
      });
      expect(result.current.isOffline).toBe(false);
    });

    it("updates status when online and offline window events fire", () => {
      const { result } = renderHook(() => useOfflineStatus(), {
        wrapper: ToastProvider,
      });

      act(() => {
        window.dispatchEvent(new Event("offline"));
      });
      expect(result.current.isOffline).toBe(true);

      act(() => {
        window.dispatchEvent(new Event("online"));
      });
      expect(result.current.isOffline).toBe(false);
    });

    it("performs manual retry Connection ping test", async () => {
      Object.defineProperty(navigator, "onLine", {
        value: true,
        writable: true,
        configurable: true,
      });

      const { result } = renderHook(() => useOfflineStatus(), {
        wrapper: ToastProvider,
      });

      let success = false;
      await act(async () => {
        success = await result.current.retryConnection();
      });

      expect(success).toBe(true);
      expect(result.current.isOffline).toBe(false);
    });
  });

  describe("OfflineBanner Component", () => {
    it("does not render when browser is online and no failed mutations", () => {
      Object.defineProperty(navigator, "onLine", {
        value: true,
        writable: true,
        configurable: true,
      });

      render(
        <ToastProvider>
          <OfflineBanner />
        </ToastProvider>,
      );
      expect(screen.queryByTestId("offline-banner")).toBeNull();
    });

    it("renders persistent top offline banner when offline event fires", () => {
      Object.defineProperty(navigator, "onLine", {
        value: false,
        writable: true,
        configurable: true,
      });

      render(
        <ToastProvider>
          <OfflineBanner />
        </ToastProvider>,
      );

      act(() => {
        window.dispatchEvent(new Event("offline"));
      });

      expect(screen.getByTestId("offline-banner")).toBeInTheDocument();
      expect(
        screen.getByText("You are currently offline."),
      ).toBeInTheDocument();
      expect(screen.getByTestId("retry-connection-button")).toBeInTheDocument();
    });

    it("triggers retry Connection when manual sync action button is clicked", async () => {
      Object.defineProperty(navigator, "onLine", {
        value: false,
        writable: true,
        configurable: true,
      });

      render(
        <ToastProvider>
          <OfflineBanner />
        </ToastProvider>,
      );

      act(() => {
        window.dispatchEvent(new Event("offline"));
      });

      const retryBtn = screen.getByTestId("retry-connection-button");
      expect(retryBtn).toBeInTheDocument();

      // Change navigator to online before retry
      Object.defineProperty(navigator, "onLine", {
        value: true,
        writable: true,
        configurable: true,
      });

      await act(async () => {
        fireEvent.click(retryBtn);
      });

      await waitFor(() => {
        expect(screen.queryByTestId("offline-banner")).toBeNull();
      });
    });

    it("displays count of failed mutations and triggers retry synchronization", async () => {
      Object.defineProperty(navigator, "onLine", {
        value: true,
        writable: true,
        configurable: true,
      });

      const onRetry = jest.fn().mockResolvedValue(undefined);
      const failedMutations = [
        { id: "mut_1", name: "Create Booking", error: "500 Server Error" },
        { id: "mut_2", name: "Update Profile", error: "Network timeout" },
      ];

      render(
        <ToastProvider>
          <OfflineBanner
            failedMutations={failedMutations}
            onRetryFailedMutations={onRetry}
          />
        </ToastProvider>,
      );

      expect(screen.getByTestId("offline-banner")).toBeInTheDocument();
      expect(screen.getByTestId("failed-mutations-count")).toHaveTextContent(
        "2 failed actions",
      );

      const retryMutationsBtn = screen.getByTestId(
        "retry-failed-mutations-button",
      );
      expect(retryMutationsBtn).toHaveTextContent("Retry Now");

      await act(async () => {
        fireEvent.click(retryMutationsBtn);
      });

      expect(onRetry).toHaveBeenCalledTimes(1);
    });

    it("opens inspect modal to view failed mutation details", () => {
      Object.defineProperty(navigator, "onLine", {
        value: true,
        writable: true,
        configurable: true,
      });

      const failedMutations = [
        { id: "mut_1", name: "Create Booking", error: "500 Server Error" },
      ];

      render(
        <ToastProvider>
          <OfflineBanner failedMutations={failedMutations} />
        </ToastProvider>,
      );

      const inspectBtn = screen.getByTestId("inspect-failed-mutations-button");
      fireEvent.click(inspectBtn);

      expect(screen.getByTestId("failed-mutations-modal")).toBeInTheDocument();
      expect(screen.getByText("Create Booking")).toBeInTheDocument();
      expect(screen.getByText("500 Server Error")).toBeInTheDocument();
    });

    it("dismisses offline banner when dismiss button is clicked", () => {
      Object.defineProperty(navigator, "onLine", {
        value: false,
        writable: true,
        configurable: true,
      });

      render(
        <ToastProvider>
          <OfflineBanner showDismiss={true} />
        </ToastProvider>,
      );

      act(() => {
        window.dispatchEvent(new Event("offline"));
      });

      const dismissBtn = screen.getByTestId("dismiss-offline-banner");
      fireEvent.click(dismissBtn);

      expect(screen.queryByTestId("offline-banner")).toBeNull();
    });
  });
});
