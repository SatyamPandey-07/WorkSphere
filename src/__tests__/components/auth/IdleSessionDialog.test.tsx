import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import IdleSessionDialog from "@/components/auth/IdleSessionDialog";
import { useIdleSession } from "@/hooks/useIdleSession";

jest.mock("@/hooks/useIdleSession");

const mockedUseIdleSession = useIdleSession as jest.MockedFunction<typeof useIdleSession>;

describe("IdleSessionDialog Component", () => {
  const mockExtendSession = jest.fn();
  const mockSignOut = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();

    mockedUseIdleSession.mockReturnValue({
      showWarning: true,
      remainingSeconds: 45,
      extendSession: mockExtendSession,
      signOut: mockSignOut,
      isRefreshing: false,
    });
  });

  describe("Rendering & Visibility", () => {
    it("renders nothing when showWarning is false", () => {
      mockedUseIdleSession.mockReturnValue({
        showWarning: false,
        remainingSeconds: 60,
        extendSession: mockExtendSession,
        signOut: mockSignOut,
        isRefreshing: false,
      });

      const { container } = render(<IdleSessionDialog />);
      expect(container).toBeEmptyDOMElement();
      expect(screen.queryByTestId("idle-session-dialog-overlay")).not.toBeInTheDocument();
    });

    it("renders accessible modal dialog when showWarning is true", () => {
      render(<IdleSessionDialog />);

      const dialog = screen.getByRole("dialog");
      expect(dialog).toBeInTheDocument();
      expect(dialog).toHaveAttribute("aria-modal", "true");
      expect(dialog).toHaveAttribute("aria-labelledby", "idle-session-title");
      expect(dialog).toHaveAttribute("aria-describedby", "idle-session-desc");

      expect(screen.getByRole("heading", { name: "Session Timeout Warning" })).toBeInTheDocument();
      expect(screen.getByTestId("idle-session-desc")).toHaveTextContent(
        "You have been inactive for 30 minutes. For your security, your session will automatically expire soon.",
      );

      const timer = screen.getByRole("timer");
      expect(timer).toBeInTheDocument();
      expect(timer).toHaveAttribute("aria-live", "polite");
      expect(screen.getByTestId("idle-session-remaining-seconds")).toHaveTextContent("45s");
    });

    it("formats custom idleTimeoutMs into minutes in description", () => {
      render(<IdleSessionDialog idleTimeoutMs={15 * 60 * 1000} />);

      expect(screen.getByTestId("idle-session-desc")).toHaveTextContent("15 minutes");
    });
  });

  describe("Interactive Controls & Actions", () => {
    it("triggers extendSession when clicking Stay Logged In button", () => {
      render(<IdleSessionDialog />);

      const extendBtn = screen.getByTestId("extend-session-btn");
      expect(extendBtn).toHaveTextContent("Stay Logged In");
      fireEvent.click(extendBtn);

      expect(mockExtendSession).toHaveBeenCalledTimes(1);
    });

    it("triggers signOut when clicking Sign Out button", () => {
      render(<IdleSessionDialog />);

      const signOutBtn = screen.getByTestId("logout-session-btn");
      expect(signOutBtn).toHaveTextContent("Sign Out");
      fireEvent.click(signOutBtn);

      expect(mockSignOut).toHaveBeenCalledTimes(1);
    });

    it("displays spinner and disables buttons during isRefreshing state", () => {
      mockedUseIdleSession.mockReturnValue({
        showWarning: true,
        remainingSeconds: 45,
        extendSession: mockExtendSession,
        signOut: mockSignOut,
        isRefreshing: true,
      });

      render(<IdleSessionDialog />);

      const extendBtn = screen.getByTestId("extend-session-btn");
      const signOutBtn = screen.getByTestId("logout-session-btn");

      expect(extendBtn).toBeDisabled();
      expect(extendBtn).toHaveTextContent("Extending...");
      expect(signOutBtn).toBeDisabled();
    });
  });

  describe("Dismissal & Backdrop Handling", () => {
    it("triggers extendSession on direct backdrop click when closeOnBackdropClick is true", () => {
      render(<IdleSessionDialog closeOnBackdropClick={true} />);

      const overlay = screen.getByTestId("idle-session-dialog-overlay");
      fireEvent.click(overlay);

      expect(mockExtendSession).toHaveBeenCalledTimes(1);
    });

    it("does not trigger extendSession when clicking inside dialog card", () => {
      render(<IdleSessionDialog closeOnBackdropClick={true} />);

      const dialogCard = screen.getByTestId("idle-session-dialog");
      fireEvent.click(dialogCard);

      expect(mockExtendSession).not.toHaveBeenCalled();
    });

    it("does not trigger extendSession on backdrop click when closeOnBackdropClick is false", () => {
      render(<IdleSessionDialog closeOnBackdropClick={false} />);

      const overlay = screen.getByTestId("idle-session-dialog-overlay");
      fireEvent.click(overlay);

      expect(mockExtendSession).not.toHaveBeenCalled();
    });

    it("triggers extendSession on Escape key press", () => {
      render(<IdleSessionDialog />);

      const dialog = screen.getByRole("dialog");
      fireEvent.keyDown(dialog, { key: "Escape", code: "Escape" });

      expect(mockExtendSession).toHaveBeenCalled();
    });
  });
});
