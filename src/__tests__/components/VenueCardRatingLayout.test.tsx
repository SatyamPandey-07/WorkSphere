import { render, screen, act } from "@testing-library/react";
import "@testing-library/jest-dom";
import { VenueCard } from "@/components/VenueCard";

jest.mock("next/navigation", () => ({
  useRouter: () => ({ prefetch: jest.fn() }),
}));

const mockVenue = {
  id: "test-venue-rating",
  name: "Star Lounge",
  category: "cafe",
  address: "456 Market St",
  rating: 4.8,
  position: { lat: 37.7749, lng: -122.4194 },
};

describe("VenueCard Rating Layout (#1745)", () => {
  it("renders star rating container with inline-flex alignment and high-contrast dark mode classes", async () => {
    render(<VenueCard venue={mockVenue} />);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const ratingContainer = screen.getByTestId("star-rating-container");
    expect(ratingContainer).toBeInTheDocument();
    expect(ratingContainer).toHaveClass("inline-flex");
    expect(ratingContainer).toHaveClass("items-center");
    expect(ratingContainer).toHaveClass("gap-1");

    const starIcon = ratingContainer.querySelector("svg");
    expect(starIcon).toBeInTheDocument();
    expect(starIcon).toHaveClass("text-amber-500");
    expect(starIcon).toHaveClass("dark:text-amber-400");
  });
});
