import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import { VenueSearchDrawer } from "@/components/venues/VenueSearchDrawer";
import {
  AmenityFilterPills,
  POPULAR_AMENITIES,
} from "@/components/venues/AmenityFilterPills";

describe("VenueSearchDrawer Component (#1429)", () => {
  it("resets all filter parameters and clears amenity chips on 'Clear Filters'", () => {
    const handleSearchChange = jest.fn();
    const handleAmenitiesChange = jest.fn();
    const handleNoiseLevelChange = jest.fn();
    const handlePriceRangeChange = jest.fn();
    const handleCategoryChange = jest.fn();
    const handleMaxDistanceChange = jest.fn();
    const handleCapacityChange = jest.fn();
    const handleSortByChange = jest.fn();
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
        maxDistance={3}
        onMaxDistanceChange={handleMaxDistanceChange}
        minCapacity={4}
        onMinCapacityChange={handleCapacityChange}
        sortBy="capacity_asc"
        onSortByChange={handleSortByChange}
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

    // Search remains unchanged while all other filters return to defaults.
    expect(handleSearchChange).not.toHaveBeenCalled();
    expect(searchInput).toHaveValue("Coffee Shop");
    expect(handleAmenitiesChange).toHaveBeenCalledWith([]);
    expect(handleNoiseLevelChange).toHaveBeenCalledWith("all");
    expect(handlePriceRangeChange).toHaveBeenCalledWith("all");
    expect(handleCategoryChange).toHaveBeenCalledWith("all");
    expect(handleMaxDistanceChange).toHaveBeenCalledWith(0);
    expect(handleCapacityChange).toHaveBeenCalledWith(1);
    expect(handleSortByChange).toHaveBeenCalledWith("default");
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

  it("uses the same standing_desk amenity ID as the quick filter", () => {
    const handleAmenitiesChange = jest.fn();
    render(
      <VenueSearchDrawer
        isOpen
        onClose={jest.fn()}
        selectedAmenities={[]}
        onAmenitiesChange={handleAmenitiesChange}
      />,
    );

    fireEvent.click(screen.getByTestId("amenity-standing_desk"));

    expect(handleAmenitiesChange).toHaveBeenCalledWith(["standing_desk"]);
  });

  it("keeps the drawer and quick pill synchronized through shared amenity state", () => {
    function SharedAmenityFilters() {
      const [selectedAmenities, setSelectedAmenities] = React.useState<
        string[]
      >([]);

      const updateAmenity = (amenityId: string, active: boolean) => {
        setSelectedAmenities((current) =>
          active
            ? [...current, amenityId]
            : current.filter((item) => item !== amenityId),
        );
      };

      return (
        <>
          <AmenityFilterPills
            amenities={POPULAR_AMENITIES.filter(
              (amenity) => amenity.id === "standing_desk",
            )}
            selectedAmenities={selectedAmenities}
            onToggleAmenity={updateAmenity}
            syncWithUrl={false}
          />
          <VenueSearchDrawer
            isOpen
            onClose={jest.fn()}
            selectedAmenities={selectedAmenities}
            onAmenitiesChange={setSelectedAmenities}
          />
        </>
      );
    }

    render(<SharedAmenityFilters />);

    const quickPill = screen.getByTestId("amenity-pill-standing_desk");
    const drawerFilter = screen.getByTestId("amenity-standing_desk");

    fireEvent.click(quickPill);
    expect(drawerFilter).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(drawerFilter);
    expect(quickPill).toHaveAttribute("aria-checked", "false");
  });

  describe("Clear Filters visibility & interactions (#3343)", () => {
    it("hides Clear Filters button and active filters bar when no filters are active", () => {
      render(<VenueSearchDrawer isOpen={true} onClose={jest.fn()} />);

      expect(screen.queryByTestId("clear-filters-btn")).not.toBeInTheDocument();
      expect(
        screen.queryByTestId("header-clear-all-btn"),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByTestId("active-filters-bar"),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByTestId("active-filter-badge"),
      ).not.toBeInTheDocument();
    });

    it("does not treat search text alone as an active filter", () => {
      render(<VenueSearchDrawer isOpen={true} onClose={jest.fn()} />);

      const searchInput = screen.getByTestId("search-input");
      fireEvent.change(searchInput, { target: { value: "Library" } });

      expect(screen.queryByTestId("clear-filters-btn")).not.toBeInTheDocument();
      expect(
        screen.queryByTestId("header-clear-all-btn"),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByTestId("active-filters-bar"),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByTestId("active-filter-badge"),
      ).not.toBeInTheDocument();
      expect(searchInput).toHaveValue("Library");
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
      expect(
        screen.queryByTestId("active-filters-bar"),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByTestId("active-filter-badge"),
      ).not.toBeInTheDocument();
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

      expect(allChip).toHaveAttribute(
        "aria-label",
        "Filter by Any Noise level",
      );
      expect(allChip).toHaveAttribute("aria-pressed", "false");

      expect(quietChip).toHaveAttribute("aria-label", "Filter by Quiet spaces");
      expect(quietChip).toHaveAttribute("aria-pressed", "true");

      expect(moderateChip).toHaveAttribute(
        "aria-label",
        "Filter by Moderate spaces",
      );
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

      const quietStudyPreset = screen.getByTestId(
        "preset-item-preset-quiet-study",
      );
      expect(quietStudyPreset).toBeInTheDocument();
      fireEvent.click(quietStudyPreset);

      expect(handleAmenitiesChange).toHaveBeenCalledWith([
        "wifi",
        "outlets",
        "quiet",
      ]);
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

  describe("Sort by Capacity (Low to High / High to Low) (#4591)", () => {
    it("renders sort dropdown with Capacity: Low to High and Capacity: High to Low options", () => {
      const handleSortByChange = jest.fn();
      render(
        <VenueSearchDrawer
          isOpen={true}
          onClose={jest.fn()}
          sortBy="default"
          onSortByChange={handleSortByChange}
        />,
      );

      const sortSelect = screen.getByTestId(
        "venue-sort-select",
      ) as HTMLSelectElement;
      expect(sortSelect).toBeInTheDocument();
      expect(sortSelect.value).toBe("default");

      expect(
        screen.getByRole("option", { name: "Default" }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("option", { name: "Capacity: Low to High" }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("option", { name: "Capacity: High to Low" }),
      ).toBeInTheDocument();

      fireEvent.change(sortSelect, { target: { value: "capacity_asc" } });
      expect(handleSortByChange).toHaveBeenCalledWith("capacity_asc");

      fireEvent.change(sortSelect, { target: { value: "capacity_desc" } });
      expect(handleSortByChange).toHaveBeenCalledWith("capacity_desc");
    });

    it("resets sort selection when Clear Filters is clicked", () => {
      const handleSortByChange = jest.fn();
      render(
        <VenueSearchDrawer
          isOpen={true}
          onClose={jest.fn()}
          sortBy="capacity_asc"
          onSortByChange={handleSortByChange}
        />,
      );

      const clearBtn = screen.getByTestId("clear-filters-btn");
      fireEvent.click(clearBtn);

      expect(handleSortByChange).toHaveBeenCalledWith("default");
    });
  });

  describe("Clear search query button and ESC keybinding (#5763)", () => {
    it("renders clear button when search input has text and clears on click", () => {
      const handleSearchChange = jest.fn();
      render(
        <VenueSearchDrawer
          isOpen={true}
          onClose={jest.fn()}
          searchText="Coworking Space"
          onSearchChange={handleSearchChange}
        />,
      );

      const clearBtn = screen.getByTestId("clear-search-input-btn");
      const searchInput = screen.getByTestId("search-input");
      expect(clearBtn).toBeInTheDocument();
      expect(clearBtn).toHaveAttribute("aria-label", "Clear search");
      expect(clearBtn).toHaveAttribute("type", "button");

      fireEvent.click(clearBtn);
      expect(handleSearchChange).toHaveBeenCalledWith("");
      expect(searchInput).toHaveFocus();
    });

    it("hides clear button when search input is empty", () => {
      render(
        <VenueSearchDrawer isOpen={true} onClose={jest.fn()} searchText="" />,
      );

      expect(
        screen.queryByTestId("clear-search-input-btn"),
      ).not.toBeInTheDocument();
    });

    it("shows and clears whitespace-only queries", () => {
      render(<VenueSearchDrawer isOpen={true} onClose={jest.fn()} />);

      const searchInput = screen.getByTestId("search-input");
      fireEvent.change(searchInput, { target: { value: " " } });

      const clearBtn = screen.getByRole("button", { name: "Clear search" });
      fireEvent.click(clearBtn);

      expect(searchInput).toHaveValue("");
      expect(searchInput).toHaveFocus();
    });

    it("clears search query and blurs input when Escape key is pressed", () => {
      const handleSearchChange = jest.fn();
      render(
        <VenueSearchDrawer
          isOpen={true}
          onClose={jest.fn()}
          searchText="Desk"
          onSearchChange={handleSearchChange}
        />,
      );

      const searchInput = screen.getByTestId("search-input");
      const blurSpy = jest.spyOn(searchInput, "blur");

      fireEvent.keyDown(searchInput, { key: "Escape", code: "Escape" });

      expect(handleSearchChange).toHaveBeenCalledWith("");
      expect(blurSpy).toHaveBeenCalled();
    });
  });

  describe("Category filter pills text wrapping and layout (#7950)", () => {
    it("renders category pills with natural text wrapping and break classes to prevent text clipping", () => {
      render(
        <VenueSearchDrawer isOpen={true} onClose={jest.fn()} category="all" />,
      );

      const allButton = screen.getByTestId("category-all");
      const cafeButton = screen.getByTestId("category-cafe");
      const coworkingButton = screen.getByTestId("category-coworking");
      const libraryButton = screen.getByTestId("category-library");

      // Verify buttons are rendered and have wrapping and break classes
      expect(allButton).toHaveClass(
        "whitespace-normal",
        "break-words",
        "max-w-full",
      );
      expect(cafeButton).toHaveClass(
        "whitespace-normal",
        "break-words",
        "max-w-full",
      );
      expect(coworkingButton).toHaveClass(
        "whitespace-normal",
        "break-words",
        "max-w-full",
      );
      expect(libraryButton).toHaveClass(
        "whitespace-normal",
        "break-words",
        "max-w-full",
      );

      // Verify button content text
      expect(allButton).toHaveTextContent("All Types");
      expect(cafeButton).toHaveTextContent("Cafes");
      expect(coworkingButton).toHaveTextContent("Coworking");
      expect(libraryButton).toHaveTextContent("Libraries");
    });

    it("handles category selection and deselection correctly with updated layout", () => {
      const handleCategoryChange = jest.fn();
      const { rerender } = render(
        <VenueSearchDrawer
          isOpen={true}
          onClose={jest.fn()}
          category="cafe"
          onCategoryChange={handleCategoryChange}
        />,
      );

      const cafeButton = screen.getByTestId("category-cafe");
      expect(cafeButton).toHaveClass("bg-blue-600", "text-white");

      const libraryButton = screen.getByTestId("category-library");
      expect(libraryButton).not.toHaveClass("bg-blue-600");

      fireEvent.click(libraryButton);
      expect(handleCategoryChange).toHaveBeenCalledWith("library");

      // Rerender with new selection
      rerender(
        <VenueSearchDrawer
          isOpen={true}
          onClose={jest.fn()}
          category="library"
          onCategoryChange={handleCategoryChange}
        />,
      );

      expect(screen.getByTestId("category-library")).toHaveClass(
        "bg-blue-600",
        "text-white",
      );
      expect(screen.getByTestId("category-cafe")).not.toHaveClass(
        "bg-blue-600",
      );
    });
  });

  describe("Mobile Backdrop Click Propagation Prevention (#8021)", () => {
    it("renders backdrop with pointer-events-auto and calls onClose on backdrop click", () => {
      const handleClose = jest.fn();
      render(<VenueSearchDrawer isOpen={true} onClose={handleClose} />);

      const backdrop = screen.getByTestId("filter-drawer-backdrop");
      expect(backdrop).toBeInTheDocument();
      expect(backdrop).toHaveClass("pointer-events-auto");

      fireEvent.click(backdrop);
      expect(handleClose).toHaveBeenCalledTimes(1);
    });

    it("stops event propagation on backdrop click, pointer-down, and touch-start to protect underlying elements", () => {
      const handleClose = jest.fn();
      const parentClickHandler = jest.fn();
      const parentPointerDownHandler = jest.fn();

      render(
        <div
          data-testid="underlying-venue-card-layer"
          onClick={parentClickHandler}
          onPointerDown={parentPointerDownHandler}
        >
          <VenueSearchDrawer isOpen={true} onClose={handleClose} />
        </div>,
      );

      const backdrop = screen.getByTestId("filter-drawer-backdrop");

      // Pointer down on backdrop should not propagate to parent
      fireEvent.pointerDown(backdrop);
      expect(parentPointerDownHandler).not.toHaveBeenCalled();

      // Click on backdrop should trigger onClose and not propagate to underlying element
      fireEvent.click(backdrop);
      expect(handleClose).toHaveBeenCalledTimes(1);
      expect(parentClickHandler).not.toHaveBeenCalled();

      // Touch start on backdrop should not propagate
      const touchEvent = new Event("touchstart", {
        bubbles: true,
        cancelable: true,
      });
      const stopPropSpy = jest.spyOn(touchEvent, "stopPropagation");
      backdrop.dispatchEvent(touchEvent);
      expect(stopPropSpy).toHaveBeenCalled();
    });

    it("does not trigger onClose or propagate events when clicking inside the drawer content panel", () => {
      const handleClose = jest.fn();
      const parentClickHandler = jest.fn();

      render(
        <div onClick={parentClickHandler}>
          <VenueSearchDrawer isOpen={true} onClose={handleClose} />
        </div>,
      );

      const searchInput = screen.getByTestId("search-input");
      fireEvent.click(searchInput);

      expect(handleClose).not.toHaveBeenCalled();
      expect(parentClickHandler).not.toHaveBeenCalled();
    });
  });
});
