import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import {
  NetworkQualityBadge,
  resolveNetworkQualityTier,
} from "@/components/audio/NetworkQualityBadge";

describe("NetworkQualityBadge & resolveNetworkQualityTier", () => {
  describe("resolveNetworkQualityTier helper", () => {
    it("returns 'unknown' when neither ping nor packetLoss is a valid non-negative number", () => {
      expect(resolveNetworkQualityTier()).toBe("unknown");
      expect(resolveNetworkQualityTier(undefined, undefined)).toBe("unknown");
      expect(resolveNetworkQualityTier(NaN, NaN)).toBe("unknown");
      expect(resolveNetworkQualityTier(-10, -5)).toBe("unknown");
    });

    it("returns 'good' when latency < 100ms and packet loss < 1%", () => {
      expect(resolveNetworkQualityTier(45, 0)).toBe("good");
      expect(resolveNetworkQualityTier(99, 0.9)).toBe("good");
    });

    it("returns 'fair' when latency is 100-249ms or packet loss is 1-4.99%", () => {
      expect(resolveNetworkQualityTier(150, 0.5)).toBe("fair");
      expect(resolveNetworkQualityTier(50, 2.5)).toBe("fair");
      expect(resolveNetworkQualityTier(240, 4.5)).toBe("fair");
    });

    it("returns 'poor' when latency >= 250ms or packet loss >= 5%", () => {
      expect(resolveNetworkQualityTier(300, 0)).toBe("poor");
      expect(resolveNetworkQualityTier(50, 6.0)).toBe("poor");
      expect(resolveNetworkQualityTier(400, 12.0)).toBe("poor");
    });
  });

  describe("NetworkQualityBadge Component", () => {
    it("renders with explicitly provided qualityTier", () => {
      render(<NetworkQualityBadge qualityTier="good" ping={35} packetLoss={0.2} />);

      const badge = screen.getByTestId("network-quality-badge");
      expect(badge).toBeInTheDocument();
      expect(screen.getByText("Good")).toBeInTheDocument();
      expect(screen.getByText("35ms")).toBeInTheDocument();
      expect(screen.getByText("0.2%")).toBeInTheDocument();
    });

    it("automatically derives qualityTier when omitted", () => {
      const { rerender } = render(<NetworkQualityBadge ping={40} packetLoss={0.1} />);
      expect(screen.getByText("Good")).toBeInTheDocument();

      rerender(<NetworkQualityBadge ping={180} packetLoss={0.5} />);
      expect(screen.getByText("Fair")).toBeInTheDocument();

      rerender(<NetworkQualityBadge ping={320} packetLoss={6.5} />);
      expect(screen.getByText("Poor")).toBeInTheDocument();
    });

    it("renders 'Unknown' tier when measurements are unavailable", () => {
      render(<NetworkQualityBadge qualityTier="unknown" />);
      expect(screen.getByText("Unknown")).toBeInTheDocument();
    });

    it("sanitizes negative ping and packetLoss, discarding invalid negative metrics", () => {
      render(<NetworkQualityBadge qualityTier="good" ping={-25} packetLoss={-3.5} />);

      expect(screen.queryByText(/-25ms/)).toBeNull();
      expect(screen.queryByText(/-3.5%/)).toBeNull();
    });

    it("clamps packetLoss above 100% to 100.0%", () => {
      render(<NetworkQualityBadge qualityTier="poor" packetLoss={145} />);
      expect(screen.getByText("100.0%")).toBeInTheDocument();
    });

    it("displays tooltip on mouse enter and focus, updating aria-describedby", () => {
      render(<NetworkQualityBadge qualityTier="fair" ping={120} packetLoss={1.5} />);

      const badge = screen.getByTestId("network-quality-badge");
      expect(screen.queryByTestId("network-quality-tooltip")).toBeNull();

      // Trigger enter
      fireEvent.mouseEnter(badge);
      const tooltip = screen.getByTestId("network-quality-tooltip");
      expect(tooltip).toBeInTheDocument();
      expect(tooltip).toHaveTextContent(/Fair network quality · 120 ms · 1.5% loss/i);
      expect(badge).toHaveAttribute("aria-describedby", "network-quality-tooltip");

      // Trigger leave
      fireEvent.mouseLeave(badge);
      expect(screen.queryByTestId("network-quality-tooltip")).toBeNull();
      expect(badge).not.toHaveAttribute("aria-describedby");
    });

    it("applies custom className", () => {
      render(<NetworkQualityBadge qualityTier="good" className="custom-test-class" />);
      expect(screen.getByTestId("network-quality-badge")).toHaveClass("custom-test-class");
    });
  });
});
