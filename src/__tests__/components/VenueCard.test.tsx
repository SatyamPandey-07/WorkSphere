import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { VenueCard } from "@/components/venue/VenueCard";

describe("VenueCard Accessibility & Actions", () => {
  const mockVenue = {
    id: "v-101",
    name: "CoWork Space Bandra",
    description: "Quiet workspace with high-speed internet.",
  };

  test("renders all action buttons with descriptive aria-label attributes", () => {
    render(<VenueCard venue={mockVenue} />);

    const bookmarkBtn = screen.getByRole("button", {
      name: `Bookmark ${mockVenue.name}`,
    });
    const favoriteBtn = screen.getByRole("button", {
      name: `Favorite ${mockVenue.name}`,
    });
    const shareBtn = screen.getByRole("button", {
      name: `Share ${mockVenue.name}`,
    });

    expect(bookmarkBtn).toBeInTheDocument();
    expect(favoriteBtn).toBeInTheDocument();
    expect(shareBtn).toBeInTheDocument();
  });

  test("applies focus-visible ring classes for keyboard navigation", () => {
    render(<VenueCard venue={mockVenue} />);

    const bookmarkBtn = screen.getByRole("button", {
      name: `Bookmark ${mockVenue.name}`,
    });
    expect(bookmarkBtn).toHaveClass("focus-visible:ring-emerald-500");
    expect(bookmarkBtn).toHaveClass("focus-visible:ring-offset-zinc-900");
  });

  test("triggers handlers on button click", () => {
    const onBookmarkMock = jest.fn();
    render(<VenueCard venue={mockVenue} onBookmark={onBookmarkMock} />);

    const bookmarkBtn = screen.getByRole("button", {
      name: `Bookmark ${mockVenue.name}`,
    });
    fireEvent.click(bookmarkBtn);

    expect(onBookmarkMock).toHaveBeenCalledWith(mockVenue.id);
  });
});