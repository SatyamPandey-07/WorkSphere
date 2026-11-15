import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import { CommuteCarbonEstimator } from "@/components/venue/CommuteCarbonEstimator";

const mockSetActiveMode = jest.fn();
const mockRequestCurrentLocation = jest.fn();
const mockSetShowWeeklyProjection = jest.fn();

const sampleEstimates = {
  walking: {
    durationFormatted: "25 min",
    distanceKm: 2.1,
    co2GramsRoundTrip: 0,
    co2KgWeekly: 0,
    ecoColorClass: "text-emerald-500",
    ecoBadgeText: "Zero Emission",
    caloriesBurnedRoundTrip: 150,
    co2SavedVsCarAnnualKg: 180,
    modeLabel: "Walking",
    equivalentTreesPlanted: 8,
    ecoScorePercentage: 100,
  },
  cycling: {
    durationFormatted: "8 min",
    distanceKm: 2.1,
    co2GramsRoundTrip: 16,
    co2KgWeekly: 0.1,
    ecoColorClass: "text-emerald-500",
    ecoBadgeText: "Ultra Low",
    caloriesBurnedRoundTrip: 90,
    co2SavedVsCarAnnualKg: 175,
    modeLabel: "Bicycle",
    equivalentTreesPlanted: 8,
    ecoScorePercentage: 98,
  },
  transit: {
    durationFormatted: "14 min",
    distanceKm: 2.1,
    co2GramsRoundTrip: 134,
    co2KgWeekly: 0.7,
    ecoColorClass: "text-teal-500",
    ecoBadgeText: "Shared Transit",
    caloriesBurnedRoundTrip: 0,
    co2SavedVsCarAnnualKg: 120,
    modeLabel: "Public Transit",
    equivalentTreesPlanted: 5,
    ecoScorePercentage: 82,
  },
  ev: {
    durationFormatted: "6 min",
    distanceKm: 2.1,
    co2GramsRoundTrip: 201,
    co2KgWeekly: 1.0,
    ecoColorClass: "text-blue-500",
    ecoBadgeText: "Electric Vehicle",
    caloriesBurnedRoundTrip: 0,
    co2SavedVsCarAnnualKg: 95,
    modeLabel: "Electric Vehicle",
    equivalentTreesPlanted: 4,
    ecoScorePercentage: 72,
  },
  motorcycle: {
    durationFormatted: "7 min",
    distanceKm: 2.1,
    co2GramsRoundTrip: 386,
    co2KgWeekly: 1.9,
    ecoColorClass: "text-amber-500",
    ecoBadgeText: "Moderate",
    caloriesBurnedRoundTrip: 0,
    co2SavedVsCarAnnualKg: 30,
    modeLabel: "Motorcycle",
    equivalentTreesPlanted: 1,
    ecoScorePercentage: 46,
  },
  car: {
    durationFormatted: "8 min",
    distanceKm: 2.1,
    co2GramsRoundTrip: 718,
    co2KgWeekly: 3.6,
    ecoColorClass: "text-red-500",
    ecoBadgeText: "Combustion Baseline",
    caloriesBurnedRoundTrip: 0,
    co2SavedVsCarAnnualKg: 0,
    modeLabel: "Gasoline Car",
    equivalentTreesPlanted: 0,
    ecoScorePercentage: 0,
  },
};

jest.mock("@/hooks/useCommuteEstimator", () => ({
  useCommuteEstimator: jest.fn(() => ({
    activeMode: "walking",
    setActiveMode: mockSetActiveMode,
    activeEstimate: sampleEstimates.walking,
    allEstimates: sampleEstimates,
    isLoadingLocation: false,
    requestCurrentLocation: mockRequestCurrentLocation,
    showWeeklyProjection: false,
    setShowWeeklyProjection: mockSetShowWeeklyProjection,
  })),
}));

import { useCommuteEstimator } from "@/hooks/useCommuteEstimator";

const mockedUseCommuteEstimator = useCommuteEstimator as unknown as jest.Mock;

describe("CommuteCarbonEstimator", () => {
  const defaultProps = {
    venueLatitude: 37.7749,
    venueLongitude: -122.4194,
    venueName: "San Francisco Central Hub",
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders active estimate and all 6 commute mode buttons", () => {
    render(<CommuteCarbonEstimator {...defaultProps} />);

    expect(screen.getByTestId("commute-carbon-estimator")).toBeInTheDocument();
    expect(screen.getByText("Commute & Carbon Footprint")).toBeInTheDocument();
    expect(screen.getByTestId("commute-travel-time")).toHaveTextContent("25 min");
    expect(screen.getByTestId("commute-co2-metric")).toHaveTextContent("0g");
    expect(screen.getByTestId("commute-active-health-metric")).toHaveTextContent("150 kcal");

    expect(screen.getByTestId("commute-mode-btn-walking")).toBeInTheDocument();
    expect(screen.getByTestId("commute-mode-btn-cycling")).toBeInTheDocument();
    expect(screen.getByTestId("commute-mode-btn-transit")).toBeInTheDocument();
    expect(screen.getByTestId("commute-mode-btn-ev")).toBeInTheDocument();
    expect(screen.getByTestId("commute-mode-btn-motorcycle")).toBeInTheDocument();
    expect(screen.getByTestId("commute-mode-btn-car")).toBeInTheDocument();
  });

  it("calls setActiveMode when a different mode button is clicked", () => {
    render(<CommuteCarbonEstimator {...defaultProps} />);

    const transitBtn = screen.getByTestId("commute-mode-btn-transit");
    fireEvent.click(transitBtn);

    expect(mockSetActiveMode).toHaveBeenCalledWith("transit");
  });

  it("toggles between daily trip and 5-day weekly projection", () => {
    render(<CommuteCarbonEstimator {...defaultProps} />);

    const toggleBtn = screen.getByTestId("projection-toggle-btn");
    expect(toggleBtn).toHaveTextContent("Daily Trip");

    fireEvent.click(toggleBtn);
    expect(mockSetShowWeeklyProjection).toHaveBeenCalledWith(true);
  });

  it("triggers requestCurrentLocation when My Location button is clicked", () => {
    render(<CommuteCarbonEstimator {...defaultProps} />);

    const locationBtn = screen.getByTestId("request-location-btn");
    fireEvent.click(locationBtn);

    expect(mockRequestCurrentLocation).toHaveBeenCalled();
  });

  it("renders carbon offset banner when co2SavedVsCarAnnualKg > 0", () => {
    render(<CommuteCarbonEstimator {...defaultProps} />);

    expect(screen.getByTestId("carbon-offset-banner")).toBeInTheDocument();
    expect(screen.getByText(/equivalent to planting/i)).toBeInTheDocument();
    expect(screen.getByText("8 trees")).toBeInTheDocument();
  });

  it("hides carbon offset banner when co2SavedVsCarAnnualKg is 0 (car mode)", () => {
    mockedUseCommuteEstimator.mockReturnValue({
      activeMode: "car",
      setActiveMode: mockSetActiveMode,
      activeEstimate: sampleEstimates.car,
      allEstimates: sampleEstimates,
      isLoadingLocation: false,
      requestCurrentLocation: mockRequestCurrentLocation,
      showWeeklyProjection: false,
      setShowWeeklyProjection: mockSetShowWeeklyProjection,
    });

    render(<CommuteCarbonEstimator {...defaultProps} />);
    expect(screen.queryByTestId("carbon-offset-banner")).not.toBeInTheDocument();
  });

  it("expands and collapses calculation method details", () => {
    render(<CommuteCarbonEstimator {...defaultProps} />);

    expect(screen.queryByTestId("calculation-info-text")).not.toBeInTheDocument();

    const infoToggle = screen.getByTestId("calculation-info-toggle");
    fireEvent.click(infoToggle);

    expect(screen.getByTestId("calculation-info-text")).toBeInTheDocument();
    expect(screen.getByText(/Emissions are calculated using standard DEFRA\/EPA/i)).toBeInTheDocument();

    fireEvent.click(infoToggle);
    expect(screen.queryByTestId("calculation-info-text")).not.toBeInTheDocument();
  });

  it("returns null when activeEstimate is missing", () => {
    mockedUseCommuteEstimator.mockReturnValue({
      activeEstimate: null,
      allEstimates: null,
    });

    const { container } = render(<CommuteCarbonEstimator {...defaultProps} />);
    expect(container.firstChild).toBeNull();
  });

  it("applies custom className", () => {
    mockedUseCommuteEstimator.mockReturnValue({
      activeMode: "walking",
      setActiveMode: mockSetActiveMode,
      activeEstimate: sampleEstimates.walking,
      allEstimates: sampleEstimates,
      isLoadingLocation: false,
      requestCurrentLocation: mockRequestCurrentLocation,
      showWeeklyProjection: false,
      setShowWeeklyProjection: mockSetShowWeeklyProjection,
    });

    render(<CommuteCarbonEstimator {...defaultProps} className="custom-carbon-estimator" />);
    expect(screen.getByTestId("commute-carbon-estimator")).toHaveClass("custom-carbon-estimator");
  });
});
