import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { BookmarkVenueButton } from "@/components/venues/BookmarkVenueButton";

jest.mock("@/lib/venues/favoriteStorage", () => ({
  isVenueFavoritedLocally: jest.fn(() => false),
  toggleVenueFavorite: jest.fn(),
  subscribeToFavoriteChanges: jest.fn(() => jest.fn()),
}));

describe("BookmarkVenueButton accessibility", () => {
  it("exposes a descriptive name and unpressed state for an unsaved venue", () => {
    render(
      <BookmarkVenueButton
        venueId="venue-1"
        venueName="Harbor Cafe"
        initialIsFavorited={false}
      />,
    );

    expect(
      screen.getByRole("button", { name: "Bookmark Harbor Cafe" }),
    ).toHaveAttribute("aria-pressed", "false");
  });

  it("updates the accessible name and pressed state for a saved venue", () => {
    render(
      <BookmarkVenueButton
        venueId="venue-1"
        venueName="Harbor Cafe"
        initialIsFavorited
      />,
    );

    expect(
      screen.getByRole("button", { name: "Remove Harbor Cafe from saved" }),
    ).toHaveAttribute("aria-pressed", "true");
  });
});
