import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { PowerGridPhaseMeter } from "@/components/admin/PowerGridPhaseMeter";

describe("PowerGridPhaseMeter Component (#6502)", () => {
  it("renders SVG circular gauge dial with 3 animated phase load needles", () => {
    render(
      <PowerGridPhaseMeter
        phaseA={40}
        phaseB={42}
        phaseC={38}
        ratedBreakerCapacity={100}
      />
    );

    expect(screen.getByTestId("power-grid-phase-meter")).toBeInTheDocument();
    expect(screen.getByTestId("needle-phase-a")).toBeInTheDocument();
    expect(screen.getByTestId("needle-phase-b")).toBeInTheDocument();
    expect(screen.getByTestId("needle-phase-c")).toBeInTheDocument();

    // Verify phase amperage cards
    expect(screen.getByTestId("phase-load-a")).toHaveTextContent("40 A");
    expect(screen.getByTestId("phase-load-b")).toHaveTextContent("42 A");
    expect(screen.getByTestId("phase-load-c")).toHaveTextContent("38 A");

    // Phase balance delta indicator should be present
    expect(screen.getByTestId("phase-balance-delta")).toBeInTheDocument();
  });

  it("does not show hazard or imbalance warnings under normal balanced load", () => {
    render(
      <PowerGridPhaseMeter
        phaseA={42}
        phaseB={40}
        phaseC={44}
        ratedBreakerCapacity={100}
      />
    );

    expect(screen.queryByTestId("phase-overload-hazard-warning")).not.toBeInTheDocument();
    expect(screen.queryByTestId("phase-imbalance-warning")).not.toBeInTheDocument();
    expect(screen.getByTestId("phase-balance-delta")).toHaveTextContent("(Balanced)");
  });

  it("emits visual hazard warning if any phase exceeds 85% rated breaker capacity", () => {
    const handleHazardChange = jest.fn();
    render(
      <PowerGridPhaseMeter
        phaseA={92}
        phaseB={45}
        phaseC={50}
        ratedBreakerCapacity={100}
        onHazardChange={handleHazardChange}
      />
    );

    // Hazard warning banner must be displayed
    const hazardBanner = screen.getByTestId("phase-overload-hazard-warning");
    expect(hazardBanner).toBeInTheDocument();
    expect(hazardBanner).toHaveTextContent("Critical Breaker Trip Hazard!");
    expect(hazardBanner).toHaveTextContent("Phase A: 92A");

    // onHazardChange should be called with true
    expect(handleHazardChange).toHaveBeenCalledWith(true);
  });

  it("highlights phase balance delta and emits warning when phase imbalance exceeds 20%", () => {
    const handleImbalanceChange = jest.fn();
    render(
      <PowerGridPhaseMeter
        phaseA={68}
        phaseB={24}
        phaseC={40}
        ratedBreakerCapacity={100}
        onImbalanceChange={handleImbalanceChange}
      />
    );

    // Phase imbalance warning banner must be displayed
    const imbalanceBanner = screen.getByTestId("phase-imbalance-warning");
    expect(imbalanceBanner).toBeInTheDocument();
    expect(imbalanceBanner).toHaveTextContent("Phase Imbalance Warning");
    expect(imbalanceBanner).toHaveTextContent(">20% limit");

    // Delta indicator displays > 20%
    const deltaIndicator = screen.getByTestId("phase-balance-delta");
    expect(deltaIndicator).toHaveTextContent("Imbalance > 20%");

    // onImbalanceChange called with isImbalanced = true
    expect(handleImbalanceChange).toHaveBeenCalledWith(expect.any(Number), true);
  });

  it("toggles facilities simulation controls and allows selecting presets", () => {
    const handleLoadChange = jest.fn();
    render(
      <PowerGridPhaseMeter
        ratedBreakerCapacity={100}
        onLoadChange={handleLoadChange}
      />
    );

    expect(screen.queryByTestId("phase-controls-panel")).not.toBeInTheDocument();

    // Toggle controls drawer
    const toggleBtn = screen.getByTestId("toggle-controls-btn");
    fireEvent.click(toggleBtn);
    expect(screen.getByTestId("phase-controls-panel")).toBeInTheDocument();

    // Click Critical Overload preset
    const overloadPresetBtn = screen.getByTestId("preset-btn-breaker_overload_hazard");
    fireEvent.click(overloadPresetBtn);

    expect(handleLoadChange).toHaveBeenCalledWith({
      phaseA: 92,
      phaseB: 88,
      phaseC: 45,
    });
    expect(screen.getByTestId("phase-overload-hazard-warning")).toBeInTheDocument();
  });

  it("updates phase loads when sliders are moved", () => {
    const handleLoadChange = jest.fn();
    render(
      <PowerGridPhaseMeter
        phaseA={30}
        phaseB={30}
        phaseC={30}
        ratedBreakerCapacity={100}
        onLoadChange={handleLoadChange}
      />
    );

    const toggleBtn = screen.getByTestId("toggle-controls-btn");
    fireEvent.click(toggleBtn);

    const sliderA = screen.getByTestId("slider-phase-a");
    fireEvent.change(sliderA, { target: { value: "88" } });

    expect(handleLoadChange).toHaveBeenCalledWith(
      expect.objectContaining({ phaseA: 88 })
    );
  });
});
