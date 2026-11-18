import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import VenueBookmarkButtonDefault, {
  VenueBookmarkButton,
} from "@/components/venues/VenueBookmarkButton";
import { BookmarkVenueButton } from "@/components/venues/BookmarkVenueButton";

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

describe("VenueBookmarkButton Component & Anti-Jitter Layout", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("Exports & Compatibility", () => {
    it("exports VenueBookmarkButton as named and default export matching BookmarkVenueButton", () => {
      expect(VenueBookmarkButton).toBeDefined();
      expect(VenueBookmarkButtonDefault).toBeDefined();
      expect(VenueBookmarkButton).toBe(VenueBookmarkButtonDefault);
      expect(VenueBookmarkButton).toBe(BookmarkVenueButton);
    });
  });

  describe("Anti-Jitter Width & Alignment Requirements", () => {
    it("locks min-w-[100px] and flex centering on button variant to prevent width collapse", () => {
      render(
        <VenueBookmarkButton
          venueId="venue-jitter-1"
          venueName="Apex Workspace"
          variant="button"
          initialIsFavorited={false}
        />,
      );

      const btn = screen.getByTestId("bookmark-toggle-btn-venue-jitter-1");
      expect(btn).toBeInTheDocument();
      expect(btn).toHaveClass("min-w-[100px]");
      expect(btn).toHaveClass("justify-center");
      expect(btn).toHaveClass("items-center");
      expect(btn).toHaveClass("px-3");
      expect(btn).toHaveClass("py-2");
      expect(screen.getByText("Save Venue")).toBeInTheDocument();
    });

    it("locks min-w-[100px] and flex centering on pill variant", () => {
      render(
        <VenueBookmarkButton
          venueId="venue-jitter-2"
          venueName="Creative Loft"
          variant="pill"
          initialIsFavorited={true}
        />,
      );

      const btn = screen.getByTestId("bookmark-toggle-btn-venue-jitter-2");
      expect(btn).toBeInTheDocument();
      expect(btn).toHaveClass("min-w-[100px]");
      expect(btn).toHaveClass("justify-center");
      expect(btn).toHaveClass("rounded-full");
      expect(btn).toHaveClass("px-3.5");
      expect(btn).toHaveClass("py-1.5");
      expect(screen.getByText("Saved")).toBeInTheDocument();
    });

    it("reserves fixed icon slot dimensions (w-4 h-4 for md size) during rendered states", () => {
      const { container } = render(
        <VenueBookmarkButton
          venueId="venue-slot-test"
          variant="button"
          size="md"
        />,
      );

      const iconSlot = container.querySelector("span.shrink-0");
      expect(iconSlot).toBeInTheDocument();
      expect(iconSlot).toHaveClass("w-4");
      expect(iconSlot).toHaveClass("h-4");
      expect(iconSlot).toHaveClass("items-center");
      expect(iconSlot).toHaveClass("justify-center");
    });
  });

  describe("Loading State & Visual Stabilization", () => {
    it("renders Loader2 spinner with animate-spin when isLoading is true", () => {
      render(
        <VenueBookmarkButton
          venueId="venue-loading-1"
          variant="button"
          isLoading={true}
        />,
      );

      const spinner = screen.getByTestId("bookmark-loading-spinner");
      expect(spinner).toBeInTheDocument();
      expect(spinner).toHaveClass("animate-spin");
      expect(spinner).toHaveClass("shrink-0");
    });

    it("displays 'Saving...' label when isLoading is true on button variant without snapping width", () => {
      const { rerender } = render(
        <VenueBookmarkButton
          venueId="venue-loading-2"
          variant="button"
          initialIsFavorited={false}
          isLoading={false}
        />,
      );

      const btn = screen.getByTestId("bookmark-toggle-btn-venue-loading-2");
      expect(btn).toHaveClass("min-w-[100px]");
      expect(screen.getByText("Save Venue")).toBeInTheDocument();

      // Switch to loading state
      rerender(
        <VenueBookmarkButton
          venueId="venue-loading-2"
          variant="button"
          initialIsFavorited={false}
          isLoading={true}
        />,
      );

      expect(btn).toHaveClass("min-w-[100px]");
      expect(btn).toHaveAttribute("aria-busy", "true");
      expect(btn).toBeDisabled();
      expect(screen.getByText("Saving...")).toBeInTheDocument();
      expect(
        screen.getByTestId("bookmark-loading-spinner"),
      ).toBeInTheDocument();
    });

    it("prevents clicks and callbacks while button is in loading state", () => {
      const onToggle = jest.fn();
      const onPersist = jest.fn();

      render(
        <VenueBookmarkButton
          venueId="venue-loading-disabled"
          variant="button"
          isLoading={true}
          onToggle={onToggle}
          onPersist={onPersist}
        />,
      );

      const btn = screen.getByTestId(
        "bookmark-toggle-btn-venue-loading-disabled",
      );
      expect(btn).toBeDisabled();

      fireEvent.click(btn);

      expect(onToggle).not.toHaveBeenCalled();
      expect(onPersist).not.toHaveBeenCalled();
    });
  });

  describe("Dynamic Toggle with showLoadingOnToggle", () => {
    it("transitions through loading state and maintains rock-solid container dimensions", async () => {
      let resolvePersist!: (val: boolean) => void;
      const persistPromise = new Promise<boolean>((resolve) => {
        resolvePersist = resolve;
      });
      const onPersist = jest.fn().mockReturnValue(persistPromise);

      render(
        <VenueBookmarkButton
          venueId="venue-async-1"
          variant="button"
          showLoadingOnToggle={true}
          onPersist={onPersist}
          initialIsFavorited={false}
        />,
      );

      const btn = screen.getByTestId("bookmark-toggle-btn-venue-async-1");
      expect(btn).toHaveClass("min-w-[100px]");
      expect(screen.getByText("Save Venue")).toBeInTheDocument();

      // Trigger click
      fireEvent.click(btn);

      // Loading state is active while persist promise is pending
      expect(btn).toHaveAttribute("aria-busy", "true");
      expect(screen.getByText("Saving...")).toBeInTheDocument();
      expect(
        screen.getByTestId("bookmark-loading-spinner"),
      ).toBeInTheDocument();
      expect(btn).toHaveClass("min-w-[100px]");

      // Resolve the persistence promise
      resolvePersist(true);

      await waitFor(() => {
        expect(btn).toHaveAttribute("aria-busy", "false");
      });

      expect(
        screen.queryByTestId("bookmark-loading-spinner"),
      ).not.toBeInTheDocument();
      expect(btn).toHaveClass("min-w-[100px]");
    });
  });
});
