import React from "react";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import "@testing-library/jest-dom";
import SignInClient from "@/components/auth/SignInClient";
import { WebAuthnAbortService } from "@simplewebauthn/browser";

const mockPush = jest.fn();
const mockRefresh = jest.fn();

jest.mock("next/navigation", () => ({
  useRouter: () => ({
    push: mockPush,
    refresh: mockRefresh,
  }),
}));

jest.mock("@clerk/nextjs", () => ({
  SignIn: () => <div data-testid="mock-clerk-signin">Clerk SignIn Mock</div>,
}));

jest.mock("@/components/PasskeyFrameNotice", () => ({
  PasskeyFrameNotice: () => <div data-testid="mock-passkey-frame-notice" />,
}));

jest.mock("@/components/auth/PasskeySignInButton", () => ({
  PasskeySignInButton: () => <button data-testid="mock-passkey-signin-btn">Passkey Sign In</button>,
}));

jest.mock("@simplewebauthn/browser", () => ({
  WebAuthnAbortService: {
    cancelCeremony: jest.fn(),
  },
}));

describe("SignInClient Component", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    document.cookie = "";
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY = "pk_test_dummy";
  });

  describe("Rendering & Fallback Detection", () => {
    it("renders fallback authentication form when publishable key is dummy", () => {
      render(<SignInClient />);

      expect(screen.getByTestId("sign-in-client")).toBeInTheDocument();
      expect(screen.getByTestId("sign-in-fallback-container")).toBeInTheDocument();
      expect(screen.getByRole("heading", { name: "Sign In to WorkSphere" })).toBeInTheDocument();
      expect(screen.getByTestId("sign-in-email-input")).toBeInTheDocument();
      expect(screen.getByTestId("sign-in-password-input")).toBeInTheDocument();
    });

    it("renders Clerk container when key is configured and defaultUseFallback is false", () => {
      process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY = "pk_live_real_key_12345";
      render(<SignInClient defaultUseFallback={false} />);

      expect(screen.getByTestId("sign-in-clerk-container")).toBeInTheDocument();
      expect(screen.getByTestId("mock-clerk-signin")).toBeInTheDocument();

      // Click toggle to fallback
      const useFallbackBtn = screen.getByTestId("sign-in-use-fallback-btn");
      fireEvent.click(useFallbackBtn);

      expect(screen.getByTestId("sign-in-fallback-container")).toBeInTheDocument();
    });
  });

  describe("Password Visibility Toggling", () => {
    it("toggles password input type and aria-label", () => {
      render(<SignInClient defaultUseFallback={true} />);

      const passwordInput = screen.getByTestId("sign-in-password-input");
      const toggleBtn = screen.getByTestId("sign-in-toggle-password-btn");

      expect(passwordInput).toHaveAttribute("type", "password");
      expect(toggleBtn).toHaveAttribute("aria-label", "Show password");

      fireEvent.click(toggleBtn);

      expect(passwordInput).toHaveAttribute("type", "text");
      expect(toggleBtn).toHaveAttribute("aria-label", "Hide password");

      fireEvent.click(toggleBtn);

      expect(passwordInput).toHaveAttribute("type", "password");
      expect(toggleBtn).toHaveAttribute("aria-label", "Show password");
    });
  });

  describe("Validation & Form Sign-In Flow", () => {
    it("shows error banner when submitted with empty fields", () => {
      render(<SignInClient defaultUseFallback={true} />);

      const form = screen.getByTestId("sign-in-form");
      fireEvent.submit(form);

      const alert = screen.getByRole("alert");
      expect(alert).toBeInTheDocument();
      expect(alert).toHaveTextContent("Please enter both email and password.");
    });

    it("submits valid credentials, sets cookie, cancels WebAuthn ceremony, and redirects", () => {
      jest.useFakeTimers();
      const onSuccess = jest.fn();

      render(<SignInClient defaultUseFallback={true} onSuccess={onSuccess} redirectPath="/dashboard" />);

      fireEvent.change(screen.getByTestId("sign-in-email-input"), {
        target: { value: "developer@example.com" },
      });
      fireEvent.change(screen.getByTestId("sign-in-password-input"), {
        target: { value: "Secret123!" },
      });

      fireEvent.submit(screen.getByTestId("sign-in-form"));

      expect(WebAuthnAbortService.cancelCeremony).toHaveBeenCalled();
      expect(document.cookie).toContain("worksphere_user_email=developer%40example.com");

      const successNotice = screen.getByRole("status");
      expect(successNotice).toBeInTheDocument();
      expect(successNotice).toHaveTextContent("Authentication successful! Redirecting to workspace finder...");

      expect(onSuccess).toHaveBeenCalledWith({ email: "developer@example.com", isDemo: false });

      act(() => {
        jest.advanceTimersByTime(600);
      });

      expect(mockPush).toHaveBeenCalledWith("/dashboard");
      expect(mockRefresh).toHaveBeenCalled();

      jest.useRealTimers();
    });
  });

  describe("Instant Demo Login Flow", () => {
    it("logs in with demo session on button click and redirects", () => {
      jest.useFakeTimers();
      const onSuccess = jest.fn();

      render(<SignInClient defaultUseFallback={true} onSuccess={onSuccess} />);

      const demoBtn = screen.getByTestId("sign-in-demo-btn");
      fireEvent.click(demoBtn);

      expect(WebAuthnAbortService.cancelCeremony).toHaveBeenCalled();
      expect(document.cookie).toContain("worksphere_demo_session=true");

      expect(screen.getByTestId("sign-in-success-banner")).toBeInTheDocument();
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

      const { unmount } = render(<SignInClient defaultUseFallback={true} />);

      fireEvent.click(screen.getByTestId("sign-in-demo-btn"));

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
