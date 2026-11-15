import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { VenueCard } from "@/components/venue/VenueCard";

describe("VenueCard Accessibility & Actions", () => {
  const mockVenue = {
    id: "v-101",
    name: "CoWork Space Bandra",
    description: "Quiet workspace with high-speed internet.",
  };

  afterEach(() => {
    jest.useRealTimers();
  });

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

  test("does not render a booking action without an onBook handler", () => {
    render(<VenueCard venue={mockVenue} />);

    expect(
      screen.queryByRole("button", {
        name: `Instant booking for ${mockVenue.name}`,
      }),
    ).not.toBeInTheDocument();
  });

  test("invokes onBook when the primary booking button is clicked", () => {
    const onBookMock = jest.fn();
    render(<VenueCard venue={mockVenue} onBook={onBookMock} />);

    fireEvent.click(
      screen.getByRole("button", {
        name: `Instant booking for ${mockVenue.name}`,
      }),
    );

    expect(onBookMock).toHaveBeenCalledWith(mockVenue.id);
  });

  test("exposes the booking hotkey and shows the tooltip badge on keyboard focus", () => {
    jest.useFakeTimers();
    render(<VenueCard venue={mockVenue} onBook={jest.fn()} />);

    const bookingBtn = screen.getByRole("button", {
      name: `Instant booking for ${mockVenue.name}`,
    });

    expect(bookingBtn).toHaveAttribute("aria-keyshortcuts", "B");
    expect(bookingBtn).not.toHaveAttribute("aria-describedby");

    act(() => bookingBtn.focus());
    act(() => {
      jest.advanceTimersByTime(200);
    });

    const tooltip = screen.getByRole("tooltip");
    expect(tooltip).toHaveTextContent("Instant booking");
    expect(bookingBtn).toHaveAttribute("aria-describedby", tooltip.id);
    expect(screen.getByTestId("keyboard-shortcut-badge")).toHaveTextContent(
      "B",
    );

    act(() => bookingBtn.blur());
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  test("shows the hotkey tooltip on pointer hover", () => {
    jest.useFakeTimers();
    render(<VenueCard venue={mockVenue} onBook={jest.fn()} />);

    const bookingBtn = screen.getByRole("button", {
      name: `Instant booking for ${mockVenue.name}`,
    });

    act(() => {
      fireEvent.mouseEnter(bookingBtn.parentElement as HTMLElement);
    });
    act(() => {
      jest.advanceTimersByTime(200);
    });

    expect(screen.getByRole("tooltip")).toHaveTextContent("Instant booking");
  });

  test("disables tooltip animations when prefers-reduced-motion is set", () => {
    jest.useFakeTimers();
    render(<VenueCard venue={mockVenue} onBook={jest.fn()} />);

    act(() =>
      screen
        .getByRole("button", {
          name: `Instant booking for ${mockVenue.name}`,
        })
        .focus(),
    );
    act(() => {
      jest.advanceTimersByTime(200);
    });

    const tooltip = screen.getByRole("tooltip");
    expect(tooltip).toHaveClass("motion-reduce:animate-none");
    expect(tooltip).toHaveClass("motion-reduce:transition-none");
  });

  test("supports rendering the booking action without a hotkey hint", () => {
    render(
      <VenueCard venue={mockVenue} onBook={jest.fn()} bookingHotkey={null} />,
    );

    const bookingBtn = screen.getByRole("button", {
      name: `Instant booking for ${mockVenue.name}`,
    });
    expect(bookingBtn).not.toHaveAttribute("aria-keyshortcuts");
  });
});
