import React from "react";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import "@testing-library/jest-dom";
import StepUpReAuthModal from "@/components/auth/StepUpReAuthModal";
import * as simpleWebAuthn from "@simplewebauthn/browser";

jest.mock("@simplewebauthn/browser", () => ({
  startAuthentication: jest.fn(),
}));

jest.mock("@/lib/auth/passkeys/client", () => ({
  savePasskeyChallengeToSession: jest.fn(),
  clearPasskeyChallengeFromSession: jest.fn(),
  setupPasskeyUnloadCleanup: jest.fn(() => jest.fn()),
}));

describe("StepUpReAuthModal Component", () => {
  const mockOptions = {
    challenge: "challenge-stepup-456",
    rpId: "localhost",
    allowCredentials: [],
  };

  const mockAssertion = {
    id: "cred-stepup-id",
    rawId: "raw-stepup",
    response: {
      clientDataJSON: "client-json",
      authenticatorData: "auth-data",
      signature: "sig",
    },
    type: "public-key",
  };

  beforeEach(() => {
    jest.clearAllMocks();

    global.fetch = jest.fn((url: RequestInfo | URL) => {
      const u = url.toString();
      if (u.includes("/api/auth/passkey/step-up/options")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ options: mockOptions }),
        } as Response);
      }
      if (u.includes("/api/auth/passkey/step-up/verify")) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              stepUpToken: "token-stepup-xyz-789",
              backupStatus: {
                backupHealth: "synced",
                description: "Passkey synced to iCloud Keychain",
                isSynced: true,
              },
            }),
        } as Response);
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({}),
      } as Response);
    });
  });

  describe("Visibility & Dialog Semantics", () => {
    it("renders nothing when isOpen is false", () => {
      const { container } = render(
        <StepUpReAuthModal
          isOpen={false}
          action="export_sensitive_data"
          onSuccess={jest.fn()}
          onCancel={jest.fn()}
        />,
      );
      expect(container.firstChild).toBeNull();
    });

    it("renders accessible dialog semantics with title, description, and action", () => {
      render(
        <StepUpReAuthModal
          isOpen={true}
          action="delete_account"
          actionTitle="Authorize Account Deletion"
          actionDescription="Please confirm identity with biometric security."
          onSuccess={jest.fn()}
          onCancel={jest.fn()}
        />,
      );

      const dialog = screen.getByRole("dialog");
      expect(dialog).toBeInTheDocument();
      expect(dialog).toHaveAttribute("aria-modal", "true");
      expect(dialog).toHaveAttribute("aria-labelledby", "step-up-modal-title");
      expect(dialog).toHaveAttribute("aria-describedby", "step-up-modal-desc");

      expect(
        screen.getByRole("heading", { name: "Authorize Account Deletion" }),
      ).toBeInTheDocument();
      expect(
        screen.getByText("Please confirm identity with biometric security."),
      ).toBeInTheDocument();
      expect(screen.getByTestId("step-up-action")).toHaveTextContent(
        "delete_account",
      );
    });
  });

  describe("Dismissal & Interaction Handlers", () => {
    it("dismisses on direct backdrop click when closeOnBackdropClick is true", () => {
      const onCancel = jest.fn();
      render(
        <StepUpReAuthModal
          isOpen={true}
          action="view_api_keys"
          onSuccess={jest.fn()}
          onCancel={onCancel}
          closeOnBackdropClick={true}
        />,
      );

      const backdrop = screen.getByTestId("step-up-modal");
      fireEvent.click(backdrop);
      expect(onCancel).toHaveBeenCalledTimes(1);
    });

    it("does not dismiss when clicking inside the modal card container", () => {
      const onCancel = jest.fn();
      render(
        <StepUpReAuthModal
          isOpen={true}
          action="view_api_keys"
          onSuccess={jest.fn()}
          onCancel={onCancel}
        />,
      );

      const heading = screen.getByRole("heading", {
        name: "Security Step-Up Verification",
      });
      fireEvent.click(heading);
      expect(onCancel).not.toHaveBeenCalled();
    });

    it("does not dismiss on backdrop click when closeOnBackdropClick is false", () => {
      const onCancel = jest.fn();
      render(
        <StepUpReAuthModal
          isOpen={true}
          action="view_api_keys"
          onSuccess={jest.fn()}
          onCancel={onCancel}
          closeOnBackdropClick={false}
        />,
      );

      const backdrop = screen.getByTestId("step-up-modal");
      fireEvent.click(backdrop);
      expect(onCancel).not.toHaveBeenCalled();
    });

    it("dismisses on Escape key when closeOnEscape is true", () => {
      const onCancel = jest.fn();
      render(
        <StepUpReAuthModal
          isOpen={true}
          action="view_api_keys"
          onSuccess={jest.fn()}
          onCancel={onCancel}
          closeOnEscape={true}
        />,
      );

      fireEvent.keyDown(window, { key: "Escape" });
      expect(onCancel).toHaveBeenCalledTimes(1);
    });

    it("does not dismiss on Escape key when closeOnEscape is false", () => {
      const onCancel = jest.fn();
      render(
        <StepUpReAuthModal
          isOpen={true}
          action="view_api_keys"
          onSuccess={jest.fn()}
          onCancel={onCancel}
          closeOnEscape={false}
        />,
      );

      fireEvent.keyDown(window, { key: "Escape" });
      expect(onCancel).not.toHaveBeenCalled();
    });

    it("dismisses via header close button and footer cancel button with type='button'", () => {
      const onCancel = jest.fn();
      render(
        <StepUpReAuthModal
          isOpen={true}
          action="view_api_keys"
          onSuccess={jest.fn()}
          onCancel={onCancel}
        />,
      );

      const closeBtn = screen.getByTestId("step-up-close-btn");
      expect(closeBtn).toHaveAttribute("type", "button");
      fireEvent.click(closeBtn);
      expect(onCancel).toHaveBeenCalledTimes(1);

      const cancelBtn = screen.getByTestId("step-up-cancel-btn");
      expect(cancelBtn).toHaveAttribute("type", "button");
      fireEvent.click(cancelBtn);
      expect(onCancel).toHaveBeenCalledTimes(2);
    });
  });

  describe("Authentication Flow & Timers", () => {
    it("completes step-up authentication and notifies onSuccess with token and backup health", async () => {
      jest.useFakeTimers();
      (simpleWebAuthn.startAuthentication as jest.Mock).mockResolvedValue(
        mockAssertion,
      );
      const onSuccess = jest.fn();

      render(
        <StepUpReAuthModal
          isOpen={true}
          action="rotate_secret_keys"
          onSuccess={onSuccess}
          onCancel={jest.fn()}
        />,
      );

      const verifyBtn = screen.getByTestId("step-up-verify-btn");
      expect(verifyBtn).toHaveAttribute("type", "button");
      fireEvent.click(verifyBtn);

      await waitFor(() => {
        expect(
          screen.getByTestId("step-up-success-notice"),
        ).toBeInTheDocument();
        expect(screen.getByTestId("step-up-backup-info")).toHaveTextContent(
          "Passkey synced to iCloud Keychain",
        );
      });

      // Fast-forward success timer
      act(() => {
        jest.advanceTimersByTime(800);
      });

      expect(onSuccess).toHaveBeenCalledWith("token-stepup-xyz-789", "synced");
      jest.useRealTimers();
    });

    it("displays error message with role='alert' when verify request fails", async () => {
      (simpleWebAuthn.startAuthentication as jest.Mock).mockResolvedValue(
        mockAssertion,
      );
      (global.fetch as jest.Mock).mockImplementation((url: RequestInfo | URL) => {
        const u = url.toString();
        if (u.includes("/api/auth/passkey/step-up/options")) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ options: mockOptions }),
          } as Response);
        }
        if (u.includes("/api/auth/passkey/step-up/verify")) {
          return Promise.resolve({
            ok: false,
            json: () =>
              Promise.resolve({ error: "Biometric assertion challenge expired" }),
          } as Response);
        }
        return Promise.resolve({ ok: true, json: () => Promise.resolve({}) } as Response);
      });

      render(
        <StepUpReAuthModal
          isOpen={true}
          action="payout_request"
          onSuccess={jest.fn()}
          onCancel={jest.fn()}
        />,
      );

      fireEvent.click(screen.getByTestId("step-up-verify-btn"));

      await waitFor(() => {
        const errorAlert = screen.getByTestId("step-up-error");
        expect(errorAlert).toBeInTheDocument();
        expect(errorAlert).toHaveAttribute("role", "alert");
        expect(errorAlert).toHaveTextContent(
          "Biometric assertion challenge expired",
        );
      });
    });

    it("displays user-friendly message when passkey prompt is cancelled", async () => {
      (simpleWebAuthn.startAuthentication as jest.Mock).mockRejectedValue(
        new Error("The operation was aborted by user"),
      );

      render(
        <StepUpReAuthModal
          isOpen={true}
          action="payout_request"
          onSuccess={jest.fn()}
          onCancel={jest.fn()}
        />,
      );

      fireEvent.click(screen.getByTestId("step-up-verify-btn"));

      await waitFor(() => {
        const errorAlert = screen.getByTestId("step-up-error");
        expect(errorAlert).toHaveTextContent(
          "Re-authentication was cancelled.",
        );
      });
    });

    it("clears pending success timer if component unmounts before timeout completes", async () => {
      jest.useFakeTimers();
      (simpleWebAuthn.startAuthentication as jest.Mock).mockResolvedValue(
        mockAssertion,
      );
      const onSuccess = jest.fn();

      const { unmount } = render(
        <StepUpReAuthModal
          isOpen={true}
          action="rotate_keys"
          onSuccess={onSuccess}
          onCancel={jest.fn()}
        />,
      );

      fireEvent.click(screen.getByTestId("step-up-verify-btn"));

      await waitFor(() => {
        expect(
          screen.getByTestId("step-up-success-notice"),
        ).toBeInTheDocument();
      });

      // Unmount before 750ms timer triggers
      unmount();

      act(() => {
        jest.advanceTimersByTime(1000);
      });

      expect(onSuccess).not.toHaveBeenCalled();
      jest.useRealTimers();
    });
  });
});
