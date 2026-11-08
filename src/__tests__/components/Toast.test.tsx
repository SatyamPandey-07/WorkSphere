/**
 * Unit tests for ToastItem behaviour including countdowns, types, and pause-on-hover.
 */

import React from "react";
import { render, screen, act, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import { ToastProvider, useToast } from "@/components/ui/Toast";

// Mock lucide-react icons
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

// Mock cn helper
jest.mock("@/lib/utils", () => ({
  cn: (...args: unknown[]) => args.filter(Boolean).join(" "),
}));

function TestButton() {
  const { toast } = useToast();
  return (
    <button onClick={() => toast("Test message", "success")}>Show Toast</button>
  );
}

function ErrorToastButton() {
  const { toast } = useToast();
  return (
    <button onClick={() => toast("Error occurred", "error")}>Show Error</button>
  );
}

function ActionToastButton() {
  const { toast } = useToast();
  return (
    <button
      onClick={() =>
        toast("Undo?", "warning", { label: "Undo", onClick: jest.fn() })
      }
    >
      Show Action
    </button>
  );
}

function Wrapper({ children }: { children: React.ReactNode }) {
  return <ToastProvider>{children}</ToastProvider>;
}

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  jest.runOnlyPendingTimers();
  jest.useRealTimers();
});

describe("Toast functionality", () => {
  it("auto-dismisses after 4 seconds when not hovered", () => {
    render(
      <Wrapper>
        <TestButton />
      </Wrapper>,
    );

    fireEvent.click(screen.getByText("Show Toast"));
    expect(screen.getByText("Test message")).toBeInTheDocument();

    act(() => {
      jest.advanceTimersByTime(4000);
    });

    expect(screen.queryByText("Test message")).not.toBeInTheDocument();
  });

  it("pauses dismissal on mouseenter and resumes on mouseleave", () => {
    render(
      <Wrapper>
        <TestButton />
      </Wrapper>,
    );

    fireEvent.click(screen.getByText("Show Toast"));
    const toast = screen.getByText("Test message").closest("[role='status']")!;

    // Advance partway, then hover
    act(() => {
      jest.advanceTimersByTime(2000);
    });
    fireEvent.mouseEnter(toast);

    // Advance past original 4s mark — should still be visible
    act(() => {
      jest.advanceTimersByTime(3000);
    });
    expect(screen.getByText("Test message")).toBeInTheDocument();

    // Leave hover, new 4s timer starts
    fireEvent.mouseLeave(toast);
    act(() => {
      jest.advanceTimersByTime(4000);
    });
    expect(screen.queryByText("Test message")).not.toBeInTheDocument();
  });

  it("pauses the timer on focus and restarts on blur", () => {
    render(
      <Wrapper>
        <TestButton />
      </Wrapper>,
    );

    fireEvent.click(screen.getByText("Show Toast"));
    const toastEl = screen
      .getByText("Test message")
      .closest("[role='status']")!;

    act(() => {
      jest.advanceTimersByTime(500);
      fireEvent.focus(toastEl);
    });

    // Advance past 4-second mark — toast must be held by focus
    act(() => {
      jest.advanceTimersByTime(5000);
    });
    expect(screen.getByText("Test message")).toBeInTheDocument();

    // Blur restarts the timer
    act(() => {
      fireEvent.blur(toastEl);
    });

    act(() => {
      jest.advanceTimersByTime(4001);
    });
    expect(screen.queryByText("Test message")).not.toBeInTheDocument();
  });

  it("dismisses immediately when dismiss button is clicked", () => {
    render(
      <Wrapper>
        <TestButton />
      </Wrapper>,
    );

    fireEvent.click(screen.getByText("Show Toast"));
    const dismissBtn = screen.getByLabelText("Dismiss notification");
    fireEvent.click(dismissBtn);

    expect(screen.queryByText("Test message")).not.toBeInTheDocument();
  });

  it("renders success toast with correct icon color", () => {
    render(
      <Wrapper>
        <TestButton />
      </Wrapper>,
    );

    fireEvent.click(screen.getByText("Show Toast"));
    const icon = screen
      .getByText("Test message")
      .closest("[role='status']")!
      .querySelector(".text-green-500");
    expect(icon).toBeInTheDocument();
  });

  it("renders error toast with correct icon color", () => {
    render(
      <Wrapper>
        <ErrorToastButton />
      </Wrapper>,
    );

    fireEvent.click(screen.getByText("Show Error"));
    const icon = screen
      .getByText("Error occurred")
      .closest("[role='alert']")!
      .querySelector(".text-red-500");
    expect(icon).toBeInTheDocument();
  });

  it("renders action button when action is provided", () => {
    render(
      <Wrapper>
        <ActionToastButton />
      </Wrapper>,
    );

    fireEvent.click(screen.getByText("Show Action"));
    expect(screen.getByText("Undo")).toBeInTheDocument();
  });

  it("displays rate limit retry toast on rate-limit-triggered custom event and counts down", async () => {
    render(
      <Wrapper>
        <div />
      </Wrapper>,
    );

    act(() => {
      window.dispatchEvent(
        new CustomEvent("rate-limit-triggered", {
          detail: { retryAfter: 3, endpoint: "chat" },
        }),
      );
    });

    expect(
      screen.getByText("Rate limit reached. Try again in 3 seconds"),
    ).toBeInTheDocument();

    act(() => {
      jest.advanceTimersByTime(1000);
    });
    expect(
      screen.getByText("Rate limit reached. Try again in 2 seconds"),
    ).toBeInTheDocument();

    act(() => {
      jest.advanceTimersByTime(1000);
    });
    expect(
      screen.getByText("Rate limit reached. Try again in 1 second"),
    ).toBeInTheDocument();

    act(() => {
      jest.advanceTimersByTime(1000);
    });
    expect(screen.queryByText(/Rate limit reached/)).not.toBeInTheDocument();
  });

  it("updates and deduplicates rate limit toast on subsequent events", async () => {
    render(
      <Wrapper>
        <div />
      </Wrapper>,
    );

    act(() => {
      window.dispatchEvent(
        new CustomEvent("rate-limit-triggered", {
          detail: { retryAfter: 5, endpoint: "chat" },
        }),
      );
    });

    expect(
      screen.getByText("Rate limit reached. Try again in 5 seconds"),
    ).toBeInTheDocument();

    act(() => {
      window.dispatchEvent(
        new CustomEvent("rate-limit-triggered", {
          detail: { retryAfter: 10, endpoint: "book" },
        }),
      );
    });

    // Should update existing toast rather than spawning a duplicate
    const toasts = screen.getAllByRole("status");
    expect(toasts.length).toBe(1);
    expect(
      screen.getByText("Rate limit reached. Try again in 10 seconds"),
    ).toBeInTheDocument();
  });

  it("auto-dismisses warning toasts after 5 seconds", () => {
    function WarningButton() {
      const { toast } = useToast();
      return (
        <button onClick={() => toast("Network unstable warning", "warning")}>
          Show Warning
        </button>
      );
    }

    render(
      <Wrapper>
        <WarningButton />
      </Wrapper>,
    );

    fireEvent.click(screen.getByText("Show Warning"));
    expect(screen.getByText("Network unstable warning")).toBeInTheDocument();

    // At 4 seconds, warning toast should still be visible
    act(() => {
      jest.advanceTimersByTime(4000);
    });
    expect(screen.getByText("Network unstable warning")).toBeInTheDocument();

    // At 5 seconds, warning toast should be dismissed
    act(() => {
      jest.advanceTimersByTime(1000);
    });
    expect(
      screen.queryByText("Network unstable warning"),
    ).not.toBeInTheDocument();
  });

  it("auto-dismisses info toasts after 5 seconds", () => {
    function InfoButton() {
      const { toast } = useToast();
      return (
        <button onClick={() => toast("Sync triggered info", "info")}>
          Show Info
        </button>
      );
    }

    render(
      <Wrapper>
        <InfoButton />
      </Wrapper>,
    );

    fireEvent.click(screen.getByText("Show Info"));
    expect(screen.getByText("Sync triggered info")).toBeInTheDocument();

    // At 4 seconds, info toast should still be visible
    act(() => {
      jest.advanceTimersByTime(4000);
    });
    expect(screen.getByText("Sync triggered info")).toBeInTheDocument();

    // At 5 seconds, info toast should be dismissed
    act(() => {
      jest.advanceTimersByTime(1000);
    });
    expect(screen.queryByText("Sync triggered info")).not.toBeInTheDocument();
  });

  it("auto-dismisses with custom duration when duration option is provided", () => {
    function CustomDurationButton() {
      const { toast } = useToast();
      return (
        <button
          onClick={() =>
            toast("Custom duration toast", "success", { duration: 2500 })
          }
        >
          Show Custom
        </button>
      );
    }

    render(
      <Wrapper>
        <CustomDurationButton />
      </Wrapper>,
    );

    fireEvent.click(screen.getByText("Show Custom"));
    expect(screen.getByText("Custom duration toast")).toBeInTheDocument();

    // At 2400ms, should still be in the document
    act(() => {
      jest.advanceTimersByTime(2400);
    });
    expect(screen.getByText("Custom duration toast")).toBeInTheDocument();

    // At 2500ms, should be dismissed
    act(() => {
      jest.advanceTimersByTime(100);
    });
    expect(screen.queryByText("Custom duration toast")).not.toBeInTheDocument();
  });
});
