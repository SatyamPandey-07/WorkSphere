import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { SavedVenueCard } from "@/components/saved-venues/SavedVenueCard";

const favorite = {
  id: "fav-1",
  notes: "",
  tags: [],
  venue: {
    id: "venue-1",
    placeId: "place-1",
    name: "Blue Tokai",
    category: "cafe",
    address: "12 MG Road",
    rating: 4.5,
    wifiQuality: 4,
    hasOutlets: true,
    noiseLevel: "quiet",
  },
};

function renderCard(onRemoveFavorite: jest.Mock) {
  return render(
    <SavedVenueCard
      favorite={favorite as any}
      onUpdateNotes={jest.fn()}
      onAddTag={jest.fn()}
      onUpdateTag={jest.fn()}
      onDeleteTag={jest.fn()}
      onRemoveFavorite={onRemoveFavorite}
    />,
  );
}

describe("SavedVenueCard remove confirmation", () => {
  it("asks for confirmation before removing the favourite", () => {
    const onRemoveFavorite = jest.fn().mockResolvedValue(undefined);
    renderCard(onRemoveFavorite);

    fireEvent.click(
      screen.getByRole("button", { name: /remove .* from saved venues/i }),
    );

    expect(
      screen.getByText("Remove from saved workspaces?"),
    ).toBeInTheDocument();
    expect(onRemoveFavorite).not.toHaveBeenCalled();
  });

  it("removes only once the confirmation is accepted", async () => {
    const onRemoveFavorite = jest.fn().mockResolvedValue(undefined);
    renderCard(onRemoveFavorite);

    fireEvent.click(
      screen.getByRole("button", { name: /remove .* from saved venues/i }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));

    await waitFor(() =>
      expect(onRemoveFavorite).toHaveBeenCalledWith("place-1"),
    );
  });

  it("dismisses the confirmation on Escape without removing", () => {
    const onRemoveFavorite = jest.fn().mockResolvedValue(undefined);
    renderCard(onRemoveFavorite);

    fireEvent.click(
      screen.getByRole("button", { name: /remove .* from saved venues/i }),
    );

    fireEvent.keyDown(screen.getByRole("alertdialog"), { key: "Escape" });

    expect(
      screen.queryByText("Remove from saved workspaces?"),
    ).not.toBeInTheDocument();
    expect(onRemoveFavorite).not.toHaveBeenCalled();
  });

  it("dismisses the confirmation when Cancel is clicked", () => {
    const onRemoveFavorite = jest.fn().mockResolvedValue(undefined);
    renderCard(onRemoveFavorite);

    fireEvent.click(
      screen.getByRole("button", { name: /remove .* from saved venues/i }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(
      screen.queryByText("Remove from saved workspaces?"),
    ).not.toBeInTheDocument();
    expect(onRemoveFavorite).not.toHaveBeenCalled();
  });
});
