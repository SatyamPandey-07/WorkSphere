/**
 * Tests for interactive seat map user interactions.
 */

type SeatState = "available" | "selected" | "unavailable" | "yours";

interface SeatMapState {
  seats: Record<string, SeatState>;
  maxSelectable: number;
  selectedSeats: string[];
}

function selectSeat(state: SeatMapState, seatId: string): SeatMapState {
  if (state.seats[seatId] === "unavailable") throw new Error("Seat not available");
  if (state.seats[seatId] === "yours") return state; // already yours
  if (state.selectedSeats.includes(seatId)) return state; // already selected

  if (state.selectedSeats.length >= state.maxSelectable) {
    throw new Error(`Maximum ${state.maxSelectable} seats allowed`);
  }

  return {
    ...state,
    seats: { ...state.seats, [seatId]: "selected" },
    selectedSeats: [...state.selectedSeats, seatId],
  };
}

function deselectSeat(state: SeatMapState, seatId: string): SeatMapState {
  if (!state.selectedSeats.includes(seatId)) return state;
  return {
    ...state,
    seats: { ...state.seats, [seatId]: "available" },
    selectedSeats: state.selectedSeats.filter((id) => id !== seatId),
  };
}

function clearSelection(state: SeatMapState): SeatMapState {
  const updatedSeats = { ...state.seats };
  state.selectedSeats.forEach((id) => {
    if (updatedSeats[id] === "selected") updatedSeats[id] = "available";
  });
  return { ...state, seats: updatedSeats, selectedSeats: [] };
}

function canProceed(state: SeatMapState, requiredSeats: number): boolean {
  return state.selectedSeats.length === requiredSeats;
}

const INITIAL_STATE: SeatMapState = {
  seats: {
    "A1": "available", "A2": "available", "A3": "unavailable",
    "B1": "available", "B2": "yours",
  },
  maxSelectable: 2,
  selectedSeats: [],
};

describe("Interactive seat map", () => {
  it("selectSeat: selects available seat", () => {
    const updated = selectSeat(INITIAL_STATE, "A1");
    expect(updated.seats["A1"]).toBe("selected");
    expect(updated.selectedSeats).toContain("A1");
  });

  it("selectSeat: throws for unavailable", () => {
    expect(() => selectSeat(INITIAL_STATE, "A3")).toThrow("not available");
  });

  it("selectSeat: throws at max selection", () => {
    const withTwo = selectSeat(selectSeat(INITIAL_STATE, "A1"), "A2");
    expect(() => selectSeat(withTwo, "B1")).toThrow("Maximum");
  });

  it("deselectSeat: removes from selected", () => {
    const selected = selectSeat(INITIAL_STATE, "A1");
    const deselected = deselectSeat(selected, "A1");
    expect(deselected.selectedSeats).not.toContain("A1");
    expect(deselected.seats["A1"]).toBe("available");
  });

  it("clearSelection: resets all selected to available", () => {
    const withSelections = selectSeat(selectSeat(INITIAL_STATE, "A1"), "A2");
    const cleared = clearSelection(withSelections);
    expect(cleared.selectedSeats).toHaveLength(0);
    expect(cleared.seats["A1"]).toBe("available");
  });

  it("canProceed: 2 selected, need 2 → true", () => {
    const withTwo = selectSeat(selectSeat(INITIAL_STATE, "A1"), "A2");
    expect(canProceed(withTwo, 2)).toBe(true);
  });

  it("canProceed: 1 selected, need 2 → false", () => {
    const withOne = selectSeat(INITIAL_STATE, "A1");
    expect(canProceed(withOne, 2)).toBe(false);
  });
});
