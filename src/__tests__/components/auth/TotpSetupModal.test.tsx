import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import TotpSetupModal from "@/components/auth/TotpSetupModal";
import * as svgQrModule from "@/lib/qr/svgQr";

describe("TotpSetupModal Component", () => {
  const defaultSecret = "JBSWY3DPEHPK3PXP"; // Valid 16-character base32 secret
  const defaultAccount = "alex@example.com";
  const defaultRecoveryCodes = ["A1B2-C3D4", "E5F6-G7H8", "I9J0-K1L2", "M3N4-O5P6"];
  const mockOnClose = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("Rendering & Visibility", () => {
    it("renders nothing when isOpen is false", () => {
      const { container } = render(
        <TotpSetupModal
          isOpen={false}
          onClose={mockOnClose}
          secret={defaultSecret}
          accountName={defaultAccount}
        />,
      );

      expect(container).toBeEmptyDOMElement();
      expect(screen.queryByTestId("totp-setup-overlay")).not.toBeInTheDocument();
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    it("renders accessible modal dialog when isOpen is true", () => {
      render(
        <TotpSetupModal
          isOpen={true}
          onClose={mockOnClose}
          secret={defaultSecret}
          accountName={defaultAccount}
        />,
      );

      const dialog = screen.getByRole("dialog");
      expect(dialog).toBeInTheDocument();
      expect(dialog).toHaveAttribute("aria-modal", "true");
      expect(dialog).toHaveAttribute("aria-labelledby", "totp-setup-title");
      expect(dialog).toHaveAttribute("aria-describedby", "totp-setup-description");

      expect(
        screen.getByRole("heading", { name: "Set up two-factor authentication" }),
      ).toBeInTheDocument();
      expect(screen.getByTestId("totp-setup-description")).toHaveTextContent(
        "Scan the QR code with an authenticator app",
      );
    });
  });

  describe("Secret Validation & Error Handling", () => {
    it("renders alert message when secret is invalid base32 or too short", () => {
      render(
        <TotpSetupModal
          isOpen={true}
          onClose={mockOnClose}
          secret="INVALID_SECRET_1"
          accountName={defaultAccount}
        />,
      );

      const alert = screen.getByRole("alert");
      expect(alert).toBeInTheDocument();
      expect(alert).toHaveTextContent("The setup key is invalid, so two-factor setup cannot continue.");
      expect(screen.queryByTestId("totp-qr-svg")).not.toBeInTheDocument();
      expect(screen.queryByTestId("totp-secret")).not.toBeInTheDocument();
    });

    it("renders alert message when secret is empty string", () => {
      render(
        <TotpSetupModal
          isOpen={true}
          onClose={mockOnClose}
          secret=""
          accountName={defaultAccount}
        />,
      );

      expect(screen.getByRole("alert")).toBeInTheDocument();
      expect(screen.getByTestId("totp-secret-error-alert")).toBeInTheDocument();
    });
  });

  describe("QR Code, Secret Display & Copying", () => {
    it("renders SVG QR code and formatted secret for valid input", () => {
      render(
        <TotpSetupModal
          isOpen={true}
          onClose={mockOnClose}
          secret="jbsw-y3dp-ehpk-3pxp"
          accountName={defaultAccount}
          issuer="WorkSphere"
        />,
      );

      const qrSvg = screen.getByTestId("totp-qr-svg");
      expect(qrSvg).toBeInTheDocument();
      expect(qrSvg).toHaveAttribute("aria-label", "QR code for authenticator app setup");

      const secretEl = screen.getByTestId("totp-secret");
      expect(secretEl).toHaveTextContent("JBSW Y3DP EHPK 3PXP");

      expect(screen.getByRole("button", { name: /Copy Secret Key/i })).toBeInTheDocument();
    });

    it("renders fallback warning when QR matrix generation throws", () => {
      const spy = jest.spyOn(svgQrModule, "generateQRMatrix").mockImplementation(() => {
        throw new Error("QR capacity exceeded");
      });

      render(
        <TotpSetupModal
          isOpen={true}
          onClose={mockOnClose}
          secret={defaultSecret}
          accountName={defaultAccount}
        />,
      );

      expect(screen.getByTestId("totp-qr-unavailable-msg")).toHaveTextContent(
        "The QR code is unavailable. Enter the setup key below in your authenticator app instead.",
      );
      expect(screen.queryByTestId("totp-qr-svg")).not.toBeInTheDocument();
      expect(screen.getByTestId("totp-secret")).toHaveTextContent("JBSW Y3DP EHPK 3PXP");

      spy.mockRestore();
    });
  });

  describe("Recovery Codes Section", () => {
    it("renders recovery codes list when provided", () => {
      render(
        <TotpSetupModal
          isOpen={true}
          onClose={mockOnClose}
          secret={defaultSecret}
          accountName={defaultAccount}
          recoveryCodes={defaultRecoveryCodes}
        />,
      );

      expect(screen.getByTestId("totp-recovery-section")).toBeInTheDocument();
      const list = screen.getByTestId("totp-recovery-codes-list");
      expect(list).toBeInTheDocument();

      const items = screen.getAllByTestId("totp-recovery-code-item");
      expect(items).toHaveLength(4);
      expect(items[0]).toHaveTextContent("A1B2-C3D4");
      expect(items[1]).toHaveTextContent("E5F6-G7H8");
    });

    it("omits recovery codes section when recoveryCodes is empty", () => {
      render(
        <TotpSetupModal
          isOpen={true}
          onClose={mockOnClose}
          secret={defaultSecret}
          accountName={defaultAccount}
          recoveryCodes={[]}
        />,
      );

      expect(screen.queryByTestId("totp-recovery-section")).not.toBeInTheDocument();
      expect(screen.queryByTestId("totp-recovery-codes-list")).not.toBeInTheDocument();
    });
  });

  describe("Dismissal & Backdrop Handling", () => {
    it("calls onClose when clicking the close (X) button", () => {
      render(
        <TotpSetupModal
          isOpen={true}
          onClose={mockOnClose}
          secret={defaultSecret}
          accountName={defaultAccount}
        />,
      );

      const closeBtn = screen.getByTestId("totp-setup-close-btn");
      fireEvent.click(closeBtn);

      expect(mockOnClose).toHaveBeenCalledTimes(1);
    });

    it("calls onClose when clicking the Done button", () => {
      render(
        <TotpSetupModal
          isOpen={true}
          onClose={mockOnClose}
          secret={defaultSecret}
          accountName={defaultAccount}
        />,
      );

      const doneBtn = screen.getByTestId("totp-setup-done-btn");
      fireEvent.click(doneBtn);

      expect(mockOnClose).toHaveBeenCalledTimes(1);
    });

    it("calls onClose on Escape key press", () => {
      render(
        <TotpSetupModal
          isOpen={true}
          onClose={mockOnClose}
          secret={defaultSecret}
          accountName={defaultAccount}
        />,
      );

      const dialog = screen.getByRole("dialog");
      fireEvent.keyDown(dialog, { key: "Escape", code: "Escape" });

      expect(mockOnClose).toHaveBeenCalled();
    });

    it("calls onClose on direct backdrop click when closeOnBackdropClick is true", () => {
      render(
        <TotpSetupModal
          isOpen={true}
          onClose={mockOnClose}
          secret={defaultSecret}
          accountName={defaultAccount}
          closeOnBackdropClick={true}
        />,
      );

      const overlay = screen.getByTestId("totp-setup-overlay");
      fireEvent.click(overlay);

      expect(mockOnClose).toHaveBeenCalledTimes(1);
    });

    it("does not call onClose when clicking inside the dialog card", () => {
      render(
        <TotpSetupModal
          isOpen={true}
          onClose={mockOnClose}
          secret={defaultSecret}
          accountName={defaultAccount}
          closeOnBackdropClick={true}
        />,
      );

      const modal = screen.getByTestId("totp-setup-modal");
      fireEvent.click(modal);

      expect(mockOnClose).not.toHaveBeenCalled();
    });

    it("does not call onClose on backdrop click when closeOnBackdropClick is false", () => {
      render(
        <TotpSetupModal
          isOpen={true}
          onClose={mockOnClose}
          secret={defaultSecret}
          accountName={defaultAccount}
          closeOnBackdropClick={false}
        />,
      );

      const overlay = screen.getByTestId("totp-setup-overlay");
      fireEvent.click(overlay);

      expect(mockOnClose).not.toHaveBeenCalled();
    });
  });
});
