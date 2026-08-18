import { render } from "@testing-library/react";
import "@testing-library/jest-dom";
import {
  RecentlyViewedTracker,
  RECENTLY_VIEWED_STORAGE_KEY,
  type RecentlyViewedVenue,
} from "@/components/venues/RecentlyViewedTracker";

const createVenue = (
  id: string,
  name = `Venue ${id}`,
): RecentlyViewedVenue => ({
  id,
  name,
  address: `${id} Main Street`,
  category: "cafe",
  imageUrl: null,
});

describe("RecentlyViewedTracker", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("stores a viewed venue in localStorage", () => {
    const venue = createVenue("1", "Tech Hub");

    render(<RecentlyViewedTracker venue={venue} />);

    expect(
      JSON.parse(localStorage.getItem(RECENTLY_VIEWED_STORAGE_KEY) || "[]"),
    ).toEqual([venue]);
  });

  it("keeps the newest venue first", () => {
    render(<RecentlyViewedTracker venue={createVenue("1")} />);
    render(<RecentlyViewedTracker venue={createVenue("2")} />);

    const stored = JSON.parse(
      localStorage.getItem(RECENTLY_VIEWED_STORAGE_KEY) || "[]",
    );

    expect(stored.map((venue: RecentlyViewedVenue) => venue.id)).toEqual([
      "2",
      "1",
    ]);
  });

  it("moves an already-viewed venue to the top without duplicating it", () => {
    render(<RecentlyViewedTracker venue={createVenue("1")} />);
    render(<RecentlyViewedTracker venue={createVenue("2")} />);
    render(
      <RecentlyViewedTracker venue={createVenue("1", "Updated Venue 1")} />,
    );

    const stored = JSON.parse(
      localStorage.getItem(RECENTLY_VIEWED_STORAGE_KEY) || "[]",
    );

    expect(stored).toHaveLength(2);
    expect(stored[0].id).toBe("1");
    expect(stored[0].name).toBe("Updated Venue 1");
  });

  it("keeps only the five most recently viewed venues", () => {
    for (let i = 1; i <= 6; i++) {
      render(<RecentlyViewedTracker venue={createVenue(String(i))} />);
    }

    const stored = JSON.parse(
      localStorage.getItem(RECENTLY_VIEWED_STORAGE_KEY) || "[]",
    );

    expect(stored).toHaveLength(5);
    expect(stored.map((venue: RecentlyViewedVenue) => venue.id)).toEqual([
      "6",
      "5",
      "4",
      "3",
      "2",
    ]);
  });
});
