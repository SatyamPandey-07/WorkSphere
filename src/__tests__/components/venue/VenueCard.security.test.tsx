import React from "react";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { VenueGallery } from "@/components/venue/VenueGallery";
import { VenueHeaderSection } from "@/components/chat/venue-dialog/VenueHeaderSection";
import { sanitizeExternalHttpUrl } from "@/lib/utils";
import type { Venue } from "@/components/chat/ChatMessages";

jest.mock("next/image", () => ({
  __esModule: true,
  default: (props: Record<string, unknown>) => {
    const { fill: _fill, priority: _priority, ...imgProps } = props;
    // eslint-disable-next-line @next/next/no-img-element
    return <img {...imgProps} alt={String(props.alt ?? "")} />;
  },
}));

jest.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

jest.mock("@/lib/viewTransitions", () => ({
  getVenueCoverTransitionName: (id: string) => `venue-cover-${id}`,
}));

jest.mock("@/components/ui/CopyToClipboardButton", () => ({
  CopyToClipboardButton: () => <button type="button">Copy</button>,
}));

jest.mock("@/components/venue/ReviewSentimentBadge", () => ({
  ReviewSentimentBadge: () => <div data-testid="review-sentiment-badge" />,
}));

const photos = ["https://example.com/venue-1.jpg"];

const mockVenue: Venue = {
  id: "venue-sec-1",
  name: "Security Test Cafe",
  category: "cafe",
  address: "100 Safe St",
  city: "San Francisco",
  country: "USA",
  latitude: 37.79,
  longitude: -122.4,
  rating: 4.5,
  reviewsCount: 12,
  photos,
  hasOutlets: true,
  isClaimed: false,
};

describe("Photo attribution URL sanitization (#9508)", () => {
  describe("sanitizeExternalHttpUrl", () => {
    it.each([
      "javascript:alert(1)",
      "JAVASCRIPT:alert(1)",
      "  javascript:void(0)  ",
      "java\tscript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "vbscript:msgbox(1)",
      "file:///etc/passwd",
      "//evil.example.com/phish",
      "not-a-valid-url",
      "",
      "   ",
    ])("rejects unsafe or malformed URL: %s", (unsafeUrl) => {
      expect(sanitizeExternalHttpUrl(unsafeUrl)).toBeNull();
    });

    it("allows valid http and https URLs and trims surrounding whitespace", () => {
      expect(sanitizeExternalHttpUrl("https://www.pexels.com/@asha")).toBe(
        "https://www.pexels.com/@asha",
      );
      expect(sanitizeExternalHttpUrl("  http://example.com/photo  ")).toBe(
        "http://example.com/photo",
      );
    });
  });

  describe("VenueGallery", () => {
    it.each([
      "javascript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "vbscript:msgbox(1)",
      "not a valid url",
    ])("renders photographer name as plain text for %s", (maliciousUrl) => {
      render(
        <VenueGallery
          photos={photos}
          attribution={{
            photographer: "Mallory",
            photographerUrl: maliciousUrl,
          }}
        />,
      );

      const name = screen.getByText("Mallory");
      expect(name.tagName).toBe("SPAN");
      expect(screen.queryByRole("link")).not.toBeInTheDocument();
    });

    it("renders safe https photographer link with rel=noopener noreferrer", () => {
      render(
        <VenueGallery
          photos={photos}
          attribution={{
            photographer: "Asha Rao",
            photographerUrl: "https://www.pexels.com/@asha",
          }}
        />,
      );

      const link = screen.getByRole("link", { name: "Asha Rao" });
      expect(link).toHaveAttribute("href", "https://www.pexels.com/@asha");
      expect(link).toHaveAttribute("rel", "noopener noreferrer");
    });
  });

  describe("VenueHeaderSection", () => {
    it("strips javascript: URI from photographerUrl and photoUrl", () => {
      render(
        <VenueHeaderSection
          venue={mockVenue}
          displayPhoto={photos[0]}
          photoLoading={false}
          photoAttribution={{
            photographer: "Mallory",
            photographerUrl: "javascript:alert(1)",
            photoUrl: "javascript:alert(2)",
          }}
          activeTab="overview"
          setActiveTab={jest.fn()}
          onClose={jest.fn()}
          onOpenLightbox={jest.fn()}
          isLibrary={false}
          quickSaveLoading={false}
          onQuickSave={jest.fn()}
        />,
      );

      const photographer = screen.getByText("Mallory");
      expect(photographer.tagName).toBe("SPAN");

      const pexelsLink = screen.getByRole("link", { name: "Pexels" });
      expect(pexelsLink).toHaveAttribute("href", "https://www.pexels.com");
      expect(pexelsLink).toHaveAttribute("rel", "noopener noreferrer");
    });
  });
});
