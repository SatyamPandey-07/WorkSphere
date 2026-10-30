import React from "react";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { VenueCardSkeleton } from "@/components/venues/VenueCardSkeleton";

describe("VenueCardSkeleton", () => {
  it("renders a single skeleton card with role status and accessible text by default", () => {
    render(<VenueCardSkeleton />);

    const card = screen.getByTestId("venue-card-skeleton-hud");
    expect(card).toBeInTheDocument();
    expect(card).toHaveAttribute("role", "status");
    expect(card).toHaveAttribute("aria-label", "Loading venue card");
    expect(screen.getByText("Loading venue details...")).toBeInTheDocument();
    expect(screen.getByText("Loading venue details...")).toHaveClass("sr-only");

    expect(screen.getByTestId("venue-card-skeleton-icon")).toBeInTheDocument();
    expect(screen.getByTestId("venue-card-skeleton-title")).toBeInTheDocument();
    expect(screen.getByTestId("venue-card-skeleton-score")).toBeInTheDocument();
    expect(screen.getByTestId("venue-card-skeleton-category")).toBeInTheDocument();
    expect(screen.getByTestId("venue-card-skeleton-address")).toBeInTheDocument();
    expect(screen.getByTestId("venue-card-skeleton-amenities")).toBeInTheDocument();
    expect(screen.getByTestId("venue-card-skeleton-actions")).toBeInTheDocument();
  });

  it("applies custom className and custom data-testid", () => {
    render(
      <VenueCardSkeleton
        className="custom-hud-test-class"
        data-testid="my-venue-skeleton"
      />
    );

    const card = screen.getByTestId("my-venue-skeleton");
    expect(card).toBeInTheDocument();
    expect(card).toHaveClass("custom-hud-test-class");
  });

  it("applies compact styling when compact is set to true", () => {
    render(<VenueCardSkeleton compact />);

    const card = screen.getByTestId("venue-card-skeleton-hud");
    expect(card).toHaveClass("py-2");
    expect(card).toHaveClass("px-2.5");

    const icon = screen.getByTestId("venue-card-skeleton-icon");
    expect(icon).toHaveClass("w-6");
    expect(icon).toHaveClass("h-6");
  });

  it("renders multiple cards inside a group container when count > 1", () => {
    render(<VenueCardSkeleton count={3} />);

    const group = screen.getByTestId("venue-card-skeleton-group");
    expect(group).toBeInTheDocument();

    expect(screen.getByTestId("venue-card-skeleton-hud-0")).toBeInTheDocument();
    expect(screen.getByTestId("venue-card-skeleton-hud-1")).toBeInTheDocument();
    expect(screen.getByTestId("venue-card-skeleton-hud-2")).toBeInTheDocument();
  });

  it("clamps non-positive count cleanly to 1 card", () => {
    render(<VenueCardSkeleton count={-2} />);

    expect(screen.queryByTestId("venue-card-skeleton-group")).not.toBeInTheDocument();
    expect(screen.getByTestId("venue-card-skeleton-hud")).toBeInTheDocument();
  });
});
