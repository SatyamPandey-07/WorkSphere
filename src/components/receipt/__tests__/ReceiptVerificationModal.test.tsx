import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { ReceiptVerificationModal } from "../ReceiptVerificationModal";

jest.mock("@/hooks/usePdfSignatureVerifier", () => ({
  usePdfSignatureVerifier: () => ({
    status: "idle",
    progress: 0,
    signatures: [],
    result: null,
    error: null,
    verify: jest.fn(),
    reset: jest.fn(),
  }),
}));

describe("ReceiptVerificationModal", () => {
  const onClose = jest.fn();

  beforeEach(() => {
    onClose.mockClear();
  });

  it("renders nothing when open is false", () => {
    const { container } = render(
      <ReceiptVerificationModal open={false} onClose={onClose} />,
    );
    expect(container.innerHTML).toBe("");
  });

  it("renders modal when open is true", () => {
    render(<ReceiptVerificationModal open={true} onClose={onClose} />);
    expect(
      screen.getByText("Verify PDF Receipt Signature"),
    ).toBeInTheDocument();
  });

  it("shows dropzone when no file selected", () => {
    render(<ReceiptVerificationModal open={true} onClose={onClose} />);
    expect(screen.getByText(/Drop a PDF receipt here/)).toBeInTheDocument();
  });

  it("calls onClose when close button clicked", () => {
    render(<ReceiptVerificationModal open={true} onClose={onClose} />);
    fireEvent.click(screen.getByLabelText("Close modal"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("calls onClose when overlay clicked", () => {
    render(<ReceiptVerificationModal open={true} onClose={onClose} />);
    const overlay = document.querySelector(".fixed.inset-0");
    expect(overlay).toBeTruthy();
    fireEvent.click(overlay!);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does not close when modal body clicked", () => {
    render(<ReceiptVerificationModal open={true} onClose={onClose} />);
    const modal = document.querySelector(".bg-white.dark\\:bg-zinc-900");
    expect(modal).toBeTruthy();
    fireEvent.click(modal!);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("shows footer text about OpenSSL WASM", () => {
    render(<ReceiptVerificationModal open={true} onClose={onClose} />);
    expect(
      screen.getByText(/WebAssembly-compiled OpenSSL/),
    ).toBeInTheDocument();
  });

  it("renders valid documentation link with target=_blank and rel=noopener", () => {
    render(<ReceiptVerificationModal open={true} onClose={onClose} />);
    const docLink = screen.getByRole("link", { name: /Documentation/i });
    expect(docLink).toHaveAttribute(
      "href",
      "/docs/WASM_DIGITAL_SIGNATURE_VERIFICATION_GUIDE.md",
    );
    expect(docLink).toHaveAttribute("target", "_blank");
    expect(docLink).toHaveAttribute("rel", "noopener noreferrer");
  });
});
