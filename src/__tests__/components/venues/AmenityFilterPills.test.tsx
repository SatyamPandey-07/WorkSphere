import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import DefaultAmenityFilterPills, {
  AmenityFilterPills,
  POPULAR_AMENITIES,
} from "@/components/venues/AmenityFilterPills";
import { useRouter, useSearchParams, usePathname } from "next/navigation";

jest.mock("next/navigation", () => ({
  useRouter: jest.fn(),
  useSearchParams: jest.fn(),
  usePathname: jest.fn(),
}));

describe("AmenityFilterPills Component", () => {
  const mockReplace = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    (useRouter as jest.Mock).mockReturnValue({ replace: mockReplace });
    (usePathname as jest.Mock).mockReturnValue("/venues");
    (useSearchParams as jest.Mock).mockReturnValue(new URLSearchParams());
  });

  describe("Exports", () => {
    it("exports AmenityFilterPills as both named and default export", () => {
      expect(DefaultAmenityFilterPills).toBe(AmenityFilterPills);
    });
  });

  describe("Rendering Default State", () => {
    it("renders popular amenities with icons and labels", () => {
      render(<AmenityFilterPills />);

      expect(screen.getByTestId("amenity-filter-pills-container")).toBeInTheDocument();
      expect(screen.getByTestId("amenity-pills-scroll")).toBeInTheDocument();

      POPULAR_AMENITIES.forEach((item) => {
        const pill = screen.getByTestId(`amenity-pill-${item.id}`);
        expect(pill).toBeInTheDocument();
        expect(pill).toHaveTextContent(item.label);
        expect(pill).toHaveAttribute("aria-checked", "false");
      });
    });
  });

  describe("Empty Amenities Handling", () => {
    it("returns null when amenities is empty and no emptyMessage is provided", () => {
      const { container } = render(<AmenityFilterPills amenities={[]} />);
      expect(container.firstChild).toBeNull();
    });

    it("renders emptyMessage paragraph when amenities is empty", () => {
      render(
        <AmenityFilterPills
          amenities={[]}
          emptyMessage="No amenities configured"
          data-testid="custom-empty-msg"
        />
      );

      const msg = screen.getByTestId("custom-empty-msg");
      expect(msg).toBeInTheDocument();
      expect(msg).toHaveTextContent("No amenities configured");
    });
  });

  describe("Controlled Selection", () => {
    it("highlights selected items and marks aria-checked=true", () => {
      render(
        <AmenityFilterPills selectedAmenities={["wifi", "coffee"]} />
      );

      const wifiPill = screen.getByTestId("amenity-pill-wifi");
      const coffeePill = screen.getByTestId("amenity-pill-coffee");
      const quietPill = screen.getByTestId("amenity-pill-quiet");

      expect(wifiPill).toHaveAttribute("aria-checked", "true");
      expect(wifiPill).toHaveAttribute("data-selected", "true");
      expect(coffeePill).toHaveAttribute("aria-checked", "true");
      expect(quietPill).toHaveAttribute("aria-checked", "false");
    });
  });

  describe("Uncontrolled Selection via URL Params", () => {
    it("derives active amenities from individual params and comma-separated amenities", () => {
      const params = new URLSearchParams("wifi=true&amenities=coffee,quiet");
      (useSearchParams as jest.Mock).mockReturnValue(params);

      render(<AmenityFilterPills />);

      expect(screen.getByTestId("amenity-pill-wifi")).toHaveAttribute("aria-checked", "true");
      expect(screen.getByTestId("amenity-pill-coffee")).toHaveAttribute("aria-checked", "true");
      expect(screen.getByTestId("amenity-pill-quiet")).toHaveAttribute("aria-checked", "true");
      expect(screen.getByTestId("amenity-pill-outlets")).toHaveAttribute("aria-checked", "false");
    });
  });

  describe("Click Interactions & onToggle Callback", () => {
    it("toggles amenity on click and notifies parent via onToggleAmenity", () => {
      const onToggleMock = jest.fn();
      render(<AmenityFilterPills onToggleAmenity={onToggleMock} />);

      const wifiPill = screen.getByTestId("amenity-pill-wifi");
      fireEvent.click(wifiPill);

      expect(onToggleMock).toHaveBeenCalledWith("wifi", true);
    });

    it("updates URL with new query parameter when syncWithUrl is true", () => {
      render(<AmenityFilterPills syncWithUrl={true} />);

      const wifiPill = screen.getByTestId("amenity-pill-wifi");
      fireEvent.click(wifiPill);

      expect(mockReplace).toHaveBeenCalledWith("/venues?wifi=true", { scroll: false });
    });

    it("removes query parameter from URL when deselecting", () => {
      const params = new URLSearchParams("wifi=true&amenities=wifi,quiet");
      (useSearchParams as jest.Mock).mockReturnValue(params);

      render(<AmenityFilterPills syncWithUrl={true} />);

      const wifiPill = screen.getByTestId("amenity-pill-wifi");
      fireEvent.click(wifiPill);

      expect(mockReplace).toHaveBeenCalledWith("/venues?amenities=quiet", { scroll: false });
    });

    it("does not call router.replace when syncWithUrl is false", () => {
      render(<AmenityFilterPills syncWithUrl={false} />);

      const wifiPill = screen.getByTestId("amenity-pill-wifi");
      fireEvent.click(wifiPill);

      expect(mockReplace).not.toHaveBeenCalled();
    });
  });

  describe("Custom Props & Test IDs", () => {
    it("applies custom className and data-testid override", () => {
      render(
        <AmenityFilterPills
          className="custom-pill-row"
          data-testid="custom-pills-test-id"
        />
      );

      const container = screen.getByTestId("custom-pills-test-id");
      expect(container).toBeInTheDocument();
      expect(container).toHaveClass("custom-pill-row");
    });
  });
});
