import React from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";
import "@testing-library/jest-dom";
import CircadianSliderControlDefault, {
  CircadianSliderControl,
} from "@/components/wellness/CircadianSliderControl";
import {
  MIN_KELVIN,
  MAX_KELVIN,
  getScheduleKelvin,
} from "@/components/wellness/CircadianLightingCard";

describe("CircadianSliderControl (Issue #8631)", () => {
  // Test 1: Initial rendering
  describe("1. Initial rendering", () => {
    it("exports named and default export correctly", () => {
      expect(CircadianSliderControl).toBeDefined();
      expect(CircadianSliderControlDefault).toBe(CircadianSliderControl);
    });

    it("renders successfully with default props and displays initial Kelvin temperature", () => {
      render(<CircadianSliderControl solarKelvin={5000} />);

      expect(screen.getByTestId("circadian-slider-control")).toBeInTheDocument();
      expect(screen.getAllByText(/5000K/).length).toBeGreaterThan(0);
      expect(screen.getByText("Solar Schedule Active")).toBeInTheDocument();
    });

    it("configures range input with min 2700, max 6500, and accessible labels", () => {
      render(<CircadianSliderControl defaultValue={3000} />);

      const slider = screen.getByRole("slider");
      expect(slider).toBeInTheDocument();
      expect(slider).toHaveAttribute("min", "2700");
      expect(slider).toHaveAttribute("max", "6500");
      expect(slider).toHaveAttribute("aria-valuenow", "3000");
      expect(slider).toHaveAccessibleName("Circadian color temperature slider");

      expect(screen.getByText("Warm Sunset")).toBeInTheDocument();
      expect(screen.getByText("Cool Daylight")).toBeInTheDocument();
      expect(screen.getByTestId("kelvin-gradient-track")).toBeInTheDocument();
    });
  });

  // Test 2: Slider value changes
  describe("2. Slider value changes", () => {
    it("updates temperature smoothly when slider moves", () => {
      const onChange = jest.fn();
      render(<CircadianSliderControl defaultValue={3500} onChange={onChange} />);

      const slider = screen.getByRole("slider");
      fireEvent.change(slider, { target: { value: "4800" } });

      expect(onChange).toHaveBeenCalledWith(4800);
      expect(slider).toHaveAttribute("aria-valuenow", "4800");
      expect(screen.getAllByText(/4800K/).length).toBeGreaterThan(0);
    });

    it("clamps values outside 2700K - 6500K range", () => {
      const onChange = jest.fn();
      render(<CircadianSliderControl defaultValue={3500} onChange={onChange} />);

      const slider = screen.getByRole("slider");

      fireEvent.change(slider, { target: { value: "2000" } });
      expect(onChange).toHaveBeenCalledWith(MIN_KELVIN);
      expect(slider).toHaveAttribute("aria-valuenow", "2700");

      fireEvent.change(slider, { target: { value: "7500" } });
      expect(onChange).toHaveBeenCalledWith(MAX_KELVIN);
      expect(slider).toHaveAttribute("aria-valuenow", "6500");
    });
  });

  // Test 3: Manual override
  describe("3. Manual override", () => {
    it("activates manual override badge when user moves the slider", () => {
      const onManualOverrideChange = jest.fn();
      render(
        <CircadianSliderControl
          defaultValue={3500}
          onManualOverrideChange={onManualOverrideChange}
        />,
      );

      expect(screen.queryByTestId("manual-override-badge")).not.toBeInTheDocument();
      expect(screen.getByTestId("solar-schedule-badge")).toBeInTheDocument();

      const slider = screen.getByRole("slider");
      fireEvent.change(slider, { target: { value: "5200" } });

      expect(onManualOverrideChange).toHaveBeenCalledWith(true);
      expect(screen.getByTestId("manual-override-badge")).toBeInTheDocument();
      expect(screen.queryByTestId("solar-schedule-badge")).not.toBeInTheDocument();
    });

    it("persists manual override indicator across rerenders until explicitly reset", () => {
      const { rerender } = render(
        <CircadianSliderControl defaultValue={3500} solarKelvin={4000} />,
      );

      const slider = screen.getByRole("slider");
      fireEvent.change(slider, { target: { value: "5500" } });

      expect(screen.getByTestId("manual-override-badge")).toBeInTheDocument();

      // Normal component rerender
      rerender(<CircadianSliderControl defaultValue={3500} solarKelvin={4000} />);
      expect(screen.getByTestId("manual-override-badge")).toBeInTheDocument();
      expect(slider).toHaveAttribute("aria-valuenow", "5500");
    });
  });

  // Test 4: Reset to Solar Schedule
  describe("4. Reset to Solar Schedule", () => {
    it("displays reset button when override is active and clicking restores solar temperature", () => {
      const onChange = jest.fn();
      const onManualOverrideChange = jest.fn();
      const onResetToSolar = jest.fn();

      render(
        <CircadianSliderControl
          solarKelvin={4200}
          defaultValue={3000}
          onChange={onChange}
          onManualOverrideChange={onManualOverrideChange}
          onResetToSolar={onResetToSolar}
        />,
      );

      const slider = screen.getByRole("slider");
      fireEvent.change(slider, { target: { value: "6000" } });

      const resetButton = screen.getByTestId("reset-solar-button");
      expect(resetButton).toBeInTheDocument();

      // Click Reset to Solar Schedule
      fireEvent.click(resetButton);

      expect(onResetToSolar).toHaveBeenCalledWith(4200);
      expect(onManualOverrideChange).toHaveBeenCalledWith(false);
      expect(onChange).toHaveBeenCalledWith(4200);

      // Verify reset UI state
      expect(screen.queryByTestId("manual-override-badge")).not.toBeInTheDocument();
      expect(screen.getByTestId("solar-schedule-badge")).toBeInTheDocument();
      expect(screen.queryByTestId("reset-solar-button")).not.toBeInTheDocument();
      expect(slider).toHaveAttribute("aria-valuenow", "4200");
    });
  });

  // Test 5: Reset visibility
  describe("5. Reset visibility", () => {
    it("does not render reset button while solar schedule is active", () => {
      render(<CircadianSliderControl defaultValue={4000} defaultManualOverride={false} />);

      expect(screen.queryByTestId("reset-solar-button")).not.toBeInTheDocument();
      expect(screen.getByTestId("solar-schedule-badge")).toBeInTheDocument();
    });
  });

  // Test 6: Accessibility
  describe("6. Accessibility", () => {
    it("exposes proper ARIA attributes and keyboard accessibility", () => {
      render(
        <CircadianSliderControl
          defaultValue={4500}
          defaultManualOverride={true}
        />,
      );

      const slider = screen.getByRole("slider");
      expect(slider).toHaveAttribute("aria-valuemin", "2700");
      expect(slider).toHaveAttribute("aria-valuemax", "6500");
      expect(slider).toHaveAttribute("aria-valuenow", "4500");
      expect(slider).toHaveAttribute("aria-valuetext", "4500K, Neutral Focus");

      const badge = screen.getByTestId("manual-override-badge");
      expect(badge).toHaveAttribute("role", "status");
      expect(badge).toHaveAttribute("aria-live", "polite");

      const resetButton = screen.getByTestId("reset-solar-button");
      expect(resetButton).toHaveAccessibleName("Reset to Solar Schedule");
    });
  });

  // Test 7: Controlled mode support
  describe("7. Controlled mode support", () => {
    it("supports controlled value and isManualOverride props", () => {
      const onChange = jest.fn();
      const onManualOverrideChange = jest.fn();

      const { rerender } = render(
        <CircadianSliderControl
          value={3200}
          isManualOverride={false}
          onChange={onChange}
          onManualOverrideChange={onManualOverrideChange}
        />,
      );

      const slider = screen.getByRole("slider");
      expect(slider).toHaveAttribute("aria-valuenow", "3200");
      expect(screen.queryByTestId("manual-override-badge")).not.toBeInTheDocument();

      fireEvent.change(slider, { target: { value: "5000" } });
      expect(onChange).toHaveBeenCalledWith(5000);
      expect(onManualOverrideChange).toHaveBeenCalledWith(true);

      // Re-render with new controlled props
      rerender(
        <CircadianSliderControl
          value={5000}
          isManualOverride={true}
          onChange={onChange}
          onManualOverrideChange={onManualOverrideChange}
        />,
      );

      expect(slider).toHaveAttribute("aria-valuenow", "5000");
      expect(screen.getByTestId("manual-override-badge")).toBeInTheDocument();
    });
  });
});
