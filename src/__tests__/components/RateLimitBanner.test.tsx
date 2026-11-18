import React from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";
import "@testing-library/jest-dom";
import {
  RateLimitBanner,
  formatEndpointName,
} from "@/components/ui/RateLimitBanner";

describe("formatEndpointName", () => {
  it("formats chat endpoint properly", () => {
    expect(formatEndpointName("chat")).toBe("AI Assistant");
  });

  it("formats book endpoint properly", () => {
    expect(formatEndpointName("book")).toBe("Reservations");
  });

  it("formats /api/ endpoints properly", () => {
    expect(formatEndpointName("/api/venues/search")).toBe("venues search");
  });

  it("returns fallback for null or empty string", () => {
    expect(formatEndpointName("")).toBe("General API");
    expect(formatEndpointName(null)).toBe("General API");
    expect(formatEndpointName(undefined)).toBe("General API");
    expect(formatEndpointName("   ")).toBe("General API");
  });

  it("returns custom endpoint name when unknown", () => {
    expect(formatEndpointName("custom-service")).toBe("custom-service");
  });
});

describe("RateLimitBanner Component", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it("does not render initially when no rate limit event occurred", () => {
    render(<RateLimitBanner />);
    expect(screen.queryByTestId("rate-limit-banner")).not.toBeInTheDocument();
  });

  it("renders when rate-limit-triggered event is dispatched", () => {
    render(<RateLimitBanner />);

    act(() => {
      window.dispatchEvent(
        new CustomEvent("rate-limit-triggered", {
          detail: {
            endpoint: "chat",
            bucket: "ai",
            retryAfter: 30,
            willRetry: true,
          },
        }),
      );
    });

    expect(screen.getByTestId("rate-limit-banner")).toBeInTheDocument();
    expect(screen.getByTestId("rate-limit-endpoint-badge")).toHaveTextContent(
      "AI Assistant",
    );
    expect(screen.getByTestId("rate-limit-countdown")).toHaveTextContent("30s");
  });

  it("counts down remaining seconds every second and clears upon reaching zero", () => {
    const onCountdownComplete = jest.fn();
    const clearedListener = jest.fn();
    window.addEventListener("rate-limit-cleared", clearedListener);

    render(<RateLimitBanner onCountdownComplete={onCountdownComplete} />);

    act(() => {
      window.dispatchEvent(
        new CustomEvent("rate-limit-triggered", {
          detail: {
            endpoint: "book",
            bucket: "reservations",
            retryAfter: 3,
            willRetry: false,
          },
        }),
      );
    });

    expect(screen.getByTestId("rate-limit-countdown")).toHaveTextContent("3s");

    // Advance 1s
    act(() => {
      jest.advanceTimersByTime(1000);
    });
    expect(screen.getByTestId("rate-limit-countdown")).toHaveTextContent("2s");

    // Advance 2s more to finish
    act(() => {
      jest.advanceTimersByTime(2000);
    });

    expect(onCountdownComplete).toHaveBeenCalledTimes(1);
    expect(clearedListener).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("rate-limit-banner")).not.toBeInTheDocument();

    window.removeEventListener("rate-limit-cleared", clearedListener);
  });

  it("hides banner when dismiss button is clicked", () => {
    render(<RateLimitBanner showDismiss={true} />);

    act(() => {
      window.dispatchEvent(
        new CustomEvent("rate-limit-triggered", {
          detail: {
            endpoint: "chat",
            bucket: "ai",
            retryAfter: 45,
          },
        }),
      );
    });

    expect(screen.getByTestId("rate-limit-banner")).toBeInTheDocument();

    const dismissBtn = screen.getByTestId("rate-limit-dismiss");
    fireEvent.click(dismissBtn);

    expect(screen.queryByTestId("rate-limit-banner")).not.toBeInTheDocument();
  });
});
