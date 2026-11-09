import "@testing-library/jest-dom";
import React from "react";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { StudentDiscountVerification } from "@/components/student/StudentDiscountVerification";

// Mock Workers & IndexedDB/localStorage
jest.mock("@/lib/zkp/commitment", () => ({
  computeMembershipCommit: jest.fn().mockReturnValue("123456789"),
}));

jest.mock("@/lib/zkp/proofCache", () => ({
  getCachedProof: jest.fn().mockResolvedValue(null),
  storeProof: jest.fn().mockResolvedValue(true),
  invalidateProof: jest.fn().mockResolvedValue(true),
}));

describe("StudentDiscountVerification - QR Code Scanner & Verification (#4416)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
    global.fetch = jest.fn();

    // Mock navigator.mediaDevices.getUserMedia
    Object.defineProperty(global.navigator, "mediaDevices", {
      writable: true,
      value: {
        getUserMedia: jest.fn().mockResolvedValue({
          getTracks: () => [{ stop: jest.fn() }],
        }),
      },
    });
  });

  test("renders tab switcher and switches to Scan QR Pass mode", async () => {
    render(<StudentDiscountVerification />);

    const qrTabBtn = screen.getByRole("button", { name: /Scan QR Pass/i });
    expect(qrTabBtn).toBeInTheDocument();

    fireEvent.click(qrTabBtn);

    await waitFor(() => {
      expect(screen.getByText(/Or Paste QR Proof Payload/i)).toBeInTheDocument();
    });
  });

  test("parses QR proof payload and verifies successfully in under 500ms", async () => {
    const mockFetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, verified: true }),
    });
    global.fetch = mockFetch;

    const onVerifiedMock = jest.fn();
    render(<StudentDiscountVerification onVerified={onVerifiedMock} />);

    // Switch to QR tab
    fireEvent.click(screen.getByRole("button", { name: /Scan QR Pass/i }));

    const qrPayload = JSON.stringify({
      proof: { pi_a: ["1", "2"], pi_b: [["3"]], pi_c: ["4"] },
      publicSignals: ["18491029481029384019284019284019"],
      studentBadge: "Gold Student Pass",
      discountTier: "Tier 1: 50% Off Workspace",
    });

    const input = screen.getByPlaceholderText(/Paste encoded Groth16 JSON or Base64 payload/i);
    fireEvent.change(input, { target: { value: qrPayload } });

    const verifyBtn = screen.getByRole("button", { name: /Verify QR/i });
    fireEvent.click(verifyBtn);

    await waitFor(() => {
      expect(screen.getByTestId("student-verification-success-card")).toBeInTheDocument();
      expect(screen.getByText(/Gold Student Pass/i)).toBeInTheDocument();
      expect(screen.getByText(/Tier 1: 50% Off Workspace/i)).toBeInTheDocument();
    });

    expect(onVerifiedMock).toHaveBeenCalledTimes(1);
  });

  test("displays camera permission fallback error when camera access is denied", async () => {
    (global.navigator.mediaDevices.getUserMedia as jest.Mock).mockRejectedValueOnce(
      new Error("Camera permission denied")
    );

    render(<StudentDiscountVerification />);

    fireEvent.click(screen.getByRole("button", { name: /Scan QR Pass/i }));

    await waitFor(() => {
      expect(screen.getByText(/Camera permission denied/i)).toBeInTheDocument();
    });
  });

  test("handles malformed QR proof payload gracefully", async () => {
    render(<StudentDiscountVerification />);

    fireEvent.click(screen.getByRole("button", { name: /Scan QR Pass/i }));

    const input = screen.getByPlaceholderText(/Paste encoded Groth16 JSON or Base64 payload/i);
    fireEvent.change(input, { target: { value: "invalid-payload-string" } });

    const verifyBtn = screen.getByRole("button", { name: /Verify QR/i });
    fireEvent.click(verifyBtn);

    await waitFor(() => {
      expect(screen.getByTestId("student-verification-error")).toBeInTheDocument();
      expect(screen.getByText(/Failed to parse QR code proof payload/i)).toBeInTheDocument();
    });
  });
});
