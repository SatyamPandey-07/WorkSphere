import { render, screen, act } from "@testing-library/react";
import { useRateLimit } from "../../hooks/useRateLimit";
import "@testing-library/jest-dom";
import React from "react";

function TestComponent({ endpoint }: { endpoint: "chat" | "book" }) {
  const retryAfter = useRateLimit(endpoint);
  return <div data-testid="retry">{retryAfter}</div>;
}

describe("useRateLimit hook", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("should return 0 initially", () => {
    render(<TestComponent endpoint="chat" />);
    expect(screen.getByTestId("retry")).toHaveTextContent("0");
  });

  it("should update and countdown when rate-limit-triggered is dispatched for matched endpoint", () => {
    render(<TestComponent endpoint="chat" />);

    act(() => {
      window.dispatchEvent(
        new CustomEvent("rate-limit-triggered", {
          detail: { retryAfter: 5, endpoint: "chat" },
        }),
      );
    });

    expect(screen.getByTestId("retry")).toHaveTextContent("5");

    act(() => {
      jest.advanceTimersByTime(1000);
    });
    expect(screen.getByTestId("retry")).toHaveTextContent("4");

    act(() => {
      jest.advanceTimersByTime(4000);
    });
    expect(screen.getByTestId("retry")).toHaveTextContent("0");
  });

  it("should ignore events for different endpoints", () => {
    render(<TestComponent endpoint="book" />);

    act(() => {
      window.dispatchEvent(
        new CustomEvent("rate-limit-triggered", {
          detail: { retryAfter: 5, endpoint: "chat" },
        }),
      );
    });

    expect(screen.getByTestId("retry")).toHaveTextContent("0");
  });
});
