import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { VenueReviewForm } from "@/components/ui/VenueReviewForm";

describe("VenueReviewForm Star Rating", () => {
  it("renders 5 star slots and initial rating state", () => {
    render(<VenueReviewForm initialRating={0} />);

    expect(
      screen.getByRole("slider", { name: /venue rating/i }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("rating-preview-text")).toHaveTextContent(
      "Select rating",
    );

    // All 5 empty star slots exist
    for (let i = 1; i <= 5; i++) {
      expect(screen.getByTestId(`star-slot-${i}`)).toBeInTheDocument();
      expect(screen.getByTestId(`star-${i}-empty`)).toBeInTheDocument();
      expect(screen.queryByTestId(`star-${i}-full`)).not.toBeInTheDocument();
      expect(screen.queryByTestId(`star-${i}-half`)).not.toBeInTheDocument();
    }
  });

  describe("Hover Preview State with Gold Star Styling", () => {
    it("previews hovered score in gold styling when hovering left or right half of stars", () => {
      render(<VenueReviewForm initialRating={0} />);

      const star4Left = screen.getByTestId("star-4-left");
      fireEvent.mouseEnter(star4Left);

      // Score 3.5 should be previewed
      expect(screen.getByTestId("rating-preview-text")).toHaveTextContent(
        "3.5 / 5.0",
      );

      // Stars 1, 2, 3 should be full gold
      for (let i = 1; i <= 3; i++) {
        const fullStar = screen.getByTestId(`star-${i}-full`);
        expect(fullStar).toBeInTheDocument();
        expect(fullStar.getAttribute("class")).toContain("text-amber-400");
        expect(fullStar.getAttribute("class")).toContain("fill-amber-400");
      }

      // Star 4 should be half gold
      const halfStar4 = screen.getByTestId("star-4-half");
      expect(halfStar4).toBeInTheDocument();

      // Star 5 should be empty
      expect(screen.queryByTestId("star-5-full")).not.toBeInTheDocument();
      expect(screen.queryByTestId("star-5-half")).not.toBeInTheDocument();
    });

    it("resets preview to confirmed rating when cursor leaves star rating container", () => {
      render(<VenueReviewForm initialRating={2} />);

      const slider = screen.getByRole("slider", { name: /venue rating/i });
      const star5Right = screen.getByTestId("star-5-right");

      // Hover over 5 stars
      fireEvent.mouseEnter(star5Right);
      expect(screen.getByTestId("rating-preview-text")).toHaveTextContent(
        "5.0 / 5.0",
      );
      expect(screen.getByTestId("star-5-full")).toBeInTheDocument();

      // Mouse leave rating container
      fireEvent.mouseLeave(slider);

      // Reverts back to initialRating 2.0
      expect(screen.getByTestId("rating-preview-text")).toHaveTextContent(
        "2.0 / 5.0",
      );
      expect(screen.getByTestId("star-2-full")).toBeInTheDocument();
      expect(screen.queryByTestId("star-3-full")).not.toBeInTheDocument();
    });
  });

  describe("Half-Star Increments (0.5 to 5.0) via Split Hit Regions", () => {
    it("selects half star when clicking left half hit region", () => {
      const onRatingChange = jest.fn();
      render(<VenueReviewForm onRatingChange={onRatingChange} />);

      const star5Left = screen.getByTestId("star-5-left");
      fireEvent.click(star5Left);

      expect(onRatingChange).toHaveBeenCalledWith(4.5);
      expect(screen.getByTestId("rating-preview-text")).toHaveTextContent(
        "4.5 / 5.0",
      );
      expect(screen.getByTestId("star-5-half")).toBeInTheDocument();
      expect(screen.queryByTestId("star-5-full")).not.toBeInTheDocument();
    });

    it("selects full star when clicking right half hit region", () => {
      const onRatingChange = jest.fn();
      render(<VenueReviewForm onRatingChange={onRatingChange} />);

      const star4Right = screen.getByTestId("star-4-right");
      fireEvent.click(star4Right);

      expect(onRatingChange).toHaveBeenCalledWith(4.0);
      expect(screen.getByTestId("rating-preview-text")).toHaveTextContent(
        "4.0 / 5.0",
      );
      expect(screen.getByTestId("star-4-full")).toBeInTheDocument();
      expect(screen.queryByTestId("star-5-full")).not.toBeInTheDocument();
    });

    it("supports cursor position via mouseMove and click on star container", () => {
      const onRatingChange = jest.fn();
      render(<VenueReviewForm onRatingChange={onRatingChange} />);

      const star3Slot = screen.getByTestId("star-slot-3");

      // Mock getBoundingClientRect
      jest.spyOn(star3Slot, "getBoundingClientRect").mockReturnValue({
        left: 0,
        top: 0,
        width: 30,
        height: 30,
        right: 30,
        bottom: 30,
        x: 0,
        y: 0,
        toJSON: () => {},
      });

      // MouseMove on left half (x = 10 < 15)
      fireEvent.mouseMove(star3Slot, { clientX: 10 });
      expect(screen.getByTestId("rating-preview-text")).toHaveTextContent(
        "2.5 / 5.0",
      );

      // Click on left half (x = 10)
      fireEvent.click(star3Slot, { clientX: 10 });
      expect(onRatingChange).toHaveBeenCalledWith(2.5);

      // MouseMove on right half (x = 25 >= 15)
      fireEvent.mouseMove(star3Slot, { clientX: 25 });
      expect(screen.getByTestId("rating-preview-text")).toHaveTextContent(
        "3.0 / 5.0",
      );

      // Click on right half (x = 25)
      fireEvent.click(star3Slot, { clientX: 25 });
      expect(onRatingChange).toHaveBeenCalledWith(3.0);
    });
  });

  describe("Keyboard Arrow Key Accessibility", () => {
    it("increments rating with ArrowRight and ArrowUp by 0.5", () => {
      const onRatingChange = jest.fn();
      render(
        <VenueReviewForm initialRating={3.0} onRatingChange={onRatingChange} />,
      );

      const slider = screen.getByRole("slider", { name: /venue rating/i });
      expect(slider).toHaveAttribute("aria-valuenow", "3");

      fireEvent.keyDown(slider, { key: "ArrowRight" });
      expect(onRatingChange).toHaveBeenCalledWith(3.5);

      fireEvent.keyDown(slider, { key: "ArrowUp" });
      expect(onRatingChange).toHaveBeenCalledWith(4.0);
    });

    it("decrements rating with ArrowLeft and ArrowDown by 0.5", () => {
      const onRatingChange = jest.fn();
      render(
        <VenueReviewForm initialRating={3.0} onRatingChange={onRatingChange} />,
      );

      const slider = screen.getByRole("slider", { name: /venue rating/i });

      fireEvent.keyDown(slider, { key: "ArrowLeft" });
      expect(onRatingChange).toHaveBeenCalledWith(2.5);

      fireEvent.keyDown(slider, { key: "ArrowDown" });
      expect(onRatingChange).toHaveBeenCalledWith(2.0);
    });

    it("clamps keyboard values between 0.5 and 5.0", () => {
      const onRatingChange = jest.fn();
      render(
        <VenueReviewForm initialRating={4.5} onRatingChange={onRatingChange} />,
      );

      const slider = screen.getByRole("slider", { name: /venue rating/i });

      // Increment to 5.0
      fireEvent.keyDown(slider, { key: "ArrowRight" });
      expect(onRatingChange).toHaveBeenCalledWith(5.0);

      // Increment beyond 5.0 clamps to 5.0
      fireEvent.keyDown(slider, { key: "ArrowRight" });
      expect(onRatingChange).toHaveBeenLastCalledWith(5.0);

      // Jump to 0.5 via Home key
      fireEvent.keyDown(slider, { key: "Home" });
      expect(onRatingChange).toHaveBeenCalledWith(0.5);

      // Decrement below 0.5 clamps to 0.5
      fireEvent.keyDown(slider, { key: "ArrowLeft" });
      expect(onRatingChange).toHaveBeenLastCalledWith(0.5);

      // Jump to 5.0 via End key
      fireEvent.keyDown(slider, { key: "End" });
      expect(onRatingChange).toHaveBeenCalledWith(5.0);
    });
  });

  describe("Review Submission", () => {
    it("submits review with selected rating and trimmed text", () => {
      const onSubmit = jest.fn();
      render(
        <VenueReviewForm
          initialRating={4.5}
          onSubmit={onSubmit}
          venueId="venue-99"
        />,
      );

      const textarea = screen.getByPlaceholderText(/share your experience/i);
      fireEvent.change(textarea, {
        target: { value: "Great coffee and fast WiFi!  " },
      });

      const submitButton = screen.getByRole("button", {
        name: /submit review/i,
      });
      fireEvent.click(submitButton);

      expect(onSubmit).toHaveBeenCalledTimes(1);
      expect(onSubmit).toHaveBeenCalledWith("Great coffee and fast WiFi!", 4.5);
    });

    it("keeps submit button disabled when text is empty", () => {
      render(<VenueReviewForm initialRating={5} />);
      const submitButton = screen.getByRole("button", {
        name: /submit review/i,
      });
      expect(submitButton).toBeDisabled();
    });
  });
});
