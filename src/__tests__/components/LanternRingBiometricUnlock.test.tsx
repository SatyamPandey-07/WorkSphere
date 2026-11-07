import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { LanternRingBiometricUnlock } from "@/components/auth/LanternRingBiometricUnlock";

describe("LanternRingBiometricUnlock (#6331)", () => {
  const originalCredentials = navigator.credentials;
  const originalPublicKeyCredential = window.PublicKeyCredential;

  beforeEach(() => {
    jest.clearAllMocks();

    // Mock HTMLCanvasElement.getContext
    HTMLCanvasElement.prototype.getContext = jest.fn().mockReturnValue({
      scale: jest.fn(),
      clearRect: jest.fn(),
      fillRect: jest.fn(),
      beginPath: jest.fn(),
      arc: jest.fn(),
      fill: jest.fn(),
      stroke: jest.fn(),
      save: jest.fn(),
      restore: jest.fn(),
      translate: jest.fn(),
      rotate: jest.fn(),
      moveTo: jest.fn(),
      lineTo: jest.fn(),
      closePath: jest.fn(),
      createLinearGradient: jest.fn().mockReturnValue({
        addColorStop: jest.fn(),
      }),
      createRadialGradient: jest.fn().mockReturnValue({
        addColorStop: jest.fn(),
      }),
    });

    // Mock window.requestAnimationFrame
    jest.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
      return setTimeout(() => cb(performance.now()), 16) as unknown as number;
    });

    // Mock window.cancelAnimationFrame
    jest.spyOn(window, "cancelAnimationFrame").mockImplementation((id) => {
      clearTimeout(id);
    });

    // Mock window.PublicKeyCredential
    (window as any).PublicKeyCredential = function () {};

    // Mock navigator.credentials.get
    Object.defineProperty(navigator, "credentials", {
      value: {
        get: jest.fn(),
        create: jest.fn(),
      },
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    Object.defineProperty(navigator, "credentials", {
      value: originalCredentials,
      writable: true,
      configurable: true,
    });
    (window as any).PublicKeyCredential = originalPublicKeyCredential;
    jest.restoreAllMocks();
  });

  it("renders 3D Green Lantern ring reticle, targeting arcs, and willpower HUD", () => {
    render(
      <LanternRingBiometricUnlock
        userName="Hal Jordan"
        challenge="test_challenge_123"
      />,
    );

    // Main component container
    expect(
      screen.getByTestId("lantern-ring-biometric-unlock"),
    ).toBeInTheDocument();

    // 3D Ring Reticle and targeting arcs
    expect(screen.getByTestId("lantern-ring-reticle")).toBeInTheDocument();
    expect(screen.getByTestId("ring-targeting-arcs")).toBeInTheDocument();
    expect(screen.getByTestId("ring-ambient-aura")).toBeInTheDocument();

    // Energy burst canvas element
    expect(
      screen.getByTestId("emerald-energy-burst-canvas"),
    ).toBeInTheDocument();

    // User name and willpower telemetry
    expect(screen.getByText(/HAL JORDAN/i)).toBeInTheDocument();
    expect(screen.getByText(/Willpower Reserve: 100%/i)).toBeInTheDocument();
    expect(
      screen.getByText(/Tap Ring Reticle to Authenticate/i),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("biometric-trigger-btn"),
    ).toBeInTheDocument();
  });

  it("executes FIDO2 WebAuthn credential assertion ceremony and triggers emerald energy burst on success", async () => {
    const mockOnUnlockSuccess = jest.fn();

    const mockCredential = {
      id: "mock_cred_id_hal_jordan",
      type: "public-key",
      rawId: new Uint8Array([1, 2, 3, 4]).buffer,
      response: {
        clientDataJSON: new Uint8Array([5, 6, 7, 8]).buffer,
        authenticatorData: new Uint8Array([9, 10, 11]).buffer,
        signature: new Uint8Array([12, 13, 14, 15]).buffer,
        userHandle: new Uint8Array([16, 17]).buffer,
      },
    };

    (navigator.credentials.get as jest.Mock).mockResolvedValue(mockCredential);

    render(
      <LanternRingBiometricUnlock
        onUnlockSuccess={mockOnUnlockSuccess}
        userName="Hal Jordan"
      />,
    );

    const reticle = screen.getByTestId("lantern-ring-reticle");
    fireEvent.click(reticle);

    // Verifying state indicates scanning
    expect(
      screen.getByText(/Awaiting Hardware Biometric Assertion/i),
    ).toBeInTheDocument();

    // FIDO2 navigator.credentials.get assertion called with publicKey options
    await waitFor(() => {
      expect(navigator.credentials.get).toHaveBeenCalledWith(
        expect.objectContaining({
          publicKey: expect.objectContaining({
            timeout: 60000,
            userVerification: "preferred",
          }),
        }),
      );
    });

    // Verification succeeded
    await waitFor(() => {
      expect(
        screen.getByText(/Cryptographic Assertion Verified!/i),
      ).toBeInTheDocument();
    });

    // Canvas energy burst active
    const canvas = screen.getByTestId("emerald-energy-burst-canvas");
    expect(canvas).toHaveClass("opacity-100");

    // Success callback invoked
    await waitFor(() => {
      expect(mockOnUnlockSuccess).toHaveBeenCalledWith(mockCredential);
    });
  });

  it("handles user cancellation (NotAllowedError) gracefully", async () => {
    const mockOnCancel = jest.fn();
    const notAllowedError = new DOMException(
      "The operation either timed out or was not allowed by the user.",
      "NotAllowedError",
    );

    (navigator.credentials.get as jest.Mock).mockRejectedValue(notAllowedError);

    render(<LanternRingBiometricUnlock onCancel={mockOnCancel} />);

    const triggerBtn = screen.getByTestId("biometric-trigger-btn");
    fireEvent.click(triggerBtn);

    await waitFor(() => {
      expect(screen.getByTestId("auth-error-banner")).toBeInTheDocument();
      expect(screen.getByTestId("auth-error-cancelled")).toBeInTheDocument();
      expect(
        screen.getByText(/Biometric ceremony canceled or denied by user/i),
      ).toBeInTheDocument();
    });

    expect(mockOnCancel).toHaveBeenCalledTimes(1);
  });

  it("handles hardware timeout (TimeoutError) gracefully", async () => {
    const timeoutError = new DOMException(
      "The authenticator operation timed out.",
      "TimeoutError",
    );

    (navigator.credentials.get as jest.Mock).mockRejectedValue(timeoutError);

    render(<LanternRingBiometricUnlock />);

    const reticle = screen.getByTestId("lantern-ring-reticle");
    fireEvent.click(reticle);

    await waitFor(() => {
      expect(screen.getByTestId("auth-error-banner")).toBeInTheDocument();
      expect(screen.getByTestId("auth-error-timeout")).toBeInTheDocument();
      expect(
        screen.getByText(/Biometric hardware sensor timed out/i),
      ).toBeInTheDocument();
    });
  });

  it("handles unsupported hardware (NotSupportedError) gracefully", async () => {
    const notSupportedError = new DOMException(
      "The requested platform authenticator is not supported.",
      "NotSupportedError",
    );

    (navigator.credentials.get as jest.Mock).mockRejectedValue(notSupportedError);

    render(<LanternRingBiometricUnlock />);

    const reticle = screen.getByTestId("lantern-ring-reticle");
    fireEvent.click(reticle);

    await waitFor(() => {
      expect(screen.getByTestId("auth-error-banner")).toBeInTheDocument();
      expect(screen.getByTestId("auth-error-unsupported")).toBeInTheDocument();
      expect(
        screen.getByText(/Biometric FIDO2 hardware is not supported on this platform/i),
      ).toBeInTheDocument();
    });
  });

  it("supports retrying verification from error state", async () => {
    const notAllowedError = new DOMException(
      "User canceled prompt",
      "NotAllowedError",
    );

    (navigator.credentials.get as jest.Mock).mockRejectedValueOnce(notAllowedError);

    render(<LanternRingBiometricUnlock />);

    // First attempt fails
    fireEvent.click(screen.getByTestId("biometric-trigger-btn"));

    await waitFor(() => {
      expect(screen.getByTestId("auth-error-banner")).toBeInTheDocument();
    });

    // Mock success for second attempt
    const mockSuccessCred = {
      id: "retry_cred_success",
      type: "public-key",
      response: {
        clientDataJSON: new Uint8Array([1]).buffer,
        signature: new Uint8Array([2]).buffer,
      },
    };
    (navigator.credentials.get as jest.Mock).mockResolvedValueOnce(mockSuccessCred);

    // Click retry button
    const retryBtn = screen.getByTestId("retry-auth-btn");
    fireEvent.click(retryBtn);

    await waitFor(() => {
      expect(screen.queryByTestId("auth-error-banner")).not.toBeInTheDocument();
      expect(
        screen.getByText(/Cryptographic Assertion Verified!/i),
      ).toBeInTheDocument();
    });
  });

  it("triggers assertion on keyboard Enter or Space on ring reticle", async () => {
    (navigator.credentials.get as jest.Mock).mockResolvedValue({
      id: "keyboard_cred_id",
      type: "public-key",
      response: {
        clientDataJSON: new Uint8Array([1]).buffer,
        signature: new Uint8Array([2]).buffer,
      },
    });

    render(<LanternRingBiometricUnlock />);

    const reticle = screen.getByTestId("lantern-ring-reticle");
    fireEvent.keyDown(reticle, { key: "Enter" });

    await waitFor(() => {
      expect(navigator.credentials.get).toHaveBeenCalled();
    });
  });
});
