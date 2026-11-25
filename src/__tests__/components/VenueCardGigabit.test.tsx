import React from "react";
import { render, screen, act } from "@testing-library/react";
import "@testing-library/jest-dom";
import { VenueCard } from "@/components/VenueCard";
import { VenueCard as LightweightVenueCard } from "@/components/venues/VenueCard";

jest.mock("next/navigation", () => ({
  useRouter: () => ({ prefetch: jest.fn(), push: jest.fn() }),
}));

jest.mock("@/context/CurrencyContext", () => ({
  useCurrency: () => ({ currency: "USD", setCurrency: jest.fn() }),
}));

jest.mock("@/components/ui/Toast", () => ({
  useToast: () => ({ toast: jest.fn() }),
  Toast: () => null,
}));

jest.mock("@/hooks/useSeatAvailability", () => ({
  useSeatAvailability: () => ({ availability: {} }),
}));

describe("Gigabit Verified Badge on VenueCard (#9893)", () => {
  beforeEach(() => {
    global.fetch = jest.fn().mockImplementation(() =>
      Promise.resolve({
        ok: false,
        json: () => Promise.resolve({}),
      }),
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("renders 'Gigabit Verified' badge when venue has wifiSpeed >= 100", async () => {
    const venue = {
      id: "v-gigabit",
      name: "Fiber CoWork",
      address: "100 Gigabit Way",
      wifiSpeed: 150,
      position: { lat: 12.9716, lng: 77.5946 },
    };

    render(<VenueCard venue={venue as any} />);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const badge = screen.getByTestId("gigabit-verified-badge");
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveTextContent("Gigabit Verified");
  });

  it("renders 'Gigabit Verified' badge when venue has amenities.wifiSpeed >= 100", async () => {
    const venue = {
      id: "v-gigabit-amenities",
      name: "Ultra Hub",
      address: "200 Fiber Ave",
      position: { lat: 12.9716, lng: 77.5946 },
      amenities: {
        wifiSpeed: 100,
      },
    };

    render(<VenueCard venue={venue as any} />);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const badge = screen.getByTestId("gigabit-verified-badge");
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveTextContent("Gigabit Verified");
  });

  it("does not render 'Gigabit Verified' badge when wifiSpeed < 100", async () => {
    const venue = {
      id: "v-slow",
      name: "Slow Cafe",
      address: "12 Dial-up Rd",
      wifiSpeed: 50,
      position: { lat: 12.9716, lng: 77.5946 },
    };

    render(<VenueCard venue={venue as any} />);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(
      screen.queryByTestId("gigabit-verified-badge"),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Gigabit Verified")).not.toBeInTheDocument();
  });

  it("renders 'Gigabit Verified' badge on lightweight VenueCard when wifiSpeed >= 100", () => {
    render(
      <LightweightVenueCard
        id="lightweight-gigabit"
        name="Fiber Lab"
        openingHours={{ open: "08:00", close: "20:00" }}
        wifiSpeed={120}
      />,
    );

    const badge = screen.getByTestId("gigabit-verified-badge");
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveTextContent("Gigabit Verified");
  });
});
