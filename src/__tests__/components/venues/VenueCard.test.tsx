import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { VenueCard } from "@/components/venues/VenueCard";

describe("VenueCard action buttons accessibility (#9899)", () => {
  const mockVenue = {
    id: "v-42",
    name: "Nomad Hub Mumbai",
    neighborhood: "Bandra West",
  };

  it("adds explicit aria-label to bookmark button with dynamic venue name", () => {
    render(<VenueCard id={mockVenue.id} name={mockVenue.name} />);

    const bookmarkBtn = screen.getByRole("button", {
      name: `Save ${mockVenue.name} to bookmarks`,
    });
    expect(bookmarkBtn).toBeInTheDocument();
    expect(bookmarkBtn).toHaveAttribute(
      "aria-label",
      `Save ${mockVenue.name} to bookmarks`,
    );
  });

  it("adds explicit aria-label to favorite button with dynamic venue name", () => {
    render(<VenueCard id={mockVenue.id} name={mockVenue.name} />);

    const favoriteBtn = screen.getByRole("button", {
      name: `Add ${mockVenue.name} to favorites`,
    });
    expect(favoriteBtn).toBeInTheDocument();
    expect(favoriteBtn).toHaveAttribute(
      "aria-label",
      `Add ${mockVenue.name} to favorites`,
    );
  });

  it("includes aria-pressed attribute indicating current saved status", () => {
    const { rerender } = render(
      <VenueCard
        id={mockVenue.id}
        name={mockVenue.name}
        isBookmarked={false}
        isFavorited={false}
      />,
    );

    const bookmarkBtn = screen.getByRole("button", {
      name: `Save ${mockVenue.name} to bookmarks`,
    });
    const favoriteBtn = screen.getByRole("button", {
      name: `Add ${mockVenue.name} to favorites`,
    });

    expect(bookmarkBtn).toHaveAttribute("aria-pressed", "false");
    expect(favoriteBtn).toHaveAttribute("aria-pressed", "false");

    rerender(
      <VenueCard
        id={mockVenue.id}
        name={mockVenue.name}
        isBookmarked={true}
        isFavorited={true}
      />,
    );

    const activeBookmarkBtn = screen.getByRole("button", {
      name: `Remove ${mockVenue.name} from bookmarks`,
    });
    const activeFavoriteBtn = screen.getByRole("button", {
      name: `Remove ${mockVenue.name} from favorites`,
    });

    expect(activeBookmarkBtn).toHaveAttribute("aria-pressed", "true");
    expect(activeFavoriteBtn).toHaveAttribute("aria-pressed", "true");
  });

  it("toggles aria-pressed and dynamic aria-label on click", () => {
    const onBookmark = jest.fn();
    const onFavorite = jest.fn();

    render(
      <VenueCard
        id={mockVenue.id}
        name={mockVenue.name}
        onBookmark={onBookmark}
        onFavorite={onFavorite}
      />,
    );

    const bookmarkBtn = screen.getByTestId("venue-bookmark-btn");
    const favoriteBtn = screen.getByTestId("venue-favorite-btn");

    expect(bookmarkBtn).toHaveAttribute(
      "aria-label",
      `Save ${mockVenue.name} to bookmarks`,
    );
    expect(bookmarkBtn).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(bookmarkBtn);

    expect(bookmarkBtn).toHaveAttribute(
      "aria-label",
      `Remove ${mockVenue.name} from bookmarks`,
    );
    expect(bookmarkBtn).toHaveAttribute("aria-pressed", "true");
    expect(onBookmark).toHaveBeenCalledWith(mockVenue.id);

    expect(favoriteBtn).toHaveAttribute(
      "aria-label",
      `Add ${mockVenue.name} to favorites`,
    );
    expect(favoriteBtn).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(favoriteBtn);

    expect(favoriteBtn).toHaveAttribute(
      "aria-label",
      `Remove ${mockVenue.name} from favorites`,
    );
    expect(favoriteBtn).toHaveAttribute("aria-pressed", "true");
    expect(onFavorite).toHaveBeenCalledWith(mockVenue.id);
  });

  it("renders share button with dynamic accessible name and hides SVG icons from screen readers", () => {
    render(<VenueCard id={mockVenue.id} name={mockVenue.name} />);

    const shareBtn = screen.getByRole("button", {
      name: `Share ${mockVenue.name}`,
    });
    expect(shareBtn).toBeInTheDocument();

    const buttons = [
      screen.getByTestId("venue-bookmark-btn"),
      screen.getByTestId("venue-favorite-btn"),
      screen.getByTestId("venue-share-btn"),
    ];

    buttons.forEach((btn) => {
      const svg = btn.querySelector("svg");
      expect(svg).toHaveAttribute("aria-hidden", "true");
    });
  });
});
