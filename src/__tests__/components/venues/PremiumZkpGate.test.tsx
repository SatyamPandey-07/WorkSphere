import React from "react";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import "@testing-library/jest-dom";
import { PremiumZkpGate } from "@/components/venues/PremiumZkpGate";
import { ZkpAccessResult, ZkpProgressStage } from "@/lib/zkp/client";

jest.mock("@/lib/zkp/client", () => ({
  provePremiumAccess: jest.fn(),
}));

import { provePremiumAccess } from "@/lib/zkp/client";

const mockedProvePremiumAccess = provePremiumAccess as unknown as jest.Mock;

describe("PremiumZkpGate", () => {
  const defaultProps = {
    venueId: "venue-101",
    venueName: "Cyberpunk Nomad Loft",
  };

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
  });

  afterEach(() => {
    act(() => {
      jest.runOnlyPendingTimers();
    });
    jest.useRealTimers();
  });

  it("renders idle state with token input and disabled submit button", () => {
    render(<PremiumZkpGate {...defaultProps} />);

    expect(screen.getByTestId("premium-zkp-gate")).toBeInTheDocument();
    expect(screen.getByText("Premium access (zero-knowledge)")).toBeInTheDocument();
    expect(screen.getByTestId("premium-zkp-token-input")).toHaveValue("");
    expect(screen.getByTestId("premium-zkp-prove-btn")).toBeDisabled();
    expect(screen.queryByTestId("premium-zkp-cancel-btn")).not.toBeInTheDocument();
  });

  it("enables prove button when a non-whitespace token is entered", () => {
    render(<PremiumZkpGate {...defaultProps} />);

    const input = screen.getByTestId("premium-zkp-token-input");
    const proveBtn = screen.getByTestId("premium-zkp-prove-btn");

    fireEvent.change(input, { target: { value: "   " } });
    expect(proveBtn).toBeDisabled();

    fireEvent.change(input, { target: { value: "token-secret-999" } });
    expect(proveBtn).toBeEnabled();
  });

  it("handles progress callback transitions and displays cancel button while busy", async () => {
    let capturedProgress: ((stage: ZkpProgressStage) => void) | undefined;
    mockedProvePremiumAccess.mockImplementation(async (opts: { onProgress?: (s: ZkpProgressStage) => void }) => {
      capturedProgress = opts.onProgress;
      return new Promise<ZkpAccessResult>(() => {});
    });

    render(<PremiumZkpGate {...defaultProps} />);

    const input = screen.getByTestId("premium-zkp-token-input");
    fireEvent.change(input, { target: { value: "token-123" } });

    const proveBtn = screen.getByTestId("premium-zkp-prove-btn");
    fireEvent.click(proveBtn);

    expect(screen.getByTestId("premium-zkp-cancel-btn")).toBeInTheDocument();
    expect(screen.getByText("Proving…")).toBeInTheDocument();

    act(() => {
      capturedProgress?.("verifying");
    });

    expect(screen.getByText("Verifying…")).toBeInTheDocument();
  });

  it("successfully grants access on valid proof, displaying token and triggering onSuccess", async () => {
    const onSuccess = jest.fn();
    mockedProvePremiumAccess.mockResolvedValue({
      allowed: true,
      accessToken: "zkp_token_xyz_888",
      proveMs: 142,
    });

    render(<PremiumZkpGate {...defaultProps} onSuccess={onSuccess} />);

    const input = screen.getByTestId("premium-zkp-token-input");
    fireEvent.change(input, { target: { value: "valid-member-token" } });

    const proveBtn = screen.getByTestId("premium-zkp-prove-btn");
    fireEvent.click(proveBtn);

    await waitFor(() => {
      expect(screen.getByTestId("premium-zkp-success-banner")).toBeInTheDocument();
      expect(screen.getByTestId("premium-zkp-access-token")).toHaveTextContent("zkp_token_xyz_888");
      expect(screen.getByText(/Verified in 142ms. Access granted to Cyberpunk Nomad Loft./)).toBeInTheDocument();
      expect(onSuccess).toHaveBeenCalledWith("zkp_token_xyz_888");
    });
  });

  it("copies access token to clipboard and resets checkmark icon after timeout", async () => {
    const writeTextMock = jest.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: {
        writeText: writeTextMock,
      },
    });

    mockedProvePremiumAccess.mockResolvedValue({
      allowed: true,
      accessToken: "zkp_access_copy_test",
      proveMs: 95,
    });

    render(<PremiumZkpGate {...defaultProps} />);

    fireEvent.change(screen.getByTestId("premium-zkp-token-input"), {
      target: { value: "member-pass-1" },
    });
    fireEvent.click(screen.getByTestId("premium-zkp-prove-btn"));

    await waitFor(() => {
      expect(screen.getByTestId("premium-zkp-copy-btn")).toBeInTheDocument();
    });

    const copyBtn = screen.getByTestId("premium-zkp-copy-btn");
    fireEvent.click(copyBtn);

    expect(writeTextMock).toHaveBeenCalledWith("zkp_access_copy_test");
    expect(screen.getByTestId("premium-zkp-copied-icon")).toBeInTheDocument();

    act(() => {
      jest.advanceTimersByTime(2000);
    });

    expect(screen.queryByTestId("premium-zkp-copied-icon")).not.toBeInTheDocument();
  });

  it("handles access denied result, displaying error message and triggering onError", async () => {
    const onError = jest.fn();
    mockedProvePremiumAccess.mockResolvedValue({
      allowed: false,
      error: "Membership token is expired or revoked",
    });

    render(<PremiumZkpGate {...defaultProps} onError={onError} />);

    fireEvent.change(screen.getByTestId("premium-zkp-token-input"), {
      target: { value: "expired-token" },
    });
    fireEvent.click(screen.getByTestId("premium-zkp-prove-btn"));

    await waitFor(() => {
      expect(screen.getByTestId("premium-zkp-error-msg")).toHaveTextContent(
        "Membership token is expired or revoked"
      );
      expect(onError).toHaveBeenCalledWith("Membership token is expired or revoked");
    });
  });

  it("handles unexpected rejection and displays fallback error message", async () => {
    const onError = jest.fn();
    mockedProvePremiumAccess.mockRejectedValue(new Error("RPC node unreachable"));

    render(<PremiumZkpGate {...defaultProps} onError={onError} />);

    fireEvent.change(screen.getByTestId("premium-zkp-token-input"), {
      target: { value: "test-token" },
    });
    fireEvent.click(screen.getByTestId("premium-zkp-prove-btn"));

    await waitFor(() => {
      expect(screen.getByTestId("premium-zkp-error-msg")).toHaveTextContent(
        "RPC node unreachable"
      );
      expect(onError).toHaveBeenCalledWith("RPC node unreachable");
    });
  });

  it("aborts active verification when Cancel button is clicked", async () => {
    let capturedSignal: AbortSignal | undefined;
    mockedProvePremiumAccess.mockImplementation(async (opts: { signal?: AbortSignal }) => {
      capturedSignal = opts.signal;
      return new Promise<ZkpAccessResult>(() => {});
    });

    render(<PremiumZkpGate {...defaultProps} />);

    fireEvent.change(screen.getByTestId("premium-zkp-token-input"), {
      target: { value: "token-to-cancel" },
    });
    fireEvent.click(screen.getByTestId("premium-zkp-prove-btn"));

    const cancelBtn = screen.getByTestId("premium-zkp-cancel-btn");
    fireEvent.click(cancelBtn);

    expect(capturedSignal?.aborted).toBe(true);
    expect(screen.getByTestId("premium-zkp-prove-btn")).toBeEnabled();
    expect(screen.queryByTestId("premium-zkp-cancel-btn")).not.toBeInTheDocument();
  });

  it("aborts active request on component unmount", async () => {
    let capturedSignal: AbortSignal | undefined;
    mockedProvePremiumAccess.mockImplementation(async (opts: { signal?: AbortSignal }) => {
      capturedSignal = opts.signal;
      return new Promise<ZkpAccessResult>(() => {});
    });

    const { unmount } = render(<PremiumZkpGate {...defaultProps} />);

    fireEvent.change(screen.getByTestId("premium-zkp-token-input"), {
      target: { value: "token-to-unmount" },
    });
    fireEvent.click(screen.getByTestId("premium-zkp-prove-btn"));

    unmount();

    expect(capturedSignal?.aborted).toBe(true);
  });
});
