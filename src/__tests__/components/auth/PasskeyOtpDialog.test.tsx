import React from "react";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import "@testing-library/jest-dom";
import PasskeyOtpDialog from "@/components/auth/PasskeyOtpDialog";

describe("PasskeyOtpDialog Component", () => {
  beforeEach(() => {
    jest.clearAllMocks();

    global.fetch = jest.fn((url: RequestInfo | URL) => {
      const u = url.toString();
      if (u.includes("/api/auth/passkey/otp")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve({
              sentTo: "developer@example.com",
            }),
        } as Response);
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({}),
      } as Response);
    });
  });

  describe("Rendering & Accessible Dialog Semantics", () => {
    it("renders accessible dialog with appropriate titles and descriptions across actions", async () => {
      const { rerender } = render(
        <PasskeyOtpDialog
          action="rotate"
          credentialId="cred-rot-1"
          passkeyName="MacBook Pro TouchID"
          onCancel={jest.fn()}
          onSubmit={jest.fn()}
        />,
      );

      const dialog = screen.getByRole("dialog");
      expect(dialog).toBeInTheDocument();
      expect(dialog).toHaveAttribute("aria-modal", "true");
      expect(dialog).toHaveAttribute("aria-labelledby");
      expect(dialog).toHaveAttribute("aria-describedby");

      expect(
        screen.getByRole("heading", { name: "Rotate passkey" }),
      ).toBeInTheDocument();
      expect(screen.getByTestId("passkey-name-display")).toHaveTextContent(
        "MacBook Pro TouchID",
      );
      expect(screen.getByTestId("passkey-rotate-notice")).toBeInTheDocument();

      // Rerender as rename
      rerender(
        <PasskeyOtpDialog
          action="rename"
          credentialId="cred-rot-1"
          passkeyName="YubiKey 5C"
          onCancel={jest.fn()}
          onSubmit={jest.fn()}
        />,
      );
      expect(
        screen.getByRole("heading", { name: "Rename passkey" }),
      ).toBeInTheDocument();
      expect(screen.queryByTestId("passkey-rotate-notice")).toBeNull();

      // Rerender as revoke
      rerender(
        <PasskeyOtpDialog
          action="revoke"
          credentialId="cred-rot-1"
          passkeyName="Old Android"
          onCancel={jest.fn()}
          onSubmit={jest.fn()}
        />,
      );
      expect(
        screen.getByRole("heading", { name: "Remove passkey" }),
      ).toBeInTheDocument();
    });

    it("sends verification email on mount and updates status description", async () => {
      render(
        <PasskeyOtpDialog
          action="rotate"
          credentialId="cred-rot-1"
          passkeyName="MacBook Touch ID"
          onCancel={jest.fn()}
          onSubmit={jest.fn()}
        />,
      );

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledWith(
          "/api/auth/passkey/otp",
          expect.objectContaining({
            method: "POST",
            body: JSON.stringify({ action: "rotate", credentialId: "cred-rot-1" }),
          }),
        );
        expect(screen.getByTestId("passkey-otp-status")).toHaveTextContent(
          "Enter the 6-digit code we sent to developer@example.com.",
        );
      });
    });
  });

  describe("Input Filtering & Validation", () => {
    it("sanitizes input to only digits and caps at 6 characters", () => {
      render(
        <PasskeyOtpDialog
          action="rename"
          credentialId="cred-1"
          passkeyName="Test Key"
          onCancel={jest.fn()}
          onSubmit={jest.fn()}
        />,
      );

      const input = screen.getByTestId("passkey-otp-input") as HTMLInputElement;
      fireEvent.change(input, { target: { value: "abc12xyz3456789" } });
      expect(input.value).toBe("123456");

      const submitBtn = screen.getByTestId("passkey-otp-submit-btn");
      expect(submitBtn).toBeEnabled();
    });

    it("keeps submit button disabled when fewer than 6 digits are entered", () => {
      render(
        <PasskeyOtpDialog
          action="rename"
          credentialId="cred-1"
          passkeyName="Test Key"
          onCancel={jest.fn()}
          onSubmit={jest.fn()}
        />,
      );

      const input = screen.getByTestId("passkey-otp-input") as HTMLInputElement;
      fireEvent.change(input, { target: { value: "12345" } });
      expect(screen.getByTestId("passkey-otp-submit-btn")).toBeDisabled();
    });
  });

  describe("Submission & Error Handling", () => {
    it("submits the verified code to onSubmit when 6 digits are entered", async () => {
      const onSubmit = jest.fn().mockResolvedValue(undefined);

      render(
        <PasskeyOtpDialog
          action="rotate"
          credentialId="cred-1"
          passkeyName="Test Key"
          onCancel={jest.fn()}
          onSubmit={onSubmit}
        />,
      );

      const input = screen.getByTestId("passkey-otp-input");
      fireEvent.change(input, { target: { value: "654321" } });

      const submitBtn = screen.getByTestId("passkey-otp-submit-btn");
      fireEvent.click(submitBtn);

      await waitFor(() => {
        expect(onSubmit).toHaveBeenCalledWith("654321");
      });
    });

    it("displays error message when onSubmit throws an error", async () => {
      const onSubmit = jest
        .fn()
        .mockRejectedValue(new Error("Verification code has expired."));

      render(
        <PasskeyOtpDialog
          action="rotate"
          credentialId="cred-1"
          passkeyName="Test Key"
          onCancel={jest.fn()}
          onSubmit={onSubmit}
        />,
      );

      const input = screen.getByTestId("passkey-otp-input");
      fireEvent.change(input, { target: { value: "112233" } });

      fireEvent.click(screen.getByTestId("passkey-otp-submit-btn"));

      await waitFor(() => {
        const err = screen.getByTestId("passkey-otp-error");
        expect(err).toBeInTheDocument();
        expect(err).toHaveAttribute("role", "alert");
        expect(err).toHaveTextContent("Verification code has expired.");
      });
    });
  });

  describe("Rate Limiting & Resend Cooldown", () => {
    it("handles 429 status code and sets retryAfter cooldown", async () => {
      jest.useFakeTimers();

      (global.fetch as jest.Mock).mockImplementation((url: RequestInfo | URL) => {
        const u = url.toString();
        if (u.includes("/api/auth/passkey/otp")) {
          return Promise.resolve({
            ok: false,
            status: 429,
            json: () =>
              Promise.resolve({
                error: "Too many requests. Please wait before retrying.",
                retryAfter: 15,
              }),
          } as Response);
        }
        return Promise.resolve({ ok: true, json: () => Promise.resolve({}) } as Response);
      });

      render(
        <PasskeyOtpDialog
          action="revoke"
          credentialId="cred-1"
          passkeyName="Test Key"
          onCancel={jest.fn()}
          onSubmit={jest.fn()}
        />,
      );

      await waitFor(() => {
        expect(screen.getByTestId("passkey-otp-error")).toHaveTextContent(
          "Too many requests. Please wait before retrying.",
        );
      });

      const resendBtn = screen.getByTestId("passkey-otp-resend-btn");
      expect(resendBtn).toHaveTextContent("Resend code in 15s");
      expect(resendBtn).toBeDisabled();

      // Advance timers by 5 seconds (1 second at a time to trigger each successive effect)
      for (let i = 0; i < 5; i++) {
        act(() => {
          jest.advanceTimersByTime(1000);
        });
      }

      expect(resendBtn).toHaveTextContent("Resend code in 10s");

      // Advance past remaining cooldown
      for (let i = 0; i < 11; i++) {
        act(() => {
          jest.advanceTimersByTime(1000);
        });
      }

      expect(resendBtn).toHaveTextContent("Resend code");
      expect(resendBtn).toBeEnabled();

      jest.useRealTimers();
    });
  });

  describe("Dismissal & Interaction Handlers", () => {
    it("dismisses on direct backdrop click when closeOnBackdropClick is true", () => {
      const onCancel = jest.fn();
      render(
        <PasskeyOtpDialog
          action="rename"
          credentialId="cred-1"
          passkeyName="Test Key"
          onCancel={onCancel}
          onSubmit={jest.fn()}
          closeOnBackdropClick={true}
        />,
      );

      const backdrop = screen.getByTestId("passkey-otp-dialog");
      fireEvent.click(backdrop);
      expect(onCancel).toHaveBeenCalledTimes(1);
    });

    it("does not dismiss when clicking inside the dialog card container", () => {
      const onCancel = jest.fn();
      render(
        <PasskeyOtpDialog
          action="rename"
          credentialId="cred-1"
          passkeyName="Test Key"
          onCancel={onCancel}
          onSubmit={jest.fn()}
        />,
      );

      const heading = screen.getByRole("heading", { name: "Rename passkey" });
      fireEvent.click(heading);
      expect(onCancel).not.toHaveBeenCalled();
    });

    it("does not dismiss on backdrop click when closeOnBackdropClick is false", () => {
      const onCancel = jest.fn();
      render(
        <PasskeyOtpDialog
          action="rename"
          credentialId="cred-1"
          passkeyName="Test Key"
          onCancel={onCancel}
          onSubmit={jest.fn()}
          closeOnBackdropClick={false}
        />,
      );

      const backdrop = screen.getByTestId("passkey-otp-dialog");
      fireEvent.click(backdrop);
      expect(onCancel).not.toHaveBeenCalled();
    });

    it("dismisses on Escape key when closeOnEscape is true", () => {
      const onCancel = jest.fn();
      render(
        <PasskeyOtpDialog
          action="rename"
          credentialId="cred-1"
          passkeyName="Test Key"
          onCancel={onCancel}
          onSubmit={jest.fn()}
          closeOnEscape={true}
        />,
      );

      fireEvent.keyDown(window, { key: "Escape" });
      expect(onCancel).toHaveBeenCalledTimes(1);
    });

    it("does not dismiss on Escape key when closeOnEscape is false", () => {
      const onCancel = jest.fn();
      render(
        <PasskeyOtpDialog
          action="rename"
          credentialId="cred-1"
          passkeyName="Test Key"
          onCancel={onCancel}
          onSubmit={jest.fn()}
          closeOnEscape={false}
        />,
      );

      fireEvent.keyDown(window, { key: "Escape" });
      expect(onCancel).not.toHaveBeenCalled();
    });

    it("dismisses via top-right close button", () => {
      const onCancel = jest.fn();
      render(
        <PasskeyOtpDialog
          action="rename"
          credentialId="cred-1"
          passkeyName="Test Key"
          onCancel={onCancel}
          onSubmit={jest.fn()}
        />,
      );

      fireEvent.click(screen.getByTestId("passkey-otp-close-btn"));
      expect(onCancel).toHaveBeenCalledTimes(1);
    });

    it("safely unmounts during active fetch without throw", () => {
      let resolveFetch: (value: any) => void;
      (global.fetch as jest.Mock).mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveFetch = resolve;
          }),
      );

      const { unmount } = render(
        <PasskeyOtpDialog
          action="rename"
          credentialId="cred-1"
          passkeyName="Test Key"
          onCancel={jest.fn()}
          onSubmit={jest.fn()}
        />,
      );

      // Unmount before fetch resolves
      unmount();

      // Resolve after unmount
      expect(() => {
        resolveFetch({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ sentTo: "user@example.com" }),
        });
      }).not.toThrow();
    });
  });
});
