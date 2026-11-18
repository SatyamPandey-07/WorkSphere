import React from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";
import "@testing-library/jest-dom";
import SignUpClient from "@/components/auth/SignUpClient";

const mockPush = jest.fn();
const mockRefresh = jest.fn();

jest.mock("next/navigation", () => ({
  useRouter: () => ({
    push: mockPush,
    refresh: mockRefresh,
  }),
}));

jest.mock("@clerk/nextjs", () => ({
  SignUp: () => <div data-testid="mock-clerk-signup">Clerk SignUp Mock</div>,
}));

jest.mock("@/components/PasskeyFrameNotice", () => ({
  PasskeyFrameNotice: () => <div data-testid="mock-passkey-frame-notice" />,
}));

jest.mock("@/components/ui/PasswordStrengthMeter", () => ({
  PasswordStrengthMeter: ({ password }: { password: string }) => (
    <div data-testid="mock-password-strength-meter">Strength: {password ? "good" : "empty"}</div>
  ),
}));

describe("SignUpClient Component", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    document.cookie = "";
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY = "pk_test_dummy";
  });

  describe("Rendering & Fallback Detection", () => {
    it("renders fallback registration form when publishable key is dummy", () => {
      render(<SignUpClient />);

      expect(screen.getByTestId("sign-up-client")).toBeInTheDocument();
      expect(screen.getByTestId("sign-up-fallback-container")).toBeInTheDocument();
      expect(screen.getByRole("heading", { name: "Create your Account" })).toBeInTheDocument();
      expect(screen.getByTestId("sign-up-name-input")).toBeInTheDocument();
      expect(screen.getByTestId("sign-up-email-input")).toBeInTheDocument();
      expect(screen.getByTestId("sign-up-password-input")).toBeInTheDocument();
    });

    it("renders Clerk container when key is configured and defaultUseFallback is false", () => {
      process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY = "pk_live_real_key_12345";
      render(<SignUpClient defaultUseFallback={false} />);

      expect(screen.getByTestId("sign-up-clerk-container")).toBeInTheDocument();
      expect(screen.getByTestId("mock-clerk-signup")).toBeInTheDocument();

      // Click toggle to fallback
      const useFallbackBtn = screen.getByTestId("sign-up-use-fallback-btn");
      fireEvent.click(useFallbackBtn);

      expect(screen.getByTestId("sign-up-fallback-container")).toBeInTheDocument();
    });
  });

  describe("Password Visibility & Strength Feedback", () => {
    it("toggles password input type and aria-label", () => {
      render(<SignUpClient defaultUseFallback={true} />);

      const passwordInput = screen.getByTestId("sign-up-password-input");
      const toggleBtn = screen.getByTestId("sign-up-toggle-password-btn");

      expect(passwordInput).toHaveAttribute("type", "password");
      expect(toggleBtn).toHaveAttribute("aria-label", "Show password");

      fireEvent.click(toggleBtn);

      expect(passwordInput).toHaveAttribute("type", "text");
      expect(toggleBtn).toHaveAttribute("aria-label", "Hide password");

      fireEvent.click(toggleBtn);

      expect(passwordInput).toHaveAttribute("type", "password");
      expect(toggleBtn).toHaveAttribute("aria-label", "Show password");
    });

    it("displays password strength meter when password text is entered", () => {
      render(<SignUpClient defaultUseFallback={true} />);

      expect(screen.queryByTestId("mock-password-strength-meter")).not.toBeInTheDocument();

      fireEvent.change(screen.getByTestId("sign-up-password-input"), {
        target: { value: "SuperSecurePass123!" },
      });

      expect(screen.getByTestId("mock-password-strength-meter")).toBeInTheDocument();
    });
  });

  describe("Validation & Form Sign-Up Flow", () => {
    it("shows error alert banner when required fields are missing", () => {
      render(<SignUpClient defaultUseFallback={true} />);

      const form = screen.getByTestId("sign-up-form");
      fireEvent.submit(form);

      const alert = screen.getByRole("alert");
      expect(alert).toBeInTheDocument();
      expect(alert).toHaveTextContent("Please fill in all required fields.");
    });

    it("submits valid registration details, sets cookies, triggers callback, and redirects", () => {
      jest.useFakeTimers();
      const onSuccess = jest.fn();

      render(<SignUpClient defaultUseFallback={true} onSuccess={onSuccess} redirectPath="/welcome" />);

      fireEvent.change(screen.getByTestId("sign-up-name-input"), {
        target: { value: "Alex Rivera" },
      });
      fireEvent.change(screen.getByTestId("sign-up-email-input"), {
        target: { value: "alex@example.com" },
      });
      fireEvent.change(screen.getByTestId("sign-up-password-input"), {
        target: { value: "SuperPassword123!" },
      });

      fireEvent.submit(screen.getByTestId("sign-up-form"));

      expect(document.cookie).toContain("worksphere_user_name=Alex%20Rivera");
      expect(document.cookie).toContain("worksphere_user_email=alex%40example.com");

      const successNotice = screen.getByRole("status");
      expect(successNotice).toBeInTheDocument();
      expect(successNotice).toHaveTextContent("Account registered successfully! Redirecting...");

      expect(onSuccess).toHaveBeenCalledWith({
        name: "Alex Rivera",
        email: "alex@example.com",
        isDemo: false,
      });

      act(() => {
        jest.advanceTimersByTime(600);
      });

      expect(mockPush).toHaveBeenCalledWith("/welcome");
      expect(mockRefresh).toHaveBeenCalled();

      jest.useRealTimers();
    });
  });

  describe("Instant Demo Account Registration", () => {
    it("sets demo session cookie on demo button click and redirects", () => {
      jest.useFakeTimers();
      const onSuccess = jest.fn();

      render(<SignUpClient defaultUseFallback={true} onSuccess={onSuccess} />);

      const demoBtn = screen.getByTestId("sign-up-demo-btn");
      fireEvent.click(demoBtn);

      expect(document.cookie).toContain("worksphere_demo_session=true");
      expect(screen.getByTestId("sign-up-success-banner")).toBeInTheDocument();
      expect(onSuccess).toHaveBeenCalledWith({ isDemo: true });

      act(() => {
        jest.advanceTimersByTime(600);
      });

      expect(mockPush).toHaveBeenCalledWith("/");
      expect(mockRefresh).toHaveBeenCalled();

      jest.useRealTimers();
    });
  });

  describe("Unmount Lifecycle & Timer Teardown", () => {
    it("clears redirect timer on unmount before redirect completes", () => {
      jest.useFakeTimers();

      const { unmount } = render(<SignUpClient defaultUseFallback={true} />);

      fireEvent.click(screen.getByTestId("sign-up-demo-btn"));

      // Unmount before 600ms timer completes
      unmount();

      act(() => {
        jest.advanceTimersByTime(600);
      });

      // Should not call router push on unmounted component
      expect(mockPush).not.toHaveBeenCalled();

      jest.useRealTimers();
    });
  });
});
