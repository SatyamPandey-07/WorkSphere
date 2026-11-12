import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import {
  VenueFilterDropdown,
  type FilterOption,
} from "@/components/venues/VenueFilterDropdown";

describe("VenueFilterDropdown Accessibility & Keyboard Navigation", () => {
  const mockOptions: FilterOption[] = [
    { id: "opt-1", label: "Free Wi-Fi", value: "wifi" },
    { id: "opt-2", label: "Power Outlets", value: "outlets" },
    { id: "opt-3", label: "Quiet Zone", value: "quiet" },
  ];

  it("renders trigger button with aria-haspopup='true' and aria-expanded='false' when closed", () => {
    render(
      <VenueFilterDropdown
        id="amenities-filter"
        label="Amenities"
        options={mockOptions}
      />,
    );

    const trigger = screen.getByRole("button", { name: /amenities/i });
    expect(trigger).toHaveAttribute("aria-haspopup", "true");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(trigger).toHaveAttribute("id", "amenities-filter-trigger");
    expect(trigger).toHaveAttribute("aria-controls", "amenities-filter-menu");

    // Menu panel should not be visible when closed
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("dynamically updates aria-expanded to true when opened and connects aria-controls", () => {
    render(
      <VenueFilterDropdown
        id="amenities-filter"
        label="Amenities"
        options={mockOptions}
      />,
    );

    const trigger = screen.getByRole("button", { name: /amenities/i });
    fireEvent.click(trigger);

    expect(trigger).toHaveAttribute("aria-expanded", "true");

    const menu = screen.getByRole("menu");
    expect(menu).toBeInTheDocument();
    expect(menu).toHaveAttribute("id", "amenities-filter-menu");
    expect(menu).toHaveAttribute("aria-labelledby", "amenities-filter-trigger");
    expect(trigger.getAttribute("aria-controls")).toBe(menu.getAttribute("id"));
  });

  it("opens dropdown and focuses first item on ArrowDown keydown on trigger button", async () => {
    render(
      <VenueFilterDropdown
        id="amenities-filter"
        label="Amenities"
        options={mockOptions}
      />,
    );

    const trigger = screen.getByRole("button", { name: /amenities/i });
    trigger.focus();

    fireEvent.keyDown(trigger, { key: "ArrowDown" });

    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("menu")).toBeInTheDocument();

    await waitFor(() => {
      const firstOption = screen.getByRole("menuitem", { name: /free wi-fi/i });
      expect(document.activeElement).toBe(firstOption);
    });
  });

  it("closes dropdown and restores focus to trigger button when Escape is pressed on trigger", () => {
    render(
      <VenueFilterDropdown
        id="amenities-filter"
        label="Amenities"
        options={mockOptions}
        isOpen={true}
      />,
    );

    const trigger = screen.getByRole("button", { name: /amenities/i });
    fireEvent.keyDown(trigger, { key: "Escape" });

    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("closes dropdown and restores focus to trigger button when Escape is pressed on menu item", () => {
    render(
      <VenueFilterDropdown
        id="amenities-filter"
        label="Amenities"
        options={mockOptions}
      />,
    );

    const trigger = screen.getByRole("button", { name: /amenities/i });
    fireEvent.click(trigger);

    const firstOption = screen.getByRole("menuitem", { name: /free wi-fi/i });
    firstOption.focus();

    fireEvent.keyDown(firstOption, { key: "Escape" });

    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(document.activeElement).toBe(trigger);
  });

  it("navigates between menu items using ArrowDown and ArrowUp", () => {
    render(
      <VenueFilterDropdown
        id="amenities-filter"
        label="Amenities"
        options={mockOptions}
      />,
    );

    const trigger = screen.getByRole("button", { name: /amenities/i });
    fireEvent.click(trigger);

    const options = screen.getAllByRole("menuitem");
    expect(options).toHaveLength(3);

    // Focus first item and press ArrowDown
    options[0].focus();
    fireEvent.keyDown(options[0], { key: "ArrowDown" });
    expect(document.activeElement).toBe(options[1]);

    // Press ArrowDown to reach third item
    fireEvent.keyDown(options[1], { key: "ArrowDown" });
    expect(document.activeElement).toBe(options[2]);

    // Press ArrowUp to go back to second item
    fireEvent.keyDown(options[2], { key: "ArrowUp" });
    expect(document.activeElement).toBe(options[1]);
  });

  it("calls onSelect callback when an option is selected", () => {
    const onSelectMock = jest.fn();
    render(
      <VenueFilterDropdown
        id="amenities-filter"
        label="Amenities"
        options={mockOptions}
        onSelect={onSelectMock}
      />,
    );

    const trigger = screen.getByRole("button", { name: /amenities/i });
    fireEvent.click(trigger);

    const secondOption = screen.getByRole("menuitem", {
      name: /power outlets/i,
    });
    fireEvent.click(secondOption);

    expect(onSelectMock).toHaveBeenCalledWith("outlets");
  });

  it("displays active selections count badge when items are selected", () => {
    render(
      <VenueFilterDropdown
        id="amenities-filter"
        label="Amenities"
        options={mockOptions}
        selectedValues={["wifi", "quiet"]}
        multiSelect={true}
      />,
    );

    const badge = screen.getByTestId("filter-badge");
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveTextContent("2");
  });
});
