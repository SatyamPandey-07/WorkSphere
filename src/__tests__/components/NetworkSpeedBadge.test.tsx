import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import {
  NetworkSpeedBadge,
  getMachVelocityInfo,
} from "@/components/ui/NetworkSpeedBadge";

describe("NetworkSpeedBadge and getMachVelocityInfo", () => {
  describe("getMachVelocityInfo", () => {
    it("handles subsonic speeds (< 100 Mbps)", () => {
      const info = getMachVelocityInfo(45);
      expect(info.tier).toBe("subsonic");
      expect(info.tierLabel).toBe("45 Mbps");
      expect(info.machValue).toBe(0.45);
    });

    it("handles turbo speeds (>= 100 and < 250 Mbps)", () => {
      const info = getMachVelocityInfo(175);
      expect(info.tier).toBe("turbo");
      expect(info.tierLabel).toContain("Turbo");
      expect(info.machValue).toBeGreaterThanOrEqual(1.2);
    });

    it("handles supersonic speeds (>= 250 and < 500 Mbps)", () => {
      const info = getMachVelocityInfo(350);
      expect(info.tier).toBe("supersonic");
      expect(info.tierLabel).toContain("Supersonic");
      expect(info.machValue).toBeGreaterThanOrEqual(2.5);
    });

    it("handles hypersonic speeds (>= 500 Mbps)", () => {
      const info = getMachVelocityInfo(750);
      expect(info.tier).toBe("hypersonic");
      expect(info.tierLabel).toContain("Hypersonic");
      expect(info.machValue).toBeGreaterThanOrEqual(5.0);
    });

    it("sanitizes negative or NaN values safely", () => {
      const negativeInfo = getMachVelocityInfo(-50);
      expect(negativeInfo.tier).toBe("subsonic");
      expect(negativeInfo.tierLabel).toBe("0 Mbps");
      expect(negativeInfo.machValue).toBe(0);

      const nanInfo = getMachVelocityInfo(Number.NaN);
      expect(nanInfo.tier).toBe("subsonic");
      expect(nanInfo.tierLabel).toBe("0 Mbps");
      expect(nanInfo.machValue).toBe(0);
    });
  });

  describe("NetworkSpeedBadge component", () => {
    it("renders subsonic badge with speed text", () => {
      render(<NetworkSpeedBadge downloadMbps={80} />);

      const badge = screen.getByTestId("network-speed-badge");
      expect(badge).toBeInTheDocument();
      expect(badge).toHaveTextContent("80 Mbps");
      expect(badge).toHaveAttribute("role", "status");
    });

    it("renders custom label override when provided", () => {
      render(<NetworkSpeedBadge downloadMbps={600} label="Ultra Gigabit" />);

      const badge = screen.getByTestId("network-speed-badge");
      expect(badge).toHaveTextContent("Ultra Gigabit");
    });

    it("shows and hides tooltip on hover and focus", () => {
      render(
        <NetworkSpeedBadge downloadMbps={300} uploadMbps={120} pingMs={9} />,
      );

      const badge = screen.getByTestId("network-speed-badge");
      expect(
        screen.queryByTestId("network-speed-tooltip"),
      ).not.toBeInTheDocument();

      fireEvent.mouseEnter(badge);
      const tooltip = screen.getByTestId("network-speed-tooltip");
      expect(tooltip).toBeInTheDocument();
      expect(tooltip).toHaveTextContent("SUPERSONIC VELOCITY");
      expect(tooltip).toHaveTextContent("Download: 300 Mbps");
      expect(tooltip).toHaveTextContent("Upload: 120 Mbps");
      expect(tooltip).toHaveTextContent("Ping: 9 ms");

      fireEvent.mouseLeave(badge);
      expect(
        screen.queryByTestId("network-speed-tooltip"),
      ).not.toBeInTheDocument();

      // Focus / blur
      fireEvent.focus(badge);
      expect(screen.getByTestId("network-speed-tooltip")).toBeInTheDocument();

      fireEvent.blur(badge);
      expect(
        screen.queryByTestId("network-speed-tooltip"),
      ).not.toBeInTheDocument();
    });

    it("toggles tooltip on click", () => {
      render(<NetworkSpeedBadge downloadMbps={150} />);

      const badge = screen.getByTestId("network-speed-badge");
      fireEvent.click(badge);
      expect(screen.getByTestId("network-speed-tooltip")).toBeInTheDocument();

      fireEvent.click(badge);
      expect(
        screen.queryByTestId("network-speed-tooltip"),
      ).not.toBeInTheDocument();
    });
  });
});
