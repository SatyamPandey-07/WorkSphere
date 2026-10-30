import "@testing-library/jest-dom";
import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import VenueRatingDialogDefault, {
  VenueRatingDialog,
} from "@/components/VenueRatingDialog";

// Mock NoiseMeter to avoid WebAudio dependency in test environment
jest.mock("@/components/noise/NoiseMeter", () => ({
  NoiseMeter: function MockNoiseMeter() {
    return <div data-testid="mock-noise-meter" />;
  },
}));

describe("VenueRatingDialog Component Suite", () => {
  const mockOnClose = jest.fn();
  const mockOnSubmit = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("exports default component matching named export", () => {
    expect(VenueRatingDialogDefault).toBe(VenueRatingDialog);
  });

  it("renders nothing when isOpen is false", () => {
    render(
      <VenueRatingDialog
        venueName="Central Perk"
        venueId="venue-cp"
        isOpen={false}
        onClose={mockOnClose}
        onSubmit={mockOnSubmit}
      />
    );

    expect(screen.queryByTestId("venue-rating-dialog")).not.toBeInTheDocument();
  });

  it("renders dialog with title and description when isOpen is true", () => {
    render(
      <VenueRatingDialog
        venueName="Central Perk"
        venueId="venue-cp"
        isOpen={true}
        onClose={mockOnClose}
        onSubmit={mockOnSubmit}
      />
    );

    expect(screen.getByTestId("venue-rating-dialog")).toBeInTheDocument();
    expect(screen.getByText("Rate Central Perk")).toBeInTheDocument();
    expect(
      screen.getByText("Add subjective feedback and optional measured noise data.")
    ).toBeInTheDocument();
  });

  it("calls onClose when close button is clicked", () => {
    render(
      <VenueRatingDialog
        venueName="Central Perk"
        venueId="venue-cp"
        isOpen={true}
        onClose={mockOnClose}
        onSubmit={mockOnSubmit}
      />
    );

    const closeBtn = screen.getByTestId("venue-rating-close-btn");
    fireEvent.click(closeBtn);
    expect(mockOnClose).toHaveBeenCalledTimes(1);
  });

  it("calls onClose when cancel button is clicked", () => {
    render(
      <VenueRatingDialog
        venueName="Central Perk"
        venueId="venue-cp"
        isOpen={true}
        onClose={mockOnClose}
        onSubmit={mockOnSubmit}
      />
    );

    const cancelBtn = screen.getByTestId("venue-rating-cancel-btn");
    fireEvent.click(cancelBtn);
    expect(mockOnClose).toHaveBeenCalledTimes(1);
  });

  it("calls onClose when backdrop is clicked, but not when dialog body is clicked", () => {
    render(
      <VenueRatingDialog
        venueName="Central Perk"
        venueId="venue-cp"
        isOpen={true}
        onClose={mockOnClose}
        onSubmit={mockOnSubmit}
      />
    );

    // Clicking inside the dialog should stop propagation
    const dialogBody = screen.getByRole("dialog");
    fireEvent.click(dialogBody);
    expect(mockOnClose).not.toHaveBeenCalled();

    // Clicking the outer backdrop should close
    const backdrop = screen.getByTestId("venue-rating-dialog");
    fireEvent.click(backdrop);
    expect(mockOnClose).toHaveBeenCalledTimes(1);
  });

  it("calls onClose when Escape key is pressed", () => {
    render(
      <VenueRatingDialog
        venueName="Central Perk"
        venueId="venue-cp"
        isOpen={true}
        onClose={mockOnClose}
        onSubmit={mockOnSubmit}
      />
    );

    fireEvent.keyDown(window, { key: "Escape" });
    expect(mockOnClose).toHaveBeenCalledTimes(1);
  });

  it("disables submit button until power outlets availability is indicated", () => {
    render(
      <VenueRatingDialog
        venueName="Central Perk"
        venueId="venue-cp"
        isOpen={true}
        onClose={mockOnClose}
        onSubmit={mockOnSubmit}
      />
    );

    const submitBtn = screen.getByTestId("venue-rating-submit-btn");
    expect(submitBtn).toBeDisabled();

    // Select Yes for outlets
    const yesOutletsBtn = screen.getByRole("button", { name: /^yes$/i });
    fireEvent.click(yesOutletsBtn);
    expect(submitBtn).not.toBeDisabled();

    // Select No for outlets
    const noOutletsBtn = screen.getByRole("button", { name: /^no$/i });
    fireEvent.click(noOutletsBtn);
    expect(submitBtn).not.toBeDisabled();
  });

  it("allows selecting noise levels and pet-friendly checkboxes", () => {
    render(
      <VenueRatingDialog
        venueName="Central Perk"
        venueId="venue-cp"
        isOpen={true}
        onClose={mockOnClose}
        onSubmit={mockOnSubmit}
      />
    );

    const quietBtn = screen.getByRole("button", { name: /quiet/i });
    fireEvent.click(quietBtn);

    const dogCheckbox = screen.getByLabelText(/dog-friendly/i) as HTMLInputElement;
    fireEvent.click(dogCheckbox);
    expect(dogCheckbox.checked).toBe(true);

    const catCheckbox = screen.getByLabelText(/cats allowed/i) as HTMLInputElement;
    fireEvent.click(catCheckbox);
    expect(catCheckbox.checked).toBe(true);
  });

  it("submits review data and triggers onClose on form submission", async () => {
    mockOnSubmit.mockResolvedValueOnce(undefined);

    render(
      <VenueRatingDialog
        venueName="Central Perk"
        venueId="venue-cp"
        isOpen={true}
        onClose={mockOnClose}
        onSubmit={mockOnSubmit}
      />
    );

    // Select outlets Yes
    fireEvent.click(screen.getByRole("button", { name: /^yes$/i }));

    // Add comment
    const commentInput = screen.getByPlaceholderText("Share your experience...");
    fireEvent.change(commentInput, { target: { value: "Great workspace with fast wifi!" } });

    // Submit
    const submitBtn = screen.getByTestId("venue-rating-submit-btn");
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(mockOnSubmit).toHaveBeenCalledTimes(1);
    });

    expect(mockOnSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        wifiQuality: 3,
        hasOutlets: true,
        noiseLevel: "moderate",
        comment: "Great workspace with fast wifi!",
      })
    );

    expect(mockOnClose).toHaveBeenCalledTimes(1);
  });

  it("applies custom className and data-testid overrides", () => {
    render(
      <VenueRatingDialog
        venueName="Central Perk"
        venueId="venue-cp"
        isOpen={true}
        onClose={mockOnClose}
        onSubmit={mockOnSubmit}
        className="custom-dialog-class"
        data-testid="custom-rating-dialog"
      />
    );

    const dialogBackdrop = screen.getByTestId("custom-rating-dialog");
    expect(dialogBackdrop).toBeInTheDocument();

    const dialog = screen.getByRole("dialog");
    expect(dialog.className).toContain("custom-dialog-class");
  });
});
