import "@testing-library/jest-dom";
import React from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { ResendOtpButton } from "@/components/ResendOtpButton";

jest.mock("@/hooks/useCsrfToken", () => ({
  refreshCsrfToken: jest.fn().mockResolvedValue("mock-csrf-token"),
}));

describe("ResendOtpButton", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
    global.fetch = originalFetch;
    jest.clearAllMocks();
  });

  it("renders with initial idle state and text", () => {
    render(<ResendOtpButton email="user@example.com" />);
    const button = screen.getByTestId("resend-otp-button");
    expect(button).toBeInTheDocument();
    expect(button).toHaveTextContent("Resend Verification Code");
    expect(button).not.toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "false");
  });

  it("immediately enters disabled and loading state with an inline spinner on click", async () => {
    let resolveFetch!: (value: Response) => void;
    global.fetch = jest.fn(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve;
        }),
    );

    render(<ResendOtpButton email="user@example.com" />);
    const button = screen.getByTestId("resend-otp-button");

    fireEvent.click(button);

    // Immediately in loading/disabled state upon click
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
    expect(screen.getByTestId("resend-otp-spinner")).toBeInTheDocument();
    expect(screen.getByTestId("resend-otp-loading")).toHaveTextContent(
      "Sending…",
    );

    // Flush microtasks so refreshCsrfToken finishes and fetch is called
    await act(async () => {
      await Promise.resolve();
    });

    // Now resolve fetch
    await act(async () => {
      resolveFetch(
        new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    });

    expect(button).toHaveTextContent(/Resend in 60s/);
    expect(screen.getByText("A new code has been sent.")).toBeInTheDocument();
  });

  it("prevents multiple simultaneous requests with isLoading guard during rapid successive clicks", async () => {
    let resolveFetch!: (value: Response) => void;
    const fetchMock = jest.fn(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve;
        }),
    );
    global.fetch = fetchMock;

    render(<ResendOtpButton email="user@example.com" />);
    const button = screen.getByTestId("resend-otp-button");

    // Perform rapid successive clicks during network latency
    fireEvent.click(button);
    fireEvent.click(button);
    fireEvent.click(button);
    fireEvent.click(button);
    fireEvent.click(button);

    // Flush microtasks
    await act(async () => {
      await Promise.resolve();
    });

    // Only one network dispatch should occur
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Resolve the single request
    await act(async () => {
      resolveFetch(
        new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    });

    // Still only 1 network dispatch
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(button).toBeDisabled();
    expect(button).toHaveTextContent(/Resend in 60s/);
  });

  it("handles 429 rate limit response and clears loading state", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      status: 429,
      ok: false,
      json: jest.fn().mockResolvedValue({ error: "Too many attempts" }),
    });

    render(<ResendOtpButton email="user@example.com" />);
    const button = screen.getByTestId("resend-otp-button");

    await act(async () => {
      fireEvent.click(button);
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.getByText("Too many attempts")).toBeInTheDocument();
    expect(button).not.toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "false");
    expect(screen.queryByTestId("resend-otp-spinner")).not.toBeInTheDocument();
  });

  it("handles network failure gracefully and releases loading guard", async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error("Network failure"));

    render(<ResendOtpButton email="user@example.com" />);
    const button = screen.getByTestId("resend-otp-button");

    await act(async () => {
      fireEvent.click(button);
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(
      screen.getByText(
        "Network error. Please check your connection and try again.",
      ),
    ).toBeInTheDocument();
    expect(button).not.toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "false");
    expect(screen.queryByTestId("resend-otp-spinner")).not.toBeInTheDocument();
  });

  it("counts down cooldown and re-enables button when cooldown reaches 0", async () => {
    global.fetch = jest.fn().mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );

    render(<ResendOtpButton email="user@example.com" cooldownSeconds={3} />);
    const button = screen.getByTestId("resend-otp-button");

    await act(async () => {
      fireEvent.click(button);
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(button).toHaveTextContent("Resend in 3s");
    expect(button).toBeDisabled();

    // Advance 1s
    act(() => {
      jest.advanceTimersByTime(1000);
    });
    expect(button).toHaveTextContent("Resend in 2s");
    expect(button).toBeDisabled();

    // Advance 1s
    act(() => {
      jest.advanceTimersByTime(1000);
    });
    expect(button).toHaveTextContent("Resend in 1s");
    expect(button).toBeDisabled();

    // Advance 1s (cooldown expires)
    act(() => {
      jest.advanceTimersByTime(1000);
    });
    expect(button).toHaveTextContent("Resend Verification Code");
    expect(button).not.toBeDisabled();
  });
});
