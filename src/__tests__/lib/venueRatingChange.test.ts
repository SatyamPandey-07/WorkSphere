/**
 * Tests for venue rating update and recalculation.
 */

interface VenueRatingState {
  venueId: string;
  totalRatings: number;
  sumRatings: number;
}

function currentRating(state: VenueRatingState): number {
  if (state.totalRatings === 0) return 0;
  return Math.round((state.sumRatings / state.totalRatings) * 10) / 10;
}

function addRating(state: VenueRatingState, newRating: number): VenueRatingState {
  if (newRating < 1 || newRating > 5) throw new RangeError("Rating must be 1–5");
  return {
    ...state,
    totalRatings: state.totalRatings + 1,
    sumRatings: state.sumRatings + newRating,
  };
}

function updateRating(
  state: VenueRatingState,
  oldRating: number,
  newRating: number
): VenueRatingState {
  if (newRating < 1 || newRating > 5) throw new RangeError("Rating must be 1–5");
  return { ...state, sumRatings: state.sumRatings - oldRating + newRating };
}

function removeRating(state: VenueRatingState, ratingValue: number): VenueRatingState {
  if (state.totalRatings <= 0) return state;
  return {
    ...state,
    totalRatings: state.totalRatings - 1,
    sumRatings: state.sumRatings - ratingValue,
  };
}

describe("Venue rating recalculation", () => {
  const STATE: VenueRatingState = { venueId: "v1", totalRatings: 4, sumRatings: 17 };

  it("currentRating: 17/4 = 4.3 (rounded to 1 decimal)", () => {
    expect(currentRating(STATE)).toBeCloseTo(4.3);
  });

  it("currentRating: zero ratings → 0", () => {
    expect(currentRating({ venueId: "v1", totalRatings: 0, sumRatings: 0 })).toBe(0);
  });

  it("addRating increases total and sum", () => {
    const updated = addRating(STATE, 5);
    expect(updated.totalRatings).toBe(5);
    expect(updated.sumRatings).toBe(22);
  });

  it("addRating: out-of-range throws", () => {
    expect(() => addRating(STATE, 6)).toThrow(RangeError);
    expect(() => addRating(STATE, 0)).toThrow(RangeError);
  });

  it("updateRating adjusts sumRatings", () => {
    const updated = updateRating(STATE, 3, 5);
    expect(updated.sumRatings).toBe(19);
    expect(updated.totalRatings).toBe(4); // unchanged
  });

  it("removeRating decreases total and sum", () => {
    const updated = removeRating(STATE, 4);
    expect(updated.totalRatings).toBe(3);
    expect(updated.sumRatings).toBe(13);
  });

  it("removeRating: no-op when totalRatings is 0", () => {
    const empty = { venueId: "v1", totalRatings: 0, sumRatings: 0 };
    expect(removeRating(empty, 5)).toEqual(empty);
  });
});
