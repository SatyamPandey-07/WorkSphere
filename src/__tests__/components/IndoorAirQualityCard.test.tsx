import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import IndoorAirQualityCard, {
  evaluateCo2Threshold,
} from "@/components/venue/telemetry/IndoorAirQualityCard";

describe("IndoorAirQualityCard Component", () => {
  describe("evaluateCo2Threshold unit logic", () => {
    it("returns optimal status for CO2 < 800 PPM", () => {
      const res = evaluateCo2Threshold(650);
      expect(res.status).toBe("optimal");
      expect(res.badgeText).toContain("<800");
      expect(res.isWarning).toBe(false);
      expect(res.isCritical).toBe(false);
      expect(res.badgeColorClass).toContain("emerald");
    });

    it("returns moderate status without warning for 800 <= CO2 <= 1000 PPM", () => {
      const res = evaluateCo2Threshold(900);
      expect(res.status).toBe("moderate");
      expect(res.badgeText).toContain("800-1200");
      expect(res.isWarning).toBe(false);
      expect(res.isCritical).toBe(false);
      expect(res.badgeColorClass).toContain("amber");
    });

    it("returns moderate status WITH warning for 1000 < CO2 <= 1200 PPM (moderate drowsiness)", () => {
      const res = evaluateCo2Threshold(1100);
      expect(res.status).toBe("moderate");
      expect(res.badgeText).toContain("800-1200");
      expect(res.isWarning).toBe(true);
      expect(res.isCritical).toBe(false);
      expect(res.recommendation).toContain("drowsiness");
    });

    it("returns poor status with warning for CO2 > 1200 and < 1500 PPM", () => {
      const res = evaluateCo2Threshold(1350);
      expect(res.status).toBe("poor");
      expect(res.badgeText).toContain(">1200");
      expect(res.isWarning).toBe(true);
      expect(res.isCritical).toBe(false);
      expect(res.badgeColorClass).toContain("rose");
    });

    it("returns critical cognitive impairment flag for CO2 >= 1500 PPM", () => {
      const res = evaluateCo2Threshold(1600);
      expect(res.status).toBe("poor");
      expect(res.isWarning).toBe(true);
      expect(res.isCritical).toBe(true);
      expect(res.recommendation).toContain("Critical threshold breached");
      expect(res.recommendation).toContain("cognitive impairment");
    });
  });

  describe("Color-coded safety status badges", () => {
    it("renders green badge for optimal air quality (<800 PPM)", () => {
      render(<IndoorAirQualityCard co2Ppm={650} />);
      const badge = screen.getByTestId("co2-status-badge");
      expect(badge).toHaveTextContent("Optimal (<800 PPM)");
      expect(badge.className).toContain("text-emerald-400");
    });

    it("renders amber badge for moderate air quality (800-1200 PPM)", () => {
      render(<IndoorAirQualityCard co2Ppm={950} />);
      const badge = screen.getByTestId("co2-status-badge");
      expect(badge).toHaveTextContent("Moderate (800-1200 PPM)");
      expect(badge.className).toContain("text-amber-400");
    });

    it("renders red badge for high risk air quality (>1200 PPM)", () => {
      render(<IndoorAirQualityCard co2Ppm={1400} />);
      const badge = screen.getByTestId("co2-status-badge");
      expect(badge).toHaveTextContent("High Risk (>1200 PPM)");
      expect(badge.className).toContain("text-rose-400");
    });
  });

  describe("Warning banner threshold breach alerts", () => {
    it("does NOT display warning banner when CO2 is <= 1000 PPM", () => {
      render(<IndoorAirQualityCard co2Ppm={750} />);
      expect(screen.queryByTestId("co2-warning-banner")).not.toBeInTheDocument();

      const { rerender } = render(<IndoorAirQualityCard co2Ppm={990} />);
      expect(screen.queryByTestId("co2-warning-banner")).not.toBeInTheDocument();
    });

    it("displays moderate drowsiness warning banner when CO2 exceeds 1000 PPM", () => {
      render(<IndoorAirQualityCard co2Ppm={1150} />);
      const banner = screen.getByTestId("co2-warning-banner");
      expect(banner).toBeInTheDocument();
      expect(banner).toHaveTextContent(/Elevated CO₂ Warning \(Moderate Drowsiness\)/i);
      expect(banner).toHaveTextContent(/drowsiness, sluggishness, and reduced focus/i);
      expect(banner).toHaveTextContent(/open windows/i);
    });

    it("displays critical cognitive impairment warning banner when CO2 exceeds 1500 PPM", () => {
      render(<IndoorAirQualityCard co2Ppm={1650} />);
      const banner = screen.getByTestId("co2-warning-banner");
      expect(banner).toBeInTheDocument();
      expect(banner).toHaveTextContent(/Critical CO₂ Threshold Breached \(Cognitive Impairment\)/i);
      expect(banner).toHaveTextContent(/severe brain fog, headaches, and impaired task performance/i);
      expect(banner).toHaveTextContent(/open all windows immediately or switch rooms/i);
    });

    it("allows occupant to dismiss the warning banner", () => {
      render(<IndoorAirQualityCard co2Ppm={1200} />);
      expect(screen.getByTestId("co2-warning-banner")).toBeInTheDocument();

      const dismissButton = screen.getByLabelText("Dismiss warning banner");
      fireEvent.click(dismissButton);

      expect(screen.queryByTestId("co2-warning-banner")).not.toBeInTheDocument();
    });
  });

  describe("Cognitive impact tooltip", () => {
    it("renders tooltip trigger button with accessible label", () => {
      render(<IndoorAirQualityCard co2Ppm={800} />);
      const trigger = screen.getByTestId("co2-tooltip-trigger");
      expect(trigger).toBeInTheDocument();
      expect(trigger).toHaveAttribute(
        "aria-label",
        "Cognitive impact of CO2 concentrations",
      );
    });

    it("shows and hides tooltip explaining cognitive impact on hover or click", () => {
      render(<IndoorAirQualityCard co2Ppm={800} />);
      const trigger = screen.getByTestId("co2-tooltip-trigger");

      expect(screen.queryByTestId("co2-cognitive-tooltip")).not.toBeInTheDocument();

      // Trigger hover / mouse enter
      fireEvent.mouseEnter(trigger);
      const tooltip = screen.getByTestId("co2-cognitive-tooltip");
      expect(tooltip).toBeInTheDocument();
      expect(tooltip).toHaveAttribute("role", "tooltip");
      expect(tooltip).toHaveTextContent(/CO₂ Cognitive Impact Guide/i);
      expect(tooltip).toHaveTextContent(/~50% drop in complex decision-making/i);
      expect(tooltip).toHaveTextContent(/Significant cognitive impairment/i);

      // Trigger mouse leave
      fireEvent.mouseLeave(trigger);
      expect(screen.queryByTestId("co2-cognitive-tooltip")).not.toBeInTheDocument();

      // Trigger click toggle
      fireEvent.click(trigger);
      expect(screen.getByTestId("co2-cognitive-tooltip")).toBeInTheDocument();
      fireEvent.click(trigger);
      expect(screen.queryByTestId("co2-cognitive-tooltip")).not.toBeInTheDocument();
    });
  });

  describe("Secondary environmental sensors and custom metadata", () => {
    it("displays custom room, venue name, and secondary telemetry metrics", () => {
      render(
        <IndoorAirQualityCard
          co2Ppm={820}
          temperatureC={21.5}
          humidityPercent={45}
          tvocPpb={85}
          pm25={2}
          venueName="Artisan Nomad Hub"
          roomName="Quiet Focus Pod 3"
        />,
      );

      expect(screen.getByText(/Artisan Nomad Hub/)).toBeInTheDocument();
      expect(screen.getByText(/Quiet Focus Pod 3/)).toBeInTheDocument();
      expect(screen.getByText("21.5°C")).toBeInTheDocument();
      expect(screen.getByText("45%")).toBeInTheDocument();
      expect(screen.getByText("85 ppb")).toBeInTheDocument();
      expect(screen.getByText("2 µg/m³")).toBeInTheDocument();
      expect(screen.getByTestId("co2-value")).toHaveTextContent("820");
    });
  });
});
