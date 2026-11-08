import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import React, { useState } from "react";
import {
  FloorPlanCanvas,
  findNearestSpatialSeat,
  DEFAULT_FLOOR_PLAN_SEATS,
  Seat2D,
} from "../../components/venue/FloorPlanCanvas";
import { describe, it, expect, vi } from "vitest";

describe("FloorPlanCanvas Keyboard Navigation Matrix (#4414)", () => {
  describe("findNearestSpatialSeat Spatial Calculation Helper", () => {
    it("finds nearest seat directly ABOVE current seat position", () => {
      const current = DEFAULT_FLOOR_PLAN_SEATS.find((s) => s.id === "seat_b1")!; // (50, 130)
      const target = findNearestSpatialSeat(current, "UP", DEFAULT_FLOOR_PLAN_SEATS);

      expect(target).not.toBeNull();
      expect(target?.id).toBe("seat_a1"); // (50, 50)
    });

    it("finds nearest seat directly BELOW current seat position", () => {
      const current = DEFAULT_FLOOR_PLAN_SEATS.find((s) => s.id === "seat_a1")!; // (50, 50)
      const target = findNearestSpatialSeat(current, "DOWN", DEFAULT_FLOOR_PLAN_SEATS);

      expect(target).not.toBeNull();
      expect(target?.id).toBe("seat_b1"); // (50, 130)
    });

    it("finds nearest seat directly to the RIGHT of current seat", () => {
      const current = DEFAULT_FLOOR_PLAN_SEATS.find((s) => s.id === "seat_a1")!; // (50, 50)
      const target = findNearestSpatialSeat(current, "RIGHT", DEFAULT_FLOOR_PLAN_SEATS);

      expect(target).not.toBeNull();
      expect(target?.id).toBe("seat_a2"); // (130, 50)
    });

    it("finds nearest seat directly to the LEFT of current seat", () => {
      const current = DEFAULT_FLOOR_PLAN_SEATS.find((s) => s.id === "seat_a2")!; // (130, 50)
      const target = findNearestSpatialSeat(current, "LEFT", DEFAULT_FLOOR_PLAN_SEATS);

      expect(target).not.toBeNull();
      expect(target?.id).toBe("seat_a1"); // (50, 50)
    });

    it("returns null when no candidate seats exist in direction", () => {
      const topSeat = DEFAULT_FLOOR_PLAN_SEATS.find((s) => s.id === "seat_a1")!; // (50, 50)
      const target = findNearestSpatialSeat(topSeat, "UP", DEFAULT_FLOOR_PLAN_SEATS);
      expect(target).toBeNull();
    });
  });

  describe("Roving Tabindex & Grid Accessibility", () => {
    it("renders grid container with role='grid' and ARIA labels", () => {
      render(<FloorPlanCanvas venueName="Downtown Coworking" />);

      const gridRegion = screen.getByRole("region", {
        name: /Downtown Coworking Interactive Floor Plan Grid/i,
      });
      expect(gridRegion).toBeInTheDocument();

      const grid = screen.getByTestId("floor-plan-grid");
      expect(grid).toHaveAttribute("role", "grid");
    });

    it("sets tabIndex=0 on initial focused seat and tabIndex=-1 on un-focused seats", () => {
      render(<FloorPlanCanvas seats={DEFAULT_FLOOR_PLAN_SEATS} />);

      const seatA1 = screen.getByTestId("seat-seat_a1");
      const seatA2 = screen.getByTestId("seat-seat_a2");

      expect(seatA1).toHaveAttribute("tabindex", "0");
      expect(seatA2).toHaveAttribute("tabindex", "-1");
    });

    it("updates roving tabIndex when user focuses or clicks a new seat", () => {
      render(<FloorPlanCanvas seats={DEFAULT_FLOOR_PLAN_SEATS} />);

      const seatA1 = screen.getByTestId("seat-seat_a1");
      const seatA2 = screen.getByTestId("seat-seat_a2");

      fireEvent.focus(seatA2);

      expect(seatA1).toHaveAttribute("tabindex", "-1");
      expect(seatA2).toHaveAttribute("tabindex", "0");
    });

    it("applies high-contrast focus ring classes on active elements", () => {
      render(<FloorPlanCanvas seats={DEFAULT_FLOOR_PLAN_SEATS} />);

      const seatA1 = screen.getByTestId("seat-seat_a1");
      expect(seatA1).toHaveClass("focus-visible:ring-4");
      expect(seatA1).toHaveClass("focus-visible:ring-blue-500");
    });
  });

  describe("Directional Arrow Key Navigation", () => {
    it("navigates RIGHT on ArrowRight key press", () => {
      render(<FloorPlanCanvas seats={DEFAULT_FLOOR_PLAN_SEATS} />);

      const seatA1 = screen.getByTestId("seat-seat_a1");
      fireEvent.keyDown(seatA1, { key: "ArrowRight" });

      const seatA2 = screen.getByTestId("seat-seat_a2");
      expect(seatA2).toHaveAttribute("tabindex", "0");
    });

    it("navigates DOWN on ArrowDown key press", () => {
      render(<FloorPlanCanvas seats={DEFAULT_FLOOR_PLAN_SEATS} />);

      const seatA1 = screen.getByTestId("seat-seat_a1");
      fireEvent.keyDown(seatA1, { key: "ArrowDown" });

      const seatB1 = screen.getByTestId("seat-seat_b1");
      expect(seatB1).toHaveAttribute("tabindex", "0");
    });

    it("navigates UP on ArrowUp key press", () => {
      render(<FloorPlanCanvas seats={DEFAULT_FLOOR_PLAN_SEATS} />);

      const seatB1 = screen.getByTestId("seat-seat_b1");
      fireEvent.focus(seatB1);
      fireEvent.keyDown(seatB1, { key: "ArrowUp" });

      const seatA1 = screen.getByTestId("seat-seat_a1");
      expect(seatA1).toHaveAttribute("tabindex", "0");
    });

    it("navigates LEFT on ArrowLeft key press", () => {
      render(<FloorPlanCanvas seats={DEFAULT_FLOOR_PLAN_SEATS} />);

      const seatA2 = screen.getByTestId("seat-seat_a2");
      fireEvent.focus(seatA2);
      fireEvent.keyDown(seatA2, { key: "ArrowLeft" });

      const seatA1 = screen.getByTestId("seat-seat_a1");
      expect(seatA1).toHaveAttribute("tabindex", "0");
    });

    it("jumps to first seat on Home key press", () => {
      render(<FloorPlanCanvas seats={DEFAULT_FLOOR_PLAN_SEATS} />);

      const seatD8 = screen.getByTestId("seat-seat_d8");
      fireEvent.focus(seatD8);
      fireEvent.keyDown(seatD8, { key: "Home" });

      const seatA1 = screen.getByTestId("seat-seat_a1");
      expect(seatA1).toHaveAttribute("tabindex", "0");
    });

    it("jumps to last seat on End key press", () => {
      render(<FloorPlanCanvas seats={DEFAULT_FLOOR_PLAN_SEATS} />);

      const seatA1 = screen.getByTestId("seat-seat_a1");
      fireEvent.keyDown(seatA1, { key: "End" });

      const seatD8 = screen.getByTestId("seat-seat_d8");
      expect(seatD8).toHaveAttribute("tabindex", "0");
    });
  });

  describe("Enter / Space Selection & Reservation Triggers", () => {
    it("triggers onSelectSeat and onReserveSeat callbacks on Enter key press", () => {
      const handleSelect = vi.fn();
      const handleReserve = vi.fn();

      render(
        <FloorPlanCanvas
          seats={DEFAULT_FLOOR_PLAN_SEATS}
          onSelectSeat={handleSelect}
          onReserveSeat={handleReserve}
        />
      );

      const seatA1 = screen.getByTestId("seat-seat_a1");
      fireEvent.keyDown(seatA1, { key: "Enter" });

      expect(handleSelect).toHaveBeenCalledTimes(1);
      expect(handleReserve).toHaveBeenCalledTimes(1);
      expect(handleSelect).toHaveBeenCalledWith(
        expect.objectContaining({ id: "seat_a1", label: "A1" })
      );
    });

    it("triggers callbacks on Space key press", () => {
      const handleSelect = vi.fn();
      const handleReserve = vi.fn();

      render(
        <FloorPlanCanvas
          seats={DEFAULT_FLOOR_PLAN_SEATS}
          onSelectSeat={handleSelect}
          onReserveSeat={handleReserve}
        />
      );

      const seatA1 = screen.getByTestId("seat-seat_a1");
      fireEvent.keyDown(seatA1, { key: " " });

      expect(handleSelect).toHaveBeenCalledTimes(1);
      expect(handleReserve).toHaveBeenCalledTimes(1);
    });

    it("prevents reservation selection on reserved seats", () => {
      const handleSelect = vi.fn();
      const handleReserve = vi.fn();

      render(
        <FloorPlanCanvas
          seats={DEFAULT_FLOOR_PLAN_SEATS}
          onSelectSeat={handleSelect}
          onReserveSeat={handleReserve}
        />
      );

      // Seat A3 is status: "reserved"
      const seatA3 = screen.getByTestId("seat-seat_a3");
      expect(seatA3).toHaveAttribute("aria-disabled", "true");

      fireEvent.keyDown(seatA3, { key: "Enter" });

      expect(handleSelect).not.toHaveBeenCalled();
      expect(handleReserve).not.toHaveBeenCalled();
    });
  });

  describe("Interactive Controlled Canvas State", () => {
    function ControlledFloorPlanWrapper() {
      const [selectedId, setSelectedId] = useState<string | null>(null);
      return (
        <FloorPlanCanvas
          seats={DEFAULT_FLOOR_PLAN_SEATS}
          selectedSeatId={selectedId}
          onSelectSeat={(seat) => setSelectedId(seat.id)}
        />
      );
    }

    it("updates selected seat styling when user selects seat via keyboard", () => {
      render(<ControlledFloorPlanWrapper />);

      const seatA1 = screen.getByTestId("seat-seat_a1");
      expect(seatA1).toHaveAttribute("aria-selected", "false");

      fireEvent.keyDown(seatA1, { key: "Enter" });

      expect(seatA1).toHaveAttribute("aria-selected", "true");
      expect(seatA1).toHaveClass("bg-blue-600");
    });
  });
});
