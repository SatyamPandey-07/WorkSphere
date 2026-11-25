import React from "react";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { StarRating } from "@/components/venues/StarRating";

describe("StarRating component (#9761)", () => {
  describe("0-rating and unrated venues", () => {
    test("renders 5 clean outline stars and 'New (No reviews yet)' when review count is 0", () => {
      render(<StarRating rating={0} totalReviews={0} />);

      const container = screen.getByTestId("star-rating-unrated");
      expect(container).toBeInTheDocument();
      expect(container).toHaveAttribute("aria-label", "No reviews yet");

      // Verify all 5 outline stars exist
      for (let i = 0; i < 5; i++) {
        const star = screen.getByTestId(`star-outline-${i}`);
        expect(star).toBeInTheDocument();
        expect(star).toHaveClass("fill-none");
      }

      // Verify label
      const label = screen.getByTestId("star-rating-label");
      expect(label).toHaveTextContent("New (No reviews yet)");
    });

    test("renders unrated state when rating is null or undefined with zero or undefined reviews", () => {
      const { rerender } = render(
        <StarRating rating={null} totalReviews={null} />,
      );
      expect(screen.getByTestId("star-rating-unrated")).toBeInTheDocument();
      expect(screen.getByText("New (No reviews yet)")).toBeInTheDocument();

      rerender(<StarRating rating={undefined} totalReviews={undefined} />);
      expect(screen.getByTestId("star-rating-unrated")).toBeInTheDocument();
      expect(screen.getByText("New (No reviews yet)")).toBeInTheDocument();
    });

    test("renders unrated state when rating is positive but totalReviews is explicitly 0", () => {
      render(<StarRating rating={4.5} totalReviews={0} />);
      expect(screen.getByTestId("star-rating-unrated")).toBeInTheDocument();
      expect(screen.getByText("New (No reviews yet)")).toBeInTheDocument();
    });

    test("renders unrated state when rating is NaN", () => {
      render(<StarRating rating={NaN} totalReviews={10} />);
      expect(screen.getByTestId("star-rating-unrated")).toBeInTheDocument();
      expect(screen.getByText("New (No reviews yet)")).toBeInTheDocument();
    });

    test("announces 'No reviews yet' for screen readers", () => {
      render(<StarRating rating={0} totalReviews={0} />);
      const srElements = screen.getAllByText("No reviews yet");
      expect(srElements.length).toBeGreaterThan(0);
      expect(screen.getByTestId("star-rating-unrated")).toHaveAttribute(
        "aria-label",
        "No reviews yet",
      );
    });

    test("respects showLabel=false while keeping outline stars and accessible label", () => {
      render(<StarRating rating={0} totalReviews={0} showLabel={false} />);
      expect(screen.queryByTestId("star-rating-label")).not.toBeInTheDocument();
      expect(screen.getByTestId("star-rating-unrated")).toHaveAttribute(
        "aria-label",
        "No reviews yet",
      );
      for (let i = 0; i < 5; i++) {
        expect(screen.getByTestId(`star-outline-${i}`)).toBeInTheDocument();
      }
    });
  });

  describe("fractional star ratings", () => {
    test("renders clean fractional stars for 3.5 rating without NaN width or clipping artifacts", () => {
      render(<StarRating rating={3.5} totalReviews={24} />);

      const container = screen.getByTestId("star-rating-rated");
      expect(container).toBeInTheDocument();
      expect(container).toHaveAttribute(
        "aria-label",
        "3.5 out of 5 stars (24 reviews)",
      );

      // Stars 0, 1, 2 should be full
      expect(screen.getByTestId("star-full-0")).toBeInTheDocument();
      expect(screen.getByTestId("star-full-1")).toBeInTheDocument();
      expect(screen.getByTestId("star-full-2")).toBeInTheDocument();

      // Star 3 should be fractional (50%)
      const fractional = screen.getByTestId("star-fractional-3");
      expect(fractional).toBeInTheDocument();
      const fillWrapper = fractional.querySelector(".overflow-hidden");
      expect(fillWrapper).toHaveStyle({ width: "50%" });

      // Star 4 should be empty
      expect(screen.getByTestId("star-empty-4")).toBeInTheDocument();

      // Label displays 3.5 (24)
      expect(screen.getByTestId("star-rating-label")).toHaveTextContent(
        "3.5(24)",
      );
    });

    test("rounds 4.2 rating to 4.0", () => {
      render(<StarRating rating={4.2} totalReviews={8} />);

      expect(screen.getByTestId("star-rating-label")).toHaveTextContent(
        "4.0(8)",
      );

      for (let i = 0; i < 4; i++) {
        expect(screen.getByTestId(`star-full-${i}`)).toBeInTheDocument();
      }

      expect(screen.getByTestId("star-empty-4")).toBeInTheDocument();
    });
  });

  describe("full 5-star ratings", () => {
    test("renders 5 full stars when rating is 5.0", () => {
      render(<StarRating rating={5.0} totalReviews={50} />);

      const container = screen.getByTestId("star-rating-rated");
      expect(container).toBeInTheDocument();
      expect(container).toHaveAttribute(
        "aria-label",
        "5.0 out of 5 stars (50 reviews)",
      );

      for (let i = 0; i < 5; i++) {
        expect(screen.getByTestId(`star-full-${i}`)).toBeInTheDocument();
      }

      expect(screen.getByTestId("star-rating-label")).toHaveTextContent(
        "5.0(50)",
      );
    });

    test("supports reviewCount alias and custom size variants", () => {
      render(<StarRating rating={4.0} reviewCount={15} size="lg" />);

      const container = screen.getByTestId("star-rating-rated");
      expect(container).toHaveAttribute(
        "aria-label",
        "4.0 out of 5 stars (15 reviews)",
      );
      expect(screen.getByTestId("star-full-0")).toHaveClass("w-5 h-5");
    });
  });

  describe("rating normalization (#9905)", () => {
    test("clamps ratings above 5 to 5 full stars", () => {
      render(<StarRating rating={5.2} totalReviews={10} />);

      expect(screen.getByTestId("star-rating-label")).toHaveTextContent(
        "5.0(10)",
      );

      for (let i = 0; i < 5; i++) {
        expect(screen.getByTestId(`star-full-${i}`)).toBeInTheDocument();
      }
    });

    test("treats negative ratings as unrated", () => {
      render(<StarRating rating={-0.5} totalReviews={10} />);

      expect(screen.getByTestId("star-rating-unrated")).toBeInTheDocument();
      expect(screen.queryByTestId("star-full-0")).not.toBeInTheDocument();
    });

    test("rounds ratings to the nearest half star", () => {
      const { rerender } = render(
        <StarRating rating={4.26} totalReviews={10} />,
      );

      expect(screen.getByTestId("star-rating-label")).toHaveTextContent(
        "4.5(10)",
      );

      rerender(<StarRating rating={4.24} totalReviews={10} />);

      expect(screen.getByTestId("star-rating-label")).toHaveTextContent(
        "4.0(10)",
      );
    });

    test("renders no filled stars for NaN", () => {
      render(<StarRating rating={NaN} totalReviews={10} />);

      expect(screen.getByTestId("star-rating-unrated")).toBeInTheDocument();

      for (let i = 0; i < 5; i++) {
        expect(screen.getByTestId(`star-outline-${i}`)).toBeInTheDocument();
      }
    });
  });
});
