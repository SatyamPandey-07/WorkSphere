import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { ReviewVoteButton } from "@/components/ui/ReviewVoteButton";

const mockToast = jest.fn();
jest.mock("@/components/ui/Toast", () => ({
  useToast: () => ({ toast: mockToast }),
}));

describe("ReviewVoteButton (#3933)", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    mockToast.mockClear();
    global.fetch = jest.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("prevents double-click duplicate requests by disabling button during in-flight network dispatch", async () => {
    let resolveFetch: (value: any) => void = () => {};
    const fetchPromise = new Promise((resolve) => {
      resolveFetch = resolve;
    });

    (global.fetch as jest.Mock).mockReturnValue(fetchPromise);

    render(
      <ReviewVoteButton
        reviewId="review-123"
        initialUpvotes={5}
        initialHasUpvoted={false}
      />
    );

    const button = screen.getByTestId("review-vote-button-review-123");
    expect(screen.getByText("5")).toBeInTheDocument();

    // First click dispatches fetch
    fireEvent.click(button);

    // Button should immediately reflect optimistic state and be disabled
    expect(screen.getByText("6")).toBeInTheDocument();
    expect(button).toBeDisabled();
    expect(global.fetch).toHaveBeenCalledTimes(1);

    // Rapid second click while in-flight should be ignored
    fireEvent.click(button);
    expect(global.fetch).toHaveBeenCalledTimes(1);

    // Resolve network request
    resolveFetch({
      ok: true,
      json: async () => ({ success: true, upvotes: 6, hasUpvoted: true }),
    });

    await waitFor(() => {
      expect(button).not.toBeDisabled();
    });
  });

  it("smoothly rolls back optimistic vote count if network request fails", async () => {
    (global.fetch as jest.Mock).mockRejectedValueOnce(
      new Error("Network connection error")
    );

    render(
      <ReviewVoteButton
        reviewId="review-456"
        initialUpvotes={10}
        initialHasUpvoted={false}
      />
    );

    const button = screen.getByTestId("review-vote-button-review-456");
    expect(screen.getByText("10")).toBeInTheDocument();

    fireEvent.click(button);

    // Optimistic increment
    expect(screen.getByText("11")).toBeInTheDocument();

    // Rollback to original state on network failure
    await waitFor(() => {
      expect(screen.getByText("10")).toBeInTheDocument();
      expect(mockToast).toHaveBeenCalledWith("Network connection error", "error");
    });
  });

  it("updates state when initialUpvotes or initialHasUpvoted props change on rerender", () => {
    const { rerender } = render(
      <ReviewVoteButton
        reviewId="review-789"
        initialUpvotes={3}
        initialHasUpvoted={false}
      />
    );

    expect(screen.getByText("3")).toBeInTheDocument();

    rerender(
      <ReviewVoteButton
        reviewId="review-789"
        initialUpvotes={7}
        initialHasUpvoted={true}
      />
    );

    expect(screen.getByText("7")).toBeInTheDocument();
  });

  it("clamps optimistic upvote count to 0 when toggled off from 0", () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true, upvotes: 0, hasUpvoted: false }),
    });

    render(
      <ReviewVoteButton
        reviewId="review-zero"
        initialUpvotes={0}
        initialHasUpvoted={true}
      />
    );

    const button = screen.getByTestId("review-vote-button-review-zero");
    fireEvent.click(button);

    expect(screen.getByText("0")).toBeInTheDocument();
  });
});

