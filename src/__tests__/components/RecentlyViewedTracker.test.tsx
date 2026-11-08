import { render } from "@testing-library/react";
import "@testing-library/jest-dom";
import {
  RecentlyViewedTracker,
  RECENTLY_VIEWED_STORAGE_KEY,
  recordRecentlyViewedVenue,
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

  it("keeps only the ten most recently viewed venues", () => {
    for (let i = 1; i <= 12; i++) {
      render(<RecentlyViewedTracker venue={createVenue(String(i))} />);
    }

    const stored = JSON.parse(
      localStorage.getItem(RECENTLY_VIEWED_STORAGE_KEY) || "[]",
    );

    expect(stored).toHaveLength(10);
    expect(stored.map((venue: RecentlyViewedVenue) => venue.id)).toEqual([
      "12",
      "11",
      "10",
      "9",
      "8",
      "7",
      "6",
      "5",
      "4",
      "3",
    ]);
  });

  it("revisiting already tracked venues moves them to the front and prevents duplicate IDs", () => {
    render(<RecentlyViewedTracker venue={createVenue("1")} />);
    render(<RecentlyViewedTracker venue={createVenue("2")} />);
    render(<RecentlyViewedTracker venue={createVenue("3")} />);
    render(<RecentlyViewedTracker venue={createVenue("2")} />);
    render(<RecentlyViewedTracker venue={createVenue("1")} />);

    const stored = JSON.parse(
      localStorage.getItem(RECENTLY_VIEWED_STORAGE_KEY) || "[]",
    );

    expect(stored.map((v: RecentlyViewedVenue) => v.id)).toEqual(["1", "2", "3"]);
    expect(new Set(stored.map((v: RecentlyViewedVenue) => v.id)).size).toBe(3);
    expect(stored).toHaveLength(3);
  });

  it("maintains maximum 10-item cap without duplicate entries when repeatedly revisiting venues", () => {
    // Fill with 10 venues
    for (let i = 1; i <= 10; i++) {
      recordRecentlyViewedVenue(createVenue(String(i)));
    }

    // Revisit older venues 1, 2, 3 multiple times
    recordRecentlyViewedVenue(createVenue("1"));
    recordRecentlyViewedVenue(createVenue("2"));
    recordRecentlyViewedVenue(createVenue("1"));
    recordRecentlyViewedVenue(createVenue("3"));

    const stored = JSON.parse(
      localStorage.getItem(RECENTLY_VIEWED_STORAGE_KEY) || "[]",
    );

    expect(stored).toHaveLength(10);
    const ids = stored.map((v: RecentlyViewedVenue) => v.id);
    expect(ids[0]).toBe("3");
    expect(ids[1]).toBe("1");
    expect(ids[2]).toBe("2");
    expect(new Set(ids).size).toBe(10);
  });
});

