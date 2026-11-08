import { render, screen, act } from "@testing-library/react";
import "@testing-library/jest-dom";
import { VenueCard } from "@/components/VenueCard";
import {
  calculateVenueSolarPhase,
  supportsCircadianLighting,
} from "@/lib/geo/circadianLighting";
import { MapMarker } from "@/types/map";

const mockPrefetch = jest.fn();
jest.mock("next/navigation", () => ({
  useRouter: () => ({ prefetch: mockPrefetch }),
}));

jest.mock("@/context/CurrencyContext", () => ({
  useCurrency: () => ({ currency: "USD", setCurrency: jest.fn() }),
}));

describe("Circadian Lighting Calculation Engine", () => {
  it("calculates Bright Daylight Work mode during solar midday", () => {
    // Latitude 37.7749 (San Francisco), midday on summer solstice at longitude 0
    const middayUtc = new Date(Date.UTC(2026, 5, 21, 12, 0, 0));
    const status = calculateVenueSolarPhase(37.7749, middayUtc, 0);

    expect(status.mode).toBe("Bright Daylight Work");
    expect(status.solarPhase).toBe("daylight");
    expect(status.solarElevation).toBeGreaterThan(10);
    expect(status.colorTemperature).toBe(5500);
    expect(status.tooltip).toContain("Bright Daylight Work");
    expect(status.tooltip).toContain("5500K");
  });

  it("calculates Warm Sunset Focus mode at night / low solar elevation", () => {
    // Midnight UTC at latitude 37.7749, longitude 0
    const nightUtc = new Date(Date.UTC(2026, 5, 21, 0, 0, 0));
    const status = calculateVenueSolarPhase(37.7749, nightUtc, 0);

    expect(status.mode).toBe("Warm Sunset Focus");
    expect(status.solarElevation).toBeLessThanOrEqual(10);
    expect(status.colorTemperature).toBe(2700);
    expect(status.tooltip).toContain("Warm Sunset Focus");
    expect(status.tooltip).toContain("2700K");
    expect(status.tooltip).toContain("melatonin");
  });

  it("identifies circadian lighting support from various venue amenity formats", () => {
    expect(supportsCircadianLighting({ lighting: "circadian" })).toBe(true);
    expect(supportsCircadianLighting({ lighting: "Automated Circadian" })).toBe(
      true,
    );
    expect(supportsCircadianLighting({ hasCircadianLighting: true })).toBe(
      true,
    );
    expect(
      supportsCircadianLighting({
        amenities: { circadianLighting: true },
      }),
    ).toBe(true);
    expect(
      supportsCircadianLighting({
        amenities: { lighting: "circadian lighting" },
      }),
    ).toBe(true);
    expect(supportsCircadianLighting({ lighting: "dim" })).toBe(false);
    expect(supportsCircadianLighting(null)).toBe(false);
  });
});

describe("VenueCard Circadian Lighting Badge", () => {
  const baseVenue: MapMarker = {
    id: "venue-circadian-1",
    name: "Focus Lumina Workspace",
    category: "coworking",
    address: "450 Market St, San Francisco, CA",
    position: { lat: 37.7749, lng: -122.4194 },
    rating: 4.8,
  };

  it("does not render circadian badge when venue has no circadian capability", async () => {
    render(<VenueCard venue={baseVenue} />);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(
      screen.queryByTestId("circadian-lighting-badge"),
    ).not.toBeInTheDocument();
  });

  it("renders Bright Daylight Work chip and tooltip when venue has circadian lighting during daytime", async () => {
    const venueWithCircadian: MapMarker = {
      ...baseVenue,
      lighting: "circadian",
    };

    // San Francisco (lng -122.4194): 20:00 UTC = 13:00 local time (Summer Solstice)
    const middayUtc = new Date(Date.UTC(2026, 5, 21, 20, 0, 0));

    render(
      <VenueCard venue={venueWithCircadian} currentTimestamp={middayUtc} />,
    );
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const badge = screen.getByTestId("circadian-lighting-badge");
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveTextContent("Bright Daylight Work");
    expect(badge).toHaveTextContent("(5500K)");

    const tooltip = screen.getByTestId("circadian-tooltip");
    expect(tooltip).toBeInTheDocument();
    expect(tooltip).toHaveTextContent("Bright Daylight Work");
    expect(tooltip).toHaveTextContent("alertness and focus");
  });

  it("renders Warm Sunset Focus chip and tooltip when venue has circadian lighting during evening/night", async () => {
    const venueWithCircadian: MapMarker = {
      ...baseVenue,
      hasCircadianLighting: true,
    };

    // San Francisco (lng -122.4194): 05:00 UTC = 22:00 local time (Summer Solstice night)
    const nightUtc = new Date(Date.UTC(2026, 5, 21, 5, 0, 0));

    render(
      <VenueCard venue={venueWithCircadian} currentTimestamp={nightUtc} />,
    );
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const badge = screen.getByTestId("circadian-lighting-badge");
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveTextContent("Warm Sunset Focus");
    expect(badge).toHaveTextContent("(2700K)");

    const tooltip = screen.getByTestId("circadian-tooltip");
    expect(tooltip).toBeInTheDocument();
    expect(tooltip).toHaveTextContent("Warm Sunset Focus");
    expect(tooltip).toHaveTextContent("melatonin production");
  });
});
