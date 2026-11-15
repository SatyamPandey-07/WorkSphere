import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import {
  VenueReviewsSection,
  VenueReviewsSectionProps,
} from "@/components/chat/venue-dialog/VenueReviewsSection";
import type { Venue } from "@/components/chat/ChatMessages";
import type { QueuedVenueReview } from "@/lib/offlineReviewSync";

// Mock dependencies
jest.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const translations: Record<string, string> = {
        "venue.noReviewsYet": "No reviews yet",
        "venue.beTheFirst": "Be the first nomad to review this spot!",
        "venue.wifi": "WiFi",
        "venue.power": "Power",
        "venue.yes": "Yes",
        "venue.no": "No",
        "venue.noise": "Noise",
        "venue.translate": "Translate",
        "venue.translating": "Translating...",
        "venue.viewSpeedtest": "View Speedtest",
      };
      return translations[key] || key;
    },
  }),
}));

jest.mock("@/components/analytics/ExportRatingsCSVButton", () => ({
  ExportRatingsCSVButton: ({
    ratings,
    venueName,
    variant,
  }: {
    ratings: any[];
    venueName: string;
    variant?: string;
  }) => (
    <button
      type="button"
      data-testid="mock-export-csv-btn"
      data-count={ratings?.length}
      data-venue={venueName}
      data-variant={variant}
    >
      Export CSV ({ratings?.length})
    </button>
  ),
}));

describe("VenueReviewsSection Component", () => {
  const mockVenue: Venue = {
    id: "venue-101",
    name: "Nomad Hub Berlin",
    address: "Friedrichstraße 123",
    lat: 52.52,
    lng: 13.405,
    city: "Berlin",
    country: "Germany",
    noiseLevel: "quiet",
  } as unknown as Venue;

  const mockReviews = [
    {
      id: "rev-1",
      user: { firstName: "Alice", lastName: "Smith" },
      wifiQuality: 5,
      hasOutlets: true,
      noiseLevel: "quiet",
      outletLocations: ["under_desk", "near_window_corner"],
      wifiSpeed: 250,
      comment: "Super fast fiber optics and great ergonomic chairs!",
      speedtestPhoto: "https://example.com/speedtest1.jpg",
    },
    {
      id: "rev-2",
      user: { firstName: "Bob", lastName: "Jones" },
      wifiQuality: 4,
      hasOutlets: false,
      noiseLevel: "moderate",
      outletLocations: [],
      wifiSpeed: 100,
      comment: "Good vibe but power outlets are scarce.",
    },
  ];

  it("renders empty state when reviews array is empty", () => {
    render(
      <VenueReviewsSection
        venue={mockVenue}
        reviews={[]}
        reviewsLoading={false}
      />,
    );

    expect(screen.getByTestId("reviews-empty-state")).toBeInTheDocument();
    expect(screen.getByText("No reviews yet")).toBeInTheDocument();
    expect(
      screen.getByText("Be the first nomad to review this spot!"),
    ).toBeInTheDocument();
  });

  it("handles null and undefined reviews gracefully without throwing", () => {
    const { rerender } = render(
      <VenueReviewsSection
        venue={mockVenue}
        reviews={undefined}
        reviewsLoading={false}
      />,
    );

    expect(screen.getByTestId("reviews-empty-state")).toBeInTheDocument();

    rerender(
      <VenueReviewsSection
        venue={mockVenue}
        reviews={null as any}
        reviewsLoading={false}
      />,
    );

    expect(screen.getByTestId("reviews-empty-state")).toBeInTheDocument();
  });

  it("renders loading skeleton when reviewsLoading is true", () => {
    render(
      <VenueReviewsSection
        venue={mockVenue}
        reviews={[]}
        reviewsLoading={true}
      />,
    );

    const skeleton = screen.getByTestId("reviews-loading-skeleton");
    expect(skeleton).toBeInTheDocument();
    expect(skeleton).toHaveAttribute("role", "status");
    expect(skeleton).toHaveAttribute("aria-label", "Loading reviews");
    expect(screen.queryByTestId("reviews-empty-state")).not.toBeInTheDocument();
  });

  it("renders conflict resolution banner and handles actions", () => {
    const onResolveConflict = jest.fn();
    const mockConflict: QueuedVenueReview = {
      venueId: "venue-101",
      rating: 5,
      wifiQuality: 4,
      comment: "Offline review draft",
      clientTimestamp: 1698000000000,
      retryCount: 0,
    } as QueuedVenueReview;

    const { rerender } = render(
      <VenueReviewsSection
        venue={mockVenue}
        reviews={[]}
        conflictReview={mockConflict}
        resolvingConflict={false}
        onResolveConflict={onResolveConflict}
      />,
    );

    const banner = screen.getByTestId("review-conflict-banner");
    expect(banner).toBeInTheDocument();
    expect(banner).toHaveAttribute("role", "alert");
    expect(screen.getByText("Review Conflict Detected")).toBeInTheDocument();

    const keepLocalBtn = screen.getByTestId("review-conflict-keep-local-btn");
    const useRemoteBtn = screen.getByTestId("review-conflict-use-remote-btn");

    fireEvent.click(keepLocalBtn);
    expect(onResolveConflict).toHaveBeenCalledWith("KEEP_LOCAL");

    fireEvent.click(useRemoteBtn);
    expect(onResolveConflict).toHaveBeenCalledWith("USE_REMOTE");

    // Test resolving state disabling buttons
    rerender(
      <VenueReviewsSection
        venue={mockVenue}
        reviews={[]}
        conflictReview={mockConflict}
        resolvingConflict={true}
        onResolveConflict={onResolveConflict}
      />,
    );

    expect(screen.getByText("Resolving...")).toBeInTheDocument();
    expect(screen.getByTestId("review-conflict-keep-local-btn")).toBeDisabled();
    expect(screen.getByTestId("review-conflict-use-remote-btn")).toBeDisabled();
  });

  it("renders reviews count header and passes props to CSV export button", () => {
    render(
      <VenueReviewsSection
        venue={mockVenue}
        reviews={mockReviews}
        reviewsLoading={false}
      />,
    );

    const header = screen.getByTestId("reviews-count-header");
    expect(header).toBeInTheDocument();
    expect(screen.getByText("2 Reviews")).toBeInTheDocument();

    const csvBtn = screen.getByTestId("mock-export-csv-btn");
    expect(csvBtn).toHaveAttribute("data-count", "2");
    expect(csvBtn).toHaveAttribute("data-venue", "Nomad Hub Berlin");
  });

  it("handles singular review count and missing venue name gracefully", () => {
    render(
      <VenueReviewsSection
        venue={undefined}
        reviews={[mockReviews[0]]}
        reviewsLoading={false}
      />,
    );

    expect(screen.getByText("1 Review")).toBeInTheDocument();
    const csvBtn = screen.getByTestId("mock-export-csv-btn");
    expect(csvBtn).toHaveAttribute("data-venue", "Venue");
  });

  it("renders review cards with author, metrics, and formatted outlet locations", () => {
    render(
      <VenueReviewsSection
        venue={mockVenue}
        reviews={mockReviews}
        reviewsLoading={false}
      />,
    );

    expect(screen.getByText("Alice Smith")).toBeInTheDocument();
    expect(screen.getByText("Bob Jones")).toBeInTheDocument();

    // WiFi speed badge
    expect(screen.getByTestId("wifi-speed-badge-rev-1")).toHaveTextContent(
      "250 MBPS",
    );
    expect(screen.getByTestId("wifi-speed-badge-rev-2")).toHaveTextContent(
      "100 MBPS",
    );

    // Outlet locations formatted with underscores replaced
    expect(
      screen.getByText(/under desk, near window corner/i),
    ).toBeInTheDocument();
  });

  it("renders anonymous fallback when review user is missing", () => {
    const anonymousReview = [
      {
        id: "rev-anon",
        wifiQuality: 3,
        hasOutlets: false,
        noiseLevel: "loud",
        comment: "Great coffee, but very noisy during lunch rush.",
      },
    ];

    render(
      <VenueReviewsSection
        venue={mockVenue}
        reviews={anonymousReview}
        reviewsLoading={false}
      />,
    );

    expect(screen.getByText("Anonymous")).toBeInTheDocument();
    expect(screen.getByText(/WiFi/i)).toBeInTheDocument();
    expect(screen.getByText(/Power/i)).toBeInTheDocument();
    expect(screen.getByText(/Noise/i)).toBeInTheDocument();
  });

  it("handles review translation interaction and displays translated text", () => {
    const onTranslateReview = jest.fn();

    const { rerender } = render(
      <VenueReviewsSection
        venue={mockVenue}
        reviews={mockReviews}
        onTranslateReview={onTranslateReview}
        translatedReviews={{}}
        translatingReviewId={null}
      />,
    );

    const translateBtn = screen.getByTestId("translate-btn-rev-1");
    expect(translateBtn).toHaveTextContent("Translate");

    fireEvent.click(translateBtn);
    expect(onTranslateReview).toHaveBeenCalledWith(mockReviews[0]);

    // Rerender with translation in progress
    rerender(
      <VenueReviewsSection
        venue={mockVenue}
        reviews={mockReviews}
        onTranslateReview={onTranslateReview}
        translatedReviews={{}}
        translatingReviewId="rev-1"
      />,
    );

    const translatingBtn = screen.getByTestId("translate-btn-rev-1");
    expect(translatingBtn).toHaveTextContent("Translating...");
    expect(translatingBtn).toBeDisabled();

    // Rerender with completed translation
    rerender(
      <VenueReviewsSection
        venue={mockVenue}
        reviews={mockReviews}
        onTranslateReview={onTranslateReview}
        translatedReviews={{
          "rev-1": "Super schnelle Glasfaser und tolle ergonomische Stühle!",
        }}
        translatingReviewId={null}
      />,
    );

    expect(
      screen.getByText(
        "Super schnelle Glasfaser und tolle ergonomische Stühle!",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("translate-btn-rev-1")).not.toBeInTheDocument();
  });

  it("handles viewing speedtest photo when present", () => {
    const onViewSpeedtestPhoto = jest.fn();

    render(
      <VenueReviewsSection
        venue={mockVenue}
        reviews={mockReviews}
        onViewSpeedtestPhoto={onViewSpeedtestPhoto}
      />,
    );

    const speedtestBtn = screen.getByTestId("view-speedtest-btn-rev-1");
    expect(speedtestBtn).toBeInTheDocument();

    fireEvent.click(speedtestBtn);
    expect(onViewSpeedtestPhoto).toHaveBeenCalledWith(
      "https://example.com/speedtest1.jpg",
    );

    // Review 2 does not have a speedtest photo
    expect(
      screen.queryByTestId("view-speedtest-btn-rev-2"),
    ).not.toBeInTheDocument();
  });

  it("renders with zero props without crashing", () => {
    render(<VenueReviewsSection />);
    expect(screen.getByTestId("venue-reviews-section")).toBeInTheDocument();
    expect(screen.getByTestId("reviews-empty-state")).toBeInTheDocument();
  });

  it("handles malformed outletLocations and undefined callbacks gracefully", () => {
    const malformedReviews = [
      {
        id: "rev-malformed",
        outletLocations: [123, null, "wall_socket"],
        comment: "Test comment",
        speedtestPhoto: "https://example.com/photo.jpg",
      },
    ];

    render(
      <VenueReviewsSection
        reviews={malformedReviews}
        conflictReview={{
          venueId: "v1",
        } as any}
      />,
    );

    expect(screen.getByText(/Locations: 123, wall socket/i)).toBeInTheDocument();

    // Trigger buttons without callbacks provided - should not throw
    const keepLocalBtn = screen.getByTestId("review-conflict-keep-local-btn");
    const useRemoteBtn = screen.getByTestId("review-conflict-use-remote-btn");
    const translateBtn = screen.getByTestId("translate-btn-rev-malformed");
    const speedtestBtn = screen.getByTestId("view-speedtest-btn-rev-malformed");

    expect(() => {
      fireEvent.click(keepLocalBtn);
      fireEvent.click(useRemoteBtn);
      fireEvent.click(translateBtn);
      fireEvent.click(speedtestBtn);
    }).not.toThrow();
  });
});
