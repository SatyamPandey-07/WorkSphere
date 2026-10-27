import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import PasskeySignInButton, {
  isConditionalMediationSupported,
  performNavigation,
  verifyAuthResponse,
} from "@/components/auth/PasskeySignInButton";
import * as simpleWebAuthn from "@simplewebauthn/browser";

// Mock @simplewebauthn/browser
jest.mock("@simplewebauthn/browser", () => ({
  browserSupportsWebAuthn: jest.fn(() => true),
  startAuthentication: jest.fn(),
  WebAuthnAbortService: {
    cancelCeremony: jest.fn(),
  },
}));

// Mock useCsrfToken
jest.mock("@/hooks/useCsrfToken", () => ({
  useCsrfToken: () => ({ csrfToken: "mock-csrf" }),
}));

// Mock passkeys client helper
jest.mock("@/lib/auth/passkeys/client", () => ({
  savePasskeyChallengeToSession: jest.fn(),
  clearPasskeyChallengeFromSession: jest.fn(),
  setupPasskeyUnloadCleanup: jest.fn(() => jest.fn()),
}));

describe("PasskeySignInButton Component", () => {
  const mockOptions = {
    challenge: "challenge-token-xyz",
    rpId: "localhost",
    allowCredentials: [],
  };

  const mockAuthResponse = {
    id: "cred-123",
    rawId: "raw-123",
    response: {
      clientDataJSON: "client-data",
      authenticatorData: "auth-data",
      signature: "sig",
    },
    type: "public-key",
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (simpleWebAuthn.browserSupportsWebAuthn as jest.Mock).mockReturnValue(true);

    global.fetch = jest.fn((url: RequestInfo | URL) => {
      const u = url.toString();
      if (u.includes("/api/auth/passkey/authenticate/options")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockOptions),
        } as Response);
      }
      if (u.includes("/api/auth/passkey/authenticate/verify")) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              verified: true,
              signInUrl: "/dashboard",
            }),
        } as Response);
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({}),
      } as Response);
    });
  });

  describe("Rendering & Accessibility", () => {
    it("renders nothing when browser does not support WebAuthn", () => {
      (simpleWebAuthn.browserSupportsWebAuthn as jest.Mock).mockReturnValue(false);
      const { container } = render(<PasskeySignInButton conditional={false} />);
      expect(container.firstChild).toBeNull();
    });

    it("renders button with explicit type='button', aria-label, and test id", () => {
      render(<PasskeySignInButton conditional={false} />);

      const button = screen.getByTestId("passkey-signin-button");
      expect(button).toBeInTheDocument();
      expect(button).toHaveAttribute("type", "button");
      expect(button).toHaveAttribute(
        "aria-label",
        "Sign in with Passkey / Biometrics",
      );
      expect(button).toHaveAttribute("aria-busy", "false");
      expect(
        screen.getByTestId("passkey-fingerprint-icon"),
      ).toBeInTheDocument();
    });

    it("does not trigger HTML form submit when clicked inside a form", () => {
      const handleFormSubmit = jest.fn((e) => e.preventDefault());

      render(
        <form onSubmit={handleFormSubmit}>
          <PasskeySignInButton conditional={false} />
        </form>,
      );

      const button = screen.getByTestId("passkey-signin-button");
      fireEvent.click(button);

      expect(handleFormSubmit).not.toHaveBeenCalled();
    });
  });

  describe("Explicit Authentication Flow", () => {
    it("completes passkey verification and triggers onSuccess and onNavigate callbacks", async () => {
      (simpleWebAuthn.startAuthentication as jest.Mock).mockResolvedValue(
        mockAuthResponse,
      );
      const onSuccess = jest.fn();
      const onNavigate = jest.fn();

      render(
        <PasskeySignInButton
          conditional={false}
          onSuccess={onSuccess}
          onNavigate={onNavigate}
        />,
      );

      const button = screen.getByTestId("passkey-signin-button");
      fireEvent.click(button);

      await waitFor(() => {
        expect(simpleWebAuthn.startAuthentication).toHaveBeenCalledWith({
          optionsJSON: mockOptions,
          useBrowserAutofill: false,
        });
        expect(onSuccess).toHaveBeenCalledWith(
          expect.objectContaining({ verified: true, signInUrl: "/dashboard" }),
        );
        expect(onNavigate).toHaveBeenCalledWith("/dashboard");
      });
    });

    it("uses custom redirectTo when server does not supply signInUrl", async () => {
      (simpleWebAuthn.startAuthentication as jest.Mock).mockResolvedValue(
        mockAuthResponse,
      );
      (global.fetch as jest.Mock).mockImplementation((url: RequestInfo | URL) => {
        const u = url.toString();
        if (u.includes("/api/auth/passkey/authenticate/options")) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve(mockOptions),
          } as Response);
        }
        if (u.includes("/api/auth/passkey/authenticate/verify")) {
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({
                verified: true,
                signInUrl: null,
              }),
          } as Response);
        }
        return Promise.resolve({ ok: true, json: () => Promise.resolve({}) } as Response);
      });

      const onNavigate = jest.fn();

      render(
        <PasskeySignInButton
          conditional={false}
          redirectTo="/welcome-portal"
          onNavigate={onNavigate}
        />,
      );

      fireEvent.click(screen.getByTestId("passkey-signin-button"));

      await waitFor(() => {
        expect(onNavigate).toHaveBeenCalledWith("/welcome-portal");
      });
    });

    it("displays error message and fires onError when server verification fails", async () => {
      (simpleWebAuthn.startAuthentication as jest.Mock).mockResolvedValue(
        mockAuthResponse,
      );
      (global.fetch as jest.Mock).mockImplementation((url: RequestInfo | URL) => {
        const u = url.toString();
        if (u.includes("/api/auth/passkey/authenticate/options")) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve(mockOptions),
          } as Response);
        }
        if (u.includes("/api/auth/passkey/authenticate/verify")) {
          return Promise.resolve({
            ok: false,
            json: () =>
              Promise.resolve({
                error: "Invalid biometric signature",
              }),
          } as Response);
        }
        return Promise.resolve({ ok: true, json: () => Promise.resolve({}) } as Response);
      });

      const onError = jest.fn();

      render(<PasskeySignInButton conditional={false} onError={onError} />);

      fireEvent.click(screen.getByTestId("passkey-signin-button"));

      await waitFor(() => {
        const alert = screen.getByTestId("passkey-error");
        expect(alert).toBeInTheDocument();
        expect(alert).toHaveAttribute("role", "alert");
        expect(alert).toHaveTextContent(/Invalid biometric signature/i);
        expect(onError).toHaveBeenCalledWith(
          expect.objectContaining({
            message: "Invalid biometric signature",
          }),
        );
      });
    });

    it("silently suppresses user cancellations (NotAllowedError / AbortError)", async () => {
      const cancelError = new Error("User cancelled passkey ceremony");
      cancelError.name = "NotAllowedError";
      (simpleWebAuthn.startAuthentication as jest.Mock).mockRejectedValue(
        cancelError,
      );

      const onError = jest.fn();

      render(<PasskeySignInButton conditional={false} onError={onError} />);

      fireEvent.click(screen.getByTestId("passkey-signin-button"));

      await waitFor(() => {
        expect(screen.queryByTestId("passkey-error")).toBeNull();
        expect(onError).not.toHaveBeenCalled();
      });
    });
  });

  describe("Utility & Navigation Helpers", () => {
    it("performNavigation calls onNavigate callback when provided", () => {
      const onNavigate = jest.fn();
      performNavigation("/custom-dest", onNavigate);
      expect(onNavigate).toHaveBeenCalledWith("/custom-dest");
    });

    it("performNavigation safely handles absence of onNavigate without error", () => {
      expect(() => performNavigation("/custom-dest")).not.toThrow();
    });

    it("isConditionalMediationSupported handles missing PublicKeyCredential safely", async () => {
      const origPKC = (window as unknown as { PublicKeyCredential?: unknown })
        .PublicKeyCredential;
      delete (window as unknown as { PublicKeyCredential?: unknown })
        .PublicKeyCredential;

      const supported = await isConditionalMediationSupported();
      expect(supported).toBe(false);

      (
        window as unknown as { PublicKeyCredential?: unknown }
      ).PublicKeyCredential = origPKC;
    });
  });
});
