import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import {
  AmenityVoteBreakdownModal,
  VoteMetric,
} from "@/components/chat/AmenityVoteBreakdownModal";

describe("AmenityVoteBreakdownModal Component", () => {
  const mockMetrics: Record<string, VoteMetric> = {
    wifi: {
      confidenceScore: 92,
      upvotes: 18,
      downvotes: 2,
      hidden: false,
      userVote: true,
    },
    outlets: {
      confidenceScore: 70,
      upvotes: 7,
      downvotes: 3,
      hidden: false,
      userVote: null,
    },
    silentRoom: {
      confidenceScore: 45,
      upvotes: 2,
      downvotes: 8,
      hidden: true,
      userVote: false,
    },
    studyTable: {
      confidenceScore: 0,
      upvotes: 0,
      downvotes: 0,
      hidden: false,
      userVote: null,
    },
  };

  it("renders nothing when isOpen is false", () => {
    const { container } = render(
      <AmenityVoteBreakdownModal
        isOpen={false}
        metrics={mockMetrics}
        onClose={jest.fn()}
      />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders empty state when metrics is null or undefined", () => {
    render(
      <AmenityVoteBreakdownModal
        isOpen={true}
        metrics={null}
        onClose={jest.fn()}
      />
    );

    expect(screen.getByTestId("amenity-vote-empty")).toBeInTheDocument();
    expect(screen.getByText("No votes yet")).toBeInTheDocument();
    expect(
      screen.getByText("Be the first to verify amenities at this venue.")
    ).toBeInTheDocument();
  });

  it("renders empty state when all metrics have 0 votes", () => {
    const zeroMetrics: Record<string, VoteMetric> = {
      wifi: {
        confidenceScore: 0,
        upvotes: 0,
        downvotes: 0,
        hidden: false,
        userVote: null,
      },
    };

    render(
      <AmenityVoteBreakdownModal
        isOpen={true}
        metrics={zeroMetrics}
        onClose={jest.fn()}
      />
    );

    expect(screen.getByTestId("amenity-vote-empty")).toBeInTheDocument();
  });

  it("renders dialog with vote metrics and confidence scores", () => {
    render(
      <AmenityVoteBreakdownModal
        isOpen={true}
        metrics={mockMetrics}
        onClose={jest.fn()}
      />
    );

    const dialog = screen.getByRole("dialog");
    expect(dialog).toBeInTheDocument();
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAttribute("aria-labelledby", "amenity-vote-title");

    expect(screen.getByText("Community Vote Breakdown")).toBeInTheDocument();
    // 20 + 10 + 10 = 40 total votes
    expect(screen.getByTestId("amenity-total-votes")).toHaveTextContent(
      "40 total votes"
    );

    // WiFi
    expect(screen.getByText("WiFi")).toBeInTheDocument();
    expect(screen.getByText("92% confidence")).toHaveClass("text-green-400");
    expect(screen.getByTestId("amenity-metric-wifi")).toBeInTheDocument();

    // Power Outlets
    expect(screen.getByText("Power Outlets")).toBeInTheDocument();
    expect(screen.getByText("70% confidence")).toHaveClass("text-amber-400");

    // Silent Room (low confidence, hidden)
    expect(screen.getByText("Silent Room")).toBeInTheDocument();
    expect(screen.getByText("45% confidence")).toHaveClass("text-red-400");
    expect(screen.getByTestId("amenity-hidden-silentRoom")).toBeInTheDocument();

    // studyTable has 0 votes, so it shouldn't be rendered in entries list
    expect(screen.queryByText("Study Tables")).not.toBeInTheDocument();
  });

  it("formats singular vote count when total votes is 1", () => {
    const singleVoteMetrics: Record<string, VoteMetric> = {
      wifi: {
        confidenceScore: 100,
        upvotes: 1,
        downvotes: 0,
        hidden: false,
        userVote: true,
      },
    };

    render(
      <AmenityVoteBreakdownModal
        isOpen={true}
        metrics={singleVoteMetrics}
        onClose={jest.fn()}
      />
    );

    expect(screen.getByTestId("amenity-total-votes")).toHaveTextContent(
      "1 total vote"
    );
  });

  it("calls onClose when close button is clicked", () => {
    const handleClose = jest.fn();
    render(
      <AmenityVoteBreakdownModal
        isOpen={true}
        metrics={mockMetrics}
        onClose={handleClose}
      />
    );

    const closeBtn = screen.getByTestId("amenity-vote-close-btn");
    expect(closeBtn).toHaveAttribute("aria-label", "Close vote breakdown");

    fireEvent.click(closeBtn);
    expect(handleClose).toHaveBeenCalledTimes(1);
  });

  it("calls onClose when Escape key is pressed", () => {
    const handleClose = jest.fn();
    render(
      <AmenityVoteBreakdownModal
        isOpen={true}
        metrics={mockMetrics}
        onClose={handleClose}
      />
    );

    fireEvent.keyDown(window, { key: "Escape" });
    expect(handleClose).toHaveBeenCalledTimes(1);
  });

  it("calls onClose when backdrop is clicked, but preserves container click isolation", () => {
    const handleClose = jest.fn();
    render(
      <AmenityVoteBreakdownModal
        isOpen={true}
        metrics={mockMetrics}
        onClose={handleClose}
        className="custom-vote-modal"
        testId="custom-vote-dialog"
      />
    );

    const backdrop = screen.getByTestId("custom-vote-dialog");
    expect(backdrop.className).toContain("custom-vote-modal");

    // Click inside modal
    fireEvent.click(screen.getByText("Community Vote Breakdown"));
    expect(handleClose).not.toHaveBeenCalled();

    // Click backdrop overlay
    fireEvent.click(backdrop);
    expect(handleClose).toHaveBeenCalledTimes(1);
  });

  it("safely handles malformed metric objects without crashing", () => {
    const malformedMetrics = {
      custom_amenity: {
        confidenceScore: undefined as unknown as number,
        upvotes: 5,
        downvotes: undefined as unknown as number,
        hidden: false,
        userVote: null,
      },
    };

    render(
      <AmenityVoteBreakdownModal
        isOpen={true}
        metrics={malformedMetrics}
        onClose={jest.fn()}
      />
    );

    expect(screen.getByText("custom amenity")).toBeInTheDocument();
    expect(screen.getByText("0% confidence")).toBeInTheDocument();
    expect(screen.getByTestId("amenity-total-votes")).toHaveTextContent(
      "5 total votes"
    );
  });
});
