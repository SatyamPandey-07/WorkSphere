import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { BookmarkVenueButton } from "@/components/venues/BookmarkVenueButton";
import { toggleVenueFavorite } from "@/lib/venues/favoriteStorage";

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

describe("BookmarkVenueButton Optimistic UI & Rollback", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("updates heart icon fill state immediately upon user click before API resolves", async () => {
    let resolveApi!: (val: boolean) => void;
    const apiPromise = new Promise<boolean>((resolve) => {
      resolveApi = resolve;
    });

    (toggleVenueFavorite as jest.Mock).mockReturnValue(apiPromise);

    render(
      <BookmarkVenueButton
        venueId="venue-101"
        venueName="Central Perk"
        iconType="heart"
        initialIsFavorited={false}
      />,
    );

    const button = screen.getByRole("button", {
      name: "Bookmark Central Perk",
    });
    expect(button).toHaveAttribute("aria-pressed", "false");

    // Click button
    fireEvent.click(button);

    // 1. Acceptance Criteria 1: Immediately toggled before API promise resolves
    expect(button).toHaveAttribute("aria-pressed", "true");
    expect(button).toHaveAttribute(
      "aria-label",
      "Remove Central Perk from saved",
    );
    const heartSvg = button.querySelector("svg");
    expect(heartSvg).toHaveClass("fill-rose-500");

    // 2. Acceptance Criteria 2: API call dispatched in background
    expect(toggleVenueFavorite).toHaveBeenCalledWith(
      "venue-101",
      expect.objectContaining({ id: "venue-101", name: "Central Perk" }),
    );

    // Now let the API resolve
    resolveApi(true);

    await waitFor(() => {
      expect(button).toHaveAttribute("aria-pressed", "true");
    });
  });

  it("calls onToggle immediately with optimistic state upon click", () => {
    (toggleVenueFavorite as jest.Mock).mockReturnValue(new Promise(() => {}));
    const onToggle = jest.fn();

    render(
      <BookmarkVenueButton
        venueId="venue-102"
        venueName="Blue Bottle"
        iconType="heart"
        initialIsFavorited={false}
        onToggle={onToggle}
      />,
    );

    const button = screen.getByRole("button", { name: "Bookmark Blue Bottle" });
    fireEvent.click(button);

    // onToggle called immediately with true
    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(onToggle).toHaveBeenCalledWith(true);
  });

  it("rolls back optimistic state and shows error toast when API rejects", async () => {
    let rejectApi!: (err: Error) => void;
    const apiPromise = new Promise<boolean>((_, reject) => {
      rejectApi = reject;
    });

    (toggleVenueFavorite as jest.Mock).mockReturnValue(apiPromise);
    const onToggle = jest.fn();

    render(
      <BookmarkVenueButton
        venueId="venue-103"
        venueName="Sightglass Coffee"
        iconType="heart"
        initialIsFavorited={false}
        onToggle={onToggle}
      />,
    );

    const button = screen.getByRole("button", {
      name: "Bookmark Sightglass Coffee",
    });

    // Click button: becomes true optimistically
    fireEvent.click(button);
    expect(button).toHaveAttribute("aria-pressed", "true");
    expect(button.querySelector("svg")).toHaveClass("fill-rose-500");
    expect(onToggle).toHaveBeenCalledWith(true);

    // API fails with network timeout
    rejectApi(new Error("Network connection lost"));

    // 3. Acceptance Criteria 3: Rollback state and show error toast
    await waitFor(() => {
      expect(button).toHaveAttribute("aria-pressed", "false");
    });

    expect(button.querySelector("svg")).not.toHaveClass("fill-rose-500");
    expect(button).toHaveAttribute("aria-label", "Bookmark Sightglass Coffee");
    expect(onToggle).toHaveBeenLastCalledWith(false);

    expect(mockToast).toHaveBeenCalledTimes(1);
    expect(mockToast).toHaveBeenCalledWith("Network connection lost", "error");
  });

  it("supports custom onPersist handler rejecting and rolling back", async () => {
    const onPersist = jest
      .fn()
      .mockRejectedValue(new Error("Database write failed"));
    const onToggle = jest.fn();

    render(
      <BookmarkVenueButton
        venueId="venue-104"
        venueName="Ritual Roasters"
        iconType="heart"
        initialIsFavorited={true}
        onPersist={onPersist}
        onToggle={onToggle}
      />,
    );

    const button = screen.getByRole("button", {
      name: "Remove Ritual Roasters from saved",
    });
    expect(button).toHaveAttribute("aria-pressed", "true");

    // Click button: optimistically toggles to false
    fireEvent.click(button);
    expect(button).toHaveAttribute("aria-pressed", "false");
    expect(onToggle).toHaveBeenCalledWith(false);

    // Rollback back to true upon rejection
    await waitFor(() => {
      expect(button).toHaveAttribute("aria-pressed", "true");
    });

    expect(button.querySelector("svg")).toHaveClass("fill-rose-500");
    expect(onToggle).toHaveBeenLastCalledWith(true);
    expect(mockToast).toHaveBeenCalledWith("Database write failed", "error");
  });
});
