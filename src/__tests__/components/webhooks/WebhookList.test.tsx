import React from "react";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import "@testing-library/jest-dom";
import { WebhookList } from "@/components/webhooks/WebhookList";
import { WebhookEndpoint, WebhookEventType } from "@prisma/client";

jest.mock("@/app/dashboard/webhooks/actions", () => ({
  deleteWebhookEndpoint: jest.fn(),
  sendTestWebhook: jest.fn(),
  setWebhookEndpointActive: jest.fn(),
}));

import {
  deleteWebhookEndpoint,
  sendTestWebhook,
  setWebhookEndpointActive,
} from "@/app/dashboard/webhooks/actions";

const mockedDeleteWebhookEndpoint = deleteWebhookEndpoint as unknown as jest.Mock;
const mockedSendTestWebhook = sendTestWebhook as unknown as jest.Mock;
const mockedSetWebhookEndpointActive = setWebhookEndpointActive as unknown as jest.Mock;

describe("WebhookList", () => {
  const sampleEndpoints: WebhookEndpoint[] = [
    {
      id: "ep-1",
      userId: "user-1",
      url: "https://example.com/webhook",
      secret: "whsec_test12345",
      eventTypes: ["BOOKING_CONFIRMED" as WebhookEventType, "VENUE_UPDATED" as WebhookEventType],
      headers: null,
      isActive: true,
      createdAt: new Date("2026-01-01T00:00:00Z"),
      updatedAt: new Date("2026-01-01T00:00:00Z"),
    },
    {
      id: "ep-2",
      userId: "user-1",
      url: "https://api.work.test/events",
      secret: "whsec_test67890",
      eventTypes: ["CHECK_IN_RECORDED" as WebhookEventType],
      headers: null,
      isActive: false,
      createdAt: new Date("2026-01-02T00:00:00Z"),
      updatedAt: new Date("2026-01-02T00:00:00Z"),
    },
  ];

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
  });

  afterEach(() => {
    act(() => {
      jest.runOnlyPendingTimers();
    });
    jest.useRealTimers();
  });

  it("renders empty state when endpoints array is empty", () => {
    render(<WebhookList endpoints={[]} />);
    expect(screen.getByTestId("webhook-list-empty")).toBeInTheDocument();
    expect(screen.getByText("No webhooks configured yet.")).toBeInTheDocument();
  });

  it("renders empty state when endpoints is null or undefined", () => {
    const { rerender } = render(<WebhookList endpoints={null} />);
    expect(screen.getByTestId("webhook-list-empty")).toBeInTheDocument();

    rerender(<WebhookList endpoints={undefined} />);
    expect(screen.getByTestId("webhook-list-empty")).toBeInTheDocument();
  });

  it("renders configured endpoints list with url, secret, and event badges", () => {
    render(<WebhookList endpoints={sampleEndpoints} />);

    expect(screen.getByTestId("webhook-list")).toBeInTheDocument();
    expect(screen.getByText("Configured Endpoints")).toBeInTheDocument();

    expect(screen.getByTestId("webhook-item-ep-1")).toBeInTheDocument();
    expect(screen.getByTestId("webhook-url-ep-1")).toHaveTextContent("https://example.com/webhook");
    expect(screen.getByTestId("webhook-secret-ep-1")).toHaveTextContent("whsec_test12345");
    expect(screen.getByTestId("webhook-status-indicator-ep-1")).toHaveAttribute("aria-label", "Active");
    expect(screen.getByTestId("webhook-event-tag-ep-1-BOOKING_CONFIRMED")).toHaveTextContent("BOOKING CONFIRMED");
    expect(screen.getByTestId("webhook-event-tag-ep-1-VENUE_UPDATED")).toHaveTextContent("VENUE UPDATED");

    expect(screen.getByTestId("webhook-item-ep-2")).toBeInTheDocument();
    expect(screen.getByTestId("webhook-url-ep-2")).toHaveTextContent("https://api.work.test/events");
    expect(screen.getByTestId("webhook-status-indicator-ep-2")).toHaveAttribute("aria-label", "Paused");
  });

  it("copies secret to clipboard on copy button click and resets icon after timer", () => {
    const writeTextMock = jest.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: {
        writeText: writeTextMock,
      },
    });

    render(<WebhookList endpoints={sampleEndpoints} />);

    const copyBtn = screen.getByTestId("webhook-copy-btn-ep-1");
    fireEvent.click(copyBtn);

    expect(writeTextMock).toHaveBeenCalledWith("whsec_test12345");
    expect(screen.getByTestId("webhook-copied-icon-ep-1")).toBeInTheDocument();

    act(() => {
      jest.advanceTimersByTime(2000);
    });

    expect(screen.queryByTestId("webhook-copied-icon-ep-1")).not.toBeInTheDocument();
  });

  it("handles clipboard failure without crashing", () => {
    Object.assign(navigator, {
      clipboard: {
        writeText: jest.fn().mockRejectedValue(new Error("Permission denied")),
      },
    });

    render(<WebhookList endpoints={sampleEndpoints} />);
    const copyBtn = screen.getByTestId("webhook-copy-btn-ep-1");

    expect(() => fireEvent.click(copyBtn)).not.toThrow();
  });

  it("toggles active status when pause/resume button is clicked", async () => {
    mockedSetWebhookEndpointActive.mockResolvedValue({ success: true });
    const onEndpointToggled = jest.fn();

    render(
      <WebhookList
        endpoints={sampleEndpoints}
        onEndpointToggled={onEndpointToggled}
      />
    );

    const toggleBtn = screen.getByTestId("webhook-toggle-btn-ep-1");
    expect(toggleBtn).toHaveAttribute("aria-label", "Pause deliveries");

    fireEvent.click(toggleBtn);

    expect(mockedSetWebhookEndpointActive).toHaveBeenCalledWith("ep-1", false);

    await waitFor(() => {
      expect(onEndpointToggled).toHaveBeenCalledWith("ep-1", false);
    });
  });

  it("triggers test event and displays delivery success status", async () => {
    mockedSendTestWebhook.mockResolvedValue({
      ok: true,
      status: "SUCCESS",
      statusCode: 200,
    });
    const onTestSent = jest.fn();

    render(<WebhookList endpoints={sampleEndpoints} onTestSent={onTestSent} />);

    const testBtn = screen.getByTestId("webhook-test-btn-ep-1");
    fireEvent.click(testBtn);

    expect(mockedSendTestWebhook).toHaveBeenCalledWith("ep-1");

    await waitFor(() => {
      const statusMsg = screen.getByTestId("webhook-test-status-ep-1");
      expect(statusMsg).toHaveTextContent("Delivered (HTTP 200)");
      expect(onTestSent).toHaveBeenCalledWith("ep-1", {
        ok: true,
        status: "SUCCESS",
        statusCode: 200,
      });
    });
  });

  it("triggers test event and displays blocked notice for private networks", async () => {
    mockedSendTestWebhook.mockResolvedValue({
      ok: true,
      status: "BLOCKED",
    });

    render(<WebhookList endpoints={sampleEndpoints} />);

    const testBtn = screen.getByTestId("webhook-test-btn-ep-1");
    fireEvent.click(testBtn);

    await waitFor(() => {
      const statusMsg = screen.getByTestId("webhook-test-status-ep-1");
      expect(statusMsg).toHaveTextContent("Blocked: URL resolves to a private network");
    });
  });

  it("triggers test event and displays error message on action error", async () => {
    mockedSendTestWebhook.mockResolvedValue({
      ok: false,
      error: "Webhook endpoint not found or inactive",
    });

    render(<WebhookList endpoints={sampleEndpoints} />);

    const testBtn = screen.getByTestId("webhook-test-btn-ep-1");
    fireEvent.click(testBtn);

    await waitFor(() => {
      const statusMsg = screen.getByTestId("webhook-test-status-ep-1");
      expect(statusMsg).toHaveTextContent("Webhook endpoint not found or inactive");
    });
  });

  it("deletes endpoint when confirmation is confirmed", async () => {
    const confirmSpy = jest.spyOn(window, "confirm").mockReturnValue(true);
    mockedDeleteWebhookEndpoint.mockResolvedValue({ success: true });
    const onEndpointDeleted = jest.fn();

    render(
      <WebhookList
        endpoints={sampleEndpoints}
        onEndpointDeleted={onEndpointDeleted}
      />
    );

    const deleteBtn = screen.getByTestId("webhook-delete-btn-ep-1");
    fireEvent.click(deleteBtn);

    expect(confirmSpy).toHaveBeenCalledWith(
      "Delete this webhook? Deliveries to it will stop immediately."
    );
    expect(mockedDeleteWebhookEndpoint).toHaveBeenCalledWith("ep-1");

    await waitFor(() => {
      expect(onEndpointDeleted).toHaveBeenCalledWith("ep-1");
    });

    confirmSpy.mockRestore();
  });

  it("does not delete endpoint when confirmation is cancelled", async () => {
    const confirmSpy = jest.spyOn(window, "confirm").mockReturnValue(false);
    mockedDeleteWebhookEndpoint.mockResolvedValue({ success: true });
    const onEndpointDeleted = jest.fn();

    render(
      <WebhookList
        endpoints={sampleEndpoints}
        onEndpointDeleted={onEndpointDeleted}
      />
    );

    const deleteBtn = screen.getByTestId("webhook-delete-btn-ep-1");
    fireEvent.click(deleteBtn);

    expect(confirmSpy).toHaveBeenCalled();
    expect(mockedDeleteWebhookEndpoint).not.toHaveBeenCalled();
    expect(onEndpointDeleted).not.toHaveBeenCalled();

    confirmSpy.mockRestore();
  });

  it("handles endpoints with undefined eventTypes without errors", () => {
    const edgeEndpoints = [
      {
        ...sampleEndpoints[0],
        eventTypes: undefined as unknown as WebhookEventType[],
      },
    ];

    expect(() => {
      render(<WebhookList endpoints={edgeEndpoints} />);
    }).not.toThrow();

    expect(screen.getByTestId("webhook-item-ep-1")).toBeInTheDocument();
  });
});
