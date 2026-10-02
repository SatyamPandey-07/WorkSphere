import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import {
  PasskeySignInButton,
  isConditionalMediationSupported,
} from "@/components/auth/PasskeySignInButton";
import { SignInClient } from "@/components/auth/SignInClient";
import * as simpleWebAuthn from "@simplewebauthn/browser";

// Ensure setImmediate is available on window in JSDOM environment,
// allowing React Scheduler to use setImmediate instead of creating an unclosed MessageChannel
if (
  typeof window !== "undefined" &&
  typeof (window as unknown as { setImmediate?: unknown }).setImmediate === "undefined" &&
  typeof global.setImmediate === "function"
) {
  (window as unknown as { setImmediate: unknown }).setImmediate = global.setImmediate;
}

jest.mock("@clerk/nextjs", () => ({
  SignIn: () => <div data-testid="clerk-sign-in">Clerk Sign In</div>,
  useUser: () => ({
    user: { id: "test-user", imageUrl: "https://example.com/avatar.png" },
    isSignedIn: true,
    isLoaded: true,
  }),
  useAuth: () => ({
    userId: "test-user",
    isSignedIn: true,
  }),
}));

jest.mock("next/navigation", () => ({
  useRouter: () => ({
    push: jest.fn(),
    refresh: jest.fn(),
  }),
}));

let activeAbortController: AbortController | null = null;

function createCancellablePendingAuth() {
  const controller = new AbortController();
  activeAbortController = controller;
  return new Promise((resolve, reject) => {
    controller.signal.addEventListener("abort", () => {
      const err = new Error("The operation was aborted");
      err.name = "AbortError";
      reject(err);
    });
  });
}

jest.mock("@simplewebauthn/browser", () => ({
  browserSupportsWebAuthn: jest.fn(),
  startAuthentication: jest.fn(),
  WebAuthnAbortService: {
    cancelCeremony: jest.fn(() => {
      if (activeAbortController) {
        activeAbortController.abort();
        activeAbortController = null;
      }
    }),
  },
}));

describe("Passkey Conditional UI & WebAuthn Autofill", () => {
  const mockOptions = {
    challenge: "test_challenge_123",
    rpId: "localhost",
    allowCredentials: [],
  };
  const mockAuthResponse = {
    id: "mock_credential_id",
    rawId: "mock_raw_id",
    response: {
      clientDataJSON: "mock_client_data_json",
      authenticatorData: "mock_authenticator_data",
      signature: "mock_signature",
    },
    type: "public-key",
  };

  beforeEach(() => {
    jest.clearAllMocks();
    activeAbortController = null;

    (simpleWebAuthn.browserSupportsWebAuthn as jest.Mock).mockReturnValue(true);

    (simpleWebAuthn.WebAuthnAbortService.cancelCeremony as jest.Mock).mockImplementation(() => {
      if (activeAbortController) {
        activeAbortController.abort();
        activeAbortController = null;
      }
    });

    // Mock global fetch for passkey endpoints
    global.fetch = jest.fn((url: string | URL | Request) => {
      const urlStr = url.toString();
      if (urlStr.includes("/api/auth/passkey/authenticate/options")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockOptions),
        } as Response);
      }
      if (urlStr.includes("/api/auth/passkey/authenticate/verify")) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              verified: true,
              signInUrl: "/dashboard",
              user: { id: "u1" },
            }),
        } as Response);
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({}),
      } as Response);
    }) as jest.Mock;
  });

  afterEach(() => {
    if (activeAbortController) {
      activeAbortController.abort();
      activeAbortController = null;
    }
  });

  describe("isConditionalMediationSupported helper", () => {
    it("returns true when browser supports WebAuthn and conditional mediation is available", async () => {
      (simpleWebAuthn.browserSupportsWebAuthn as jest.Mock).mockReturnValue(
        true,
      );
      (window as unknown as { PublicKeyCredential?: unknown }).PublicKeyCredential = {
        isConditionalMediationAvailable: jest.fn().mockResolvedValue(true),
      };

      const supported = await isConditionalMediationSupported();
      expect(supported).toBe(true);
    });

    it("returns false when WebAuthn is unsupported by browser", async () => {
      (simpleWebAuthn.browserSupportsWebAuthn as jest.Mock).mockReturnValue(
        false,
      );
      (window as unknown as { PublicKeyCredential?: unknown }).PublicKeyCredential = {
        isConditionalMediationAvailable: jest.fn().mockResolvedValue(true),
      };

      const supported = await isConditionalMediationSupported();
      expect(supported).toBe(false);
    });

    it("returns false when PublicKeyCredential is not defined", async () => {
      delete (window as unknown as { PublicKeyCredential?: unknown }).PublicKeyCredential;

      const supported = await isConditionalMediationSupported();
      expect(supported).toBe(false);
    });

    it("returns false when isConditionalMediationAvailable is not a function", async () => {
      (window as unknown as { PublicKeyCredential?: unknown }).PublicKeyCredential = {};

      const supported = await isConditionalMediationSupported();
      expect(supported).toBe(false);
    });

    it("returns false when isConditionalMediationAvailable resolves to false", async () => {
      (window as unknown as { PublicKeyCredential?: unknown }).PublicKeyCredential = {
        isConditionalMediationAvailable: jest.fn().mockResolvedValue(false),
      };

      const supported = await isConditionalMediationSupported();
      expect(supported).toBe(false);
    });
  });

  describe("Sign-in email input configuration", () => {
    it("includes autoComplete='username webauthn' on the email input", () => {
      render(<SignInClient />);
      const emailInput = screen.getByPlaceholderText("name@company.com");
      expect(emailInput).toBeInTheDocument();
      expect(emailInput).toHaveAttribute("autocomplete", "username webauthn");
      expect(emailInput).toHaveAttribute("type", "email");
      expect(emailInput).toHaveAttribute("name", "email");
    });

    it("includes autoComplete='current-password' on the password input", () => {
      render(<SignInClient />);
      const passwordInput = screen.getByPlaceholderText("••••••••••••");
      expect(passwordInput).toBeInTheDocument();
      expect(passwordInput).toHaveAttribute("autocomplete", "current-password");
    });
  });

  describe("Conditional WebAuthn Assertion Flow", () => {
    it("automatically starts conditional assertion when conditional mediation is supported and eligible input exists", async () => {
      (window as unknown as { PublicKeyCredential?: unknown }).PublicKeyCredential = {
        isConditionalMediationAvailable: jest.fn().mockResolvedValue(true),
      };
      (simpleWebAuthn.startAuthentication as jest.Mock).mockResolvedValue(
        mockAuthResponse,
      );

      render(<SignInClient />);

      await waitFor(() => {
        expect(simpleWebAuthn.startAuthentication).toHaveBeenCalledWith({
          optionsJSON: mockOptions,
          useBrowserAutofill: true,
        });
      });

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledWith(
          "/api/auth/passkey/authenticate/verify",
          expect.objectContaining({
            method: "POST",
            body: JSON.stringify({ authenticationResponse: mockAuthResponse }),
          }),
        );
      });
    });

    it("silently skips conditional mediation when unsupported", async () => {
      (window as unknown as { PublicKeyCredential?: unknown }).PublicKeyCredential = {
        isConditionalMediationAvailable: jest.fn().mockResolvedValue(false),
      };

      render(<SignInClient />);

      await waitFor(() => {
        expect(simpleWebAuthn.startAuthentication).not.toHaveBeenCalledWith(
          expect.objectContaining({ useBrowserAutofill: true }),
        );
      });

      // No error banner should be visible
      expect(screen.queryByText(/passkey/i, { selector: ".bg-red-500\\/10 *" })).toBeNull();
    });

    it("silently handles conditional UI cancellation/aborts without displaying an error", async () => {
      (window as unknown as { PublicKeyCredential?: unknown }).PublicKeyCredential = {
        isConditionalMediationAvailable: jest.fn().mockResolvedValue(true),
      };
      const abortError = new Error("The operation was aborted");
      abortError.name = "AbortError";
      (simpleWebAuthn.startAuthentication as jest.Mock).mockRejectedValue(
        abortError,
      );

      render(<SignInClient />);

      await waitFor(() => {
        expect(simpleWebAuthn.startAuthentication).toHaveBeenCalledWith({
          optionsJSON: mockOptions,
          useBrowserAutofill: true,
        });
      });

      await waitFor(() => {
        expect(screen.queryByText(/failed/i)).toBeNull();
        expect(screen.getByRole("button", { name: /^sign in$/i })).toBeInTheDocument();
      });
    });

    it("cleans up active ceremony on unmount", async () => {
      (window as unknown as { PublicKeyCredential?: unknown }).PublicKeyCredential = {
        isConditionalMediationAvailable: jest.fn().mockResolvedValue(true),
      };
      (simpleWebAuthn.startAuthentication as jest.Mock).mockImplementation(
        () => createCancellablePendingAuth(),
      );

      const { unmount } = render(<SignInClient />);

      await waitFor(() => {
        expect(simpleWebAuthn.startAuthentication).toHaveBeenCalled();
      });

      unmount();

      expect(simpleWebAuthn.WebAuthnAbortService.cancelCeremony).toHaveBeenCalled();
    });
  });

  describe("Explicit Passkey Button fallback", () => {
    it("preserves explicit passkey authentication button and cancels conditional ceremony before starting", async () => {
      (window as unknown as { PublicKeyCredential?: unknown }).PublicKeyCredential = {
        isConditionalMediationAvailable: jest.fn().mockResolvedValue(true),
      };
      (simpleWebAuthn.startAuthentication as jest.Mock).mockImplementation(
        ({ useBrowserAutofill }: { useBrowserAutofill?: boolean }) => {
          if (useBrowserAutofill) {
            return createCancellablePendingAuth();
          }
          return Promise.resolve(mockAuthResponse);
        },
      );

      render(<SignInClient />);

      const passkeyButton = screen.getByRole("button", {
        name: /sign in with passkey/i,
      });
      expect(passkeyButton).toBeInTheDocument();

      fireEvent.click(passkeyButton);

      await waitFor(() => {
        expect(simpleWebAuthn.WebAuthnAbortService.cancelCeremony).toHaveBeenCalled();
        expect(simpleWebAuthn.startAuthentication).toHaveBeenCalledWith({
          optionsJSON: mockOptions,
          useBrowserAutofill: false,
        });
      });
    });

    it("displays an error message when explicit passkey authentication fails with a real error", async () => {
      // Disable auto conditional mediation for this test to isolate button click
      (window as unknown as { PublicKeyCredential?: unknown }).PublicKeyCredential = {
        isConditionalMediationAvailable: jest.fn().mockResolvedValue(false),
      };
      (simpleWebAuthn.startAuthentication as jest.Mock).mockRejectedValue(
        new Error("Biometric sensor timeout"),
      );

      render(<SignInClient />);

      const passkeyButton = screen.getByRole("button", {
        name: /sign in with passkey/i,
      });

      fireEvent.click(passkeyButton);

      await waitFor(() => {
        expect(screen.getByText("Biometric sensor timeout")).toBeInTheDocument();
      });
    });
  });

  describe("Normal email/password login preservation", () => {
    it("allows user to log in with email and password without interference", async () => {
      (window as unknown as { PublicKeyCredential?: unknown }).PublicKeyCredential = {
        isConditionalMediationAvailable: jest.fn().mockResolvedValue(true),
      };
      (simpleWebAuthn.startAuthentication as jest.Mock).mockImplementation(
        () => createCancellablePendingAuth(),
      );

      render(<SignInClient />);

      const emailInput = screen.getByPlaceholderText("name@company.com");
      const passwordInput = screen.getByPlaceholderText("••••••••••••");
      const submitButton = screen.getByRole("button", { name: /^sign in$/i });

      fireEvent.change(emailInput, { target: { value: "worker@worksphere.com" } });
      fireEvent.change(passwordInput, { target: { value: "SecurePass123!" } });
      fireEvent.click(submitButton);

      await waitFor(() => {
        expect(
          screen.getByText(/authentication successful! redirecting/i),
        ).toBeInTheDocument();
      });

      // Verify WebAuthnAbortService.cancelCeremony was called on form submission
      expect(simpleWebAuthn.WebAuthnAbortService.cancelCeremony).toHaveBeenCalled();
    });
  });
});
