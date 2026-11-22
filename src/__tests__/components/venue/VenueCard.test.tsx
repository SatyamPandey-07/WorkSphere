import React from "react";
import { render, screen } from "@testing-library/react";
import { VenueCard } from "@/components/venue/VenueCard";
import { VenueDetailModal } from "@/components/venues/VenueDetailModal";

describe("Venue Amenity Tag Mobile Overflow & Responsive Wrapping (Issue #9357)", () => {
  const sampleAmenities = [
    "Standing Desks Available",
    "Ergonomic Chairs",
    "High-Speed Internet",
    "Dedicated Meeting Rooms",
  ];

  describe("VenueCard amenity tag pills", () => {
    test("renders amenity tag container with wrapping classes and no whitespace-nowrap", () => {
      render(
        <VenueCard
          id="venue-amenity-test-1"
          name="Minimalist Coworking Studio"
          amenities={sampleAmenities}
        />,
      );

      const container = screen.getByTestId("venue-amenity-tags");
      expect(container).toBeInTheDocument();
      expect(container).toHaveClass("flex");
      expect(container).toHaveClass("flex-wrap");
      expect(container).toHaveClass("items-center");
      expect(container).toHaveClass("gap-1.5");
      expect(container).toHaveClass("overflow-hidden");

      const pills = screen.getAllByTestId("amenity-tag-pill");
      expect(pills).toHaveLength(sampleAmenities.length);

      pills.forEach((pill, idx) => {
        expect(pill).toHaveTextContent(sampleAmenities[idx]);
        expect(pill).toHaveClass("inline-flex");
        expect(pill).toHaveClass("items-center");
        expect(pill).toHaveClass("text-xs");
        expect(pill).toHaveClass("px-2");
        expect(pill).toHaveClass("py-0.5");
        expect(pill).toHaveClass("rounded-full");
        expect(pill).toHaveClass("font-medium");
        expect(pill).toHaveClass("break-words");
        expect(pill).not.toHaveClass("whitespace-nowrap");
      });
    });

    test("renders amenity tags when supplied via nested venue object", () => {
      render(
        <VenueCard
          venue={{
            id: "venue-nested-1",
            name: "Downtown Hub",
            description: "Modern open workspace",
            amenities: sampleAmenities,
          }}
        />,
      );

      const container = screen.getByTestId("venue-amenity-tags");
      expect(container).toBeInTheDocument();
      expect(container).toHaveClass("flex");
      expect(container).toHaveClass("flex-wrap");
      expect(container).toHaveClass("items-center");
      expect(container).toHaveClass("gap-1.5");
      expect(container).toHaveClass("overflow-hidden");

      expect(screen.getByText("Standing Desks Available")).toBeInTheDocument();
      expect(screen.getByText("Ergonomic Chairs")).toBeInTheDocument();
      expect(screen.getByText("High-Speed Internet")).toBeInTheDocument();
      expect(screen.getByText("Dedicated Meeting Rooms")).toBeInTheDocument();
    });

    test("does not render amenity container if amenities list is empty", () => {
      render(
        <VenueCard
          id="venue-no-amenities"
          name="Simple Workspace"
          amenities={[]}
        />,
      );

      expect(
        screen.queryByTestId("venue-amenity-tags"),
      ).not.toBeInTheDocument();
    });

    test("renders long amenity labels with wrapping, break-words, and max-w-full without line clamping", () => {
      const longAmenities = [
        "Dedicated Quiet Workspaces & Ergonomic Standing Desks With Dual 4K Monitor Arm Support",
        "Ultra-High-Speed Dedicated Symmetrical Gigabit Fiber Internet Connection",
      ];

      render(
        <VenueCard
          id="venue-long-amenities"
          name="Tech Haven"
          amenities={longAmenities}
        />,
      );

      const container = screen.getByTestId("venue-amenity-tags");
      expect(container).toHaveClass("min-w-0");
      expect(container).toHaveClass("max-w-full");

      const pills = screen.getAllByTestId("amenity-tag-pill");
      expect(pills).toHaveLength(2);

      pills.forEach((pill, idx) => {
        expect(pill).toHaveTextContent(longAmenities[idx]);
        expect(pill).toHaveClass("break-words");
        expect(pill).toHaveClass("whitespace-normal");
        expect(pill).toHaveClass("min-w-0");
        expect(pill).toHaveClass("max-w-full");
        expect(pill).toHaveClass("[overflow-wrap:anywhere]");
        expect(pill).not.toHaveClass("truncate");
        expect(pill).not.toHaveClass("line-clamp-1");
        expect(pill).not.toHaveClass("line-clamp-2");
      });
    });

    test("handles uninterrupted tokens without breaking card layout boundaries", () => {
      const unbrokenAmenity = [
        "SupercalifragilisticexpialidociousLongUnbrokenStringWithoutSpaces",
      ];

      const { container } = render(
        <VenueCard
          id="venue-unbroken"
          name="Edge Case Studio"
          amenities={unbrokenAmenity}
        />,
      );

      const cardRoot = container.firstElementChild;
      expect(cardRoot).toHaveClass("min-w-0");
      expect(cardRoot).toHaveClass("max-w-full");

      const pill = screen.getByTestId("amenity-tag-pill");
      expect(pill).toHaveTextContent(unbrokenAmenity[0]);
      expect(pill).toHaveClass("break-words");
      expect(pill).toHaveClass("[overflow-wrap:anywhere]");
      expect(pill).toHaveClass("max-w-full");
    });

    test("renders multiple amenity badges in a compact wrapping flex layout", () => {
      const manyAmenities = [
        "WiFi",
        "Coffee",
        "Power Outlets",
        "Quiet Zone",
        "Monitors",
        "Whiteboard",
        "Phone Booth",
        "Parking",
      ];

      render(
        <VenueCard
          id="venue-many-amenities"
          name="Metropolitan Workspace"
          amenities={manyAmenities}
        />,
      );

      const container = screen.getByTestId("venue-amenity-tags");
      expect(container).toHaveClass("flex");
      expect(container).toHaveClass("flex-wrap");
      expect(container).toHaveClass("gap-1.5");

      const pills = screen.getAllByTestId("amenity-tag-pill");
      expect(pills).toHaveLength(8);
    });
  });

  describe("VenueDetailModal amenity tag pills", () => {
    test("renders amenity tags in modal with flex-wrap and responsive badge styles", () => {
      const modalVenue = {
        id: "modal-venue-1",
        name: "Apex Coworking",
        category: "Work Lounge",
        amenities: sampleAmenities,
      };

      render(
        <VenueDetailModal
          venue={modalVenue}
          isOpen={true}
          onClose={jest.fn()}
        />,
      );

      const modalContainer = screen.getByTestId("venue-modal-amenities");
      expect(modalContainer).toBeInTheDocument();
      expect(modalContainer).toHaveClass("flex");
      expect(modalContainer).toHaveClass("flex-wrap");
      expect(modalContainer).toHaveClass("items-center");
      expect(modalContainer).toHaveClass("gap-1.5");
      expect(modalContainer).toHaveClass("overflow-hidden");

      const modalPills = screen.getAllByTestId("modal-amenity-tag-pill");
      expect(modalPills).toHaveLength(sampleAmenities.length);

      modalPills.forEach((pill, idx) => {
        expect(pill).toHaveTextContent(sampleAmenities[idx]);
        expect(pill).toHaveClass("inline-flex");
        expect(pill).toHaveClass("items-center");
        expect(pill).toHaveClass("text-xs");
        expect(pill).toHaveClass("px-2");
        expect(pill).toHaveClass("py-0.5");
        expect(pill).toHaveClass("rounded-full");
        expect(pill).toHaveClass("font-medium");
        expect(pill).toHaveClass("break-words");
        expect(pill).not.toHaveClass("whitespace-nowrap");
      });
    });
  });
});
