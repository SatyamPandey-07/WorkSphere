import React from "react";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import "@testing-library/jest-dom";
import { DeliveryLogs } from "@/components/webhooks/DeliveryLogs";
import { WebhookEndpoint, WebhookDeliveryLog } from "@prisma/client";

jest.mock("@/app/dashboard/webhooks/actions", () => ({
  getWebhookLogs: jest.fn(),
}));

import { getWebhookLogs } from "@/app/dashboard/webhooks/actions";

const mockedGetWebhookLogs = getWebhookLogs as unknown as jest.Mock;

describe("DeliveryLogs", () => {
  const sampleEndpoints: WebhookEndpoint[] = [
    {
      id: "ep-1",
      userId: "user-1",
      url: "https://example.com/webhook",
      secret: "whsec_test1",
      eventTypes: [],
      headers: null,
      isActive: true,
      createdAt: new Date("2026-01-01T00:00:00Z"),
      updatedAt: new Date("2026-01-01T00:00:00Z"),
    },
    {
      id: "ep-2",
      userId: "user-1",
      url: "https://api.domain.test/events",
      secret: "whsec_test2",
      eventTypes: [],
      headers: null,
      isActive: true,
      createdAt: new Date("2026-01-02T00:00:00Z"),
      updatedAt: new Date("2026-01-02T00:00:00Z"),
    },
  ];

  const sampleLogs: WebhookDeliveryLog[] = [
    {
      id: "log-1",
      endpointId: "ep-1",
      eventType: "BOOKING_CONFIRMED",
      payload: { id: "bk-123" },
      status: "SUCCESS",
      statusCode: 200,
      createdAt: new Date("2026-01-05T10:00:00Z"),
    },
    {
      id: "log-2",
      endpointId: "ep-1",
      eventType: "VENUE_UPDATED",
      payload: { venueId: "vn-456" },
      status: "SKIPPED_OUTSIDE_WINDOW",
      statusCode: null,
      createdAt: new Date("2026-01-05T11:00:00Z"),
    },
    {
      id: "log-3",
      endpointId: "ep-1",
      eventType: "PAYMENT_RECEIVED",
      payload: { amount: 50 },
      status: "FAILED",
      statusCode: 500,
      createdAt: new Date("2026-01-05T12:00:00Z"),
    },
  ];

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns null when endpoints is an empty array", () => {
    const { container } = render(<DeliveryLogs endpoints={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it("returns null when endpoints is null or undefined", () => {
    const { container: c1 } = render(<DeliveryLogs endpoints={null} />);
    expect(c1.firstChild).toBeNull();

    const { container: c2 } = render(<DeliveryLogs endpoints={undefined} />);
    expect(c2.firstChild).toBeNull();
  });

  it("renders container, endpoint dropdown, and empty logs state when no logs returned", async () => {
    mockedGetWebhookLogs.mockResolvedValue([]);

    render(<DeliveryLogs endpoints={sampleEndpoints} />);

    expect(screen.getByTestId("delivery-logs-container")).toBeInTheDocument();
    expect(screen.getByText("Delivery Logs")).toBeInTheDocument();
    expect(screen.getByTestId("delivery-logs-endpoint-select")).toHaveValue("ep-1");

    await waitFor(() => {
      expect(screen.getByTestId("delivery-logs-empty")).toBeInTheDocument();
      expect(
        screen.getByText("No delivery logs found for this endpoint.")
      ).toBeInTheDocument();
    });
  });

  it("fetches and renders delivery logs for default first endpoint", async () => {
    mockedGetWebhookLogs.mockResolvedValue(sampleLogs);
    const onLogsLoaded = jest.fn();

    render(
      <DeliveryLogs
        endpoints={sampleEndpoints}
        onLogsLoaded={onLogsLoaded}
      />
    );

    expect(mockedGetWebhookLogs).toHaveBeenCalledWith("ep-1");

    await waitFor(() => {
      expect(screen.getByTestId("delivery-log-row-log-1")).toBeInTheDocument();
      expect(screen.getByTestId("delivery-log-event-log-1")).toHaveTextContent("BOOKING_CONFIRMED");
      expect(screen.getByTestId("delivery-log-code-log-1")).toHaveTextContent("200");
      expect(screen.getByTestId("delivery-log-status-log-1")).toHaveTextContent("SUCCESS");
      expect(screen.getByTestId("delivery-log-status-log-1")).toHaveClass("text-green-400");

      expect(screen.getByTestId("delivery-log-row-log-2")).toBeInTheDocument();
      expect(screen.getByTestId("delivery-log-code-log-2")).toHaveTextContent("-");
      expect(screen.getByTestId("delivery-log-status-log-2")).toHaveTextContent("SKIPPED_OUTSIDE_WINDOW");
      expect(screen.getByTestId("delivery-log-status-log-2")).toHaveClass("text-amber-400");

      expect(screen.getByTestId("delivery-log-row-log-3")).toBeInTheDocument();
      expect(screen.getByTestId("delivery-log-code-log-3")).toHaveTextContent("500");
      expect(screen.getByTestId("delivery-log-status-log-3")).toHaveTextContent("FAILED");
      expect(screen.getByTestId("delivery-log-status-log-3")).toHaveClass("text-red-400");

      expect(onLogsLoaded).toHaveBeenCalledWith(sampleLogs);
    });
  });

  it("switches selected endpoint and requests logs for the newly chosen endpoint", async () => {
    mockedGetWebhookLogs.mockResolvedValueOnce(sampleLogs);
    const onEndpointChange = jest.fn();

    render(
      <DeliveryLogs
        endpoints={sampleEndpoints}
        onEndpointChange={onEndpointChange}
      />
    );

    await waitFor(() => {
      expect(mockedGetWebhookLogs).toHaveBeenCalledWith("ep-1");
    });

    const ep2Logs: WebhookDeliveryLog[] = [
      {
        id: "log-ep2-1",
        endpointId: "ep-2",
        eventType: "CHECK_IN_RECORDED",
        payload: {},
        status: "DISPATCHED_TO_SVIX",
        statusCode: 202,
        createdAt: new Date("2026-01-06T00:00:00Z"),
      },
    ];
    mockedGetWebhookLogs.mockResolvedValueOnce(ep2Logs);

    const select = screen.getByTestId("delivery-logs-endpoint-select");
    fireEvent.change(select, { target: { value: "ep-2" } });

    expect(onEndpointChange).toHaveBeenCalledWith("ep-2");

    await waitFor(() => {
      expect(mockedGetWebhookLogs).toHaveBeenCalledWith("ep-2");
      expect(screen.getByTestId("delivery-log-row-log-ep2-1")).toBeInTheDocument();
      expect(screen.getByTestId("delivery-log-status-log-ep2-1")).toHaveClass("text-green-400");
    });
  });

  it("respects initialSelectedEndpointId if present in endpoints list", async () => {
    mockedGetWebhookLogs.mockResolvedValue([]);

    render(
      <DeliveryLogs
        endpoints={sampleEndpoints}
        initialSelectedEndpointId="ep-2"
      />
    );

    expect(screen.getByTestId("delivery-logs-endpoint-select")).toHaveValue("ep-2");
    expect(mockedGetWebhookLogs).toHaveBeenCalledWith("ep-2");

    await waitFor(() => {
      expect(screen.getByTestId("delivery-logs-empty")).toBeInTheDocument();
    });
  });

  it("handles getWebhookLogs promise rejection safely without crashing", async () => {
    mockedGetWebhookLogs.mockRejectedValue(new Error("Network connection error"));
    const onLogsLoaded = jest.fn();

    render(
      <DeliveryLogs
        endpoints={sampleEndpoints}
        onLogsLoaded={onLogsLoaded}
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId("delivery-logs-empty")).toBeInTheDocument();
      expect(onLogsLoaded).toHaveBeenCalledWith([]);
    });
  });

  it("does not update state when component is unmounted while fetch is pending", async () => {
    let resolvePromise: (logs: WebhookDeliveryLog[]) => void;
    mockedGetWebhookLogs.mockReturnValue(
      new Promise((resolve) => {
        resolvePromise = resolve;
      })
    );

    const { unmount } = render(<DeliveryLogs endpoints={sampleEndpoints} />);
    unmount();

    await act(async () => {
      resolvePromise!(sampleLogs);
    });
  });
});
