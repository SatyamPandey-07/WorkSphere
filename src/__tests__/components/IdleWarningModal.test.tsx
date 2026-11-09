import React from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { IdleWarningModal } from "@/components/auth/IdleWarningModal";

const mockPush = jest.fn();
jest.mock("next/navigation", () => ({
  useRouter: () => ({
    push: mockPush,
    refresh: jest.fn(),
  }),
}));

describe("IdleWarningModal Component", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockPush.mockClear();
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true }),
    });
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  it("does not render when user is actively interacting", () => {
    render(
      <IdleWarningModal
        idleTimeoutMs={5000}
        warningDurationMs={3000}
      />,
    );

    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("renders warning modal with live countdown exactly before idle timeout", () => {
    render(
      <IdleWarningModal
        idleTimeoutMs={5000}
        warningDurationMs={3000}
      />,
    );

    act(() => {
      jest.advanceTimersByTime(5500);
    });

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText(/Session Timeout Warning/i)).toBeInTheDocument();
    expect(screen.getByText(/Stay Logged In/i)).toBeInTheDocument();
    expect(screen.getByText(/Sign Out/i)).toBeInTheDocument();
    expect(screen.getByText(/3s/i)).toBeInTheDocument();
  });

  it("refreshes session and resets idle timer when 'Stay Logged In' is clicked", async () => {
    render(
      <IdleWarningModal
        idleTimeoutMs={5000}
        warningDurationMs={3000}
      />,
    );

    act(() => {
      jest.advanceTimersByTime(5500);
    });

    const stayLoggedInBtn = screen.getByText(/Stay Logged In/i);
    await act(async () => {
      fireEvent.click(stayLoggedInBtn);
    });

    expect(global.fetch).toHaveBeenCalledWith(
      "/api/auth/session/refresh",
      expect.objectContaining({ method: "POST" }),
    );
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("safely logs out and redirects when countdown finishes without user action", async () => {
    render(
      <IdleWarningModal
        idleTimeoutMs={5000}
        warningDurationMs={3000}
        redirectUrl="/sign-in"
      />,
    );

    // Trigger warning modal
    act(() => {
      jest.advanceTimersByTime(5500);
    });
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    // Advance through the entire countdown (3000ms)
    await act(async () => {
      jest.advanceTimersByTime(3500);
    });

    expect(global.fetch).toHaveBeenCalledWith(
      "/api/auth/session/logout",
      expect.objectContaining({ method: "POST" }),
    );
    expect(mockPush).toHaveBeenCalledWith("/sign-in");
  });
});
