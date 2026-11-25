import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { SolanaPayButton } from "@/components/payments/SolanaPayButton";
import * as WebAuthnUtil from "@/lib/auth/webauthnPasskey";

jest.mock("@/lib/auth/webauthnPasskey", () => ({
  ...jest.requireActual("@/lib/auth/webauthnPasskey"),
  isWebAuthnSupported: jest.fn(),
  isPlatformAuthenticatorAvailable: jest.fn(),
  performWebAuthnStepUp: jest.fn(),
  requestStepUpEmailOtp: jest.fn(),
  verifyStepUpEmailOtp: jest.fn(),
}));

describe("SolanaPayButton Component", () => {
  const mockOnSuccess = jest.fn();
  const mockOnError = jest.fn();
  const mockOnCancel = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    (WebAuthnUtil.isWebAuthnSupported as jest.Mock).mockReturnValue(true);
    (WebAuthnUtil.isPlatformAuthenticatorAvailable as jest.Mock).mockResolvedValue(true);
  });

  it("renders idle state with label", () => {
    render(
      <SolanaPayButton
        amount={0.5}
        onSuccess={mockOnSuccess}
        label="Pay Desk Fee"
      />
    );

    expect(screen.getByText("Pay Desk Fee")).toBeDefined();
  });

  it("bypasses step-up authentication when amount is low and action is not protected", () => {
    render(
      <SolanaPayButton
        amount={0.5} // below 1.0 SOL threshold
        action="wallet_transfer"
        onSuccess={mockOnSuccess}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /confirm payment/i }));

    expect(mockOnSuccess).toHaveBeenCalledWith({ transactionConfirmed: true });
    expect(WebAuthnUtil.performWebAuthnStepUp).not.toHaveBeenCalled();
  });

  it("requires step-up authentication when amount >= highValueThreshold", async () => {
    (WebAuthnUtil.performWebAuthnStepUp as jest.Mock).mockResolvedValue({
      success: true,
      type: "success",
      stepUpToken: "mock.stepup.token",
    });

    render(
      <SolanaPayButton
        amount={2.5} // >= 1.0 SOL threshold
        action="wallet_transfer"
        onSuccess={mockOnSuccess}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /confirm payment/i }));

    await waitFor(() => {
      expect(WebAuthnUtil.performWebAuthnStepUp).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "wallet_transfer",
          amount: 2.5,
        })
      );
    });

    await waitFor(() => {
      expect(mockOnSuccess).toHaveBeenCalledWith({
        stepUpToken: "mock.stepup.token",
        transactionConfirmed: true,
      });
      expect(screen.getByText(/Step-up authentication verified!/i)).toBeDefined();
    });
  });

  it("requires step-up authentication for escrow_settle even when amount is low", async () => {
    (WebAuthnUtil.performWebAuthnStepUp as jest.Mock).mockResolvedValue({
      success: true,
      type: "success",
      stepUpToken: "mock.escrow.token",
    });

    render(
      <SolanaPayButton
        amount={0.1}
        action="escrow_settle"
        onSuccess={mockOnSuccess}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /confirm payment/i }));

    await waitFor(() => {
      expect(WebAuthnUtil.performWebAuthnStepUp).toHaveBeenCalled();
    });
  });

  it("requires step-up authentication for refund action even when amount is low", async () => {
    (WebAuthnUtil.performWebAuthnStepUp as jest.Mock).mockResolvedValue({
      success: true,
      type: "success",
      stepUpToken: "mock.refund.token",
    });

    render(
      <SolanaPayButton
        amount={0.2}
        action="refund"
        onSuccess={mockOnSuccess}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /confirm payment/i }));

    await waitFor(() => {
      expect(WebAuthnUtil.performWebAuthnStepUp).toHaveBeenCalled();
    });
  });

  it("shows error screen and allows OTP fallback when passkey authentication is cancelled or fails", async () => {
    (WebAuthnUtil.performWebAuthnStepUp as jest.Mock).mockResolvedValue({
      success: false,
      type: "user_cancelled",
      error: "Biometric authentication was cancelled.",
    });

    (WebAuthnUtil.requestStepUpEmailOtp as jest.Mock).mockResolvedValue({
      success: true,
      maskedEmail: "s•••p@example.com",
    });

    (WebAuthnUtil.verifyStepUpEmailOtp as jest.Mock).mockResolvedValue({
      success: true,
      type: "success",
      stepUpToken: "otp.verified.token",
    });

    render(
      <SolanaPayButton
        amount={5.0}
        action="wallet_transfer"
        onSuccess={mockOnSuccess}
        onError={mockOnError}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /confirm payment/i }));

    await waitFor(() => {
      expect(screen.getByText(/Authentication Failed/i)).toBeDefined();
      expect(screen.getByText("Biometric authentication was cancelled.")).toBeDefined();
    });

    // Click "Verify with Email OTP Instead"
    const fallbackBtn = screen.getByRole("button", {
      name: /Verify with Email OTP Instead/i,
    });
    fireEvent.click(fallbackBtn);

    await waitFor(() => {
      expect(WebAuthnUtil.requestStepUpEmailOtp).toHaveBeenCalledWith(
        expect.objectContaining({ action: "wallet_transfer", amount: 5.0 })
      );
      expect(screen.getByText(/Email Verification/i)).toBeDefined();
      expect(screen.getByText("s•••p@example.com")).toBeDefined();
    });

    // Enter 6-digit code and submit
    const otpInput = screen.getByLabelText("Verification Code");
    fireEvent.change(otpInput, { target: { value: "654321" } });

    const verifyCodeBtn = screen.getByRole("button", { name: /Verify Code/i });
    fireEvent.click(verifyCodeBtn);

    await waitFor(() => {
      expect(WebAuthnUtil.verifyStepUpEmailOtp).toHaveBeenCalledWith({
        code: "654321",
        action: "wallet_transfer",
        amount: 5.0,
        recipient: undefined,
      });
      expect(mockOnSuccess).toHaveBeenCalledWith({
        stepUpToken: "otp.verified.token",
        transactionConfirmed: true,
      });
    });
  });

  it("automatically routes to OTP fallback when WebAuthn is unsupported on the platform", async () => {
    (WebAuthnUtil.isWebAuthnSupported as jest.Mock).mockReturnValue(false);
    (WebAuthnUtil.requestStepUpEmailOtp as jest.Mock).mockResolvedValue({
      success: true,
      maskedEmail: "u•••r@example.com",
    });

    render(
      <SolanaPayButton
        amount={10.0}
        action="wallet_transfer"
        onSuccess={mockOnSuccess}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /confirm payment/i }));

    await waitFor(() => {
      expect(WebAuthnUtil.requestStepUpEmailOtp).toHaveBeenCalled();
      expect(screen.getByText(/Email Verification/i)).toBeDefined();
    });
  });

  it("prevents transaction completion when cancellation is triggered", async () => {
    // Delay performWebAuthnStepUp so component remains in prompt_passkey/verifying_passkey stage
    let resolveAuth: (val: any) => void;
    (WebAuthnUtil.performWebAuthnStepUp as jest.Mock).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveAuth = resolve;
        })
    );

    render(
      <SolanaPayButton
        amount={2.0}
        action="wallet_transfer"
        onSuccess={mockOnSuccess}
        onCancel={mockOnCancel}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /confirm payment/i }));

    // Cancel from prompt
    const cancelBtn = await screen.findByRole("button", { name: /^cancel$/i });
    fireEvent.click(cancelBtn);

    expect(mockOnCancel).toHaveBeenCalled();
    expect(mockOnSuccess).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /confirm payment/i })).toBeDefined();

    // Clean up promise
    resolveAuth!({ success: false, type: "user_cancelled" });
  });
});
