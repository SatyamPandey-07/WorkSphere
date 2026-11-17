import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import {
  VenueReviewModal,
  validateReviewComment,
  REVIEW_ERROR_MESSAGE,
  REVIEW_MIN_LENGTH,
  REVIEW_MAX_LENGTH,
  REVIEW_MAX_ERROR_MESSAGE,
} from "@/components/venues/VenueReviewModal";

// Global mock declarations for testing environment
declare const describe: (name: string, fn: () => void) => void;
declare const it: (name: string, fn: () => void) => void;
declare const expect: (actual: unknown) => any;
declare const beforeEach: (fn: () => void) => void;
declare const jest: any;

describe("validateReviewComment helper", () => {
  it("rejects empty comments", () => {
    const result = validateReviewComment("");
    expect(result.isValid).toBe(false);
    expect(result.trimmedLength).toBe(0);
    expect(result.errorMessage).toBe(REVIEW_ERROR_MESSAGE);
  });

  it("rejects whitespace-only comments", () => {
    const result = validateReviewComment("             ");
    expect(result.isValid).toBe(false);
    expect(result.trimmedLength).toBe(0);
    expect(result.errorMessage).toBe(REVIEW_ERROR_MESSAGE);
  });

  it("rejects comments with fewer than 10 non-whitespace characters", () => {
    const result = validateReviewComment("  Quiet!  "); // 6 trimmed chars < REVIEW_MIN_LENGTH
    expect(result.isValid).toBe(false);
    expect(result.trimmedLength).toBe(6);
    expect(result.trimmedLength).toBeLessThan(REVIEW_MIN_LENGTH);
    expect(result.errorMessage).toBe(REVIEW_ERROR_MESSAGE);
  });

  it("accepts comments with 10 or more non-whitespace characters up to 500 characters", () => {
    const result = validateReviewComment("  Great quiet workspace!  ");
    expect(result.isValid).toBe(true);
    expect(result.trimmedLength).toBe(22);
    expect(result.trimmedLength).toBeGreaterThanOrEqual(REVIEW_MIN_LENGTH);
    expect(result.trimmedLength).toBeLessThanOrEqual(REVIEW_MAX_LENGTH);
    expect(result.trimmedComment).toBe("Great quiet workspace!");
    expect(result.errorMessage).toBeNull();
  });

  it("rejects comments exceeding 500 characters", () => {
    const longComment = "a".repeat(REVIEW_MAX_LENGTH + 1);
    const result = validateReviewComment(longComment);
    expect(result.isValid).toBe(false);
    expect(result.errorMessage).toBe(REVIEW_MAX_ERROR_MESSAGE);
  });

  it("accepts comments of exactly 500 characters", () => {
    const exactComment = "a".repeat(REVIEW_MAX_LENGTH);
    const result = validateReviewComment(exactComment);
    expect(result.isValid).toBe(true);
    expect(result.trimmedLength).toBe(REVIEW_MAX_LENGTH);
    expect(result.errorMessage).toBeNull();
  });
});

describe("VenueReviewModal Component", () => {
  const defaultProps = {
    isOpen: true,
    onClose: jest.fn(),
    venueId: "venue-101",
    venueName: "Blue Bottle Coffee",
    onSubmit: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns null when isOpen is false", () => {
    const { container } = render(
      <VenueReviewModal {...defaultProps} isOpen={false} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders modal dialog when isOpen is true", () => {
    render(<VenueReviewModal {...defaultProps} />);

    expect(screen.getByTestId("venue-review-modal")).toBeInTheDocument();
    expect(screen.getByText("Review Blue Bottle Coffee")).toBeInTheDocument();
    expect(
      screen.getByTestId("venue-review-submit-button"),
    ).toBeInTheDocument();
  });

  it("disables submit button by default when rating is 0 and comment is empty", () => {
    render(<VenueReviewModal {...defaultProps} />);

    const submitBtn = screen.getByTestId("venue-review-submit-button");
    expect(submitBtn).toBeDisabled();
  });

  it("keeps submit button disabled when rating is selected but comment is empty or whitespace-only", () => {
    render(<VenueReviewModal {...defaultProps} />);

    const submitBtn = screen.getByTestId("venue-review-submit-button");
    const textarea = screen.getByTestId("venue-review-textarea");

    // Select 5-star rating
    fireEvent.click(screen.getByTestId("star-rating-5"));
    expect(submitBtn).toBeDisabled();

    // Type spaces only
    fireEvent.change(textarea, { target: { value: "          " } });
    expect(submitBtn).toBeDisabled();
  });

  it("keeps submit button disabled when comment has fewer than 10 non-whitespace characters", () => {
    render(<VenueReviewModal {...defaultProps} />);

    const submitBtn = screen.getByTestId("venue-review-submit-button");
    const textarea = screen.getByTestId("venue-review-textarea");

    // Select 4-star rating
    fireEvent.click(screen.getByTestId("star-rating-4"));

    // 9 characters
    fireEvent.change(textarea, { target: { value: "123456789" } });
    expect(submitBtn).toBeDisabled();
  });

  it("keeps submit button disabled when comment is valid but rating is 0", () => {
    render(<VenueReviewModal {...defaultProps} />);

    const submitBtn = screen.getByTestId("venue-review-submit-button");
    const textarea = screen.getByTestId("venue-review-textarea");

    // Valid comment with > 10 characters
    fireEvent.change(textarea, {
      target: { value: "Excellent high-speed WiFi and coffee." },
    });

    // Rating is still 0
    expect(submitBtn).toBeDisabled();
  });

  it("enables submit button when both rating is selected and comment has >= 10 non-whitespace characters", () => {
    render(<VenueReviewModal {...defaultProps} />);

    const submitBtn = screen.getByTestId("venue-review-submit-button");
    const textarea = screen.getByTestId("venue-review-textarea");

    // Select rating
    fireEvent.click(screen.getByTestId("star-rating-4"));
    expect(submitBtn).toBeDisabled();

    // Type valid comment
    fireEvent.change(textarea, {
      target: { value: "Solid workspace with fast internet." },
    });

    expect(submitBtn).not.toBeDisabled();
  });

  it("displays descriptive error message when text input has fewer than 10 non-whitespace characters", () => {
    render(<VenueReviewModal {...defaultProps} />);

    const textarea = screen.getByTestId("venue-review-textarea");

    // Initially no error is shown
    expect(screen.queryByTestId("venue-review-error")).not.toBeInTheDocument();

    // User types whitespace only
    fireEvent.change(textarea, { target: { value: "     " } });
    expect(screen.getByTestId("venue-review-error")).toHaveTextContent(
      REVIEW_ERROR_MESSAGE,
    );

    // User types short text
    fireEvent.change(textarea, { target: { value: "Short" } });
    expect(screen.getByTestId("venue-review-error")).toHaveTextContent(
      "Review must contain at least 10 non-whitespace characters.",
    );

    // User types >= 10 non-whitespace characters
    fireEvent.change(textarea, {
      target: { value: "Super cozy work atmosphere!" },
    });
    expect(screen.queryByTestId("venue-review-error")).not.toBeInTheDocument();
  });

  it("submits trimmed review comment and calls onClose upon success", async () => {
    const mockSubmit = jest.fn().mockResolvedValue(undefined);
    const mockClose = jest.fn();

    render(
      <VenueReviewModal
        {...defaultProps}
        onSubmit={mockSubmit}
        onClose={mockClose}
      />,
    );

    // Select rating
    fireEvent.click(screen.getByTestId("star-rating-5"));

    // Enter comment with leading and trailing whitespace
    const textarea = screen.getByTestId("venue-review-textarea");
    fireEvent.change(textarea, {
      target: { value: "   Awesome quiet place with power outlets!   " },
    });

    const submitBtn = screen.getByTestId("venue-review-submit-button");
    expect(submitBtn).not.toBeDisabled();

    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(mockSubmit).toHaveBeenCalledWith({
        venueId: "venue-101",
        rating: 5,
        comment: "Awesome quiet place with power outlets!",
      });
      expect(mockClose).toHaveBeenCalledTimes(1);
    });
  });

  it("closes modal on close button click and backdrop click", () => {
    const mockClose = jest.fn();
    render(<VenueReviewModal {...defaultProps} onClose={mockClose} />);

    fireEvent.click(screen.getByTestId("venue-review-modal-close"));
    expect(mockClose).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByTestId("venue-review-modal-backdrop"));
    expect(mockClose).toHaveBeenCalledTimes(2);
  });

  it("closes modal on Escape key press", () => {
    const mockClose = jest.fn();
    render(<VenueReviewModal {...defaultProps} onClose={mockClose} />);

    fireEvent.keyDown(window, { key: "Escape" });
    expect(mockClose).toHaveBeenCalledTimes(1);
  });

  describe("Character Counter & Dynamic Capacity Alerts", () => {
    it("renders initial character counter showing '0 / 500 characters' with neutral muted styling", () => {
      render(<VenueReviewModal {...defaultProps} />);

      const counter = screen.getByTestId("venue-review-char-counter");
      expect(counter).toBeInTheDocument();
      expect(counter).toHaveTextContent("0 / 500 characters");
      expect(counter).toHaveClass("text-zinc-500");
    });

    it("updates character count synchronously on keystroke and maintains neutral styling under 450 characters", () => {
      render(<VenueReviewModal {...defaultProps} />);

      const textarea = screen.getByTestId("venue-review-textarea");
      const counter = screen.getByTestId("venue-review-char-counter");

      // 124 characters
      const comment124 = "x".repeat(124);
      fireEvent.change(textarea, { target: { value: comment124 } });

      expect(counter).toHaveTextContent("124 / 500 characters");
      expect(counter).toHaveClass("text-zinc-500");

      // 449 characters (just below threshold)
      const comment449 = "x".repeat(449);
      fireEvent.change(textarea, { target: { value: comment449 } });

      expect(counter).toHaveTextContent("449 / 500 characters");
      expect(counter).toHaveClass("text-zinc-500");
      expect(counter).not.toHaveClass("text-amber-500");
      expect(counter).not.toHaveClass("text-rose-500");
    });

    it("shifts text color to warning amber between 450 and 499 characters", () => {
      render(<VenueReviewModal {...defaultProps} />);

      const textarea = screen.getByTestId("venue-review-textarea");
      const counter = screen.getByTestId("venue-review-char-counter");

      // Exactly 450 characters
      fireEvent.change(textarea, { target: { value: "x".repeat(450) } });
      expect(counter).toHaveTextContent("450 / 500 characters");
      expect(counter).toHaveClass("text-amber-500");

      // 475 characters
      fireEvent.change(textarea, { target: { value: "x".repeat(475) } });
      expect(counter).toHaveTextContent("475 / 500 characters");
      expect(counter).toHaveClass("text-amber-500");

      // 499 characters
      fireEvent.change(textarea, { target: { value: "x".repeat(499) } });
      expect(counter).toHaveTextContent("499 / 500 characters");
      expect(counter).toHaveClass("text-amber-500");
      expect(counter).not.toHaveClass("text-rose-500");
    });

    it("shifts text color to destructive red when 500 characters is reached", () => {
      render(<VenueReviewModal {...defaultProps} />);

      const textarea = screen.getByTestId("venue-review-textarea");
      const counter = screen.getByTestId("venue-review-char-counter");

      // Exactly 500 characters
      fireEvent.change(textarea, { target: { value: "x".repeat(500) } });
      expect(counter).toHaveTextContent("500 / 500 characters");
      expect(counter).toHaveClass("text-rose-500");
      expect(counter).toHaveClass("font-semibold");
    });

    it("disables submit button and shows error alert when character count exceeds 500", () => {
      render(<VenueReviewModal {...defaultProps} />);

      const textarea = screen.getByTestId("venue-review-textarea");
      const submitBtn = screen.getByTestId("venue-review-submit-button");
      const counter = screen.getByTestId("venue-review-char-counter");

      // Select rating 5
      fireEvent.click(screen.getByTestId("star-rating-5"));

      // Enter 501 characters
      fireEvent.change(textarea, { target: { value: "x".repeat(501) } });

      expect(counter).toHaveTextContent("501 / 500 characters");
      expect(counter).toHaveClass("text-rose-500");
      expect(submitBtn).toBeDisabled();

      // Error alert displayed
      expect(screen.getByTestId("venue-review-error")).toHaveTextContent(
        REVIEW_MAX_ERROR_MESSAGE,
      );
    });
  });
});
