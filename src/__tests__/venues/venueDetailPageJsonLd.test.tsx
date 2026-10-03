import React from "react";
import VenuePage from "@/app/venues/[id]/page";
import { prisma } from "@/lib/prisma";

jest.mock("@/lib/prisma", () => ({
  prisma: {
    venue: {
      findUnique: jest.fn(),
    },
  },
}));

// Mock child components that might use browser/three/canvas/clerk APIs
jest.mock("@/components/TopNav", () => ({
  TopNav: () => <div data-testid="top-nav" />,
}));
jest.mock("@/components/site-footer", () => function MockSiteFooter() {
  return <div data-testid="site-footer" />;
});
jest.mock("@/components/venues/RecentlyViewedTracker", () => ({
  RecentlyViewedTracker: function MockRecentlyViewedTracker() {
    return null;
  },
}));
jest.mock("@/components/venues/PremiumZkpGate", () => function MockPremiumZkpGate() {
  return null;
});
jest.mock("@/components/WeatherCloudRenderer", () => ({
  WeatherCloudRenderer: () => null,
}));
jest.mock("@/components/noise/NoiseForecastChart", () => ({
  NoiseForecastChart: () => null,
}));
jest.mock("@/components/venue/SeatingForecastChart", () => ({
  SeatingForecastChart: () => null,
}));
jest.mock("@/components/venue/VenueSummary", () => ({
  VenueSummary: () => null,
}));
jest.mock("@/components/bookings/CollaborativeNotes", () => ({
  CollaborativeNotes: () => null,
}));
jest.mock("@/components/ui/CopyToClipboardButton", () => ({
  CopyToClipboardButton: () => null,
}));

describe("VenuePage JSON-LD script tag injection", () => {
  it("renders script tag with application/ld+json and valid Schema.org LocalBusiness data", async () => {
    const mockVenue = {
      id: "venue-123",
      name: "Workspace Hub",
      category: "coworking_space",
      latitude: 40.7128,
      longitude: -74.006,
      address: "100 Broadway, New York, NY 10005",
      rating: 4.6,
      ratings: [
        { id: "r1", wifiQuality: 5 },
        { id: "r2", wifiQuality: 4 },
      ],
      wifiQuality: 5,
      hasOutlets: true,
      hasErgonomic: true,
      hasQuietZone: false,
      hasPhoneBooths: true,
      imageUrl: "https://example.com/photo.jpg",
    };

    (prisma.venue.findUnique as jest.Mock).mockResolvedValue(mockVenue);

    const jsx = await VenuePage({
      params: Promise.resolve({ id: "venue-123" }),
    });

    expect(prisma.venue.findUnique).toHaveBeenCalledWith({
      where: { id: "venue-123" },
      include: {
        ratings: {
          select: {
            id: true,
            wifiQuality: true,
          },
        },
      },
    });

    // Check script tag in returned JSX children
    const rootChildren = React.Children.toArray(jsx.props.children);
    const scriptChild = rootChildren.find(
      (child: any) =>
        React.isValidElement(child) && child.type === "script" && (child.props as any).type === "application/ld+json"
    ) as React.ReactElement<any> | undefined;

    expect(scriptChild).toBeDefined();
    expect(scriptChild?.props.type).toBe("application/ld+json");

    const htmlContent = scriptChild?.props.dangerouslySetInnerHTML?.__html;
    expect(htmlContent).toBeDefined();

    const parsedJsonLd = JSON.parse(htmlContent!);
    expect(parsedJsonLd).toEqual({
      "@context": "https://schema.org",
      "@type": "LocalBusiness",
      name: "Workspace Hub",
      address: {
        "@type": "PostalAddress",
        streetAddress: "100 Broadway",
        addressLocality: "New York",
        postalCode: "10005",
        addressCountry: "US",
      },
      geo: {
        "@type": "GeoCoordinates",
        latitude: 40.7128,
        longitude: -74.006,
      },
      telephone: "",
      aggregateRating: {
        "@type": "AggregateRating",
        ratingValue: 4.6,
        reviewCount: 2,
      },
      amenityFeature: [
        {
          "@type": "LocationFeatureSpecification",
          name: "WiFi",
          value: true,
        },
        {
          "@type": "LocationFeatureSpecification",
          name: "Power Outlets",
          value: true,
        },
        {
          "@type": "LocationFeatureSpecification",
          name: "Ergonomic Seating",
          value: true,
        },
        {
          "@type": "LocationFeatureSpecification",
          name: "Phone Booths",
          value: true,
        },
      ],
    });
  });
});
