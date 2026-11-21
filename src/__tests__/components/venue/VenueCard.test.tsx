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

      expect(screen.queryByTestId("venue-amenity-tags")).not.toBeInTheDocument();
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
