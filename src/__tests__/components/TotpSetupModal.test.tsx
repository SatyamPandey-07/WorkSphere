import React from "react";
import { render, screen, fireEvent, act, within } from "@testing-library/react";
import "@testing-library/jest-dom";
import { TotpSetupModal } from "@/components/auth/TotpSetupModal";
import { generateQRMatrix } from "@/lib/qr/svgQr";

jest.mock("@/lib/qr/svgQr", () => ({
  generateQRMatrix: jest.fn(),
}));

const mockGenerateQRMatrix = generateQRMatrix as jest.MockedFunction<
  typeof generateQRMatrix
>;

const SECRET = "JBSWY3DPEHPK3PXP";
const URI =
  "otpauth://totp/WorkSphere:alex%40example.com?secret=JBSWY3DPEHPK3PXP&issuer=WorkSphere";
const RECOVERY_CODES = ["a1b2-c3d4", "e5f6-g7h8", "i9j0-k1l2", "m3n4-o5p6"];

type ModalProps = React.ComponentProps<typeof TotpSetupModal>;

function renderModal(props: Partial<ModalProps> = {}) {
  const onClose = jest.fn();
  const utils = render(
    <TotpSetupModal
      isOpen
      onClose={onClose}
      secret={SECRET}
      accountName="alex@example.com"
      recoveryCodes={RECOVERY_CODES}
      {...props}
    />,
  );
  return { onClose, ...utils };
}

describe("TotpSetupModal", () => {
  beforeEach(() => {
    mockGenerateQRMatrix.mockReset();
    mockGenerateQRMatrix.mockReturnValue([
      [true, false],
      [false, true],
    ]);
  });

  describe("dialog", () => {
    it("renders nothing when closed", () => {
      const { container } = renderModal({ isOpen: false });
      expect(container).toBeEmptyDOMElement();
      expect(mockGenerateQRMatrix).not.toHaveBeenCalled();
    });

    it("is an accessible, labelled modal dialog", () => {
      renderModal();
      const dialog = screen.getByRole("dialog", {
        name: "Set up two-factor authentication",
      });
      expect(dialog).toHaveAttribute("aria-modal", "true");
    });

    it("closes from the Done button and the close icon", () => {
      const { onClose } = renderModal();

      fireEvent.click(screen.getByRole("button", { name: "Done" }));
      expect(onClose).toHaveBeenCalledTimes(1);

      fireEvent.click(screen.getByRole("button", { name: "Close" }));
      expect(onClose).toHaveBeenCalledTimes(2);
    });

    it("closes on Escape", () => {
      const { onClose } = renderModal();
      fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
      expect(onClose).toHaveBeenCalled();
    });
  });

  describe("QR code", () => {
    it("encodes the otpauth provisioning URI", () => {
      renderModal();
      expect(mockGenerateQRMatrix).toHaveBeenCalledWith(URI);
    });

    it("uses a custom issuer", () => {
      renderModal({ issuer: "Acme Corp" });
      expect(mockGenerateQRMatrix).toHaveBeenCalledWith(
        "otpauth://totp/Acme%20Corp:alex%40example.com?secret=JBSWY3DPEHPK3PXP&issuer=Acme%20Corp",
      );
    });

    it("renders a scalable SVG with a quiet zone, drawn from the matrix", () => {
      renderModal();
      const svg = screen.getByRole("img", { name: /qr code/i });

      // 2 modules + a 4 module quiet zone on each side
      expect(svg).toHaveAttribute("viewBox", "0 0 10 10");
      expect(svg).toHaveAttribute("shape-rendering", "crispEdges");
      expect(svg.querySelector("path")).toHaveAttribute(
        "d",
        "M0 0h1v1h-1zM1 1h1v1h-1z",
      );
    });

    it("does not leak the secret into the SVG", () => {
      renderModal();
      const svg = screen.getByRole("img", { name: /qr code/i });
      expect(svg.outerHTML).not.toContain(SECRET);
    });

    it("falls back to the setup key when the QR code cannot be generated", () => {
      mockGenerateQRMatrix.mockImplementation(() => {
        throw new Error("Data too long");
      });
      renderModal();

      expect(screen.queryByRole("img", { name: /qr code/i })).toBeNull();
      expect(screen.getByText(/QR code is unavailable/i)).toBeInTheDocument();
      expect(screen.getByTestId("totp-secret")).toHaveTextContent(
        "JBSW Y3DP EHPK 3PXP",
      );
      expect(
        screen.getByRole("button", { name: /copy to clipboard/i }),
      ).toBeInTheDocument();
    });
  });

  describe("setup key and copy", () => {
    const originalClipboard = navigator.clipboard;

    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
      Object.assign(navigator, { clipboard: originalClipboard });
    });

    it("shows the secret in readable groups", () => {
      renderModal();
      expect(screen.getByTestId("totp-secret")).toHaveTextContent(
        "JBSW Y3DP EHPK 3PXP",
      );
    });

    it("copies the plain secret and shows feedback", async () => {
      const writeText = jest.fn().mockResolvedValue(undefined);
      Object.assign(navigator, { clipboard: { writeText } });
      renderModal();

      await act(async () => {
        fireEvent.click(
          screen.getByRole("button", { name: /copy to clipboard/i }),
        );
      });

      expect(writeText).toHaveBeenCalledWith(SECRET);
      expect(screen.getByText("Copied!")).toBeInTheDocument();
      expect(screen.getByRole("status")).toHaveTextContent(
        "Secret key copied!",
      );
    });

    it("copies the normalized secret when given a lowercase, spaced one", async () => {
      const writeText = jest.fn().mockResolvedValue(undefined);
      Object.assign(navigator, { clipboard: { writeText } });
      renderModal({ secret: "jbsw y3dp ehpk 3pxp" });

      await act(async () => {
        fireEvent.click(
          screen.getByRole("button", { name: /copy to clipboard/i }),
        );
      });

      expect(writeText).toHaveBeenCalledWith(SECRET);
    });
  });

  describe("recovery codes", () => {
    it("lists every code in a monospaced grid", () => {
      renderModal();
      const list = screen.getByRole("list", { name: /recovery codes/i });
      const items = within(list).getAllByRole("listitem");

      expect(items).toHaveLength(RECOVERY_CODES.length);
      items.forEach((item, index) => {
        expect(item).toHaveTextContent(RECOVERY_CODES[index]);
        expect(item).toHaveClass("font-mono");
      });
      expect(list).toHaveClass("grid");
    });

    it("hides the recovery section when there are no codes", () => {
      renderModal({ recoveryCodes: [] });
      expect(screen.queryByRole("list")).toBeNull();
      expect(screen.queryByText(/recovery codes/i)).toBeNull();
    });
  });

  describe("invalid secret", () => {
    it("shows an error instead of a QR code or copy button", () => {
      renderModal({ secret: "not a valid key!" });

      expect(screen.getByRole("alert")).toHaveTextContent(/invalid/i);
      expect(screen.queryByRole("img", { name: /qr code/i })).toBeNull();
      expect(
        screen.queryByRole("button", { name: /copy to clipboard/i }),
      ).toBeNull();
      expect(mockGenerateQRMatrix).not.toHaveBeenCalled();
    });

    it("can still be closed", () => {
      const { onClose } = renderModal({ secret: "" });
      fireEvent.click(screen.getByRole("button", { name: "Done" }));
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });
});
