import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import {
  ReviewSentimentFilter,
  ReviewSentimentSection,
  type ReviewItem,
} from "@/components/venue/ReviewSentimentBadge";

describe("ReviewSentimentFilter & ReviewSentimentSection Component (#5062)", () => {
  const mockReviews: ReviewItem[] = [
    {
      id: "rev-1",
      authorName: "Sarah Connor",
      comment: "Amazing peaceful workspace with fantastic high-speed wifi!",
      wifiQuality: 5,
      noiseLevel: "quiet",
      hasOutlets: true,
    },
    {
      id: "rev-2",
      authorName: "John Doe",
      comment: "Average cafe, table was standard and noise was moderate.",
      wifiQuality: 3,
      noiseLevel: "moderate",
      hasOutlets: false,
    },
    {
      id: "rev-3",
      authorName: "Kyle Reese",
      comment: "Terrible dirty seats, awful loud noise and broken power outlets.",
      wifiQuality: 1,
      noiseLevel: "loud",
      hasOutlets: false,
    },
  ];

  it("renders the sentiment filter dropdown with options", () => {
    const handleChange = jest.fn();
    render(
      <ReviewSentimentFilter
        value="all"
        onChange={handleChange}
        reviewCounts={{ all: 3, positive: 1, neutral: 1, critical: 1 }}
      />,
    );

    const dropdown = screen.getByTestId("sentiment-filter-dropdown");
    expect(dropdown).toBeInTheDocument();
    expect(dropdown).toHaveValue("all");

    fireEvent.change(dropdown, { target: { value: "positive" } });
    expect(handleChange).toHaveBeenCalledWith("positive");
  });

  it("renders all reviews initially and filters by sentiment classification when changed", () => {
    render(<ReviewSentimentSection reviews={mockReviews} />);

    // Initially shows all 3 reviews
    expect(screen.getByText("Sarah Connor")).toBeInTheDocument();
    expect(screen.getByText("John Doe")).toBeInTheDocument();
    expect(screen.getByText("Kyle Reese")).toBeInTheDocument();

    const dropdown = screen.getByTestId("sentiment-filter-dropdown");

    // Filter by Positive
    fireEvent.change(dropdown, { target: { value: "positive" } });
    expect(screen.getByText("Sarah Connor")).toBeInTheDocument();
    expect(screen.queryByText("John Doe")).not.toBeInTheDocument();
    expect(screen.queryByText("Kyle Reese")).not.toBeInTheDocument();

    // Filter by Critical
    fireEvent.change(dropdown, { target: { value: "critical" } });
    expect(screen.getByText("Kyle Reese")).toBeInTheDocument();
    expect(screen.queryByText("Sarah Connor")).not.toBeInTheDocument();
    expect(screen.queryByText("John Doe")).not.toBeInTheDocument();

    // Filter by Neutral
    fireEvent.change(dropdown, { target: { value: "neutral" } });
    expect(screen.getByText("John Doe")).toBeInTheDocument();
    expect(screen.queryByText("Sarah Connor")).not.toBeInTheDocument();
    expect(screen.queryByText("Kyle Reese")).not.toBeInTheDocument();
  });

  it("displays empty state message when no reviews match selected filter", () => {
    const positiveOnly: ReviewItem[] = [
      {
        id: "rev-pos",
        authorName: "Happy User",
        comment: "Great loved everything!",
        wifiQuality: 5,
        noiseLevel: "quiet",
      },
    ];

    render(<ReviewSentimentSection reviews={positiveOnly} />);

    const dropdown = screen.getByTestId("sentiment-filter-dropdown");
    fireEvent.change(dropdown, { target: { value: "critical" } });

    expect(
      screen.getByText(/No reviews match the selected sentiment filter/i),
    ).toBeInTheDocument();
  });
});
