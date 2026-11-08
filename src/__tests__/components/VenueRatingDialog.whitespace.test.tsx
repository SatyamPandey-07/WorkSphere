import "@testing-library/jest-dom";
import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { VenueRatingDialog } from "@/components/VenueRatingDialog";

// Mock NoiseMeter to avoid WebAudio dependency in tests
jest.mock("@/components/noise/NoiseMeter", () => ({
  NoiseMeter: function MockNoiseMeter() {
    return <div data-testid="mock-noise-meter" />;
  },
}));

describe("VenueRatingDialog whitespace comment sanitization", () => {
  const mockOnClose = jest.fn();
  const mockOnSubmit = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("sanitizes whitespace-only comments to undefined on submission", async () => {
    render(
      <VenueRatingDialog
        venueName="Starbucks Coffee"
        venueId="venue-123"
        isOpen={true}
        onClose={mockOnClose}
        onSubmit={mockOnSubmit}
      />,
    );

    // Indicate power outlet availability (required)
    const yesOutletsBtn = screen.getByRole("button", { name: /^yes$/i });
    fireEvent.click(yesOutletsBtn);

    // Fill comment with whitespace only
    const commentInput = screen.getByPlaceholderText("Share your experience...");
    fireEvent.change(commentInput, { target: { value: "     \n\t   " } });

    // Submit form
    const submitBtn = screen.getByRole("button", { name: /submit rating/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(mockOnSubmit).toHaveBeenCalledTimes(1);
    });

    expect(mockOnSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        comment: undefined,
        hasOutlets: true,
        wifiQuality: 3,
        noiseLevel: "moderate",
      }),
    );
  });

  it("trims leading and trailing whitespace from valid comments before submission", async () => {
    render(
      <VenueRatingDialog
        venueName="Central Library Workspace"
        venueId="venue-456"
        isOpen={true}
        onClose={mockOnClose}
        onSubmit={mockOnSubmit}
      />,
    );

    const yesOutletsBtn = screen.getByRole("button", { name: /^yes$/i });
    fireEvent.click(yesOutletsBtn);

    const commentInput = screen.getByPlaceholderText("Share your experience...");
    fireEvent.change(commentInput, {
      target: { value: "   Great quiet place with fast WiFi!   " },
    });

    const submitBtn = screen.getByRole("button", { name: /submit rating/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(mockOnSubmit).toHaveBeenCalledTimes(1);
    });

    expect(mockOnSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        comment: "Great quiet place with fast WiFi!",
      }),
    );
  });

  it("does not allow submission if outlet availability is not selected", async () => {
    window.alert = jest.fn();

    render(
      <VenueRatingDialog
        venueName="Tech Hub Coworking"
        venueId="venue-789"
        isOpen={true}
        onClose={mockOnClose}
        onSubmit={mockOnSubmit}
      />,
    );

    const submitBtn = screen.getByRole("button", { name: /submit rating/i });
    fireEvent.click(submitBtn);

    expect(window.alert).toHaveBeenCalledWith("Please indicate if outlets are available");
    expect(mockOnSubmit).not.toHaveBeenCalled();
  });
});
