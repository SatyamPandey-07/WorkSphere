import React from "react";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import "@testing-library/jest-dom";
import BookmarkVenueButtonDefault, {
  BookmarkVenueButton,
} from "@/components/venues/BookmarkVenueButton";
import {
  isVenueFavoritedLocally,
  toggleVenueFavorite,
  subscribeToFavoriteChanges,
} from "@/lib/venues/favoriteStorage";

const mockToast = jest.fn();

jest.mock("@/components/ui/Toast", () => ({
  useToast: () => ({
    toast: mockToast,
  }),
}));

jest.mock("@/lib/venues/favoriteStorage", () => ({
  isVenueFavoritedLocally: jest.fn(() => false),
  toggleVenueFavorite: jest.fn(),
  subscribeToFavoriteChanges: jest.fn(() => jest.fn()),
}));

describe("BookmarkVenueButton Component", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("Exports", () => {
    it("exports BookmarkVenueButton as both named and default export", () => {
      expect(BookmarkVenueButton).toBeDefined();
      expect(BookmarkVenueButtonDefault).toBeDefined();
      expect(BookmarkVenueButton).toBe(BookmarkVenueButtonDefault);
    });
  });

  describe("Rendering & Icon Types", () => {
    it("renders default icon-only bookmark button with default test id and aria attributes", () => {
      render(<BookmarkVenueButton venueId="venue-101" venueName="Hub Central" />);

      const button = screen.getByTestId("bookmark-toggle-btn-venue-101");
      expect(button).toBeInTheDocument();
      expect(button).toHaveAttribute("aria-pressed", "false");
      expect(button).toHaveAttribute("aria-label", "Bookmark Hub Central");
      expect(button).toHaveAttribute("title", "Bookmark Hub Central");
    });

    it("renders heart icon when iconType is heart", () => {
      const { container } = render(
        <BookmarkVenueButton
          venueId="venue-102"
          iconType="heart"
          initialIsFavorited={true}
        />
      );

      const svg = container.querySelector("svg");
      expect(svg).toBeInTheDocument();
      expect(svg).toHaveClass("fill-rose-500");
    });

    it("renders star icon when iconType is star", () => {
      const { container } = render(
        <BookmarkVenueButton
          venueId="venue-103"
          iconType="star"
          initialIsFavorited={true}
        />
      );

      const svg = container.querySelector("svg");
      expect(svg).toBeInTheDocument();
      expect(svg).toHaveClass("fill-amber-400");
    });
  });

  describe("Variants & Sizes", () => {
    it("renders button variant with label", () => {
      render(
        <BookmarkVenueButton
          venueId="venue-201"
          variant="button"
          initialIsFavorited={false}
        />
      );

      expect(screen.getByText("Save Venue")).toBeInTheDocument();
      const btn = screen.getByTestId("bookmark-toggle-btn-venue-201");
      expect(btn).toHaveClass("px-3");
    });

    it("renders pill variant with rounded-full styling", () => {
      render(
        <BookmarkVenueButton
          venueId="venue-202"
          variant="pill"
          initialIsFavorited={true}
        />
      );

      expect(screen.getByText("Saved")).toBeInTheDocument();
      const btn = screen.getByTestId("bookmark-toggle-btn-venue-202");
      expect(btn).toHaveClass("rounded-full");
    });

    it("applies size classes for sm, md, and lg", () => {
      const { rerender } = render(
        <BookmarkVenueButton venueId="v-size" size="sm" />
      );
      expect(screen.getByTestId("bookmark-toggle-btn-v-size")).toHaveClass("p-1.5");

      rerender(<BookmarkVenueButton venueId="v-size" size="md" />);
      expect(screen.getByTestId("bookmark-toggle-btn-v-size")).toHaveClass("p-2");

      rerender(<BookmarkVenueButton venueId="v-size" size="lg" />);
      expect(screen.getByTestId("bookmark-toggle-btn-v-size")).toHaveClass("p-2.5");
    });
  });

  describe("Custom Props & Overrides", () => {
    it("supports custom data-testid and className overrides", () => {
      render(
        <BookmarkVenueButton
          venueId="venue-custom"
          data-testid="custom-bookmark-button"
          className="my-custom-class"
        />
      );

      const btn = screen.getByTestId("custom-bookmark-button");
      expect(btn).toBeInTheDocument();
      expect(btn).toHaveClass("my-custom-class");
    });

    it("omits title tooltip when showTooltip is false", () => {
      render(
        <BookmarkVenueButton
          venueId="venue-no-tooltip"
          showTooltip={false}
        />
      );

      const btn = screen.getByTestId("bookmark-toggle-btn-venue-no-tooltip");
      expect(btn).not.toHaveAttribute("title");
    });
  });

  describe("Toggle Interactions & Callbacks", () => {
    it("calls onToggle and persists favorite on click", async () => {
      (toggleVenueFavorite as jest.Mock).mockResolvedValue(true);
      const onToggle = jest.fn();

      render(
        <BookmarkVenueButton
          venueId="venue-301"
          venueName="Workspace Hub"
          onToggle={onToggle}
          initialIsFavorited={false}
        />
      );

      const btn = screen.getByTestId("bookmark-toggle-btn-venue-301");
      fireEvent.click(btn);

      expect(onToggle).toHaveBeenCalledWith(true);
      expect(toggleVenueFavorite).toHaveBeenCalledWith("venue-301", {
        id: "venue-301",
        name: "Workspace Hub",
      });
    });

    it("does nothing when disabled is true", () => {
      const onToggle = jest.fn();
      render(
        <BookmarkVenueButton
          venueId="venue-disabled"
          disabled={true}
          onToggle={onToggle}
        />
      );

      const btn = screen.getByTestId("bookmark-toggle-btn-venue-disabled");
      expect(btn).toBeDisabled();
      fireEvent.click(btn);

      expect(onToggle).not.toHaveBeenCalled();
      expect(toggleVenueFavorite).not.toHaveBeenCalled();
    });

    it("calls custom onPersist handler if provided", async () => {
      const customPersist = jest.fn().mockResolvedValue(true);
      const onToggle = jest.fn();

      render(
        <BookmarkVenueButton
          venueId="venue-persist"
          onPersist={customPersist}
          onToggle={onToggle}
          initialIsFavorited={false}
        />
      );

      const btn = screen.getByTestId("bookmark-toggle-btn-venue-persist");
      fireEvent.click(btn);

      expect(customPersist).toHaveBeenCalledWith("venue-persist", true);
      expect(toggleVenueFavorite).not.toHaveBeenCalled();
    });

    it("rolls back optimistic update and displays toast when onPersist rejects", async () => {
      const customPersist = jest.fn().mockRejectedValue(new Error("Network failed"));
      const onToggle = jest.fn();

      render(
        <BookmarkVenueButton
          venueId="venue-rollback"
          venueName="Cafe North"
          onPersist={customPersist}
          onToggle={onToggle}
          initialIsFavorited={false}
        />
      );

      const btn = screen.getByTestId("bookmark-toggle-btn-venue-rollback");
      fireEvent.click(btn);

      await waitFor(() => {
        expect(mockToast).toHaveBeenCalledWith("Network failed", "error");
      });
      expect(btn).toHaveAttribute("aria-pressed", "false");
    });
  });

  describe("Lifecycle & Subscription", () => {
    it("subscribes to favorite changes and cleans up on unmount", () => {
      const unsubscribe = jest.fn();
      (subscribeToFavoriteChanges as jest.Mock).mockReturnValue(unsubscribe);

      const { unmount } = render(
        <BookmarkVenueButton venueId="venue-sub" />
      );

      expect(subscribeToFavoriteChanges).toHaveBeenCalled();
      unmount();
      expect(unsubscribe).toHaveBeenCalled();
    });
  });
});
