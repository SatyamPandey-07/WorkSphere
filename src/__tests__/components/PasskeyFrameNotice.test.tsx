import React from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";
import "@testing-library/jest-dom";
import { PasskeyFrameNotice } from "@/components/PasskeyFrameNotice";
import * as passkeysClient from "@/lib/auth/passkeys/client";

jest.mock("@/lib/auth/passkeys/client", () => ({
  getFrameWebAuthnStatus: jest.fn(),
  installWebAuthnFrameGuard: jest.fn(),
}));

describe("PasskeyFrameNotice Component (#6923)", () => {
  let mockCleanup: jest.Mock;
  let guardCallback: (() => void) | null = null;

  beforeEach(() => {
    jest.clearAllMocks();
    mockCleanup = jest.fn();
    guardCallback = null;

    (passkeysClient.getFrameWebAuthnStatus as jest.Mock).mockReturnValue({
      isEmbedded: false,
      isCrossOrigin: false,
      permissionDelegated: true,
      shouldBlockPasskeys: false,
    });

    (passkeysClient.installWebAuthnFrameGuard as jest.Mock).mockImplementation((cb) => {
      guardCallback = cb;
      return mockCleanup;
    });
  });

  it("does not render when frame status does not block passkeys", () => {
    render(<PasskeyFrameNotice />);
    expect(screen.queryByTestId("passkey-frame-notice")).not.toBeInTheDocument();
  });

  it("renders when shouldBlockPasskeys is true", () => {
    (passkeysClient.getFrameWebAuthnStatus as jest.Mock).mockReturnValue({
      isEmbedded: true,
      isCrossOrigin: true,
      permissionDelegated: false,
      shouldBlockPasskeys: true,
    });

    render(<PasskeyFrameNotice />);

    const notice = screen.getByTestId("passkey-frame-notice");
    expect(notice).toBeInTheDocument();
    expect(notice).toHaveAttribute("role", "status");
    expect(screen.getByTestId("passkey-frame-notice-icon")).toBeInTheDocument();
    expect(screen.getByTestId("passkey-frame-notice-message")).toHaveTextContent(
      "Passkey sign-in isn't available in this embedded view"
    );
    expect(screen.getByTestId("passkey-frame-notice-dismiss")).toBeInTheDocument();
  });

  it("renders when forceVisible is true even if shouldBlockPasskeys is false", () => {
    render(<PasskeyFrameNotice forceVisible={true} />);

    expect(screen.getByTestId("passkey-frame-notice")).toBeInTheDocument();
  });

  it("renders custom message and applies custom className and testId", () => {
    render(
      <PasskeyFrameNotice
        forceVisible={true}
        message="Custom security restriction warning."
        className="custom-notice-class"
        testId="custom-notice-id"
      />
    );

    const notice = screen.getByTestId("custom-notice-id");
    expect(notice).toHaveClass("custom-notice-class");
    expect(screen.getByTestId("passkey-frame-notice-message")).toHaveTextContent(
      "Custom security restriction warning."
    );
  });

  it("dismisses notice when close button is clicked and triggers onDismiss callback", () => {
    const handleDismiss = jest.fn();
    render(<PasskeyFrameNotice forceVisible={true} onDismiss={handleDismiss} />);

    const dismissBtn = screen.getByTestId("passkey-frame-notice-dismiss");
    fireEvent.click(dismissBtn);

    expect(handleDismiss).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("passkey-frame-notice")).not.toBeInTheDocument();
  });

  it("reveals notice when installWebAuthnFrameGuard invokes its callback", () => {
    render(<PasskeyFrameNotice />);

    expect(screen.queryByTestId("passkey-frame-notice")).not.toBeInTheDocument();

    // Trigger guard callback wrapped in act
    expect(guardCallback).not.toBeNull();
    act(() => {
      guardCallback!();
    });

    expect(screen.getByTestId("passkey-frame-notice")).toBeInTheDocument();
  });

  it("cleans up frame guard on unmount and prevents state updates after unmount", () => {
    const { unmount } = render(<PasskeyFrameNotice />);

    expect(passkeysClient.installWebAuthnFrameGuard).toHaveBeenCalled();
    unmount();

    expect(mockCleanup).toHaveBeenCalledTimes(1);

    // Invoking callback after unmount should not throw or cause state update errors
    expect(() => {
      if (guardCallback) {
        guardCallback();
      }
    }).not.toThrow();
  });
});
