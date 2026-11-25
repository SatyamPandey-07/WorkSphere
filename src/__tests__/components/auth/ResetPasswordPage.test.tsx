import React from "react";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import "@testing-library/jest-dom";
import ResetPasswordPage from "@/app/reset-password/page";
import { useSignIn } from "@clerk/nextjs";

const mockPush = jest.fn();
const mockRefresh = jest.fn();
let mockSearchParams = new URLSearchParams();

jest.mock("next/navigation", () => ({
  useRouter: () => ({
    push: mockPush,
    refresh: mockRefresh,
  }),
  useSearchParams: () => mockSearchParams,
}));

const mockSignInCreate = jest.fn();
const mockAttemptFirstFactor = jest.fn();
const mockSetActive = jest.fn();

jest.mock("@clerk/nextjs", () => ({
  useSignIn: jest.fn(),
}));

describe("ResetPasswordPage Component", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSearchParams = new URLSearchParams("email=test%40example.com");

    (useSignIn as jest.Mock).mockReturnValue({
      isLoaded: true,
      signIn: {
        status: "needs_first_factor",
        create: mockSignInCreate,
        attemptFirstFactor: mockAttemptFirstFactor,
      },
      setActive: mockSetActive,
    });
  });

  it("renders reset password form with code, password, confirm password, and resend button", () => {
    render(<ResetPasswordPage />);

    expect(screen.getByRole("heading", { name: "Reset your password" })).toBeInTheDocument();
    expect(screen.getByTestId("reset-password-code-input")).toBeInTheDocument();
    expect(screen.getByTestId("reset-password-new-password-input")).toBeInTheDocument();
    expect(screen.getByTestId("reset-password-confirm-password-input")).toBeInTheDocument();
    expect(screen.getByTestId("reset-password-resend-btn")).toBeInTheDocument();
  });

  it("shows error when verification code is missing", async () => {
    render(<ResetPasswordPage />);

    fireEvent.change(screen.getByTestId("reset-password-new-password-input"), {
      target: { value: "StrongPassword123!" },
    });
    fireEvent.change(screen.getByTestId("reset-password-confirm-password-input"), {
      target: { value: "StrongPassword123!" },
    });

    fireEvent.submit(screen.getByTestId("reset-password-form"));

    expect(await screen.findByRole("alert")).toHaveTextContent("Please enter the verification code.");
    expect(mockAttemptFirstFactor).not.toHaveBeenCalled();
  });

  it("validates password complexity (min length, uppercase, lowercase, number)", async () => {
    render(<ResetPasswordPage />);

    fireEvent.change(screen.getByTestId("reset-password-code-input"), {
      target: { value: "123456" },
    });
    fireEvent.change(screen.getByTestId("reset-password-new-password-input"), {
      target: { value: "weak" },
    });
    fireEvent.change(screen.getByTestId("reset-password-confirm-password-input"), {
      target: { value: "weak" },
    });

    fireEvent.submit(screen.getByTestId("reset-password-form"));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Password must be at least 8 characters long.",
    );
  });

  it("rejects mismatched password and confirmation", async () => {
    render(<ResetPasswordPage />);

    fireEvent.change(screen.getByTestId("reset-password-code-input"), {
      target: { value: "123456" },
    });
    fireEvent.change(screen.getByTestId("reset-password-new-password-input"), {
      target: { value: "StrongPassword123!" },
    });
    fireEvent.change(screen.getByTestId("reset-password-confirm-password-input"), {
      target: { value: "DifferentPassword123!" },
    });

    fireEvent.submit(screen.getByTestId("reset-password-form"));

    expect(await screen.findByRole("alert")).toHaveTextContent("Passwords do not match.");
  });

  it("successfully verifies OTP and resets password via Clerk's attemptFirstFactor", async () => {
    jest.useFakeTimers();

    mockAttemptFirstFactor.mockResolvedValueOnce({
      status: "complete",
      createdSessionId: "sess_clerk_verified_123",
    });

    render(<ResetPasswordPage />);

    fireEvent.change(screen.getByTestId("reset-password-code-input"), {
      target: { value: "654321" },
    });
    fireEvent.change(screen.getByTestId("reset-password-new-password-input"), {
      target: { value: "StrongPassword123!" },
    });
    fireEvent.change(screen.getByTestId("reset-password-confirm-password-input"), {
      target: { value: "StrongPassword123!" },
    });

    fireEvent.submit(screen.getByTestId("reset-password-form"));

    await waitFor(() => {
      expect(mockAttemptFirstFactor).toHaveBeenCalledWith({
        strategy: "reset_password_email_code",
        code: "654321",
        password: "StrongPassword123!",
      });
    });

    expect(mockSetActive).toHaveBeenCalledWith({ session: "sess_clerk_verified_123" });
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Password reset successful! Redirecting to dashboard...",
    );

    act(() => {
      jest.advanceTimersByTime(1200);
    });

    expect(mockPush).toHaveBeenCalledWith("/dashboard");
    expect(mockRefresh).toHaveBeenCalled();

    jest.useRealTimers();
  });

  it("handles invalid or expired code errors from Clerk", async () => {
    mockAttemptFirstFactor.mockRejectedValueOnce(new Error("Incorrect code entered."));

    render(<ResetPasswordPage />);

    fireEvent.change(screen.getByTestId("reset-password-code-input"), {
      target: { value: "999999" },
    });
    fireEvent.change(screen.getByTestId("reset-password-new-password-input"), {
      target: { value: "StrongPassword123!" },
    });
    fireEvent.change(screen.getByTestId("reset-password-confirm-password-input"), {
      target: { value: "StrongPassword123!" },
    });

    fireEvent.submit(screen.getByTestId("reset-password-form"));

    expect(await screen.findByRole("alert")).toHaveTextContent("Incorrect code entered.");
  });

  it("handles resend code with 60-second cooldown timer", async () => {
    mockSignInCreate.mockResolvedValueOnce({});

    render(<ResetPasswordPage />);

    const resendBtn = screen.getByTestId("reset-password-resend-btn");
    await act(async () => {
      fireEvent.click(resendBtn);
    });

    await waitFor(() => {
      expect(mockSignInCreate).toHaveBeenCalledWith({
        strategy: "reset_password_email_code",
        identifier: "test@example.com",
      });
    });

    expect(resendBtn).toHaveTextContent("Resend code (60s)");
    expect(resendBtn).toBeDisabled();
  });

  it("toggles password visibility", () => {
    render(<ResetPasswordPage />);

    const pwdInput = screen.getByTestId("reset-password-new-password-input");
    const toggleBtn = screen.getByTestId("reset-password-toggle-password-btn");

    expect(pwdInput).toHaveAttribute("type", "password");
    fireEvent.click(toggleBtn);
    expect(pwdInput).toHaveAttribute("type", "text");
    fireEvent.click(toggleBtn);
    expect(pwdInput).toHaveAttribute("type", "password");
  });
});
