import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { DeskPostureAnalytics } from "@/components/wellness/DeskPostureAnalytics";

describe("DeskPostureAnalytics Component (#6507)", () => {
  beforeEach(() => {
    localStorage.clear();
    jest.clearAllMocks();
  });

  it("renders workstation check-in and active telemetry banner", () => {
    render(<DeskPostureAnalytics />);

    expect(screen.getByTestId("desk-posture-analytics")).toBeInTheDocument();
    expect(screen.getByTestId("checkin-station-motorized")).toBeInTheDocument();
    expect(screen.getByTestId("checkin-station-chair")).toBeInTheDocument();
    expect(screen.getByTestId("motorized-desk-banner")).toBeInTheDocument();
  });

  it("switches to standard ergonomic chair and shows chair notice", () => {
    const handleStationChange = jest.fn();
    render(<DeskPostureAnalytics onStationChange={handleStationChange} />);

    const chairBtn = screen.getByTestId("checkin-station-chair");
    fireEvent.click(chairBtn);

    expect(handleStationChange).toHaveBeenCalledWith("standard_ergonomic_chair");
    expect(screen.getByTestId("standard-chair-banner")).toBeInTheDocument();

    // In standard chair, toggle posture button should be disabled
    const toggleBtn = screen.getByTestId("toggle-posture-btn");
    expect(toggleBtn).toBeDisabled();
  });

  it("toggles posture between sitting and standing on motorized desk", () => {
    const handlePostureChange = jest.fn();
    render(<DeskPostureAnalytics onPostureChange={handlePostureChange} />);

    const toggleBtn = screen.getByTestId("toggle-posture-btn");
    expect(screen.getByTestId("current-posture-state")).toHaveTextContent("Seated Posture");

    // Click to switch to standing
    fireEvent.click(toggleBtn);
    expect(handlePostureChange).toHaveBeenCalledWith("standing");
    expect(screen.getByTestId("current-posture-state")).toHaveTextContent("Standing Posture");

    // Click again to switch back to sitting
    fireEvent.click(toggleBtn);
    expect(handlePostureChange).toHaveBeenCalledWith("sitting");
    expect(screen.getByTestId("current-posture-state")).toHaveTextContent("Seated Posture");
  });

  it("renders weekly horizontal stacked bar chart with 7 days", () => {
    render(<DeskPostureAnalytics />);

    const chart = screen.getByTestId("weekly-horizontal-bar-chart");
    expect(chart).toBeInTheDocument();

    const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
    days.forEach((day) => {
      const row = screen.getByTestId(`day-bar-row-${day}`);
      expect(row).toBeInTheDocument();

      const sitBar = screen.getByTestId(`sitting-bar-${day}`);
      const standBar = screen.getByTestId(`standing-bar-${day}`);
      expect(sitBar).toBeInTheDocument();
      expect(standBar).toBeInTheDocument();
    });
  });

  it("renders all 6 weekly KPI summary cards", () => {
    render(<DeskPostureAnalytics />);

    expect(screen.getByTestId("weekly-overall-ratio")).toBeInTheDocument();
    expect(screen.getByTestId("weekly-total-standing")).toBeInTheDocument();
    expect(screen.getByTestId("weekly-total-sitting")).toBeInTheDocument();
    expect(screen.getByTestId("weekly-ergonomic-grade")).toBeInTheDocument();
    expect(screen.getByTestId("weekly-total-transitions")).toBeInTheDocument();
    expect(screen.getByTestId("weekly-calories-burned")).toBeInTheDocument();
  });

  it("allows selecting target presets and updates ratio target", () => {
    render(<DeskPostureAnalytics />);

    const target1Btn = screen.getByTestId("target-preset-active_1_1");
    fireEvent.click(target1Btn);

    expect(localStorage.getItem("worksphere_desk_target_ratio")).toBe("1");
  });

  it("toggles clinical ergonomic preset info banner", () => {
    render(<DeskPostureAnalytics />);

    expect(screen.queryByTestId("preset-info-banner")).not.toBeInTheDocument();

    const infoBtn = screen.getByTestId("toggle-preset-info-btn");
    fireEvent.click(infoBtn);
    expect(screen.getByTestId("preset-info-banner")).toBeInTheDocument();

    fireEvent.click(infoBtn);
    expect(screen.queryByTestId("preset-info-banner")).not.toBeInTheDocument();
  });

  it("allows quick adding stand and sit intervals", () => {
    const handleMetricsUpdate = jest.fn();
    render(<DeskPostureAnalytics onMetricsUpdate={handleMetricsUpdate} />);

    const addStandBtn = screen.getByTestId("quick-add-stand-btn");
    fireEvent.click(addStandBtn);
    expect(handleMetricsUpdate).toHaveBeenCalled();

    const addSitBtn = screen.getByTestId("quick-add-sit-btn");
    fireEvent.click(addSitBtn);
    expect(handleMetricsUpdate).toHaveBeenCalledTimes(2);
  });

  it("selects day row and renders drilldown details", () => {
    render(<DeskPostureAnalytics />);

    const wedRow = screen.getByTestId("day-bar-row-Wed");
    fireEvent.click(wedRow);

    const drilldown = screen.getByTestId("day-drilldown-details");
    expect(drilldown).toBeInTheDocument();
    expect(drilldown).toHaveTextContent("Wednesday Details");
  });

  it("persists records to localStorage", () => {
    render(<DeskPostureAnalytics />);

    const saved = localStorage.getItem("worksphere_desk_weekly_records");
    expect(saved).not.toBeNull();
    const parsed = JSON.parse(saved!);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.length).toBe(7);
  });
});
