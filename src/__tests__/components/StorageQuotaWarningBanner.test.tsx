import React from "react";
import {
  render,
  screen,
  fireEvent,
  act,
  waitFor,
} from "@testing-library/react";
import "@testing-library/jest-dom";
import { StorageQuotaWarningBanner } from "@/components/ui/StorageQuotaWarningBanner";
import {
  STORAGE_QUOTA_WARNING_EVENT,
  clearStaleCaches,
} from "@/lib/cache/storageQuota";
import { ToastProvider } from "@/components/ui/Toast";

jest.mock("@/lib/cache/storageQuota", () => {
  const actual = jest.requireActual("@/lib/cache/storageQuota");
  return {
    ...actual,
    clearStaleCaches: jest.fn(),
  };
});

describe("StorageQuotaWarningBanner (#6254)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("is hidden initially until storage-quota-warning event fires", () => {
    render(
      <ToastProvider>
        <StorageQuotaWarningBanner />
      </ToastProvider>,
    );

    expect(
      screen.queryByTestId("storage-quota-warning-banner"),
    ).not.toBeInTheDocument();
  });

  it("renders banner and usage percentage badge when event fires with detail", () => {
    render(
      <ToastProvider>
        <StorageQuotaWarningBanner />
      </ToastProvider>,
    );

    act(() => {
      window.dispatchEvent(
        new CustomEvent(STORAGE_QUOTA_WARNING_EVENT, {
          detail: {
            source: "offline-db",
            usagePercentage: 88,
            timestamp: Date.now(),
          },
        }),
      );
    });

    expect(
      screen.getByTestId("storage-quota-warning-banner"),
    ).toBeInTheDocument();
    expect(screen.getByText("Storage Space Almost Full")).toBeInTheDocument();
    expect(screen.getByTestId("storage-quota-percent-badge")).toHaveTextContent(
      "88% used",
    );
  });

  it("dismisses banner when dismiss button is clicked", () => {
    render(
      <ToastProvider>
        <StorageQuotaWarningBanner />
      </ToastProvider>,
    );

    act(() => {
      window.dispatchEvent(
        new CustomEvent(STORAGE_QUOTA_WARNING_EVENT, {
          detail: { source: "test" },
        }),
      );
    });

    const dismissBtn = screen.getByTestId("dismiss-quota-banner");
    fireEvent.click(dismissBtn);

    expect(
      screen.queryByTestId("storage-quota-warning-banner"),
    ).not.toBeInTheDocument();
  });

  it("triggers clearStaleCaches and hides banner upon successful cache clear", async () => {
    (clearStaleCaches as jest.Mock).mockResolvedValueOnce({
      cleared: ["offline-tiles", "venue-cache"],
      bytesFreed: 5242880,
    });

    render(
      <ToastProvider>
        <StorageQuotaWarningBanner />
      </ToastProvider>,
    );

    act(() => {
      window.dispatchEvent(
        new CustomEvent(STORAGE_QUOTA_WARNING_EVENT, {
          detail: { source: "test" },
        }),
      );
    });

    const clearBtn = screen.getByTestId("clear-stale-caches-btn");
    await act(async () => {
      fireEvent.click(clearBtn);
    });

    expect(clearStaleCaches).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(
        screen.queryByTestId("storage-quota-warning-banner"),
      ).not.toBeInTheDocument();
    });
  });
});
