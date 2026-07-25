import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import { VenueSearchDrawer } from "@/components/venues/VenueSearchDrawer";

describe("VenueSearchDrawer Component (#1429)", () => {
  it("resets all filter parameters and sets amenity checkboxes to false on 'Clear Filters'", () => {
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

    const wifiCheckbox = screen.getByTestId("amenity-wifi") as HTMLInputElement;
    const outletsCheckbox = screen.getByTestId(
      "amenity-outlets",
    ) as HTMLInputElement;
    const quietCheckbox = screen.getByTestId(
      "amenity-quiet",
    ) as HTMLInputElement;
    const ergonomicCheckbox = screen.getByTestId(
      "amenity-ergonomic",
    ) as HTMLInputElement;

    expect(wifiCheckbox.checked).toBe(true);
    expect(outletsCheckbox.checked).toBe(true);
    expect(quietCheckbox.checked).toBe(true);
    expect(ergonomicCheckbox.checked).toBe(false);

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

  it("resets internal uncontrolled filter checkboxes to false when cleared", () => {
    render(<VenueSearchDrawer isOpen={true} onClose={jest.fn()} />);

    // Toggle WiFi and Outlets checkboxes on
    const wifiCheckbox = screen.getByTestId("amenity-wifi") as HTMLInputElement;
    const outletsCheckbox = screen.getByTestId(
      "amenity-outlets",
    ) as HTMLInputElement;

    fireEvent.click(wifiCheckbox);
    fireEvent.click(outletsCheckbox);

    expect(wifiCheckbox.checked).toBe(true);
    expect(outletsCheckbox.checked).toBe(true);

    // Click 'Clear Filters'
    const clearBtn = screen.getByTestId("clear-filters-btn");
    fireEvent.click(clearBtn);

    // Assert all checkboxes are reset to false
    expect(wifiCheckbox.checked).toBe(false);
    expect(outletsCheckbox.checked).toBe(false);
  });
});
