import React from "react";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { ReviewSentimentBadge } from "@/components/venue/ReviewSentimentBadge";
import type { SentimentSummary } from "@/lib/reviewSentiment";

const make = (overrides: Partial<SentimentSummary> = {}): SentimentSummary => ({
  label: "positive",
  score: 0.8,
  reviewCount: 5,
  highlights: ["Quiet atmosphere", "Fast WiFi"],
  ...overrides,
});

describe("ReviewSentimentBadge", () => {
  it("renders nothing without a summary", () => {
    const { container } = render(<ReviewSentimentBadge summary={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the positive pill and what reviewers loved", () => {
    render(<ReviewSentimentBadge summary={make()} />);
    expect(screen.getByText("Mostly positive")).toBeInTheDocument();
    expect(
      screen.getByText("Loved for: Quiet atmosphere, Fast WiFi"),
    ).toBeInTheDocument();
  });

  it("shows the mixed pill", () => {
    render(
      <ReviewSentimentBadge
        summary={make({ label: "mixed", highlights: [] })}
      />,
    );
    expect(screen.getByText("Mixed reviews")).toBeInTheDocument();
    expect(screen.queryByText(/Loved for/)).not.toBeInTheDocument();
  });

  it("hides highlights when the venue needs improvement", () => {
    render(
      <ReviewSentimentBadge
        summary={make({ label: "needs_improvement", score: -0.7 })}
      />,
    );
    expect(screen.getByText("Needs improvement")).toBeInTheDocument();
    expect(screen.queryByText(/Loved for/)).not.toBeInTheDocument();
  });

  it("explains how many reviews it is based on", () => {
    render(<ReviewSentimentBadge summary={make({ reviewCount: 12 })} />);
    expect(screen.getByTestId("review-sentiment-badge")).toHaveAttribute(
      "title",
      "Based on 12 recent reviews",
    );
  });
});
