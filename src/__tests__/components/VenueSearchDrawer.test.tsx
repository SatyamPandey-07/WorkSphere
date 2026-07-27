import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import { VenueSearchDrawer } from "@/components/venues/VenueSearchDrawer";

describe("VenueSearchDrawer Component (#1429)", () => {
  it("resets all filter parameters and clears amenity chips on 'Clear Filters'", () => {
    const handleSearchChange = jest.fn();
    const handleAmenitiesChange = jest.fn();
    const handleNoiseLevelChange = jest.fn();
    const handlePriceRangeChange = jest.fn();
    const handleCategoryChange = jest.fn();
    const handleClearFilters = jest.fn();

    render(
      <VenueSearchDrawer
        isOpen={true}
        onClose={jest.fn()}
        searchText="Coffee Shop"
        onSearchChange={handleSearchChange}
        selectedAmenities={["wifi", "outlets", "quiet"]}
        onAmenitiesChange={handleAmenitiesChange}
        noiseLevel="quiet"
        onNoiseLevelChange={handleNoiseLevelChange}
        priceRange="$$"
        onPriceRangeChange={handlePriceRangeChange}
        category="cafe"
        onCategoryChange={handleCategoryChange}
        onClearFilters={handleClearFilters}
      />,
    );

    // Verify initial values
    const searchInput = screen.getByTestId("search-input") as HTMLInputElement;
    expect(searchInput.value).toBe("Coffee Shop");

    expect(screen.getByTestId("amenity-wifi")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByTestId("amenity-outlets")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByTestId("amenity-quiet")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByTestId("amenity-ergonomic")).toHaveAttribute(
      "aria-pressed",
      "false",
    );

    // Click 'Clear Filters' button
    const clearBtn = screen.getByTestId("clear-filters-btn");
    fireEvent.click(clearBtn);

    // Assert that callbacks were triggered with cleared / default values
    expect(handleSearchChange).toHaveBeenCalledWith("");
    expect(handleAmenitiesChange).toHaveBeenCalledWith([]);
    expect(handleNoiseLevelChange).toHaveBeenCalledWith("all");
    expect(handlePriceRangeChange).toHaveBeenCalledWith("all");
    expect(handleCategoryChange).toHaveBeenCalledWith("all");
    expect(handleClearFilters).toHaveBeenCalledTimes(1);
  });

  it("toggles amenity chips with animated active state and clears them", () => {
    render(<VenueSearchDrawer isOpen={true} onClose={jest.fn()} />);

    const wifiChip = screen.getByTestId("amenity-wifi");
    const outletsChip = screen.getByTestId("amenity-outlets");

    fireEvent.click(wifiChip);
    fireEvent.click(outletsChip);

    expect(wifiChip).toHaveAttribute("aria-pressed", "true");
    expect(outletsChip).toHaveAttribute("aria-pressed", "true");
    expect(wifiChip.className).toMatch(/scale-105/);
    expect(wifiChip.className).toMatch(/bg-blue-600/);

    const clearBtn = screen.getByTestId("clear-filters-btn");
    fireEvent.click(clearBtn);

    expect(wifiChip).toHaveAttribute("aria-pressed", "false");
    expect(outletsChip).toHaveAttribute("aria-pressed", "false");
  });
});
