/**
 * Screen-reader accessibility tests for toast notifications
 * (WCAG 2.1 SC 4.1.3 — Status Messages).
 */

import React from "react";
import { render, screen, act, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import { ToastProvider, useToast } from "@/components/ui/Toast";

jest.mock("lucide-react", () => ({
  X: (props: any) => <svg data-testid="icon-x" {...props} />,
  CheckCircle2: (props: any) => <svg data-testid="icon-check" {...props} />,
  AlertCircle: (props: any) => (
    <svg data-testid="icon-alert-circle" {...props} />
  ),
  AlertTriangle: (props: any) => (
    <svg data-testid="icon-alert-triangle" {...props} />
  ),
  Info: (props: any) => <svg data-testid="icon-info" {...props} />,
}));

jest.mock("@/lib/utils", () => ({
  cn: (...args: unknown[]) => args.filter(Boolean).join(" "),
}));

function Triggers() {
  const { toast } = useToast();
  return (
    <>
      <input aria-label="Search venues" />
      <button onClick={() => toast("Saved to favorites", "success")}>
        Success
      </button>
      <button onClick={() => toast("Network unstable", "warning")}>
        Warning
      </button>
      <button onClick={() => toast("Booking failed", "error")}>Error</button>
      <button
        onClick={() =>
          toast("Undo removal?", "warning", { label: "Undo", onClick: jest.fn() })
        }
      >
        Action
      </button>
    </>
  );
}

function renderWithProvider() {
  return render(
    <ToastProvider>
      <Triggers />
    </ToastProvider>,
  );
}

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  jest.runOnlyPendingTimers();
  jest.useRealTimers();
});

describe("Toast accessibility", () => {
  it("keeps polite and assertive live regions mounted before any toast appears", () => {
    renderWithProvider();

    const polite = screen.getByTestId("toast-region-polite");
    const assertive = screen.getByTestId("toast-region-assertive");

    expect(polite).toHaveAttribute("aria-live", "polite");
    expect(assertive).toHaveAttribute("aria-live", "assertive");
    expect(polite).toBeEmptyDOMElement();
    expect(assertive).toBeEmptyDOMElement();
  });

  it.each([
    ["Success", "Saved to favorites"],
    ["Warning", "Network unstable"],
  ])(
    "announces %s toasts politely via role=status with aria-atomic",
    (trigger, message) => {
      renderWithProvider();
      fireEvent.click(screen.getByText(trigger));

      const toast = screen.getByRole("status");
      expect(toast).toHaveTextContent(message);
      expect(toast).toHaveAttribute("aria-live", "polite");
      expect(toast).toHaveAttribute("aria-atomic", "true");
      expect(screen.getByTestId("toast-region-polite")).toContainElement(toast);
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    },
  );

  it("announces error toasts assertively via role=alert with aria-atomic", () => {
    renderWithProvider();
    fireEvent.click(screen.getByText("Error"));

    const toast = screen.getByRole("alert");
    expect(toast).toHaveTextContent("Booking failed");
    expect(toast).toHaveAttribute("aria-live", "assertive");
    expect(toast).toHaveAttribute("aria-atomic", "true");
    expect(screen.getByTestId("toast-region-assertive")).toContainElement(
      toast,
    );
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("keeps rate-limit countdown errors polite to avoid interrupting every tick", () => {
    renderWithProvider();

    act(() => {
      window.dispatchEvent(
        new CustomEvent("rate-limit-triggered", {
          detail: { retryAfter: 5, endpoint: "chat" },
        }),
      );
    });

    const toast = screen.getByRole("status");
    expect(toast).toHaveTextContent(/Rate limit reached/);
    expect(toast).toHaveAttribute("aria-live", "polite");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("routes simultaneous toasts to the correct region", () => {
    renderWithProvider();
    fireEvent.click(screen.getByText("Success"));
    fireEvent.click(screen.getByText("Error"));

    expect(screen.getAllByRole("status")).toHaveLength(1);
    expect(screen.getAllByRole("alert")).toHaveLength(1);
  });

  it("hides decorative icons from assistive technology", () => {
    renderWithProvider();
    fireEvent.click(screen.getByText("Success"));

    expect(screen.getByTestId("icon-check")).toHaveAttribute(
      "aria-hidden",
      "true",
    );
  });

  it("exposes an accessible name on the dismiss button", () => {
    renderWithProvider();
    fireEvent.click(screen.getByText("Success"));

    expect(
      screen.getByRole("button", { name: "Dismiss notification" }),
    ).toBeInTheDocument();
  });

  it.each(["Success", "Error", "Action"])(
    "does not steal keyboard focus from the active input (%s toast)",
    (trigger) => {
      renderWithProvider();
      const input = screen.getByLabelText("Search venues");
      input.focus();
      expect(input).toHaveFocus();

      // HTMLElement.click() dispatches the handler without moving focus.
      act(() => {
        screen.getByText(trigger).click();
      });
      act(() => {
        jest.advanceTimersByTime(100);
      });

      expect(
        screen.getByText(/Saved to favorites|Booking failed|Undo removal\?/),
      ).toBeInTheDocument();
      expect(input).toHaveFocus();
    },
  );

  it("does not move focus when a toast is triggered by a background event", () => {
    renderWithProvider();
    const input = screen.getByLabelText("Search venues");
    input.focus();

    act(() => {
      window.dispatchEvent(
        new CustomEvent("rate-limit-triggered", {
          detail: { retryAfter: 3, endpoint: "chat" },
        }),
      );
    });

    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(input).toHaveFocus();
  });
});
