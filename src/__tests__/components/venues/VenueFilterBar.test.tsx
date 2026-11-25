import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { VenueFilterBar } from "@/components/venues/VenueFilterBar";

describe("VenueFilterBar", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("toggles amenity chips, updates aria-pressed, and preserves existing query params", () => {
    const onQueryParamsChange = jest.fn();
    render(
      <VenueFilterBar
        existingSearchParams="q=Bandra&sort=rating"
        onQueryParamsChange={onQueryParamsChange}
      />,
    );

    const petChip = screen.getByTestId("venue-filter-chip-dogFriendly");
    expect(petChip).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(petChip);
    expect(petChip).toHaveAttribute("aria-pressed", "true");
    expect(onQueryParamsChange).toHaveBeenCalledWith(
      "q=Bandra&sort=rating&amenities=dogFriendly&dogFriendly=true",
    );

    act(() => {
      jest.advanceTimersByTime(250);
    });

    expect(screen.getByTestId("venue-filter-live-region").textContent).toBe(
      "1 amenity filter active.",
    );
  });

  it("renders standing desks and external monitors filter chips (#9759)", () => {
    const onQueryParamsChange = jest.fn();
    render(
      <VenueFilterBar
        existingSearchParams="q=Pune"
        onQueryParamsChange={onQueryParamsChange}
      />,
    );

    const standingDeskChip = screen.getByTestId(
      "venue-filter-chip-standing_desks",
    );
    expect(standingDeskChip).toBeInTheDocument();
    expect(standingDeskChip).toHaveTextContent("Standing Desk");
    expect(standingDeskChip).toHaveAttribute("aria-pressed", "false");

    const monitorChip = screen.getByTestId(
      "venue-filter-chip-external_monitors",
    );
    expect(monitorChip).toBeInTheDocument();
    expect(monitorChip).toHaveTextContent("External Monitor (4K/USB-C)");
    expect(monitorChip).toHaveAttribute("aria-pressed", "false");

    // Toggle standing desks
    fireEvent.click(standingDeskChip);
    expect(standingDeskChip).toHaveAttribute("aria-pressed", "true");
    expect(onQueryParamsChange).toHaveBeenCalledWith(
      "q=Pune&amenities=standing_desks&standing_desks=true",
    );

    // Toggle external monitors
    fireEvent.click(monitorChip);
    expect(monitorChip).toHaveAttribute("aria-pressed", "true");
    expect(onQueryParamsChange).toHaveBeenCalledWith(
      "q=Pune&amenities=standing_desks%2Cexternal_monitors&standing_desks=true&external_monitors=true",
    );
  });

  it("renders and toggles vegan options and pet friendly amenity chips with keyboard support (#9882)", () => {
    const onQueryParamsChange = jest.fn();
    render(
      <VenueFilterBar
        existingSearchParams="q=Goa"
        onQueryParamsChange={onQueryParamsChange}
      />,
    );

    const veganChip = screen.getByTestId("venue-filter-chip-veganOptions");
    expect(veganChip).toBeInTheDocument();
    expect(veganChip).toHaveTextContent("Vegan Options");
    expect(veganChip).toHaveAttribute("aria-pressed", "false");

    const petChip = screen.getByTestId("venue-filter-chip-dogFriendly");
    expect(petChip).toBeInTheDocument();
    expect(petChip).toHaveTextContent("Pet Friendly");
    expect(petChip).toHaveAttribute("aria-pressed", "false");

    // Toggle Vegan Options with Space key
    fireEvent.keyDown(veganChip, { key: " " });
    expect(veganChip).toHaveAttribute("aria-pressed", "true");
    expect(onQueryParamsChange).toHaveBeenCalledWith(
      "q=Goa&amenities=veganOptions&veganOptions=true",
    );

    // Toggle Pet Friendly with Enter key
    fireEvent.keyDown(petChip, { key: "Enter" });
    expect(petChip).toHaveAttribute("aria-pressed", "true");
    expect(onQueryParamsChange).toHaveBeenCalledWith(
      "q=Goa&amenities=veganOptions%2CdogFriendly&dogFriendly=true&veganOptions=true",
    );
  });

  it("renders radius dropdown with default 5km and updates localStorage and callbacks on selection (#9890)", () => {
    localStorage.clear();
    const onRadiusChange = jest.fn();

    render(<VenueFilterBar onRadiusChange={onRadiusChange} />);

    const select = screen.getByTestId(
      "venue-filter-radius-select",
    ) as HTMLSelectElement;
    expect(select).toBeInTheDocument();
    expect(select.value).toBe("5");

    fireEvent.change(select, { target: { value: "10" } });
    expect(select.value).toBe("10");
    expect(localStorage.getItem("worksphere_search_radius")).toBe("10");
    expect(onRadiusChange).toHaveBeenCalledWith(10);
  });

  it("restores valid saved radius preference from localStorage on mount (#9890)", () => {
    localStorage.setItem("worksphere_search_radius", "25");

    render(<VenueFilterBar />);

    const select = screen.getByTestId(
      "venue-filter-radius-select",
    ) as HTMLSelectElement;
    expect(select.value).toBe("25");
  });

  describe("Ergonomic quick filters", () => {
    it("renders labeled chips with checkbox selected states", () => {
      render(<VenueFilterBar />);

      for (const label of [
        "Standing Desk",
        "External Monitor",
        "Ergonomic Chair",
      ]) {
        expect(
          screen.getByRole("checkbox", { name: label }),
        ).toHaveAttribute("aria-checked", "false");
      }
    });

    it("selects a preset and preserves other URL parameters", () => {
      (useSearchParams as jest.Mock).mockReturnValue(
        new URLSearchParams("category=cafe&externalMonitor=true&source=map"),
      );
      render(<VenueFilterBar />);

      fireEvent.click(
        screen.getByRole("checkbox", { name: "Standing Desk" }),
      );

      expect(mockReplace).toHaveBeenCalledWith(
        "/venues?category=cafe&externalMonitor=true&source=map&standingDesk=true",
        { scroll: false },
      );
    });

    it("deselects one preset without removing the others", () => {
      (useSearchParams as jest.Mock).mockReturnValue(
        new URLSearchParams(
          "category=cafe&standingDesk=true&externalMonitor=true&ergonomic=true",
        ),
      );
      render(<VenueFilterBar />);

      const standingDesk = screen.getByRole("checkbox", {
        name: "Standing Desk",
      });
      expect(standingDesk).toHaveAttribute("aria-checked", "true");
      fireEvent.click(standingDesk);

      expect(mockReplace).toHaveBeenCalledWith(
        "/venues?category=cafe&externalMonitor=true&ergonomic=true",
        { scroll: false },
      );
    });

    it("restores multiple selected presets from URL parameters after rerender", () => {
      (useSearchParams as jest.Mock).mockReturnValue(
        new URLSearchParams(
          "standingDesk=true&externalMonitor=true&ergonomic=true",
        ),
      );
      const { rerender } = render(<VenueFilterBar />);

      const selectedChips = [
        "Standing Desk",
        "External Monitor",
        "Ergonomic Chair",
      ].map((label) => screen.getByRole("checkbox", { name: label }));
      expect(
        selectedChips.every(
          (chip) => chip.getAttribute("aria-checked") === "true",
        ),
      ).toBe(true);

      rerender(<VenueFilterBar />);
      for (const chip of selectedChips) {
        expect(chip).toHaveAttribute("aria-checked", "true");
      }
    });
  });

  describe("Custom Range Filters Popover Integration", () => {
    it("renders the popover trigger button and opens the filter popover on click", () => {
      render(<VenueFilterBar />);

      const triggerBtn = screen.getByTestId("venue-filter-popover-trigger");
      expect(triggerBtn).toBeInTheDocument();
      expect(triggerBtn).toHaveTextContent("Noise & Wi-Fi");

    render(<VenueFilterBar />);

    const select = screen.getByTestId(
      "venue-filter-radius-select",
    ) as HTMLSelectElement;
    expect(select.value).toBe("5");
  });

  it('renders "⚡ 100+ Mbps" toggle chip and applies minWifiSpeed=100 query parameter (#9893)', () => {
    const onQueryParamsChange = jest.fn();
    render(
      <VenueFilterBar
        existingSearchParams="q=Mumbai"
        onQueryParamsChange={onQueryParamsChange}
      />,
    );

    const wifiChip = screen.getByTestId("venue-filter-chip-lightning_wifi");
    expect(wifiChip).toBeInTheDocument();
    expect(wifiChip).toHaveTextContent("⚡ 100+ Mbps");
    expect(wifiChip).toHaveAttribute("aria-pressed", "false");

    // Toggle on
    fireEvent.click(wifiChip);
    expect(wifiChip).toHaveAttribute("aria-pressed", "true");
    expect(onQueryParamsChange).toHaveBeenCalledWith(
      "q=Mumbai&amenities=lightning_wifi&minWifiSpeed=100",
    );

    // Toggle off
    fireEvent.click(wifiChip);
    expect(wifiChip).toHaveAttribute("aria-pressed", "false");
    expect(onQueryParamsChange).toHaveBeenCalledWith("q=Mumbai");
  });

  it('initializes "⚡ 100+ Mbps" chip as active when minWifiSpeed=100 is present in search params (#9893)', () => {
    render(<VenueFilterBar existingSearchParams="minWifiSpeed=100" />);

    const wifiChip = screen.getByTestId("venue-filter-chip-lightning_wifi");
    expect(wifiChip).toBeInTheDocument();
    expect(wifiChip).toHaveAttribute("aria-pressed", "true");
  });
});
