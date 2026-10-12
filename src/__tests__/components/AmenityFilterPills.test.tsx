import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import {
  AmenityFilterPills,
  POPULAR_AMENITIES,
} from "@/components/venues/AmenityFilterPills";

const mockReplace = jest.fn();
let mockSearchParams = new URLSearchParams();

jest.mock("next/navigation", () => ({
  useRouter: () => ({
    replace: mockReplace,
  }),
  useSearchParams: () => mockSearchParams,
  usePathname: () => "/venues",
}));

describe("AmenityFilterPills Component", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSearchParams = new URLSearchParams();
  });

  it("renders horizontally scrollable container with all popular amenities", () => {
    render(<AmenityFilterPills />);

    const container = screen.getByTestId("amenity-filter-pills-container");
    expect(container).toBeInTheDocument();

    const scrollContainer = screen.getByTestId("amenity-pills-scroll");
    expect(scrollContainer).toHaveClass("overflow-x-auto");

    POPULAR_AMENITIES.forEach((item) => {
      expect(screen.getByText(item.label)).toBeInTheDocument();
    });
  });

  it("toggles amenity pill selection state and invokes onToggleAmenity callback", () => {
    const handleToggle = jest.fn();
    render(
      <AmenityFilterPills onToggleAmenity={handleToggle} syncWithUrl={false} />,
    );

    const wifiPill = screen.getByTestId("amenity-pill-wifi");
    expect(wifiPill).toHaveAttribute("aria-checked", "false");

    fireEvent.click(wifiPill);
    expect(handleToggle).toHaveBeenCalledWith("wifi", true);
  });

  it("dynamically updates URL search parameters when toggling pills", () => {
    render(<AmenityFilterPills syncWithUrl={true} />);

    const outletsPill = screen.getByTestId("amenity-pill-outlets");
    fireEvent.click(outletsPill);

    expect(mockReplace).toHaveBeenCalledWith("/venues?outlets=true", {
      scroll: false,
    });
  });

  it("reflects active state when search params already contain the amenity", () => {
    mockSearchParams = new URLSearchParams("wifi=true&quiet=true");
    render(<AmenityFilterPills syncWithUrl={true} />);

    const wifiPill = screen.getByTestId("amenity-pill-wifi");
    const quietPill = screen.getByTestId("amenity-pill-quiet");
    const outletsPill = screen.getByTestId("amenity-pill-outlets");

    expect(wifiPill).toHaveAttribute("aria-checked", "true");
    expect(quietPill).toHaveAttribute("aria-checked", "true");
    expect(outletsPill).toHaveAttribute("aria-checked", "false");
  });

  it("renders no container when amenities are empty", () => {
    render(<AmenityFilterPills amenities={[]} />);

    expect(
      screen.queryByTestId("amenity-filter-pills-container"),
    ).not.toBeInTheDocument();

    expect(
      screen.queryByTestId("amenity-pills-scroll"),
    ).not.toBeInTheDocument();
  });

  it("renders a custom fallback message when amenities are empty", () => {
    render(
      <AmenityFilterPills
        amenities={[]}
        emptyMessage="No matching amenities found"
      />,
    );

    expect(screen.getByText("No matching amenities found")).toBeInTheDocument();

    expect(
      screen.queryByTestId("amenity-pills-scroll"),
    ).not.toBeInTheDocument();
  });

  it("initializes scroll handling when amenities become available", () => {
    const { rerender, container } = render(
      <AmenityFilterPills amenities={[]} />,
    );
    // Simulate amenities arriving after the initial empty render.
    rerender(<AmenityFilterPills amenities={POPULAR_AMENITIES} />);
    const scrollContainer = screen.getByTestId("amenity-pills-scroll");
    // Simulate the user scrolling horizontally.
    scrollContainer.scrollLeft = 12;
    fireEvent.scroll(scrollContainer);
    // The left gradient should appear after scrolling.
    expect(container.querySelector(".bg-gradient-to-r")).toBeInTheDocument();
  });
});
