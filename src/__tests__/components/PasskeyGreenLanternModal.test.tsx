import React from "react";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  act,
} from "@testing-library/react";
import "@testing-library/jest-dom";
import { PasskeyManager } from "@/components/auth/PasskeyManager";
import { GreenLanternBatteryModal } from "@/components/auth/GreenLanternBatteryModal";
import { startAuthentication } from "@simplewebauthn/browser";

// Mock @simplewebauthn/browser
jest.mock("@simplewebauthn/browser", () => ({
  browserSupportsWebAuthn: jest.fn(() => true),
  startRegistration: jest.fn(),
  startAuthentication: jest.fn(),
}));

// Mock hooks and child components
jest.mock("@/hooks/useCsrfToken", () => ({
  useCsrfToken: () => ({ csrfToken: "mock-csrf-token" }),
}));

jest.mock("@/components/auth/PasskeyOtpDialog", () => ({
  PasskeyOtpDialog: () => <div data-testid="otp-dialog" />,
}));

jest.mock("@/components/auth/StepUpReAuthModal", () => ({
  StepUpReAuthModal: () => <div data-testid="step-up-modal" />,
}));

jest.mock("@/components/auth/PasskeySecurityAuditLog", () => ({
  PasskeySecurityAuditLog: () => <div data-testid="audit-log" />,
}));

jest.mock("@/lib/auth/passkeys/deviceDetection", () => ({
  detectDeviceDetails: jest.fn(() => ({
    browser: "Chrome",
    os: "Windows",
    deviceType: "desktop",
    defaultName: "Chrome on Windows",
    suggestedNickname: "Work MacBook",
  })),
  DEVICE_NICKNAME_PRESETS: ["Work Laptop", "Personal Phone"],
}));

jest.mock("@/lib/auth/passkeys/client", () => ({
  savePasskeyChallengeToSession: jest.fn(),
  clearPasskeyChallengeFromSession: jest.fn(),
  setupPasskeyUnloadCleanup: jest.fn(() => jest.fn()),
}));

describe("GreenLanternBatteryModal and PasskeyManager Biometric Ceremony", () => {
  const mockPasskey = {
    id: "cred-1",
    credentialId: "cred-abc-123",
    name: "MacBook Touch ID",
    deviceType: "multiDevice",
    backedUp: true,
    transports: ["internal"],
    createdAt: "2026-01-01T00:00:00.000Z",
    lastUsedAt: "2026-01-02T00:00:00.000Z",
    expiresAt: "2027-01-01T00:00:00.000Z",
  };

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();

    global.fetch = jest.fn((url: RequestInfo | URL) => {
      const urlString = url.toString();
      if (urlString.includes("/api/auth/passkey/credentials")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ credentials: [mockPasskey] }),
        } as Response);
      }
      if (urlString.includes("/api/auth/passkey/rotation")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ credentials: [] }),
        } as Response);
      }
      if (urlString.includes("/api/auth/passkey/authenticate/options")) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              challenge: "test-challenge-123",
              rpId: "localhost",
              allowCredentials: [{ id: "cred-abc-123", type: "public-key" }],
            }),
        } as Response);
      }
      if (urlString.includes("/api/auth/passkey/authenticate/verify")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ success: true }),
        } as Response);
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({}),
      } as Response);
    });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe("GreenLanternBatteryModal Component States", () => {
    it("renders modal with Green Lantern battery emblem during initiating and waiting states", () => {
      const { rerender } = render(
        <GreenLanternBatteryModal
          isOpen={true}
          state="initiating"
          passkeyName="MacBook Touch ID"
        />,
      );

      expect(screen.getByTestId("green-lantern-modal")).toBeInTheDocument();
      expect(screen.getByTestId("green-lantern-emblem")).toBeInTheDocument();
      expect(
        screen.getByTestId("green-lantern-emblem-svg"),
      ).toBeInTheDocument();
      expect(screen.getByTestId("biometric-state-indicator")).toHaveTextContent(
        /Initiating Biometric Channel/i,
      );
      expect(screen.getByTestId("battery-charge-percentage")).toHaveTextContent(
        "25%",
      );

      // Re-render in waiting state (navigator.credentials.get in flight)
      rerender(
        <GreenLanternBatteryModal
          isOpen={true}
          state="waiting"
          passkeyName="MacBook Touch ID"
        />,
      );

      expect(screen.getByTestId("biometric-state-indicator")).toHaveTextContent(
        /Awaiting Biometric Verification/i,
      );
      expect(screen.getByTestId("battery-charge-percentage")).toHaveTextContent(
        "65%",
      );
    });

    it("bursts into a green shockwave on success with 100% charge", () => {
      render(
        <GreenLanternBatteryModal
          isOpen={true}
          state="success"
          passkeyName="MacBook Touch ID"
        />,
      );

      expect(screen.getByTestId("green-shockwave")).toBeInTheDocument();
      expect(screen.getByTestId("biometric-state-indicator")).toHaveTextContent(
        /Willpower Verified \/\/ Access Granted/i,
      );
      expect(screen.getByTestId("battery-charge-percentage")).toHaveTextContent(
        "100%",
      );
    });

    it("displays failed state with error message", () => {
      render(
        <GreenLanternBatteryModal
          isOpen={true}
          state="failed"
          errorMessage="User verification timeout"
        />,
      );

      expect(screen.getByTestId("biometric-state-indicator")).toHaveTextContent(
        /Verification Failed/i,
      );
      expect(screen.getByText("User verification timeout")).toBeInTheDocument();
    });

    it("invokes onCancel callback when cancel button or ESC is triggered", () => {
      const onCancelMock = jest.fn();
      render(
        <GreenLanternBatteryModal
          isOpen={true}
          state="waiting"
          onCancel={onCancelMock}
        />,
      );

      const cancelBtn = screen.getByTestId("cancel-biometric-btn");
      fireEvent.click(cancelBtn);
      expect(onCancelMock).toHaveBeenCalledTimes(1);

      // Trigger ESC key
      fireEvent.keyDown(window, { key: "Escape" });
      expect(onCancelMock).toHaveBeenCalledTimes(2);
    });
  });

  describe("PasskeyManager Integration with Green Lantern Modal", () => {
    it("opens Green Lantern modal, executes WebAuthn ceremony, and bursts into shockwave on success", async () => {
      (startAuthentication as jest.Mock).mockResolvedValueOnce({
        id: "cred-abc-123",
        rawId: "raw-abc",
        response: {
          authenticatorData: "data",
          clientDataJSON: "client-json",
          signature: "sig",
        },
        type: "public-key",
      });

      render(<PasskeyManager />);

      // Wait for passkeys to load
      await waitFor(() => {
        expect(screen.getByText("MacBook Touch ID")).toBeInTheDocument();
      });

      // Find and click the Verify button for the passkey
      const verifyBtn = screen.getByTestId("verify-passkey-cred-1");
      expect(verifyBtn).toBeInTheDocument();

      fireEvent.click(verifyBtn);

      // Green Lantern modal should immediately render
      expect(screen.getByTestId("green-lantern-modal")).toBeInTheDocument();

      // Resolve async authentication ceremony
      await waitFor(() => {
        expect(startAuthentication).toHaveBeenCalledTimes(1);
      });

      // State reaches success and shockwave is present
      await waitFor(() => {
        expect(screen.getByTestId("green-shockwave")).toBeInTheDocument();
        expect(
          screen.getByText(/Willpower Verified \/\/ Access Granted/i),
        ).toBeInTheDocument();
      });

      // Fast-forward success timeout (1200ms)
      act(() => {
        jest.advanceTimersByTime(1200);
      });

      // Modal closes and standard UI shows success banner
      expect(
        screen.queryByTestId("green-lantern-modal"),
      ).not.toBeInTheDocument();
      expect(
        screen.getByText(
          /Biometric verification succeeded for "MacBook Touch ID"!/i,
        ),
      ).toBeInTheDocument();
    });

    it("gracefully falls back to standard UI when user cancels WebAuthn prompt", async () => {
      const cancelError = new Error(
        "The operation either timed out or was not allowed.",
      );
      cancelError.name = "NotAllowedError";
      (startAuthentication as jest.Mock).mockRejectedValueOnce(cancelError);

      render(<PasskeyManager />);

      await waitFor(() => {
        expect(screen.getByText("MacBook Touch ID")).toBeInTheDocument();
      });

      const verifyBtn = screen.getByTestId("verify-passkey-cred-1");
      fireEvent.click(verifyBtn);

      expect(screen.getByTestId("green-lantern-modal")).toBeInTheDocument();

      await waitFor(() => {
        expect(startAuthentication).toHaveBeenCalledTimes(1);
      });

      // Modal should gracefully close
      await waitFor(() => {
        expect(
          screen.queryByTestId("green-lantern-modal"),
        ).not.toBeInTheDocument();
      });

      // Returns to standard UI with cancellation notice
      expect(
        screen.getByText("Passkey biometric verification was cancelled."),
      ).toBeInTheDocument();
    });

    it("launches Green Lantern biometric verification via Test Biometrics header button", async () => {
      (startAuthentication as jest.Mock).mockResolvedValueOnce({
        id: "cred-abc-123",
        rawId: "raw-abc",
        response: { signature: "sig" },
        type: "public-key",
      });

      render(<PasskeyManager />);

      await waitFor(() => {
        expect(screen.getByTestId("verify-biometrics-btn")).toBeInTheDocument();
      });

      const testBtn = screen.getByTestId("verify-biometrics-btn");
      fireEvent.click(testBtn);

      expect(screen.getByTestId("green-lantern-modal")).toBeInTheDocument();

      await waitFor(() => {
        expect(startAuthentication).toHaveBeenCalledTimes(1);
      });

      await waitFor(() => {
        expect(screen.getByTestId("green-shockwave")).toBeInTheDocument();
      });
    });
  });
});
