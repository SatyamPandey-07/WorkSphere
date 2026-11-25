import React from "react";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import "@testing-library/jest-dom";
import ForgotPasswordPage from "@/app/forgot-password/page";
import { useSignIn } from "@clerk/nextjs";

const mockPush = jest.fn();

jest.mock("next/navigation", () => ({
  useRouter: () => ({
    push: mockPush,
  }),
}));

const mockSignInCreate = jest.fn();

jest.mock("@clerk/nextjs", () => ({
  useSignIn: jest.fn(),
}));

describe("ForgotPasswordPage Component", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (useSignIn as jest.Mock).mockReturnValue({
      isLoaded: true,
      signIn: {
        create: mockSignInCreate,
      },
    });
  });

  it("renders forgot password form with accessible inputs and controls", () => {
    render(<ForgotPasswordPage />);

    expect(screen.getByRole("heading", { name: "Forgot your password?" })).toBeInTheDocument();
    expect(screen.getByTestId("forgot-password-email-input")).toBeInTheDocument();
    expect(screen.getByTestId("forgot-password-submit-btn")).toBeInTheDocument();
    expect(screen.getByTestId("forgot-password-back-to-signin")).toHaveAttribute("href", "/sign-in");
  });

  it("displays client error when submitting an empty email", async () => {
    render(<ForgotPasswordPage />);

    fireEvent.submit(screen.getByTestId("forgot-password-form"));

    expect(await screen.findByRole("alert")).toHaveTextContent("Please enter your email address.");
    expect(mockSignInCreate).not.toHaveBeenCalled();
  });

  it("initiates native Clerk password recovery with reset_password_email_code strategy on valid submit", async () => {
    jest.useFakeTimers();
    mockSignInCreate.mockResolvedValueOnce({ status: "needs_first_factor" });

    render(<ForgotPasswordPage />);

    fireEvent.change(screen.getByTestId("forgot-password-email-input"), {
      target: { value: "developer@example.com" },
    });

    fireEvent.submit(screen.getByTestId("forgot-password-form"));

    await waitFor(() => {
      expect(mockSignInCreate).toHaveBeenCalledWith({
        strategy: "reset_password_email_code",
        identifier: "developer@example.com",
      });
    });

    expect(await screen.findByRole("status")).toHaveTextContent(
      "Verification code sent! Redirecting to password reset...",
    );

    act(() => {
      jest.advanceTimersByTime(1200);
    });

    expect(mockPush).toHaveBeenCalledWith("/reset-password?email=developer%40example.com");
    jest.useRealTimers();
  });

  it("handles Clerk API response errors gracefully and displays error banner", async () => {
    mockSignInCreate.mockRejectedValueOnce({
      errors: [
        {
          message: "Identifier not found.",
          longMessage: "Couldn't find an account matching that email.",
        },
      ],
      clerkError: true,
    });

    render(<ForgotPasswordPage />);

    fireEvent.change(screen.getByTestId("forgot-password-email-input"), {
      target: { value: "unknown@example.com" },
    });

    fireEvent.submit(screen.getByTestId("forgot-password-form"));

    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });

  it("handles uninitialized Clerk service state safely", async () => {
    (useSignIn as jest.Mock).mockReturnValue({
      isLoaded: false,
      signIn: null,
    });

    render(<ForgotPasswordPage />);

    fireEvent.change(screen.getByTestId("forgot-password-email-input"), {
      target: { value: "user@example.com" },
    });

    fireEvent.submit(screen.getByTestId("forgot-password-form"));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Authentication service is initializing. Please try again in a moment.",
    );
    expect(mockSignInCreate).not.toHaveBeenCalled();
  });
});
