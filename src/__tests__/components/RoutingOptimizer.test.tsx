import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import {
  RoutingOptimizer,
  RouteSummaryCard,
  type OptimizedRouteData,
} from "@/components/map/RoutingOptimizer";

describe("RoutingOptimizer & RouteSummaryCard", () => {
  const sampleWalkingRoute: OptimizedRouteData = {
    distance: 2500, // 2.5 km
    duration: 1800, // 30 minutes
    coordinates: [
      [-122.4, 37.7, 50],
      [-122.41, 37.71, 75],
      [-122.42, 37.72, 60],
      [-122.43, 37.73, 90],
    ],
  };

  const sampleRouteNoElevation: OptimizedRouteData = {
    distance: 1200, // 1.2 km
    duration: 900, // 15 minutes
    coordinates: [
      [-122.4, 37.7],
      [-122.41, 37.71],
    ],
  };

  describe("RoutingOptimizer Overlay Rendering", () => {
    it("renders the routing optimizer panel title and empty queue placeholder", () => {
      render(
        <RoutingOptimizer
          routingQueue={[]}
          travelProfile="walking"
        />,
      );

      expect(screen.getByText("📍 ROUTING OPTIMIZER")).toBeInTheDocument();
      expect(
        screen.getByText(/Click markers or venue listings to chain multiple destinations/i),
      ).toBeInTheDocument();
    });

    it("renders the travel mode selectors and responds to profile change clicks", () => {
      const handleModeChange = jest.fn();
      render(
        <RoutingOptimizer
          routingQueue={[]}
          travelProfile="walking"
          onTravelProfileChange={handleModeChange}
        />,
      );

      const bikeBtn = screen.getByText("🚴‍♂️ Bike");
      fireEvent.click(bikeBtn);
      expect(handleModeChange).toHaveBeenCalledWith("cycling");

      const driveBtn = screen.getByText("🚗 Drive");
      fireEvent.click(driveBtn);
      expect(handleModeChange).toHaveBeenCalledWith("driving");
    });

    it("renders venue items in queue and allows removing a venue", () => {
      const handleRemove = jest.fn();
      const queue = [
        { id: "v1", name: "Central Cafe", latitude: 37.7, longitude: -122.4 },
        { id: "v2", name: "Cowork Hub", latitude: 37.71, longitude: -122.41 },
      ];

      render(
        <RoutingOptimizer
          routingQueue={queue}
          onRemoveVenue={handleRemove}
        />,
      );

      expect(screen.getByText("Central Cafe")).toBeInTheDocument();
      expect(screen.getByText("Cowork Hub")).toBeInTheDocument();

      const removeBtns = screen.getAllByRole("button", { name: /Remove/i });
      fireEvent.click(removeBtns[0]);
      expect(handleRemove).toHaveBeenCalledWith(0);
    });

    it("shows calculate timeline action button when queue has 2 or more stops", () => {
      const handleCalculate = jest.fn();
      const queue = [
        { id: "v1", name: "Central Cafe", latitude: 37.7, longitude: -122.4 },
        { id: "v2", name: "Cowork Hub", latitude: 37.71, longitude: -122.41 },
      ];

      render(
        <RoutingOptimizer
          routingQueue={queue}
          onCalculateRoute={handleCalculate}
        />,
      );

      const calcBtn = screen.getByRole("button", {
        name: /Calculate Combined Travel Timeline/i,
      });
      expect(calcBtn).toBeInTheDocument();
      fireEvent.click(calcBtn);
      expect(handleCalculate).toHaveBeenCalledTimes(1);
    });

    it("renders clear queue button and clears queue when clicked", () => {
      const handleClear = jest.fn();
      const queue = [
        { id: "v1", name: "Central Cafe", latitude: 37.7, longitude: -122.4 },
      ];

      render(
        <RoutingOptimizer
          routingQueue={queue}
          onClearQueue={handleClear}
        />,
      );

      const clearBtn = screen.getByRole("button", { name: /Clear Queue/i });
      fireEvent.click(clearBtn);
      expect(handleClear).toHaveBeenCalledTimes(1);
    });
  });

  describe("RouteSummaryCard - Transportation Modes & Metrics", () => {
    it("displays distance, duration, elevation gain, and active calories for WALK mode", () => {
      // Profile elevation: 50 -> 75 (+25), 75 -> 60 (-15), 60 -> 90 (+30) => total gain = 55m
      // Distance = 2.50 km, Duration = 30 mins (Speed = 83.33 m/min, within ACSM walking range)
      // Net VO2 * minutes = 0.1 * 2500 + 1.8 * 55 = 250 + 99 = 349
      // Active Calories = (349 * 70) / 200 = 122.15 => ~122 kcal
      render(
        <RouteSummaryCard
          route={sampleWalkingRoute}
          mode="walking"
        />,
      );

      expect(screen.getByTestId("metric-distance")).toHaveTextContent("2.50 km");
      expect(screen.getByTestId("metric-duration")).toHaveTextContent("30 mins");
      expect(screen.getByTestId("metric-elevation")).toHaveTextContent("55 m");
      expect(screen.getByTestId("metric-calories")).toHaveTextContent("~122 kcal");
    });

    it("displays distance, duration, elevation gain, and active calories for BIKE mode", () => {
      // Profile elevation: 55m gain
      // Cycling uses base active MET = 6.8 - 1 = 5.8 (outdoor road workload parameters are unmeasured)
      // Active Calories = (5.8 * 3.5 * 70 / 200) * 30 = 213.15 => ~213 kcal
      render(
        <RouteSummaryCard
          route={sampleWalkingRoute}
          mode="cycling"
        />,
      );

      expect(screen.getByTestId("metric-distance")).toHaveTextContent("2.50 km");
      expect(screen.getByTestId("metric-duration")).toHaveTextContent("30 mins");
      expect(screen.getByTestId("metric-elevation")).toHaveTextContent("55 m");
      expect(screen.getByTestId("metric-calories")).toHaveTextContent("~213 kcal");
    });

    it("displays N/A for elevation and calories in DRIVE mode", () => {
      render(
        <RouteSummaryCard
          route={sampleWalkingRoute}
          mode="driving"
        />,
      );

      expect(screen.getByTestId("metric-distance")).toHaveTextContent("2.50 km");
      expect(screen.getByTestId("metric-duration")).toHaveTextContent("30 mins");
      expect(screen.getByTestId("metric-elevation")).toHaveTextContent("N/A");
      expect(screen.getByTestId("metric-calories")).toHaveTextContent("N/A");
    });

    it("handles missing elevation data gracefully without fabricating 0m", () => {
      // sampleRouteNoElevation has 2D coordinates [lng, lat] without elevation
      render(
        <RouteSummaryCard
          route={sampleRouteNoElevation}
          mode="walking"
        />,
      );

      expect(screen.getByTestId("metric-distance")).toHaveTextContent("1.20 km");
      expect(screen.getByTestId("metric-duration")).toHaveTextContent("15 mins");
      // Must not fabricate a measurement
      expect(screen.getByTestId("metric-elevation")).toHaveTextContent("N/A");
      // Calorie calculation succeeds with base active MET (3.5 - 1 = 2.5)
      // Active Calories = (2.5 * 3.5 * 70 / 200) * 15 = 45.9375 => ~46 kcal
      expect(screen.getByTestId("metric-calories")).toHaveTextContent("~46 kcal");
    });

    it("respects imperial unit preference (miles and feet)", () => {
      render(
        <RouteSummaryCard
          route={sampleWalkingRoute}
          mode="walking"
          unitPreference="imperial"
        />,
      );

      // 2500m / 1609.34 = 1.55 mi
      expect(screen.getByTestId("metric-distance")).toHaveTextContent("1.55 mi");
      // 55m * 3.28084 = 180 ft
      expect(screen.getByTestId("metric-elevation")).toHaveTextContent("180 ft");
    });

    it("uses custom weightKg configuration when supplied", () => {
      // 60kg user, walking 15 mins with no elevation data
      // Active Calories = (2.5 * 3.5 * 60 / 200) * 15 = 39.375 => ~39 kcal
      render(
        <RouteSummaryCard
          route={sampleRouteNoElevation}
          mode="walking"
          weightKg={60}
        />,
      );

      expect(screen.getByTestId("metric-calories")).toHaveTextContent("~39 kcal");
    });

    it("handles zero-distance and zero-duration routes gracefully", () => {
      const zeroRoute: OptimizedRouteData = {
        distance: 0,
        duration: 0,
        coordinates: [],
      };

      render(
        <RouteSummaryCard
          route={zeroRoute}
          mode="walking"
        />,
      );

      expect(screen.getByTestId("metric-distance")).toHaveTextContent("0.00 km");
      expect(screen.getByTestId("metric-duration")).toHaveTextContent("0 mins");
      expect(screen.getByTestId("metric-elevation")).toHaveTextContent("N/A");
      expect(screen.getByTestId("metric-calories")).toHaveTextContent("~0 kcal");
    });

    it("handles precalculated route elevationGain if provided directly on route object", () => {
      const precalculatedRoute: OptimizedRouteData = {
        distance: 3000,
        duration: 2400,
        elevationGain: 120, // precalculated 120m
      };

      render(
        <RouteSummaryCard
          route={precalculatedRoute}
          mode="walking"
        />,
      );

      expect(screen.getByTestId("metric-elevation")).toHaveTextContent("120 m");
    });

    it("returns null when route is not provided", () => {
      const { container } = render(<RouteSummaryCard route={null} />);
      expect(container.firstChild).toBeNull();
    });
  });
});
