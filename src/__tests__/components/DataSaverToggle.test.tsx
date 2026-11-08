import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { DataSaverToggle } from "@/components/sessions/DataSaverToggle";
import {
  DATA_SAVER_STORAGE_KEY,
  DATA_SAVER_SAVINGS_KEY,
} from "@/lib/dataSaver";
import { VenueCard } from "@/components/VenueCard";

jest.mock("@/context/CurrencyContext", () => ({
  useCurrency: () => ({ currency: "USD", setCurrency: jest.fn() }),
}));

const mockVenue = {
  id: "venue-test-1",
  name: "Cafe Nomad",
  address: "123 High Street",
  category: "cafe",
  latitude: 51.5,
  longitude: -0.1,
  photos: ["https://example.com/cafe.jpg"],
};

describe("DataSaverToggle", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage?.clear();
  });

  it("renders with default Off state and no savings chip", () => {
    render(<DataSaverToggle />);

    const switchBtn = screen.getByRole("switch");
    expect(switchBtn).toBeInTheDocument();
    expect(switchBtn).toHaveAttribute("aria-checked", "false");
    expect(switchBtn).toHaveTextContent("Off");

    expect(
      screen.queryByTestId("data-saver-savings-chip"),
    ).not.toBeInTheDocument();
  });

  it("toggles state, persists to localStorage, and displays session data savings counter chip", async () => {
    const onChange = jest.fn();
    render(<DataSaverToggle onChange={onChange} />);

    const switchBtn = screen.getByRole("switch");
    fireEvent.click(switchBtn);

    expect(onChange).toHaveBeenCalledWith(true);
    expect(window.localStorage.getItem(DATA_SAVER_STORAGE_KEY)).toBe("true");

    await waitFor(() => {
      const chip = screen.getByTestId("data-saver-savings-chip");
      expect(chip).toBeInTheDocument();
      expect(chip).toHaveTextContent(/Estimated ~.*MB saved this session/i);
    });
  });

  it("initializes from localStorage when previously enabled", () => {
    window.localStorage.setItem(DATA_SAVER_STORAGE_KEY, "true");
    window.localStorage.setItem(DATA_SAVER_SAVINGS_KEY, "24.6");

    render(<DataSaverToggle />);

    const switchBtn = screen.getByRole("switch");
    expect(switchBtn).toHaveAttribute("aria-checked", "true");
    expect(switchBtn).toHaveTextContent("On");

    const chip = screen.getByTestId("data-saver-savings-chip");
    expect(chip).toHaveTextContent("Estimated ~24.6 MB saved this session");
  });

  it("respects controlled mode and custom estimatedSavedMB override", () => {
    const onChange = jest.fn();
    const { rerender } = render(
      <DataSaverToggle
        enabled={true}
        onChange={onChange}
        estimatedSavedMB={18.4}
      />,
    );

    const chip = screen.getByTestId("data-saver-savings-chip");
    expect(chip).toHaveTextContent("Estimated ~18.4 MB saved this session");

    const switchBtn = screen.getByRole("switch");
    fireEvent.click(switchBtn);
    expect(onChange).toHaveBeenCalledWith(false);

    // Rerender as disabled
    rerender(
      <DataSaverToggle
        enabled={false}
        onChange={onChange}
        estimatedSavedMB={18.4}
      />,
    );
    expect(
      screen.queryByTestId("data-saver-savings-chip"),
    ).not.toBeInTheDocument();
  });
});

describe("VenueCard Data Saver Image Quality Integration", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("sets low image quality when Data Saver is active", () => {
    const { container } = render(
      <VenueCard venue={mockVenue} isDataSaver={true} />,
    );

    const img = container.querySelector("img");
    expect(img).toBeInTheDocument();
    expect(img).toHaveAttribute("data-quality", "low");
    expect(img).toHaveAttribute("data-datasaver", "true");
  });

  it("sets standard image quality when Data Saver is disabled", () => {
    const { container } = render(
      <VenueCard venue={mockVenue} isDataSaver={false} />,
    );

    const img = container.querySelector("img");
    expect(img).toBeInTheDocument();
    expect(img).toHaveAttribute("data-quality", "high");
    expect(img).toHaveAttribute("data-datasaver", "false");
  });

  it("automatically picks up Data Saver mode from localStorage", () => {
    window.localStorage.setItem(DATA_SAVER_STORAGE_KEY, "true");

    const { container } = render(<VenueCard venue={mockVenue} />);

    const img = container.querySelector("img");
    expect(img).toBeInTheDocument();
    expect(img).toHaveAttribute("data-datasaver", "true");
    expect(img).toHaveAttribute("data-quality", "low");
  });
});
