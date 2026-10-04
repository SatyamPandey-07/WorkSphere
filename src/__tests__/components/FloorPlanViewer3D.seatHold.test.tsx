import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import FloorPlanViewer3D, {
  type SeatProps,
} from "@/components/floorplan/FloorPlanViewer3D";

const mockSeats: SeatProps[] = [
  {
    id: "seat-1",
    seatNumber: "D1",
    type: "HOT_DESK",
    x: 10,
    y: 10,
    width: 40,
    height: 40,
    amenities: ["monitor"],
    available: true,
  },
  {
    id: "seat-2",
    seatNumber: "D2",
    type: "HOT_DESK",
    x: 60,
    y: 10,
    width: 40,
    height: 40,
    amenities: ["power"],
    available: true,
  },
  {
    id: "seat-3",
    seatNumber: "M1",
    type: "MEETING_ROOM",
    x: 120,
    y: 10,
    width: 60,
    height: 60,
    amenities: ["whiteboard"],
    available: false,
  },
];

describe("FloorPlanViewer3D Realtime Seat-Hold Indicator (#3522)", () => {
  it("renders 'Held by someone else' in the floorplan legend", () => {
    render(
      <FloorPlanViewer3D
        seats={mockSeats}
        selectedSeat={null}
        onSelectSeat={jest.fn()}
      />,
    );

    expect(screen.getByText("Held by someone else")).toBeInTheDocument();
  });

  it("renders animated pulsing indicator and lock icon when a seat is held by another user", () => {
    const activeHolds = {
      "seat-1": {
        heldBy: "user-bob",
        heldByName: "Bob",
        expiresAt: Date.now() + 240_000,
        isSelf: false,
        remainingSeconds: 240,
      },
    };

    const { container } = render(
      <FloorPlanViewer3D
        seats={mockSeats}
        selectedSeat={null}
        onSelectSeat={jest.fn()}
        activeHolds={activeHolds}
      />,
    );

    // Pulse animation ring rendered for held seat
    const pulseRing = container.querySelector("rect.animate-pulse");
    expect(pulseRing).toBeInTheDocument();
    expect(pulseRing).toHaveAttribute("stroke", "#f59e0b");

    // Title / accessible text contains hold info and countdown
    const titleElement = container.querySelector("title");
    expect(titleElement?.textContent).toContain("Held by Bob");
    expect(titleElement?.textContent).toContain("240s remaining");
  });

  it("prevents selecting a seat held by someone else and invokes onHeldSeatClick", () => {
    const onSelectSeat = jest.fn();
    const onHeldSeatClick = jest.fn();

    const activeHolds = {
      "seat-1": {
        heldBy: "user-bob",
        heldByName: "Bob",
        expiresAt: Date.now() + 180_000,
        isSelf: false,
        remainingSeconds: 180,
      },
    };

    render(
      <FloorPlanViewer3D
        seats={mockSeats}
        selectedSeat={null}
        onSelectSeat={onSelectSeat}
        onHeldSeatClick={onHeldSeatClick}
        activeHolds={activeHolds}
      />,
    );

    // Click on held seat-1
    const heldSeatLabel = screen.getByText("D1");
    const seatGroup = heldSeatLabel.closest("g");
    expect(seatGroup).toHaveClass("cursor-not-allowed");

    fireEvent.click(seatGroup!);

    // onSelectSeat should NOT be called
    expect(onSelectSeat).not.toHaveBeenCalled();

    // onHeldSeatClick should be called with seat and hold info
    expect(onHeldSeatClick).toHaveBeenCalledWith(
      expect.objectContaining({ id: "seat-1", seatNumber: "D1" }),
      expect.objectContaining({ heldByName: "Bob", remainingSeconds: 180 }),
    );
  });

  it("allows selecting an unheld available seat", () => {
    const onSelectSeat = jest.fn();

    render(
      <FloorPlanViewer3D
        seats={mockSeats}
        selectedSeat={null}
        onSelectSeat={onSelectSeat}
      />,
    );

    const seatLabel = screen.getByText("D2");
    const seatGroup = seatLabel.closest("g");
    expect(seatGroup).toHaveClass("cursor-pointer");

    fireEvent.click(seatGroup!);
    expect(onSelectSeat).toHaveBeenCalledWith("seat-2");
  });
});
