import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import {
  VenueHeaderSection,
  VenueDescriptionAndHostCard,
  VenueActionButtons,
  VenueHeaderSectionProps,
} from "@/components/chat/venue-dialog/VenueHeaderSection";
import type { Venue } from "@/components/chat/ChatMessages";

// Mock dependencies
jest.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => (key === "venue.reviews" ? "Reviews" : key),
  }),
}));

jest.mock("@/lib/viewTransitions", () => ({
  getVenueCoverTransitionName: (id: string) => `venue-cover-${id}`,
}));

jest.mock("@/components/ui/CopyToClipboardButton", () => ({
  CopyToClipboardButton: ({
    textToCopy,
    label,
  }: {
    textToCopy: string;
    label: string;
  }) => (
    <button
      type="button"
      data-testid={`copy-btn-${label.toLowerCase().replace(/\s+/g, "-")}`}
      data-copy={textToCopy}
    >
      {label}
    </button>
  ),
}));

jest.mock("@/components/venue/ReviewSentimentBadge", () => ({
  ReviewSentimentBadge: ({ summary }: { summary?: any }) => (
    <div
      data-testid="review-sentiment-badge"
      data-sentiment={summary ? "loaded" : "none"}
    />
  ),
}));

describe("VenueHeaderSection Component Suite", () => {
  const mockVenue: Venue = {
    id: "venue-101",
    name: "Artisan Roasters & Cowork",
    category: "cafe",
    address: "45 Market Street, San Francisco, CA",
    city: "San Francisco",
    country: "USA",
    latitude: 37.79,
    longitude: -122.4,
    rating: 4.8,
    reviewsCount: 88,
    photos: ["https://example.com/cover.jpg"],
    hasOutlets: true,
    isClaimed: true,
    hostMessage: "Welcome digital nomads! Fiber optic WiFi on floor 2.",
    description: "Quiet cafe workspace with natural sunlight and artisanal espresso.",
  };

  const defaultProps: VenueHeaderSectionProps = {
    venue: mockVenue,
    currentScore: 8.5,
    displayPhoto: "https://example.com/cover.jpg",
    photoLoading: false,
    setImageError: jest.fn(),
    sentiment: { score: 0.9 },
    activeTab: "overview",
    setActiveTab: jest.fn(),
    onClose: jest.fn(),
    onOpenLightbox: jest.fn(),
    voteMetrics: {},
    isLibrary: false,
    quickSaveLoading: false,
    onQuickSave: jest.fn(),
    selectedVenueLang: "EN",
    onSelectVenueLang: jest.fn(),
    isTranslatingDesc: false,
    descTranslationError: null,
    translatedDescription: "",
    onGetDirections: jest.fn(),
    onToggleFavorite: jest.fn(),
    isFavorited: false,
    enableTransition: false,
    onRate: jest.fn(),
    showFlagMenu: false,
    setShowFlagMenu: jest.fn(),
    flagSubmitting: false,
    flagSubmitted: false,
    onSubmitFlag: jest.fn(),
    copied: false,
    onShare: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("VenueHeaderSection Header, Banners & Tabs", () => {
    it("renders gracefully with undefined or null voteMetrics without crashing", () => {
      render(
        <VenueHeaderSection
          {...defaultProps}
          voteMetrics={undefined}
        />,
      );

      expect(
        screen.getByText("Artisan Roasters & Cowork"),
      ).toBeInTheDocument();
      expect(screen.queryByTestId("wifi-warning-banner")).not.toBeInTheDocument();
    });

    it("renders community warning banners when metrics are flagged as hidden/low-confidence", () => {
      const voteMetrics = {
        wifi: { upvotes: 1, downvotes: 10, userVote: null, hidden: true },
        outlets: { upvotes: 0, downvotes: 8, userVote: null, hidden: true },
        silentRoom: { upvotes: 0, downvotes: 5, userVote: null, hidden: true },
        studyTable: { upvotes: 0, downvotes: 5, userVote: null, hidden: true },
        scanner: { upvotes: 0, downvotes: 5, userVote: null, hidden: true },
      };

      render(
        <VenueHeaderSection
          {...defaultProps}
          isLibrary={true}
          voteMetrics={voteMetrics}
        />,
      );

      expect(screen.getByTestId("wifi-warning-banner")).toBeInTheDocument();
      expect(screen.getByTestId("outlets-warning-banner")).toBeInTheDocument();
      expect(screen.getByTestId("silent-room-warning-banner")).toBeInTheDocument();
      expect(screen.getByTestId("study-table-warning-banner")).toBeInTheDocument();
      expect(screen.getByTestId("scanner-warning-banner")).toBeInTheDocument();
    });

    it("renders loading skeleton when photoLoading is true", () => {
      render(
        <VenueHeaderSection
          {...defaultProps}
          photoLoading={true}
        />,
      );

      expect(screen.getByTestId("photo-loading-skeleton")).toBeInTheDocument();
      expect(screen.queryByTestId("cover-photo-img")).not.toBeInTheDocument();
    });

    it("renders cover photo and handles lightbox click and image error", () => {
      const onOpenLightbox = jest.fn();
      const setImageError = jest.fn();

      render(
        <VenueHeaderSection
          {...defaultProps}
          onOpenLightbox={onOpenLightbox}
          setImageError={setImageError}
        />,
      );

      const img = screen.getByTestId("cover-photo-img");
      expect(img).toHaveAttribute("src", "https://example.com/cover.jpg");

      fireEvent.click(img);
      expect(onOpenLightbox).toHaveBeenCalledWith(0);

      fireEvent.error(img);
      expect(setImageError).toHaveBeenCalledWith(true);
    });

    it("triggers onQuickSave and onClose handlers", () => {
      const onQuickSave = jest.fn();
      const onClose = jest.fn();

      render(
        <VenueHeaderSection
          {...defaultProps}
          onQuickSave={onQuickSave}
          onClose={onClose}
        />,
      );

      fireEvent.click(screen.getByTestId("quick-save-btn"));
      expect(onQuickSave).toHaveBeenCalledTimes(1);

      fireEvent.click(screen.getByTestId("close-venue-btn"));
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("renders category, vibe score, verified badge, and address", () => {
      render(<VenueHeaderSection {...defaultProps} currentScore={9.2} />);

      expect(screen.getByText("cafe")).toBeInTheDocument();
      expect(screen.getByText("VIBE SCORE: 92%")).toBeInTheDocument();
      expect(screen.getByTestId("verified-host-badge")).toBeInTheDocument();
      expect(screen.getByText(/45 Market Street/)).toBeInTheDocument();
      expect(screen.getByTestId("copy-btn-copy")).toBeInTheDocument();
    });

    it("renders navigation tabs and switches tabs on click", () => {
      const setActiveTab = jest.fn();

      render(
        <VenueHeaderSection
          {...defaultProps}
          activeTab="overview"
          setActiveTab={setActiveTab}
        />,
      );

      const overviewTab = screen.getByTestId("tab-overview");
      const reviewsTab = screen.getByTestId("tab-reviews");
      const menuTab = screen.getByTestId("tab-menu");

      expect(overviewTab).toHaveAttribute("aria-selected", "true");
      expect(reviewsTab).toHaveAttribute("aria-selected", "false");

      fireEvent.click(reviewsTab);
      expect(setActiveTab).toHaveBeenCalledWith("reviews");

      fireEvent.click(menuTab);
      expect(setActiveTab).toHaveBeenCalledWith("menu");
    });
  });

  describe("VenueDescriptionAndHostCard Component", () => {
    it("renders description translator, changes language, and shows error banner if present", () => {
      const onSelectVenueLang = jest.fn();

      render(
        <VenueDescriptionAndHostCard
          venue={mockVenue}
          selectedVenueLang="EN"
          onSelectVenueLang={onSelectVenueLang}
          descTranslationError="Language translation unavailable"
        />,
      );

      expect(screen.getByTestId("venue-description-card")).toBeInTheDocument();
      expect(
        screen.getByText("Language translation unavailable"),
      ).toBeInTheDocument();

      const langSelect = screen.getByTestId("venue-lang-select");
      fireEvent.change(langSelect, { target: { value: "ES" } });
      expect(onSelectVenueLang).toHaveBeenCalledWith("ES");

      expect(
        screen.getByText(/Quiet cafe workspace with natural sunlight/),
      ).toBeInTheDocument();
    });

    it("renders verified host card when claimed with hostMessage", () => {
      render(
        <VenueDescriptionAndHostCard
          venue={mockVenue}
          selectedVenueLang="EN"
        />,
      );

      expect(screen.getByTestId("venue-host-card")).toBeInTheDocument();
      expect(
        screen.getByText(/Welcome digital nomads! Fiber optic WiFi/),
      ).toBeInTheDocument();
    });

    it("renders unclaimed listing prompt when venue is not claimed", () => {
      const unclaimedVenue: Venue = {
        ...mockVenue,
        isClaimed: false,
      };

      render(
        <VenueDescriptionAndHostCard
          venue={unclaimedVenue}
          selectedVenueLang="EN"
        />,
      );

      expect(
        screen.getByTestId("unclaimed-listing-notice"),
      ).toBeInTheDocument();
      expect(
        screen.getByText("Are you the owner or manager?"),
      ).toBeInTheDocument();
    });
  });

  describe("VenueActionButtons Component", () => {
    it("triggers onGetDirections, onToggleFavorite, and onRate callbacks", () => {
      const onGetDirections = jest.fn();
      const onToggleFavorite = jest.fn();
      const onRate = jest.fn();

      render(
        <VenueActionButtons
          venue={mockVenue}
          onGetDirections={onGetDirections}
          onToggleFavorite={onToggleFavorite}
          onRate={onRate}
          isFavorited={false}
          onShare={jest.fn()}
        />,
      );

      fireEvent.click(screen.getByTestId("navigate-btn"));
      expect(onGetDirections).toHaveBeenCalledWith(mockVenue);

      fireEvent.click(screen.getByTestId("favorite-btn"));
      expect(onToggleFavorite).toHaveBeenCalledWith(mockVenue);

      fireEvent.click(screen.getByTestId("rate-btn"));
      expect(onRate).toHaveBeenCalledWith(mockVenue);
    });

    it("displays 'Saved' status when isFavorited is true", () => {
      render(
        <VenueActionButtons
          venue={mockVenue}
          onGetDirections={jest.fn()}
          onToggleFavorite={jest.fn()}
          isFavorited={true}
          onShare={jest.fn()}
        />,
      );

      const favBtn = screen.getByTestId("favorite-btn");
      expect(favBtn).toHaveTextContent("Saved");
    });

    it("toggles flag menu dropdown, submits flag reason, and dismisses on Escape", () => {
      const setShowFlagMenu = jest.fn();
      const onSubmitFlag = jest.fn();

      const { rerender } = render(
        <VenueActionButtons
          venue={mockVenue}
          onGetDirections={jest.fn()}
          onToggleFavorite={jest.fn()}
          showFlagMenu={false}
          setShowFlagMenu={setShowFlagMenu}
          onSubmitFlag={onSubmitFlag}
          onShare={jest.fn()}
        />,
      );

      expect(screen.queryByTestId("flag-menu-dropdown")).not.toBeInTheDocument();

      fireEvent.click(screen.getByTestId("flag-menu-btn"));
      expect(setShowFlagMenu).toHaveBeenCalledTimes(1);

      // Re-render with showFlagMenu=true
      rerender(
        <VenueActionButtons
          venue={mockVenue}
          onGetDirections={jest.fn()}
          onToggleFavorite={jest.fn()}
          showFlagMenu={true}
          setShowFlagMenu={setShowFlagMenu}
          onSubmitFlag={onSubmitFlag}
          onShare={jest.fn()}
        />,
      );

      expect(screen.getByTestId("flag-menu-dropdown")).toBeInTheDocument();
      fireEvent.click(screen.getByTestId("flag-reason-btn-permanently_closed"));
      expect(onSubmitFlag).toHaveBeenCalledWith("permanently_closed");

      // Test Escape dismissal
      fireEvent.keyDown(window, { key: "Escape" });
      expect(setShowFlagMenu).toHaveBeenCalledWith(false);
    });

    it("handles share button click and displays 'Copied' state", () => {
      const onShare = jest.fn();

      const { rerender } = render(
        <VenueActionButtons
          venue={mockVenue}
          onGetDirections={jest.fn()}
          onToggleFavorite={jest.fn()}
          onShare={onShare}
          copied={false}
        />,
      );

      fireEvent.click(screen.getByTestId("share-btn"));
      expect(onShare).toHaveBeenCalledTimes(1);

      rerender(
        <VenueActionButtons
          venue={mockVenue}
          onGetDirections={jest.fn()}
          onToggleFavorite={jest.fn()}
          onShare={onShare}
          copied={true}
        />,
      );

      expect(screen.getByText("Copied")).toBeInTheDocument();
    });
  });
});
