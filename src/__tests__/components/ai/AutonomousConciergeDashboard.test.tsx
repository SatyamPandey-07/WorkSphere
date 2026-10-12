import React from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";
import "@testing-library/jest-dom";
import { AutonomousConciergeDashboard } from "@/components/ai/AutonomousConciergeDashboard";

describe("AutonomousConciergeDashboard Aerospace Mission Control Tactical Board", () => {
  beforeEach(() => {
    // ScrollIntoView is not implemented in jsdom
    Element.prototype.scrollIntoView = jest.fn();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("renders tactical mission control multi-column grid view with header and sector telemetry", () => {
    render(<AutonomousConciergeDashboard />);

    // Mission Control Header
    expect(
      screen.getByText(/Mission Control \/\/ Tactical AI Board/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/DEFCON 4 \/\/ NOMINAL/i)).toBeInTheDocument();
    expect(screen.getByTestId("mission-clock")).toBeInTheDocument();

    // Multi-column grid elements
    expect(screen.getByText(/Sector Telemetry Grid/i)).toBeInTheDocument();
    expect(
      screen.getByTestId("sector-card-zone-outdoor-terrace"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("sector-card-zone-open-atrium"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("sector-card-zone-quiet-library"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("sector-card-zone-biophilic-bay"),
    ).toBeInTheDocument();

    // Sector telemetry metrics
    expect(screen.getByText("17.5°C")).toBeInTheDocument();
    expect(screen.getByText("58 dB")).toBeInTheDocument();
    expect(screen.getByText("420 ppm")).toBeInTheDocument();
  });

  it("displays active AI agent statuses with avionics status indicators", () => {
    render(<AutonomousConciergeDashboard />);

    expect(
      screen.getByText(/Active AI Flight Squadrons & Avionics Status/i),
    ).toBeInTheDocument();

    // Avionics flight status badges
    const indicatorAlpha = screen.getByTestId("avionics-indicator-agent-alpha");
    expect(indicatorAlpha).toHaveTextContent("IN-FLIGHT");

    const indicatorBravo = screen.getByTestId("avionics-indicator-agent-bravo");
    expect(indicatorBravo).toHaveTextContent("RADAR-LOCK");

    const indicatorCharlie = screen.getByTestId(
      "avionics-indicator-agent-charlie",
    );
    expect(indicatorCharlie).toHaveTextContent("INTERCEPTING");

    const indicatorDelta = screen.getByTestId("avionics-indicator-agent-delta");
    expect(indicatorDelta).toHaveTextContent("ORBITAL-PATROL");

    // Agent codenames and roles
    expect(
      screen.getAllByText("Agent-Alpha // Climate-Orbiter")[0],
    ).toBeInTheDocument();
    expect(
      screen.getByText("Agent-Bravo // Acoustic-Sentinel"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Agent-Charlie // Equilibrium-Director"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Agent-Delta // Spatial-Navigator"),
    ).toBeInTheDocument();
  });

  it("renders streaming agent logs with green phosphor terminal typography", () => {
    render(<AutonomousConciergeDashboard />);

    const terminalContainer = screen.getByTestId("streaming-agent-terminal");
    expect(terminalContainer).toBeInTheDocument();
    expect(
      screen.getByText(
        /Terminal \/\/ Streaming Agent Telemetry Feed \(TTY-1\)/i,
      ),
    ).toBeInTheDocument();

    const terminalOutput = screen.getByTestId("terminal-log-output");
    expect(terminalOutput).toBeInTheDocument();
    // Verify green phosphor typography class styling
    expect(terminalOutput.className).toContain("text-emerald-400");
    expect(terminalContainer.className).toContain("font-mono");

    // Initial streaming telemetry messages
    expect(
      screen.getByText(/Aerospace Mission Control initialized/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Agent-Alpha telemetry locked/i),
    ).toBeInTheDocument();
  });

  it("renders memory vector heatmap with latent weights", () => {
    render(<AutonomousConciergeDashboard />);

    expect(screen.getByTestId("memory-vector-heatmap")).toBeInTheDocument();
    expect(
      screen.getByText(/Memory Vector Heatmap \/\/ Latent Weights/i),
    ).toBeInTheDocument();

    const vectorCells = screen.getByTestId("vector-matrix-cells");
    expect(vectorCells).toBeInTheDocument();
    expect(screen.getByText("Thermal Bias")).toBeInTheDocument();
    expect(screen.getByText("Acoustic Vector")).toBeInTheDocument();
  });

  it("triggers tactical event injectors in glowing emerald and appends to terminal logs", () => {
    const onScenarioTriggered = jest.fn();
    render(
      <AutonomousConciergeDashboard
        onScenarioTriggered={onScenarioTriggered}
      />,
    );

    // Click Rainstorm injector
    const rainButton = screen.getByTestId("simulate-rain-button");
    fireEvent.click(rainButton);

    expect(onScenarioTriggered).toHaveBeenCalledWith("rain");
    expect(
      screen.getByText(
        /CRITICAL RADAR WARNING: Severe precipitation detected/i,
      ),
    ).toBeInTheDocument();

    // Fast-forward simulation delay
    act(() => {
      jest.advanceTimersByTime(600);
    });

    expect(
      screen.getByText(
        /Telemetry update cycle synchronized for scenario: RAIN/i,
      ),
    ).toBeInTheDocument();

    // Click Noise injector
    const noiseButton = screen.getByTestId("simulate-noise-button");
    fireEvent.click(noiseButton);
    expect(onScenarioTriggered).toHaveBeenCalledWith("noise");
    expect(
      screen.getByText(/ACOUSTIC ANOMALY SPIKE: Sector-02 Glass Atrium/i),
    ).toBeInTheDocument();

    act(() => {
      jest.advanceTimersByTime(600);
    });

    // Click HVAC Reset injector
    const hvacButton = screen.getByTestId("simulate-hvac-button");
    fireEvent.click(hvacButton);
    expect(onScenarioTriggered).toHaveBeenCalledWith("hvac_reset");
    expect(
      screen.getByText(/LIFE SUPPORT RESET: Purging environmental sensors/i),
    ).toBeInTheDocument();

    act(() => {
      jest.advanceTimersByTime(600);
    });
  });

  it("toggles Auto-Pilot flight mode and invokes callback", () => {
    const onAutoPilotToggle = jest.fn();
    render(
      <AutonomousConciergeDashboard
        defaultAutoPilot={true}
        onAutoPilotToggle={onAutoPilotToggle}
      />,
    );

    const autoPilotBtn = screen.getByTestId("autopilot-toggle-button");
    expect(autoPilotBtn).toHaveTextContent("AUTO-PILOT ENGAGED");

    fireEvent.click(autoPilotBtn);
    expect(onAutoPilotToggle).toHaveBeenCalledWith(false);
    expect(autoPilotBtn).toHaveTextContent("AUTO-PILOT STANDBY");
  });

  it("supports confirming flight rebalance proposals and invokes onMigrationApplied", () => {
    const onMigrationApplied = jest.fn();
    render(
      <AutonomousConciergeDashboard
        defaultAutoPilot={false}
        onMigrationApplied={onMigrationApplied}
      />,
    );

    expect(screen.getByText(/Flight Rebalance Proposals/i)).toBeInTheDocument();

    const confirmBtns = screen.getAllByText("CONFIRM FLIGHT RE-ALLOCATION");
    expect(confirmBtns.length).toBeGreaterThan(0);

    fireEvent.click(confirmBtns[0]);
    expect(onMigrationApplied).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/AUTO-RELOCATED/i)).toBeInTheDocument();
  });
});
