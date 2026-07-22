import React from "react";
import { render, screen } from "@testing-library/react";
import { SignatureVerificationBadge } from "../SignatureVerificationBadge";

describe("SignatureVerificationBadge", () => {
  it("renders verified state with signer name", () => {
    render(
      <SignatureVerificationBadge
        status="verified"
        result={{
          valid: true,
          signerName: "DigiCert Inc",
          signingTime: "2026-01-15",
          algorithm: "sha256WithRSAEncryption",
          error: "",
        }}
      />,
    );
    expect(screen.getByText("Digitally Verified")).toBeInTheDocument();
    expect(screen.getByText(/by DigiCert Inc/)).toBeInTheDocument();
  });

  it("renders invalid state with error", () => {
    render(
      <SignatureVerificationBadge
        status="invalid"
        result={{
          valid: false,
          signerName: "",
          signingTime: "",
          algorithm: "",
          error: "Certificate chain broken",
        }}
      />,
    );
    expect(screen.getByText("Signature Invalid")).toBeInTheDocument();
    expect(screen.getByText("Certificate chain broken")).toBeInTheDocument();
  });

  it("renders unsigned state", () => {
    render(<SignatureVerificationBadge status="unsigned" />);
    expect(screen.getByText("No Digital Signature")).toBeInTheDocument();
  });

  it("renders loading state", () => {
    render(<SignatureVerificationBadge status="loading" />);
    expect(screen.getByText("Verifying Signature...")).toBeInTheDocument();
  });

  it("renders verifying state", () => {
    render(<SignatureVerificationBadge status="verifying" />);
    expect(screen.getByText("Verifying Signature...")).toBeInTheDocument();
  });

  it("renders error state", () => {
    render(<SignatureVerificationBadge status="error" />);
    expect(screen.getByText("Verification Error")).toBeInTheDocument();
  });

  it("renders idle state", () => {
    render(<SignatureVerificationBadge status="idle" />);
    expect(screen.getByText("Awaiting Verification")).toBeInTheDocument();
  });

  it("accepts custom className", () => {
    const { container } = render(
      <SignatureVerificationBadge status="idle" className="my-class" />,
    );
    expect(container.firstChild).toHaveClass("my-class");
  });
});
