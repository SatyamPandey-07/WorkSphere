import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import DefaultSavedVenueCard, {
  SavedVenueCard,
  type SavedVenueCardProps,
} from "@/components/saved-venues/SavedVenueCard";
import type { SavedVenue } from "@/hooks/useSavedVenues";

const mockFavorite: SavedVenue = {
  id: "fav-101",
  notes: "Quiet corner with fast internet near the window.",
  tags: [
    { id: "tag-1", name: "High Speed", color: "blue" },
    { id: "tag-2", name: "Spacious", color: "green" },
  ],
  venue: {
    id: "venue-101",
    placeId: "place-tokai-101",
    name: "Blue Tokai Coffee",
    category: "cafe",
    address: "100 Indiranagar 100ft Road, Bangalore",
    rating: 4.8,
    wifiQuality: 5,
    hasOutlets: true,
    noiseLevel: "moderate",
    imageUrl: "https://images.unsplash.com/photo-cafe.jpg",
  },
};

describe("SavedVenueCard Component", () => {
  const defaultProps: SavedVenueCardProps = {
    favorite: mockFavorite,
    onUpdateNotes: jest.fn().mockResolvedValue(undefined),
    onAddTag: jest.fn().mockResolvedValue({ id: "tag-3", name: "Quiet", color: "purple" }),
    onUpdateTag: jest.fn().mockResolvedValue(undefined),
    onDeleteTag: jest.fn().mockResolvedValue(undefined),
    onRemoveFavorite: jest.fn().mockResolvedValue(undefined),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("exports both named SavedVenueCard and default SavedVenueCard identically", () => {
    expect(SavedVenueCard).toBeDefined();
    expect(DefaultSavedVenueCard).toBe(SavedVenueCard);
  });

  it("renders full venue information accurately", () => {
    render(<SavedVenueCard {...defaultProps} />);

    expect(screen.getByTestId("saved-venue-card")).toBeInTheDocument();
    expect(screen.getByText("Blue Tokai Coffee")).toBeInTheDocument();
    expect(screen.getByText("100 Indiranagar 100ft Road, Bangalore")).toBeInTheDocument();
    expect(screen.getByText("cafe")).toBeInTheDocument();
    expect(screen.getByText("4.8")).toBeInTheDocument();
    expect(screen.getByText("5/5")).toBeInTheDocument();
    expect(screen.getByText("Outlets")).toBeInTheDocument();
    expect(screen.getByText("moderate")).toBeInTheDocument();

    const link = screen.getByRole("link", { name: "Blue Tokai Coffee" });
    expect(link).toHaveAttribute("href", "/venues/place-tokai-101");

    const image = screen.getByRole("img", { name: "Blue Tokai Coffee" });
    expect(image).toHaveAttribute("src", "https://images.unsplash.com/photo-cafe.jpg");
  });

  it("renders tags correctly with delete capability", () => {
    render(<SavedVenueCard {...defaultProps} />);

    expect(screen.getByText("High Speed")).toBeInTheDocument();
    expect(screen.getByText("Spacious")).toBeInTheDocument();

    const removeButtons = screen.getAllByRole("button", { name: /remove tag/i });
    expect(removeButtons.length).toBeGreaterThanOrEqual(2);
    fireEvent.click(removeButtons[0]);

    expect(defaultProps.onDeleteTag).toHaveBeenCalledWith("fav-101", "tag-1");
  });

  it("supports tag renaming via inline edit input", async () => {
    render(<SavedVenueCard {...defaultProps} />);

    const editButtons = screen.getAllByRole("button", { name: /edit tag/i });
    fireEvent.click(editButtons[0]);

    const input = screen.getByRole("textbox", { name: /rename tag High Speed/i });
    expect(input).toBeInTheDocument();

    fireEvent.change(input, { target: { value: "Ultra High Speed" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => {
      expect(defaultProps.onUpdateTag).toHaveBeenCalledWith("fav-101", "tag-1", {
        name: "Ultra High Speed",
      });
    });
  });

  it("merges custom className and data-testid on root article element", () => {
    render(
      <SavedVenueCard
        {...defaultProps}
        className="custom-test-card border-purple-500"
        data-testid="custom-venue-root"
      />
    );

    const card = screen.getByTestId("custom-venue-root");
    expect(card).toBeInTheDocument();
    expect(card).toHaveClass("custom-test-card");
    expect(card).toHaveClass("border-purple-500");
  });

  it("renders with minimal venue data and safely handles missing optional fields", () => {
    const minimalFavorite: SavedVenue = {
      id: "fav-minimal",
      notes: "",
      tags: [],
      venue: {
        id: "venue-min",
        name: "Minimalist Space",
        category: "coworking",
      } as any,
    };

    render(<SavedVenueCard {...defaultProps} favorite={minimalFavorite} />);

    expect(screen.getByText("Minimalist Space")).toBeInTheDocument();
    expect(screen.getByText("coworking")).toBeInTheDocument();
    expect(screen.getByText("0.0")).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("handles notes preview and expansion toggle", async () => {
    render(<SavedVenueCard {...defaultProps} />);

    const notesPreviewButton = screen.getByTestId("saved-venue-notes-preview-button");
    expect(notesPreviewButton).toBeInTheDocument();
    expect(notesPreviewButton).toHaveTextContent("Quiet corner with fast internet near the window.");

    const expandButton = screen.getByTestId("saved-venue-expand-button");
    expect(expandButton).toHaveAttribute("aria-expanded", "false");

    // Click preview to expand
    fireEvent.click(notesPreviewButton);
    expect(expandButton).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Private Notes")).toBeInTheDocument();

    // Click expand button to collapse
    fireEvent.click(expandButton);
    expect(expandButton).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Private Notes")).not.toBeInTheDocument();
  });

  it("executes remove confirmation lifecycle and triggers onRemoveFavorite", async () => {
    render(<SavedVenueCard {...defaultProps} />);

    const removeBtn = screen.getByTestId("saved-venue-remove-button");
    fireEvent.click(removeBtn);

    const dialog = screen.getByTestId("saved-venue-confirm-dialog");
    expect(dialog).toBeInTheDocument();
    expect(screen.getByText("Remove from saved workspaces?")).toBeInTheDocument();

    const confirmBtn = screen.getByTestId("saved-venue-confirm-remove-button");
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(defaultProps.onRemoveFavorite).toHaveBeenCalledWith("place-tokai-101");
    });
  });

  it("cancels remove confirmation when Cancel button is clicked", () => {
    render(<SavedVenueCard {...defaultProps} />);

    fireEvent.click(screen.getByTestId("saved-venue-remove-button"));
    expect(screen.getByTestId("saved-venue-confirm-dialog")).toBeInTheDocument();

    const cancelBtn = screen.getByTestId("saved-venue-cancel-remove-button");
    fireEvent.click(cancelBtn);

    expect(screen.queryByTestId("saved-venue-confirm-dialog")).not.toBeInTheDocument();
    expect(defaultProps.onRemoveFavorite).not.toHaveBeenCalled();
  });

  it("cancels remove confirmation when Escape key is pressed", () => {
    render(<SavedVenueCard {...defaultProps} />);

    fireEvent.click(screen.getByTestId("saved-venue-remove-button"));
    const dialog = screen.getByTestId("saved-venue-confirm-dialog");
    expect(dialog).toBeInTheDocument();

    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(screen.queryByTestId("saved-venue-confirm-dialog")).not.toBeInTheDocument();
    expect(defaultProps.onRemoveFavorite).not.toHaveBeenCalled();
  });
});
