import React from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { IdleSessionDialog } from "@/components/auth/IdleSessionDialog";

const mockPush = jest.fn();
jest.mock("next/navigation", () => ({
  useRouter: () => ({
    push: mockPush,
    refresh: jest.fn(),
  }),
}));

describe("IdleSessionDialog Component", () => {
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
      <IdleSessionDialog
        idleTimeoutMs={5000}
        warningDurationMs={3000}
      />,
    );

    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("renders session timeout warning dialog after idle timeout", () => {
    render(
      <IdleSessionDialog
        idleTimeoutMs={5000}
        warningDurationMs={3000}
      />,
    );

    act(() => {
      jest.advanceTimersByTime(5500);
    });

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText(/Session Timeout Warning/i)).toBeInTheDocument();
    expect(screen.getByText(/Stay Signed In/i)).toBeInTheDocument();
    expect(screen.getByText(/Sign Out/i)).toBeInTheDocument();
  });

  it("extends session and closes dialog on clicking 'Stay Signed In'", async () => {
    render(
      <IdleSessionDialog
        idleTimeoutMs={5000}
        warningDurationMs={3000}
      />,
    );

    act(() => {
      jest.advanceTimersByTime(5500);
    });

    const extendBtn = screen.getByText(/Stay Signed In/i);
    await act(async () => {
      fireEvent.click(extendBtn);
    });

    expect(global.fetch).toHaveBeenCalledWith(
      "/api/auth/session/refresh",
      expect.objectContaining({ method: "POST" }),
    );
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("signs out and redirects on clicking 'Sign Out'", async () => {
    render(
      <IdleSessionDialog
        idleTimeoutMs={5000}
        warningDurationMs={3000}
        redirectUrl="/sign-in"
      />,
    );

    act(() => {
      jest.advanceTimersByTime(5500);
    });

    const signOutBtn = screen.getByText(/Sign Out/i);
    await act(async () => {
      fireEvent.click(signOutBtn);
    });

    expect(global.fetch).toHaveBeenCalledWith(
      "/api/auth/session/logout",
      expect.objectContaining({ method: "POST" }),
    );
    expect(mockPush).toHaveBeenCalledWith("/sign-in");
  });
});
