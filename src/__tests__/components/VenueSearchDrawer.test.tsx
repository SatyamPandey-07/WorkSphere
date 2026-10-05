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

  describe("Clear Filters visibility & interactions (#3343)", () => {
    it("hides Clear Filters button and active filters bar when no filters are active", () => {
      render(<VenueSearchDrawer isOpen={true} onClose={jest.fn()} />);

      expect(screen.queryByTestId("clear-filters-btn")).not.toBeInTheDocument();
      expect(screen.queryByTestId("header-clear-all-btn")).not.toBeInTheDocument();
      expect(screen.queryByTestId("active-filters-bar")).not.toBeInTheDocument();
      expect(screen.queryByTestId("active-filter-badge")).not.toBeInTheDocument();
    });

    it("displays Clear Filters button and active chips when search text is entered", () => {
      render(<VenueSearchDrawer isOpen={true} onClose={jest.fn()} />);

      const searchInput = screen.getByTestId("search-input");
      fireEvent.change(searchInput, { target: { value: "Library" } });

      expect(screen.getByTestId("clear-filters-btn")).toBeInTheDocument();
      expect(screen.getByTestId("header-clear-all-btn")).toBeInTheDocument();
      expect(screen.getByTestId("active-filters-bar")).toBeInTheDocument();
      expect(screen.getByTestId("active-filter-badge")).toHaveTextContent("1");
      expect(screen.getByText('"Library"')).toBeInTheDocument();

      // Dismiss search chip
      const dismissSearch = screen.getByTestId("clear-search-chip");
      fireEvent.click(dismissSearch);

      expect(screen.queryByTestId("clear-filters-btn")).not.toBeInTheDocument();
      expect(screen.queryByTestId("active-filters-bar")).not.toBeInTheDocument();
    });

    it("displays active chips and allows individual dismissal for category, noise, and price", () => {
      render(<VenueSearchDrawer isOpen={true} onClose={jest.fn()} />);

      // Select category
      fireEvent.click(screen.getByTestId("category-cafe"));
      expect(screen.getByTestId("active-filter-badge")).toHaveTextContent("1");

      // Select noise
      fireEvent.click(screen.getByTestId("noise-quiet"));
      expect(screen.getByTestId("active-filter-badge")).toHaveTextContent("2");

      // Select price
      fireEvent.click(screen.getByTestId("price-$$"));
      expect(screen.getByTestId("active-filter-badge")).toHaveTextContent("3");

      // Dismiss noise chip
      fireEvent.click(screen.getByTestId("clear-noise-chip"));
      expect(screen.getByTestId("active-filter-badge")).toHaveTextContent("2");

      // Click Clear All Filters in the active bar
      const clearAllBtn = screen.getByTestId("clear-all-filters-btn");
      fireEvent.click(clearAllBtn);

      expect(screen.queryByTestId("clear-filters-btn")).not.toBeInTheDocument();
      expect(screen.queryByTestId("active-filters-bar")).not.toBeInTheDocument();
      expect(screen.queryByTestId("active-filter-badge")).not.toBeInTheDocument();
    });
  });

  describe("Noise level filter chips accessibility (#3930)", () => {
    it("renders noise filter chips with descriptive aria-label and aria-pressed attributes", () => {
      render(
        <VenueSearchDrawer
          isOpen={true}
          onClose={jest.fn()}
          noiseLevel="quiet"
        />,
      );

      const allChip = screen.getByTestId("noise-all");
      const quietChip = screen.getByTestId("noise-quiet");
      const moderateChip = screen.getByTestId("noise-moderate");
      const loudChip = screen.getByTestId("noise-loud");

      expect(allChip).toHaveAttribute("aria-label", "Filter by Any Noise level");
      expect(allChip).toHaveAttribute("aria-pressed", "false");

      expect(quietChip).toHaveAttribute("aria-label", "Filter by Quiet spaces");
      expect(quietChip).toHaveAttribute("aria-pressed", "true");

      expect(moderateChip).toHaveAttribute("aria-label", "Filter by Moderate spaces");
      expect(moderateChip).toHaveAttribute("aria-pressed", "false");

      expect(loudChip).toHaveAttribute("aria-label", "Filter by Lively spaces");
      expect(loudChip).toHaveAttribute("aria-pressed", "false");
    });

    it("toggles noise filter selection and updates aria-pressed accordingly", () => {
      const handleNoiseChange = jest.fn();
      render(
        <VenueSearchDrawer
          isOpen={true}
          onClose={jest.fn()}
          onNoiseLevelChange={handleNoiseChange}
        />,
      );

      const quietChip = screen.getByTestId("noise-quiet");
      fireEvent.click(quietChip);

      expect(handleNoiseChange).toHaveBeenCalledWith("quiet");
    });

    it("supports keyboard Enter and Space keys to toggle noise filter state", () => {
      const handleNoiseChange = jest.fn();
      render(
        <VenueSearchDrawer
          isOpen={true}
          onClose={jest.fn()}
          onNoiseLevelChange={handleNoiseChange}
        />,
      );

      const moderateChip = screen.getByTestId("noise-moderate");

      // Press Enter
      fireEvent.keyDown(moderateChip, { key: "Enter", code: "Enter" });
      expect(handleNoiseChange).toHaveBeenCalledWith("moderate");

      // Press Space
      fireEvent.keyDown(moderateChip, { key: " ", code: "Space" });
      expect(handleNoiseChange).toHaveBeenCalledWith("moderate");
    });
  });

  describe("Filter preset saving and application", () => {
    beforeEach(() => {
      localStorage.clear();
    });

    it("applies a default preset on click and updates all filter controls", () => {
      const handleAmenitiesChange = jest.fn();
      const handleNoiseChange = jest.fn();
      const handleCategoryChange = jest.fn();

      render(
        <VenueSearchDrawer
          isOpen={true}
          onClose={jest.fn()}
          onAmenitiesChange={handleAmenitiesChange}
          onNoiseLevelChange={handleNoiseChange}
          onCategoryChange={handleCategoryChange}
        />,
      );

      const quietStudyPreset = screen.getByTestId("preset-item-preset-quiet-study");
      expect(quietStudyPreset).toBeInTheDocument();
      fireEvent.click(quietStudyPreset);

      expect(handleAmenitiesChange).toHaveBeenCalledWith(["wifi", "outlets", "quiet"]);
      expect(handleNoiseChange).toHaveBeenCalledWith("quiet");
      expect(handleCategoryChange).toHaveBeenCalledWith("library");
    });

    it("saves custom filter combination as a new preset to localStorage", () => {
      render(<VenueSearchDrawer isOpen={true} onClose={jest.fn()} />);

      // Open save preset form
      const openSaveBtn = screen.getByTestId("open-save-preset-btn");
      fireEvent.click(openSaveBtn);

      const nameInput = screen.getByTestId("preset-name-input");
      fireEvent.change(nameInput, { target: { value: "Weekend Work" } });

      const saveBtn = screen.getByTestId("confirm-save-preset-btn");
      fireEvent.click(saveBtn);

      expect(screen.getByText("Weekend Work")).toBeInTheDocument();
    });
  });
});

