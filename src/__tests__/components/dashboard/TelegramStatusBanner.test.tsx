import React from "react";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { TelegramStatusBanner } from "@/components/dashboard/TelegramStatusBanner";

const mockPush = jest.fn();
jest.mock("next/navigation", () => ({
  useRouter: () => ({
    push: mockPush,
  }),
}));

describe("TelegramStatusBanner Component", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("renders loading skeleton initially and renders configured banner on success", async () => {
    global.fetch = jest.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ telegramConfigured: true }),
    } as Response);

    const onSettingsLoaded = jest.fn();

    render(
      <TelegramStatusBanner
        onSettingsLoaded={onSettingsLoaded}
        testId="tg-banner"
        className="custom-tg-class"
      />
    );

    // Initial loading state
    expect(screen.getByTestId("tg-banner-loading")).toBeInTheDocument();
    expect(screen.getByRole("region")).toHaveAttribute("aria-busy", "true");

    // Wait for configured state
    await waitFor(() => {
      expect(screen.getByTestId("tg-banner-heading")).toHaveTextContent("Telegram Configured");
    });

    expect(screen.getByTestId("tg-banner-success-icon")).toBeInTheDocument();
    expect(screen.getByTestId("tg-banner-action-button")).toHaveTextContent("Manage Telegram");
    expect(screen.getByTestId("tg-banner")).toHaveClass("custom-tg-class");
    expect(onSettingsLoaded).toHaveBeenCalledWith({ telegramConfigured: true });
  });

  it("renders unconfigured banner when telegramConfigured is false", async () => {
    global.fetch = jest.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ telegramConfigured: false }),
    } as Response);

    render(<TelegramStatusBanner testId="tg-banner" />);

    await waitFor(() => {
      expect(screen.getByTestId("tg-banner-heading")).toHaveTextContent("Telegram Not Configured");
    });

    expect(screen.getByTestId("tg-banner-warning-icon")).toBeInTheDocument();
    expect(screen.getByTestId("tg-banner-action-button")).toHaveTextContent("Configure Telegram");
  });

  it("navigates to webhooks dashboard on action button click", async () => {
    const onNavigate = jest.fn();

    render(
      <TelegramStatusBanner
        initialSettings={{ telegramConfigured: true }}
        onNavigate={onNavigate}
        testId="tg-banner"
      />
    );

    const button = screen.getByTestId("tg-banner-action-button");
    fireEvent.click(button);

    expect(onNavigate).toHaveBeenCalledWith("/dashboard/webhooks");
    expect(mockPush).not.toHaveBeenCalled();
  });

  it("falls back to router.push when onNavigate is not supplied", async () => {
    render(
      <TelegramStatusBanner
        initialSettings={{ telegramConfigured: false }}
        testId="tg-banner"
      />
    );

    const button = screen.getByTestId("tg-banner-action-button");
    fireEvent.click(button);

    expect(mockPush).toHaveBeenCalledWith("/dashboard/webhooks");
  });

  it("renders null on 401 unauthenticated response", async () => {
    global.fetch = jest.fn().mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: async () => ({ error: "Unauthorized" }),
    } as Response);

    const { container } = render(<TelegramStatusBanner testId="tg-banner" />);

    await waitFor(() => {
      expect(container).toBeEmptyDOMElement();
    });
  });

  it("handles network error and allows retrying", async () => {
    global.fetch = jest
      .fn()
      .mockRejectedValueOnce(new Error("Connection refused"))
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ telegramConfigured: true }),
      } as Response);

    const onError = jest.fn();

    render(<TelegramStatusBanner onError={onError} testId="tg-banner" />);

    await waitFor(() => {
      expect(screen.getByTestId("tg-banner-error")).toBeInTheDocument();
    });

    expect(onError).toHaveBeenCalledWith(expect.any(Error));
    expect(screen.getByTestId("tg-banner-error-heading")).toHaveTextContent(
      "Failed to load Telegram status"
    );

    // Click retry
    const retryBtn = screen.getByTestId("tg-banner-retry-button");
    fireEvent.click(retryBtn);

    await waitFor(() => {
      expect(screen.getByTestId("tg-banner-heading")).toHaveTextContent("Telegram Configured");
    });
  });

  it("uses initialSettings directly without making a network request", () => {
    const fetchSpy = jest.fn();
    global.fetch = fetchSpy;

    render(
      <TelegramStatusBanner
        initialSettings={{ telegramConfigured: true }}
        testId="tg-banner"
      />
    );

    expect(screen.getByTestId("tg-banner-heading")).toHaveTextContent("Telegram Configured");
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
