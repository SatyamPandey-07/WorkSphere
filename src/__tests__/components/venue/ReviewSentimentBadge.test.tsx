import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import DefaultReviewSentimentBadge, {
  ReviewSentimentBadge,
  ReviewSentimentFilter,
  ReviewSentimentSection,
  ReviewItem,
} from "@/components/venue/ReviewSentimentBadge";
import { SentimentSummary } from "@/lib/reviewSentiment";

describe("ReviewSentimentBadge Component Suite", () => {
  const mockPositiveSummary: SentimentSummary = {
    label: "positive",
    positiveRatio: 0.85,
    criticalRatio: 0.05,
    reviewCount: 20,
    highlights: ["Fast wifi", "Quiet pods"],
  };

  const mockMixedSummary: SentimentSummary = {
    label: "mixed",
    positiveRatio: 0.5,
    criticalRatio: 0.4,
    reviewCount: 15,
    highlights: ["Good coffee"],
  };

  const mockNeedsImprovementSummary: SentimentSummary = {
    label: "needs_improvement",
    positiveRatio: 0.2,
    criticalRatio: 0.7,
    reviewCount: 10,
    highlights: ["Spacious desks"],
  };

  const mockReviews: ReviewItem[] = [
    {
      id: "rev-1",
      rating: 5,
      comment: "Super quiet space with incredible fast wifi!",
      authorName: "Alice",
    },
    {
      id: "rev-2",
      rating: 3,
      comment: "Average experience, neither good nor bad.",
      authorName: "Bob",
    },
    {
      id: "rev-3",
      rating: 1,
      comment: "Too noisy and broken AC.",
      author: "Charlie",
    },
  ];

  describe("Exports", () => {
    it("exports ReviewSentimentBadge as both named and default export", () => {
      expect(DefaultReviewSentimentBadge).toBe(ReviewSentimentBadge);
    });
  });

  describe("ReviewSentimentBadge", () => {
    it("renders null when summary is null", () => {
      const { container } = render(<ReviewSentimentBadge summary={null} />);
      expect(container.firstChild).toBeNull();
    });

    it("renders positive sentiment badge with highlights and tooltip", () => {
      render(<ReviewSentimentBadge summary={mockPositiveSummary} />);
      const badge = screen.getByTestId("review-sentiment-badge");
      expect(badge).toBeInTheDocument();
      expect(badge).toHaveAttribute("title", "Based on 20 recent reviews");
      expect(screen.getByText("Mostly positive")).toBeInTheDocument();
      expect(screen.getByText("Loved for: Fast wifi, Quiet pods")).toBeInTheDocument();
    });

    it("renders mixed sentiment badge", () => {
      render(<ReviewSentimentBadge summary={mockMixedSummary} />);
      expect(screen.getByText("Mixed reviews")).toBeInTheDocument();
      expect(screen.getByText("Loved for: Good coffee")).toBeInTheDocument();
    });

    it("renders needs_improvement badge and suppresses highlights", () => {
      render(<ReviewSentimentBadge summary={mockNeedsImprovementSummary} />);
      expect(screen.getByText("Needs improvement")).toBeInTheDocument();
      expect(screen.queryByText(/Loved for:/i)).not.toBeInTheDocument();
    });

    it("accepts custom className and data-testid", () => {
      render(
        <ReviewSentimentBadge
          summary={mockPositiveSummary}
          className="custom-badge-class"
          data-testid="custom-badge"
        />
      );
      const el = screen.getByTestId("custom-badge");
      expect(el).toHaveClass("custom-badge-class");
    });
  });

  describe("ReviewSentimentFilter", () => {
    it("renders sentiment filter with option counts and triggers onChange", () => {
      const handleChange = jest.fn();
      render(
        <ReviewSentimentFilter
          value="all"
          onChange={handleChange}
          reviewCounts={{ all: 30, positive: 20, neutral: 5, critical: 5 }}
        />
      );

      const select = screen.getByTestId("sentiment-filter-dropdown") as HTMLSelectElement;
      expect(select.value).toBe("all");
      expect(screen.getByText("All Reviews (30)")).toBeInTheDocument();
      expect(screen.getByText("Positive (20)")).toBeInTheDocument();
      expect(screen.getByText("Neutral (5)")).toBeInTheDocument();
      expect(screen.getByText("Critical (5)")).toBeInTheDocument();

      fireEvent.change(select, { target: { value: "critical" } });
      expect(handleChange).toHaveBeenCalledWith("critical");
    });

    it("renders default option labels without counts when reviewCounts is omitted", () => {
      render(<ReviewSentimentFilter value="all" onChange={jest.fn()} />);
      expect(screen.getByText("All Reviews")).toBeInTheDocument();
      expect(screen.getByText("Positive")).toBeInTheDocument();
    });

    it("applies custom className and custom data-testid", () => {
      render(
        <ReviewSentimentFilter
          value="positive"
          onChange={jest.fn()}
          className="filter-custom"
          data-testid="custom-filter-dropdown"
        />
      );
      expect(screen.getByTestId("custom-filter-dropdown")).toBeInTheDocument();
    });
  });

  describe("ReviewSentimentSection", () => {
    it("renders summary badge and all reviews with sentiments", () => {
      render(
        <ReviewSentimentSection
          reviews={mockReviews}
          summary={mockPositiveSummary}
        />
      );

      expect(screen.getByTestId("review-sentiment-badge")).toBeInTheDocument();
      expect(screen.getByText("Alice")).toBeInTheDocument();
      expect(screen.getByText("Bob")).toBeInTheDocument();
      expect(screen.getByText("Charlie")).toBeInTheDocument();
      expect(screen.getByText("Super quiet space with incredible fast wifi!")).toBeInTheDocument();

      const items = screen.getAllByTestId(/^review-item-/);
      expect(items).toHaveLength(3);
    });

    it("filters reviews when filter dropdown value is changed", () => {
      render(<ReviewSentimentSection reviews={mockReviews} />);

      const select = screen.getByTestId("sentiment-filter-dropdown");
      fireEvent.change(select, { target: { value: "critical" } });

      expect(screen.getByText("Charlie")).toBeInTheDocument();
      expect(screen.queryByText("Alice")).not.toBeInTheDocument();
      expect(screen.queryByText("Bob")).not.toBeInTheDocument();
    });

    it("renders empty state message when no reviews match the selected filter", () => {
      const positiveOnlyReviews: ReviewItem[] = [
        {
          id: "p-1",
          rating: 5,
          comment: "Great spot!",
          authorName: "Dave",
        },
      ];

      render(<ReviewSentimentSection reviews={positiveOnlyReviews} />);

      const select = screen.getByTestId("sentiment-filter-dropdown");
      fireEvent.change(select, { target: { value: "critical" } });

      expect(screen.getByTestId("no-matching-reviews")).toBeInTheDocument();
      expect(
        screen.getByText("No reviews match the selected sentiment filter.")
      ).toBeInTheDocument();
    });

    it("applies custom className and data-testid to section container", () => {
      render(
        <ReviewSentimentSection
          reviews={mockReviews}
          className="custom-section"
          data-testid="custom-section-id"
        />
      );
      const section = screen.getByTestId("custom-section-id");
      expect(section).toBeInTheDocument();
      expect(section).toHaveClass("custom-section");
    });
  });
});
