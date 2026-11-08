import React from "react";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
} from "@testing-library/react";
import "@testing-library/jest-dom";
import {
  PasskeySettings,
  isConditionalMediationSupported,
} from "@/components/PasskeySettings";
import * as simpleWebAuthn from "@simplewebauthn/browser";

// Ensure setImmediate is available on window in JSDOM environment
if (
  typeof window !== "undefined" &&
  typeof (window as unknown as { setImmediate?: unknown }).setImmediate ===
    "undefined" &&
  typeof global.setImmediate === "function"
) {
  (window as unknown as { setImmediate: unknown }).setImmediate =
    global.setImmediate;
}

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
  startRegistration: jest.fn(),
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

jest.mock("@/lib/auth/passkeys/deviceDetection", () => ({
  detectDeviceDetails: jest.fn(() => ({
    browser: "Chrome",
    os: "Windows",
    deviceType: "desktop",
    iconType: "laptop",
    defaultName: "Chrome on Windows",
  })),
  inferDeviceNickname: jest.fn(() => "MacBook Pro Touch ID"),
  DEVICE_NICKNAME_PRESETS: [
    { label: "MacBook Pro Touch ID", icon: "laptop" },
    { label: "iPhone Face ID", icon: "smartphone" },
  ],
}));

describe("PasskeySettings Conditional WebAuthn & Autofill Mediation", () => {
  const mockOptions = {
    challenge: "test_challenge_abc_123",
    rpId: "localhost",
    allowCredentials: [],
  };

  const mockAuthResponse = {
    id: "cred-1",
    rawId: "raw-cred-1",
    response: {
      clientDataJSON: "mock_client_data_json",
      authenticatorData: "mock_authenticator_data",
      signature: "mock_signature",
    },
    type: "public-key",
  };

  const mockCredentials = [
    {
      id: "cred-1",
      credentialId: "credential-id-123",
      name: "MacBook Pro Touch ID",
      deviceType: "multiDevice",
      backedUp: true,
      transports: ["internal"],
      createdAt: "2026-01-01T00:00:00.000Z",
      lastUsedAt: "2026-01-02T00:00:00.000Z",
    },
  ];

  beforeEach(() => {
    jest.clearAllMocks();
    activeAbortController = null;

    (simpleWebAuthn.browserSupportsWebAuthn as jest.Mock).mockReturnValue(true);

    (
      simpleWebAuthn.WebAuthnAbortService.cancelCeremony as jest.Mock
    ).mockImplementation(() => {
      if (activeAbortController) {
        activeAbortController.abort();
        activeAbortController = null;
      }
    });

    global.fetch = jest.fn((url: string | URL | Request) => {
      const urlStr = url.toString();
      if (urlStr.includes("/api/auth/passkey/credentials")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ credentials: mockCredentials }),
        } as Response);
      }
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
              credential: {
                id: "cred-1",
                name: "MacBook Pro Touch ID",
                nickname: "MacBook Pro Touch ID",
              },
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
    cleanup();
    if (activeAbortController) {
      activeAbortController.abort();
      activeAbortController = null;
    }
  });

  describe("isConditionalMediationSupported helper", () => {
    it("returns true when PublicKeyCredential.isConditionalMediationAvailable resolves to true", async () => {
      (simpleWebAuthn.browserSupportsWebAuthn as jest.Mock).mockReturnValue(
        true,
      );
      (
        window as unknown as { PublicKeyCredential?: unknown }
      ).PublicKeyCredential = {
        isConditionalMediationAvailable: jest.fn().mockResolvedValue(true),
      };

      const supported = await isConditionalMediationSupported();
      expect(supported).toBe(true);
    });

    it("returns false when WebAuthn is unsupported by browser", async () => {
      (simpleWebAuthn.browserSupportsWebAuthn as jest.Mock).mockReturnValue(
        false,
      );
      (
        window as unknown as { PublicKeyCredential?: unknown }
      ).PublicKeyCredential = {
        isConditionalMediationAvailable: jest.fn().mockResolvedValue(true),
      };

      const supported = await isConditionalMediationSupported();
      expect(supported).toBe(false);
    });

    it("returns false when PublicKeyCredential is not defined", async () => {
      delete (window as unknown as { PublicKeyCredential?: unknown })
        .PublicKeyCredential;
      const supported = await isConditionalMediationSupported();
      expect(supported).toBe(false);
    });

    it("returns false when isConditionalMediationAvailable is not a function", async () => {
      (
        window as unknown as { PublicKeyCredential?: unknown }
      ).PublicKeyCredential = {};
      const supported = await isConditionalMediationSupported();
      expect(supported).toBe(false);
    });

    it("returns false when isConditionalMediationAvailable resolves to false", async () => {
      (
        window as unknown as { PublicKeyCredential?: unknown }
      ).PublicKeyCredential = {
        isConditionalMediationAvailable: jest.fn().mockResolvedValue(false),
      };
      const supported = await isConditionalMediationSupported();
      expect(supported).toBe(false);
    });
  });

  describe("Conditional WebAuthn on Page Mount", () => {
    it("triggers conditional WebAuthn get request on mount when supported", async () => {
      (
        window as unknown as { PublicKeyCredential?: unknown }
      ).PublicKeyCredential = {
        isConditionalMediationAvailable: jest.fn().mockResolvedValue(true),
      };
      (simpleWebAuthn.startAuthentication as jest.Mock).mockResolvedValue(
        mockAuthResponse,
      );

      render(<PasskeySettings />);

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

      // Verify autofill active badge
      expect(screen.getByTestId("autofill-supported-badge")).toHaveTextContent(
        "Autofill Active",
      );
    });

    it("does not trigger conditional authentication on mount when unsupported", async () => {
      (
        window as unknown as { PublicKeyCredential?: unknown }
      ).PublicKeyCredential = {
        isConditionalMediationAvailable: jest.fn().mockResolvedValue(false),
      };

      render(<PasskeySettings />);

      await waitFor(() => {
        expect(screen.getByTestId("autofill-fallback-badge")).toHaveTextContent(
          "Modal Fallback",
        );
      });

      expect(simpleWebAuthn.startAuthentication).not.toHaveBeenCalledWith(
        expect.objectContaining({ useBrowserAutofill: true }),
      );
    });

    it("silently ignores AbortError / NotAllowedError during background conditional autofill", async () => {
      (
        window as unknown as { PublicKeyCredential?: unknown }
      ).PublicKeyCredential = {
        isConditionalMediationAvailable: jest.fn().mockResolvedValue(true),
      };
      const abortError = new Error("The operation was aborted");
      abortError.name = "AbortError";
      (simpleWebAuthn.startAuthentication as jest.Mock).mockRejectedValue(
        abortError,
      );

      render(<PasskeySettings />);

      await waitFor(() => {
        expect(simpleWebAuthn.startAuthentication).toHaveBeenCalledWith({
          optionsJSON: mockOptions,
          useBrowserAutofill: true,
        });
      });

      // Ensure no error banner is displayed
      await waitFor(() => {
        expect(screen.queryByText(/aborted/i)).toBeNull();
        expect(screen.queryByText(/failed/i)).toBeNull();
      });
    });

    it("cleans up active ceremony on unmount", async () => {
      (
        window as unknown as { PublicKeyCredential?: unknown }
      ).PublicKeyCredential = {
        isConditionalMediationAvailable: jest.fn().mockResolvedValue(true),
      };
      (simpleWebAuthn.startAuthentication as jest.Mock).mockImplementation(() =>
        createCancellablePendingAuth(),
      );

      const { unmount } = render(<PasskeySettings />);

      await waitFor(() => {
        expect(simpleWebAuthn.startAuthentication).toHaveBeenCalled();
      });

      unmount();

      expect(
        simpleWebAuthn.WebAuthnAbortService.cancelCeremony,
      ).toHaveBeenCalled();
    });
  });

  describe("Graceful Fallback to Modal Prompt on Unsupported Browsers", () => {
    it("falls back to modal prompt (useBrowserAutofill: false) when verify button is clicked", async () => {
      // Browser does not support conditional mediation
      (
        window as unknown as { PublicKeyCredential?: unknown }
      ).PublicKeyCredential = {
        isConditionalMediationAvailable: jest.fn().mockResolvedValue(false),
      };
      (simpleWebAuthn.startAuthentication as jest.Mock).mockResolvedValue(
        mockAuthResponse,
      );

      render(<PasskeySettings />);

      await waitFor(() => {
        expect(screen.getByTestId("verify-passkey-btn")).toBeInTheDocument();
      });

      const verifyButton = screen.getByTestId("verify-passkey-btn");
      fireEvent.click(verifyButton);

      await waitFor(() => {
        expect(
          simpleWebAuthn.WebAuthnAbortService.cancelCeremony,
        ).toHaveBeenCalled();
        expect(simpleWebAuthn.startAuthentication).toHaveBeenCalledWith({
          optionsJSON: mockOptions,
          useBrowserAutofill: false,
        });
      });

      await waitFor(() => {
        expect(
          screen.getByText(
            /Passkey "MacBook Pro Touch ID" verified successfully!/i,
          ),
        ).toBeInTheDocument();
      });
    });

    it("falls back to modal prompt when test-passkey-btn in autofill section is clicked", async () => {
      (
        window as unknown as { PublicKeyCredential?: unknown }
      ).PublicKeyCredential = {
        isConditionalMediationAvailable: jest.fn().mockResolvedValue(false),
      };
      (simpleWebAuthn.startAuthentication as jest.Mock).mockResolvedValue(
        mockAuthResponse,
      );

      render(<PasskeySettings />);

      await waitFor(() => {
        expect(screen.getByTestId("test-passkey-btn")).toBeInTheDocument();
      });

      const testButton = screen.getByTestId("test-passkey-btn");
      fireEvent.click(testButton);

      await waitFor(() => {
        expect(simpleWebAuthn.startAuthentication).toHaveBeenCalledWith({
          optionsJSON: mockOptions,
          useBrowserAutofill: false,
        });
      });
    });

    it("renders eligible autofill input with autocomplete='username webauthn'", async () => {
      (
        window as unknown as { PublicKeyCredential?: unknown }
      ).PublicKeyCredential = {
        isConditionalMediationAvailable: jest.fn().mockResolvedValue(true),
      };

      render(<PasskeySettings />);

      const input = await screen.findByTestId("passkey-autofill-input");
      expect(input).toHaveAttribute("autocomplete", "username webauthn");
    });
  });
});
