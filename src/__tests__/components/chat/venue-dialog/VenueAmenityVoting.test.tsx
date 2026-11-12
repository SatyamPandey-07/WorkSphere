import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { VenueAmenityVoting } from "@/components/chat/venue-dialog/VenueAmenityVoting";
import type { Venue } from "@/components/chat/ChatMessages";
import type {
  VoteMetricState,
  AmenityLeaderboardEntry,
} from "@/components/chat/venue-dialog/useVenueAmenityVotes";

// Mock the breakdown modal to keep tests isolated and fast
jest.mock("@/components/chat/AmenityVoteBreakdownModal", () => ({
  AmenityVoteBreakdownModal: ({ isOpen, onClose }: any) =>
    isOpen ? (
      <div data-testid="mock-breakdown-modal">
        <button onClick={onClose} data-testid="mock-modal-close">
          Close
        </button>
      </div>
    ) : null,
}));

describe("VenueAmenityVoting", () => {
  const mockVenue: Venue = {
    id: "venue-test-1",
    name: "CoWork Tokyo Central",
    hasOutlets: true,
  } as any;

  const mockVoteMetrics: Record<string, VoteMetricState> = {
    freeStreetParking: {
      confidenceScore: 75,
      upvotes: 6,
      downvotes: 2,
      userVote: true,
      hidden: false,
    },
    paidGarage: {
      confidenceScore: 45, // low confidence (<60)
      upvotes: 2,
      downvotes: 4,
      userVote: null,
      hidden: false,
    },
    bicycleRack: {
      confidenceScore: 90,
      upvotes: 9,
      downvotes: 1,
      userVote: false,
      hidden: false,
    },
    secureMotorcycleParking: {
      confidenceScore: 50,
      upvotes: 1,
      downvotes: 1,
      userVote: null,
      hidden: true, // hidden tag
    },
    wifi: {
      confidenceScore: 95,
      upvotes: 20,
      downvotes: 1,
      userVote: null,
      hidden: false,
    },
    outlets: {
      confidenceScore: 80,
      upvotes: 12,
      downvotes: 3,
      userVote: true,
      hidden: false,
    },
    silentRoom: {
      confidenceScore: 85,
      upvotes: 8,
      downvotes: 1,
      userVote: null,
      hidden: false,
    },
    studyTable: {
      confidenceScore: 70,
      upvotes: 5,
      downvotes: 2,
      userVote: null,
      hidden: false,
    },
    scanner: {
      confidenceScore: 65,
      upvotes: 4,
      downvotes: 2,
      userVote: null,
      hidden: false,
    },
  };

  const mockLeaderboard: AmenityLeaderboardEntry[] = [
    {
      userId: "u-1",
      name: "Alice Nomad",
      totalVotes: 14,
      accurateVotes: 12, // >= 10 gets badge
    },
    {
      userId: "u-2",
      name: "Bob Traveler",
      totalVotes: 5,
      accurateVotes: 4,
    },
  ];

  it("renders non-hidden standard amenity tags with confidence scores", () => {
    render(
      <VenueAmenityVoting
        venue={mockVenue}
        voteMetrics={mockVoteMetrics}
        submitAmenityVote={jest.fn()}
        showVoteBreakdown={false}
        setShowVoteBreakdown={jest.fn()}
        showLeaderboard={false}
        setShowLeaderboard={jest.fn()}
        leaderboard={mockLeaderboard}
        isLibrary={false}
      />
    );

    // Free street parking is visible and shows 75%
    expect(screen.getByTestId("amenity-tag-freeStreetParking")).toBeInTheDocument();
    expect(screen.getByText(/Street Parking \(75%\)/i)).toBeInTheDocument();

    // Paid garage has low confidence and amber styling
    const paidGarageTag = screen.getByTestId("amenity-tag-paidGarage");
    expect(paidGarageTag).toHaveClass("text-amber-400");
    expect(screen.getByText(/Paid Garage \(45%\)/i)).toBeInTheDocument();

    // Hidden tag should not be rendered
    expect(
      screen.queryByTestId("amenity-tag-secureMotorcycleParking")
    ).not.toBeInTheDocument();

    // Outlets tag is visible because venue.hasOutlets is true
    expect(screen.getByTestId("amenity-tag-outlets")).toBeInTheDocument();

    // Library tags should NOT be rendered when isLibrary is false
    expect(screen.queryByTestId("amenity-tag-silentRoom")).not.toBeInTheDocument();
    expect(screen.queryByTestId("amenity-tag-studyTable")).not.toBeInTheDocument();
    expect(screen.queryByTestId("amenity-tag-scanner")).not.toBeInTheDocument();
  });

  it("renders library-specific amenities when isLibrary is true", () => {
    render(
      <VenueAmenityVoting
        venue={mockVenue}
        voteMetrics={mockVoteMetrics}
        submitAmenityVote={jest.fn()}
        showVoteBreakdown={false}
        setShowVoteBreakdown={jest.fn()}
        showLeaderboard={false}
        setShowLeaderboard={jest.fn()}
        leaderboard={mockLeaderboard}
        isLibrary={true}
      />
    );

    expect(screen.getByTestId("amenity-tag-silentRoom")).toBeInTheDocument();
    expect(screen.getByTestId("amenity-tag-studyTable")).toBeInTheDocument();
    expect(screen.getByTestId("amenity-tag-scanner")).toBeInTheDocument();
  });

  it("handles voting actions and sets aria-pressed state appropriately", () => {
    const handleSubmitVote = jest.fn();

    render(
      <VenueAmenityVoting
        venue={mockVenue}
        voteMetrics={mockVoteMetrics}
        submitAmenityVote={handleSubmitVote}
        showVoteBreakdown={false}
        setShowVoteBreakdown={jest.fn()}
        showLeaderboard={false}
        setShowLeaderboard={jest.fn()}
        leaderboard={mockLeaderboard}
        isLibrary={false}
      />
    );

    // In mockVoteMetrics, freeStreetParking userVote is true
    const streetParkingUp = screen.getByTestId("vote-up-freeStreetParking");
    expect(streetParkingUp).toHaveAttribute("aria-pressed", "true");
    expect(streetParkingUp).toHaveClass("text-green-400 font-bold");

    // Click upvote on wifi
    const wifiUp = screen.getByTestId("vote-up-wifi");
    fireEvent.click(wifiUp);
    expect(handleSubmitVote).toHaveBeenCalledWith("wifi", true);

    // Click downvote on bicycleRack
    const bikeDown = screen.getByTestId("vote-down-bicycleRack");
    fireEvent.click(bikeDown);
    expect(handleSubmitVote).toHaveBeenCalledWith("bicycleRack", false);
  });

  it("toggles vote breakdown modal on button click", () => {
    const handleSetBreakdown = jest.fn();

    render(
      <VenueAmenityVoting
        venue={mockVenue}
        voteMetrics={mockVoteMetrics}
        submitAmenityVote={jest.fn()}
        showVoteBreakdown={false}
        setShowVoteBreakdown={handleSetBreakdown}
        showLeaderboard={false}
        setShowLeaderboard={jest.fn()}
        leaderboard={mockLeaderboard}
        isLibrary={false}
      />
    );

    fireEvent.click(screen.getByTestId("vote-breakdown-btn"));
    expect(handleSetBreakdown).toHaveBeenCalledWith(true);
  });

  it("toggles leaderboard and displays top voter entries with verified badges", () => {
    const handleSetLeaderboard = jest.fn();

    const { rerender } = render(
      <VenueAmenityVoting
        venue={mockVenue}
        voteMetrics={mockVoteMetrics}
        submitAmenityVote={jest.fn()}
        showVoteBreakdown={false}
        setShowVoteBreakdown={jest.fn()}
        showLeaderboard={false}
        setShowLeaderboard={handleSetLeaderboard}
        leaderboard={mockLeaderboard}
        isLibrary={false}
      />
    );

    const toggleBtn = screen.getByTestId("leaderboard-toggle-btn");
    expect(toggleBtn).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByTestId("leaderboard-drawer")).not.toBeInTheDocument();

    fireEvent.click(toggleBtn);
    expect(handleSetLeaderboard).toHaveBeenCalledWith(true);

    // Rerender with showLeaderboard=true
    rerender(
      <VenueAmenityVoting
        venue={mockVenue}
        voteMetrics={mockVoteMetrics}
        submitAmenityVote={jest.fn()}
        showVoteBreakdown={false}
        setShowVoteBreakdown={jest.fn()}
        showLeaderboard={true}
        setShowLeaderboard={handleSetLeaderboard}
        leaderboard={mockLeaderboard}
        isLibrary={false}
      />
    );

    expect(screen.getByTestId("leaderboard-drawer")).toBeInTheDocument();
    expect(screen.getByText("Alice Nomad")).toBeInTheDocument();
    expect(screen.getByTestId("leaderboard-badge-u-1")).toBeInTheDocument(); // >=10 accurate votes
    expect(screen.getByText("Bob Traveler")).toBeInTheDocument();
    expect(screen.queryByTestId("leaderboard-badge-u-2")).not.toBeInTheDocument();
  });

  it("shows empty state when leaderboard is opened with zero entries", () => {
    render(
      <VenueAmenityVoting
        venue={mockVenue}
        voteMetrics={mockVoteMetrics}
        submitAmenityVote={jest.fn()}
        showVoteBreakdown={false}
        setShowVoteBreakdown={jest.fn()}
        showLeaderboard={true}
        setShowLeaderboard={jest.fn()}
        leaderboard={[]}
        isLibrary={false}
      />
    );

    expect(screen.getByTestId("leaderboard-drawer")).toBeInTheDocument();
    expect(screen.getByTestId("leaderboard-empty")).toHaveTextContent(
      "No community votes recorded yet."
    );
  });

  it("defensively handles undefined voteMetrics and renders custom className/testId", () => {
    render(
      <VenueAmenityVoting
        venue={mockVenue}
        voteMetrics={undefined as any}
        submitAmenityVote={jest.fn()}
        showVoteBreakdown={false}
        setShowVoteBreakdown={jest.fn()}
        showLeaderboard={false}
        setShowLeaderboard={jest.fn()}
        leaderboard={[]}
        isLibrary={false}
        className="custom-amenity-class"
        testId="custom-voting-widget"
      />
    );

    const widget = screen.getByTestId("custom-voting-widget");
    expect(widget).toBeInTheDocument();
    expect(widget).toHaveClass("custom-amenity-class");
  });
});
