import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import LowPowerModeIndicator from "@/components/power/LowPowerModeIndicator";
import { useBatteryLowPowerThrottle } from "@/hooks/useBatteryLowPowerThrottle";

jest.mock("@/hooks/useBatteryLowPowerThrottle");

const mockedUseBatteryLowPowerThrottle =
  useBatteryLowPowerThrottle as jest.MockedFunction<typeof useBatteryLowPowerThrottle>;

describe("LowPowerModeIndicator Component", () => {
  const mockSetManualOverride = jest.fn();
  const mockShouldRenderWebGLFrame = jest.fn().mockReturnValue(true);
  const mockNotifyAudioWorklet = jest.fn();

  const defaultMockReturn = {
    mode: "normal" as const,
    isLowPower: false,
    isCritical: false,
    webglPolicy: {
      targetFps: 60,
      frameIntervalMs: 16.666,
      maxDpr: 2.0,
      enablePostProcessing: true,
      shadowMapResolution: 2048,
    },
    audioWorkletPolicy: {
      dspQuality: "ultra" as const,
      enableTelemetry: true,
      telemetryIntervalMs: 20,
      bypassNonEssential: false,
    },
    batteryLevel: 0.85,
    charging: false,
    manualOverride: null,
    setManualOverride: mockSetManualOverride,
    shouldRenderWebGLFrame: mockShouldRenderWebGLFrame,
    notifyAudioWorklet: mockNotifyAudioWorklet,
    optimalDpr: 2.0,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockedUseBatteryLowPowerThrottle.mockReturnValue({ ...defaultMockReturn });
  });

  describe("Compact Mode Rendering", () => {
    it("renders compact mode status badge with battery level, FPS, and DSP quality", () => {
      render(<LowPowerModeIndicator compact={true} />);

      const compactEl = screen.getByTestId("low-power-indicator-compact");
      expect(compactEl).toBeInTheDocument();
      expect(compactEl).toHaveAttribute("role", "status");
      expect(compactEl).toHaveAttribute("aria-label", "Power Mode Status");
      expect(compactEl).toHaveTextContent("85% · 60 FPS · ULTRA");
    });

    it("displays AC and charging indicator when charging on line power", () => {
      mockedUseBatteryLowPowerThrottle.mockReturnValue({
        ...defaultMockReturn,
        batteryLevel: null,
        charging: true,
      });

      render(<LowPowerModeIndicator compact={true} />);

      const compactEl = screen.getByTestId("low-power-indicator-compact");
      expect(compactEl).toHaveTextContent("AC · 60 FPS · ULTRA");
    });

    it("displays critical pulse styling when isCritical is true in compact mode", () => {
      mockedUseBatteryLowPowerThrottle.mockReturnValue({
        ...defaultMockReturn,
        mode: "critical",
        isCritical: true,
        batteryLevel: 0.08,
      });

      render(<LowPowerModeIndicator compact={true} />);

      const compactEl = screen.getByTestId("low-power-indicator-compact");
      expect(compactEl).toHaveClass("bg-rose-500/20");
      expect(compactEl).toHaveTextContent("8%");
    });
  });

  describe("Full HUD Telemetry & Battery States", () => {
    it("renders complete cockpit telemetry HUD region", () => {
      render(<LowPowerModeIndicator />);

      const hud = screen.getByTestId("low-power-mode-indicator");
      expect(hud).toBeInTheDocument();
      expect(hud).toHaveAttribute("role", "region");
      expect(hud).toHaveAttribute(
        "aria-label",
        "Battery-Aware Power Throttling Telemetry",
      );

      const badge = screen.getByTestId("power-mode-badge");
      expect(badge).toHaveTextContent("normal");
      expect(screen.getByText("AUTONOMOUS BATTERY SENSING")).toBeInTheDocument();
    });

    it("displays charging status when device is connected to AC charger", () => {
      mockedUseBatteryLowPowerThrottle.mockReturnValue({
        ...defaultMockReturn,
        charging: true,
        batteryLevel: 0.72,
      });

      render(<LowPowerModeIndicator />);

      const chargeState = screen.getByTestId("power-charging-state");
      expect(chargeState).toHaveTextContent("CHARGING (72%)");
    });

    it("displays critical battery warning when isCritical is true and discharging", () => {
      mockedUseBatteryLowPowerThrottle.mockReturnValue({
        ...defaultMockReturn,
        isCritical: true,
        mode: "critical",
        charging: false,
        batteryLevel: 0.09,
      });

      render(<LowPowerModeIndicator />);

      const chargeState = screen.getByTestId("power-charging-state");
      expect(chargeState).toHaveTextContent("CRITICAL (9%)");
    });

    it("displays LINE POWER when battery level is unavailable", () => {
      mockedUseBatteryLowPowerThrottle.mockReturnValue({
        ...defaultMockReturn,
        batteryLevel: null,
        charging: false,
      });

      render(<LowPowerModeIndicator />);

      expect(screen.getByTestId("power-charging-state")).toHaveTextContent("LINE POWER");
    });

    it("sanitizes non-finite NaN batteryLevel without rendering NaN%", () => {
      mockedUseBatteryLowPowerThrottle.mockReturnValue({
        ...defaultMockReturn,
        batteryLevel: NaN,
        charging: false,
      });

      render(<LowPowerModeIndicator />);

      expect(screen.getByTestId("power-charging-state")).toHaveTextContent("LINE POWER");
    });
  });

  describe("Hardware Throttling Policies", () => {
    it("renders WebGL target FPS and DPR clamp ceiling", () => {
      render(<LowPowerModeIndicator />);

      const fpsVal = screen.getByTestId("webgl-fps-value");
      expect(fpsVal).toHaveTextContent("60 FPS");
      expect(screen.getByText("16.7 ms")).toBeInTheDocument();
      expect(screen.getByText("2.0x (max 2x)")).toBeInTheDocument();
      expect(screen.getByText("ENABLED")).toBeInTheDocument();
    });

    it("renders AudioWorklet DSP quality and calculates IPC telemetry frequency in Hz", () => {
      render(<LowPowerModeIndicator />);

      expect(screen.getByTestId("audioworklet-dsp-quality")).toHaveTextContent("ultra");
      expect(screen.getByText("20 ms (~50 Hz)")).toBeInTheDocument();
      expect(screen.getByText("ACTIVE")).toBeInTheDocument();
    });

    it("handles disabled or zero-interval AudioWorklet telemetry safely without division by zero", () => {
      mockedUseBatteryLowPowerThrottle.mockReturnValue({
        ...defaultMockReturn,
        audioWorkletPolicy: {
          dspQuality: "eco",
          enableTelemetry: false,
          telemetryIntervalMs: 0,
          bypassNonEssential: true,
        },
      });

      render(<LowPowerModeIndicator />);

      expect(screen.getByText("DISABLED (ZERO IPC)")).toBeInTheDocument();
      expect(screen.getByText("BYPASSED")).toBeInTheDocument();
    });
  });

  describe("Operational Tier Controls & Manual Override", () => {
    it("renders tier override buttons with accessible aria-pressed semantics", () => {
      render(<LowPowerModeIndicator showControls={true} />);

      const normalBtn = screen.getByTestId("power-mode-normal-btn");
      const lowBtn = screen.getByTestId("power-mode-low-btn");
      const criticalBtn = screen.getByTestId("power-mode-critical-btn");

      expect(normalBtn).toHaveAttribute("aria-pressed", "false");
      expect(lowBtn).toHaveAttribute("aria-pressed", "false");
      expect(criticalBtn).toHaveAttribute("aria-pressed", "false");

      fireEvent.click(lowBtn);
      expect(mockSetManualOverride).toHaveBeenCalledWith("low_power");

      fireEvent.click(criticalBtn);
      expect(mockSetManualOverride).toHaveBeenCalledWith("critical");

      fireEvent.click(normalBtn);
      expect(mockSetManualOverride).toHaveBeenCalledWith("normal");
    });

    it("reflects active manual override and renders Auto reset button", () => {
      mockedUseBatteryLowPowerThrottle.mockReturnValue({
        ...defaultMockReturn,
        mode: "low_power",
        manualOverride: "low_power",
        isLowPower: true,
      });

      render(<LowPowerModeIndicator showControls={true} />);

      expect(screen.getByText("MANUAL OVERRIDE ACTIVE")).toBeInTheDocument();

      const lowBtn = screen.getByTestId("power-mode-low-btn");
      expect(lowBtn).toHaveAttribute("aria-pressed", "true");

      const autoBtn = screen.getByTestId("power-mode-auto-btn");
      expect(autoBtn).toBeInTheDocument();
      expect(autoBtn).toHaveAttribute("aria-label", "Reset to autonomous battery sensing");

      fireEvent.click(autoBtn);
      expect(mockSetManualOverride).toHaveBeenCalledWith(null);
    });

    it("omits mode controls when showControls is false", () => {
      render(<LowPowerModeIndicator showControls={false} />);

      expect(screen.queryByTestId("power-mode-normal-btn")).not.toBeInTheDocument();
      expect(screen.queryByTestId("power-mode-low-btn")).not.toBeInTheDocument();
      expect(screen.queryByTestId("power-mode-critical-btn")).not.toBeInTheDocument();
    });
  });
});
