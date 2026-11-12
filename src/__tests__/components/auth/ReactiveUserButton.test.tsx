import React from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";
import "@testing-library/jest-dom";
import ReactiveUserButton from "@/components/auth/ReactiveUserButton";
import { dispatchAvatarUpdated, AVATAR_UPDATED_EVENT } from "@/lib/avatar-events";

describe("ReactiveUserButton Component", () => {
  const defaultUserId = "user-123";
  const defaultAvatar = "https://images.example.com/avatar1.jpg";
  const defaultUserName = "Alex Johnson";
  const mockOnClick = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("Rendering Avatar & Accessible Labels", () => {
    it("renders avatar image with correct src and accessible label", () => {
      render(
        <ReactiveUserButton
          userId={defaultUserId}
          initialAvatarUrl={defaultAvatar}
          userName={defaultUserName}
          onClick={mockOnClick}
        />,
      );

      const button = screen.getByTestId("reactive-user-button");
      expect(button).toBeInTheDocument();
      expect(button).toHaveAttribute("aria-label", "Open profile menu for Alex Johnson");
      expect(button).toHaveAttribute("title", "Alex Johnson");

      const image = screen.getByTestId("reactive-user-avatar-image");
      expect(image).toBeInTheDocument();
      expect(image).toHaveAttribute("src", defaultAvatar);
      expect(image).toHaveAttribute("alt", defaultUserName);
    });

    it("applies custom size and className to button", () => {
      render(
        <ReactiveUserButton
          userId={defaultUserId}
          initialAvatarUrl={defaultAvatar}
          size={48}
          className="custom-avatar-class"
        />,
      );

      const button = screen.getByTestId("reactive-user-button");
      expect(button).toHaveStyle({ width: "48px", height: "48px" });
      expect(button).toHaveClass("custom-avatar-class");
    });
  });

  describe("Fallback Initials & Icon", () => {
    it("renders uppercase two-letter initials when no avatar is provided", () => {
      render(
        <ReactiveUserButton
          userId={defaultUserId}
          initialAvatarUrl={null}
          userName="Jane Smith"
        />,
      );

      expect(screen.queryByTestId("reactive-user-avatar-image")).not.toBeInTheDocument();
      expect(screen.getByTestId("reactive-user-fallback-container")).toBeInTheDocument();
      expect(screen.getByTestId("reactive-user-fallback-initials")).toHaveTextContent("JA");
      expect(screen.queryByTestId("reactive-user-fallback-icon")).not.toBeInTheDocument();
    });

    it("trims whitespace from userName when deriving initials", () => {
      render(
        <ReactiveUserButton
          userId={defaultUserId}
          initialAvatarUrl={null}
          userName="   Carol White   "
        />,
      );

      expect(screen.getByTestId("reactive-user-fallback-initials")).toHaveTextContent("CA");
    });

    it("falls back to User icon when userName is empty or whitespace-only", () => {
      const { rerender } = render(
        <ReactiveUserButton
          userId={defaultUserId}
          initialAvatarUrl={null}
          userName=""
        />,
      );

      expect(screen.getByTestId("reactive-user-fallback-icon")).toBeInTheDocument();
      expect(screen.queryByTestId("reactive-user-fallback-initials")).not.toBeInTheDocument();

      rerender(
        <ReactiveUserButton
          userId={defaultUserId}
          initialAvatarUrl={null}
          userName="     "
        />,
      );

      expect(screen.getByTestId("reactive-user-fallback-icon")).toBeInTheDocument();
      expect(screen.queryByTestId("reactive-user-fallback-initials")).not.toBeInTheDocument();
    });

    it("switches to initials fallback when avatar image encounters onError", () => {
      render(
        <ReactiveUserButton
          userId={defaultUserId}
          initialAvatarUrl="https://invalid-domain.example.com/broken.png"
          userName="Bob Marley"
        />,
      );

      const image = screen.getByTestId("reactive-user-avatar-image");
      fireEvent.error(image);

      expect(screen.queryByTestId("reactive-user-avatar-image")).not.toBeInTheDocument();
      expect(screen.getByTestId("reactive-user-fallback-initials")).toHaveTextContent("BO");
    });
  });

  describe("Reactive Avatar Events", () => {
    it("reactively updates avatar image on worksphere:avatar-updated event for matching userId", () => {
      render(
        <ReactiveUserButton
          userId={defaultUserId}
          initialAvatarUrl={null}
          userName={defaultUserName}
        />,
      );

      expect(screen.queryByTestId("reactive-user-avatar-image")).not.toBeInTheDocument();

      const newAvatarUrl = "https://images.example.com/new-avatar.png";
      act(() => {
        dispatchAvatarUpdated(defaultUserId, newAvatarUrl);
      });

      const updatedImage = screen.getByTestId("reactive-user-avatar-image");
      expect(updatedImage).toBeInTheDocument();
      expect(updatedImage).toHaveAttribute("src", newAvatarUrl);
    });

    it("ignores worksphere:avatar-updated event for a different userId", () => {
      render(
        <ReactiveUserButton
          userId={defaultUserId}
          initialAvatarUrl={null}
          userName={defaultUserName}
        />,
      );

      act(() => {
        dispatchAvatarUpdated("other-user-999", "https://images.example.com/other.png");
      });

      expect(screen.queryByTestId("reactive-user-avatar-image")).not.toBeInTheDocument();
      expect(screen.getByTestId("reactive-user-fallback-initials")).toHaveTextContent("AL");
    });

    it("updates avatar when initialAvatarUrl prop updates", () => {
      const { rerender } = render(
        <ReactiveUserButton
          userId={defaultUserId}
          initialAvatarUrl={null}
          userName={defaultUserName}
        />,
      );

      expect(screen.queryByTestId("reactive-user-avatar-image")).not.toBeInTheDocument();

      const updatedUrl = "https://images.example.com/prop-update.png";
      rerender(
        <ReactiveUserButton
          userId={defaultUserId}
          initialAvatarUrl={updatedUrl}
          userName={defaultUserName}
        />,
      );

      const image = screen.getByTestId("reactive-user-avatar-image");
      expect(image).toBeInTheDocument();
      expect(image).toHaveAttribute("src", updatedUrl);
    });
  });

  describe("Interactions & Disabled State", () => {
    it("triggers onClick when button is clicked", () => {
      render(
        <ReactiveUserButton
          userId={defaultUserId}
          initialAvatarUrl={defaultAvatar}
          onClick={mockOnClick}
        />,
      );

      const button = screen.getByTestId("reactive-user-button");
      fireEvent.click(button);

      expect(mockOnClick).toHaveBeenCalledTimes(1);
    });

    it("respects disabled prop and disables button", () => {
      render(
        <ReactiveUserButton
          userId={defaultUserId}
          initialAvatarUrl={defaultAvatar}
          onClick={mockOnClick}
          disabled={true}
        />,
      );

      const button = screen.getByTestId("reactive-user-button");
      expect(button).toBeDisabled();
      expect(button).toHaveClass("cursor-not-allowed");
    });

    it("cleans up event listener on unmount", () => {
      const removeSpy = jest.spyOn(window, "removeEventListener");

      const { unmount } = render(
        <ReactiveUserButton
          userId={defaultUserId}
          initialAvatarUrl={defaultAvatar}
        />,
      );

      unmount();

      expect(removeSpy).toHaveBeenCalledWith(
        AVATAR_UPDATED_EVENT,
        expect.any(Function),
      );

      removeSpy.mockRestore();
    });
  });
});
