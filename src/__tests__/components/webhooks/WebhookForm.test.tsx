import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { WebhookForm } from "@/components/webhooks/WebhookForm";

jest.mock("@/app/dashboard/webhooks/actions", () => ({
  createWebhookEndpoint: jest.fn(),
}));

describe("WebhookForm", () => {
  const mockCreateEndpoint = jest.fn();
  const onSuccess = jest.fn();
  const onError = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders with default fields and disabled submit button", () => {
    render(<WebhookForm />);

    expect(screen.getByTestId("webhook-form")).toBeInTheDocument();
    expect(screen.getByTestId("webhook-url-input")).toHaveValue("");
    expect(screen.getByTestId("webhook-submit-btn")).toBeDisabled();
    expect(screen.getByText("Add New Webhook")).toBeInTheDocument();
  });

  it("enables submit button only when URL and at least one event are provided", () => {
    render(<WebhookForm />);

    const urlInput = screen.getByTestId("webhook-url-input");
    const submitBtn = screen.getByTestId("webhook-submit-btn");
    const eventCheckbox = screen.getByTestId(
      "webhook-event-checkbox-BOOKING_CONFIRMED",
    );

    fireEvent.change(urlInput, { target: { value: "https://example.com/webhook" } });
    expect(submitBtn).toBeDisabled();

    fireEvent.click(eventCheckbox);
    expect(submitBtn).toBeEnabled();

    fireEvent.click(eventCheckbox);
    expect(submitBtn).toBeDisabled();
  });

  it("allows adding, editing, and removing custom headers", () => {
    render(<WebhookForm />);

    const addHeaderBtn = screen.getByTestId("webhook-add-header-btn");
    fireEvent.click(addHeaderBtn);

    const keyInput = screen.getByTestId("webhook-header-key-0");
    const valInput = screen.getByTestId("webhook-header-value-0");

    fireEvent.change(keyInput, { target: { value: "Authorization" } });
    fireEvent.change(valInput, { target: { value: "Bearer token123" } });

    expect(keyInput).toHaveValue("Authorization");
    expect(valInput).toHaveValue("Bearer token123");

    const removeBtn = screen.getByTestId("webhook-header-remove-0");
    fireEvent.click(removeBtn);

    expect(screen.queryByTestId("webhook-header-row-0")).not.toBeInTheDocument();
  });

  it("successfully creates webhook, resets form, and calls onSuccess", async () => {
    mockCreateEndpoint.mockResolvedValueOnce({ ok: true });

    render(
      <WebhookForm
        onCreateEndpoint={mockCreateEndpoint}
        onSuccess={onSuccess}
      />,
    );

    const urlInput = screen.getByTestId("webhook-url-input");
    fireEvent.change(urlInput, { target: { value: "https://example.com/webhook" } });

    const eventCheckbox = screen.getByTestId(
      "webhook-event-checkbox-BOOKING_CONFIRMED",
    );
    fireEvent.click(eventCheckbox);

    // Add header
    fireEvent.click(screen.getByTestId("webhook-add-header-btn"));
    fireEvent.change(screen.getByTestId("webhook-header-key-0"), {
      target: { value: "X-Secret" },
    });
    fireEvent.change(screen.getByTestId("webhook-header-value-0"), {
      target: { value: "test-secret" },
    });

    const submitBtn = screen.getByTestId("webhook-submit-btn");
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(mockCreateEndpoint).toHaveBeenCalledWith({
        url: "https://example.com/webhook",
        eventTypes: ["BOOKING_CONFIRMED"],
        headers: { "X-Secret": "test-secret" },
      });
      expect(onSuccess).toHaveBeenCalled();
    });

    expect(urlInput).toHaveValue("");
    expect(eventCheckbox).not.toBeChecked();
    expect(screen.queryByTestId("webhook-header-row-0")).not.toBeInTheDocument();
  });

  it("displays error message and calls onError when creation fails", async () => {
    mockCreateEndpoint.mockResolvedValueOnce({
      ok: false,
      error: "Endpoint URL is unreachable",
    });

    render(
      <WebhookForm
        onCreateEndpoint={mockCreateEndpoint}
        onError={onError}
      />,
    );

    fireEvent.change(screen.getByTestId("webhook-url-input"), {
      target: { value: "https://bad-domain.com" },
    });
    fireEvent.click(
      screen.getByTestId("webhook-event-checkbox-DOCUMENT_SIGNED"),
    );

    fireEvent.click(screen.getByTestId("webhook-submit-btn"));

    await waitFor(() => {
      expect(screen.getByTestId("webhook-error-alert")).toHaveTextContent(
        "Endpoint URL is unreachable",
      );
      expect(onError).toHaveBeenCalledWith("Endpoint URL is unreachable");
    });
  });

  it("handles exception during submission without crashing", async () => {
    mockCreateEndpoint.mockRejectedValueOnce(new Error("Network disconnect"));

    render(
      <WebhookForm
        onCreateEndpoint={mockCreateEndpoint}
        onError={onError}
      />,
    );

    fireEvent.change(screen.getByTestId("webhook-url-input"), {
      target: { value: "https://example.com/hook" },
    });
    fireEvent.click(
      screen.getByTestId("webhook-event-checkbox-BOOKING_CONFIRMED"),
    );

    fireEvent.click(screen.getByTestId("webhook-submit-btn"));

    await waitFor(() => {
      expect(screen.getByTestId("webhook-error-alert")).toHaveTextContent(
        "Could not create the webhook. Please try again.",
      );
      expect(onError).toHaveBeenCalledWith(
        "Could not create the webhook. Please try again.",
      );
    });
  });

  it("guards against unmounted component state updates", async () => {
    let resolvePromise: (val: { ok: boolean }) => void;
    mockCreateEndpoint.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvePromise = resolve;
        }),
    );

    const { unmount } = render(
      <WebhookForm onCreateEndpoint={mockCreateEndpoint} />,
    );

    fireEvent.change(screen.getByTestId("webhook-url-input"), {
      target: { value: "https://example.com/hook" },
    });
    fireEvent.click(
      screen.getByTestId("webhook-event-checkbox-BOOKING_CONFIRMED"),
    );

    fireEvent.click(screen.getByTestId("webhook-submit-btn"));

    unmount();

    // Resolve after unmount
    resolvePromise!({ ok: true });
    // Expect no crash or unmounted warnings
  });

  it("merges custom className with container", () => {
    render(<WebhookForm className="custom-webhook-form-class" />);

    expect(screen.getByTestId("webhook-form")).toHaveClass(
      "custom-webhook-form-class",
    );
  });
});
