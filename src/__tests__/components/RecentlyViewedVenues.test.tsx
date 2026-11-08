import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { RecentlyViewedVenues } from "@/components/venues/RecentlyViewedVenues";
import {
  RECENTLY_VIEWED_STORAGE_KEY,
  getRecentlyViewedVenues,
  removeRecentlyViewedVenue,
  clearRecentlyViewedVenues,
  RecentlyViewedVenue,
} from "@/components/venues/RecentlyViewedTracker";

const mockVenues: RecentlyViewedVenue[] = [
  {
    id: "venue-1",
    name: "Central Park Cafe",
    address: "123 Main St, New York",
    category: "cafe",
  },
  {
    id: "venue-2",
    name: "Tech Workspace Hub",
    address: "456 Tech Ave, San Francisco",
    category: "coworking",
  },
];

describe("RecentlyViewedVenues component", () => {
  beforeEach(() => {
    localStorage.clear();
    jest.clearAllMocks();
  });

  it("returns null when no recently viewed venues exist in localStorage", () => {
    const { container } = render(<RecentlyViewedVenues />);
    expect(container.firstChild).toBeNull();
  });

  it("returns null when localStorage has empty array", () => {
    localStorage.setItem(RECENTLY_VIEWED_STORAGE_KEY, JSON.stringify([]));
    const { container } = render(<RecentlyViewedVenues />);
    expect(container.firstChild).toBeNull();
  });

  it("renders list of recently viewed venue cards with name, address, and links", () => {
    localStorage.setItem(
      RECENTLY_VIEWED_STORAGE_KEY,
      JSON.stringify(mockVenues),
    );

    render(<RecentlyViewedVenues />);

    expect(screen.getByText("Recently Viewed")).toBeInTheDocument();
    expect(screen.getByText("Central Park Cafe")).toBeInTheDocument();
    expect(screen.getByText("123 Main St, New York")).toBeInTheDocument();
    expect(screen.getByText("Tech Workspace Hub")).toBeInTheDocument();
    expect(screen.getByText("456 Tech Ave, San Francisco")).toBeInTheDocument();

    const link = screen.getByText("Central Park Cafe").closest("a");
    expect(link).toHaveAttribute("href", "/venues/venue-1");
  });

  it("clears all venues when 'Clear' button is clicked", () => {
    localStorage.setItem(
      RECENTLY_VIEWED_STORAGE_KEY,
      JSON.stringify(mockVenues),
    );

    const { container } = render(<RecentlyViewedVenues />);
    expect(screen.getByText("Central Park Cafe")).toBeInTheDocument();

    const clearButton = screen.getByRole("button", { name: /clear/i });
    fireEvent.click(clearButton);

    expect(container.firstChild).toBeNull();
    expect(localStorage.getItem(RECENTLY_VIEWED_STORAGE_KEY)).toBeNull();
  });

  it("removes only the targeted venue when its remove button is clicked", () => {
    localStorage.setItem(
      RECENTLY_VIEWED_STORAGE_KEY,
      JSON.stringify(mockVenues),
    );

    render(<RecentlyViewedVenues />);

    const removeCentralParkBtn = screen.getByRole("button", {
      name: "Remove Central Park Cafe from recently viewed",
    });

    fireEvent.click(removeCentralParkBtn);

    expect(screen.queryByText("Central Park Cafe")).not.toBeInTheDocument();
    expect(screen.getByText("Tech Workspace Hub")).toBeInTheDocument();

    const stored = JSON.parse(
      localStorage.getItem(RECENTLY_VIEWED_STORAGE_KEY) || "[]",
    );
    expect(stored).toHaveLength(1);
    expect(stored[0].id).toBe("venue-2");
  });

  it("returns null when the last remaining venue card is removed", () => {
    localStorage.setItem(
      RECENTLY_VIEWED_STORAGE_KEY,
      JSON.stringify([mockVenues[0]]),
    );

    const { container } = render(<RecentlyViewedVenues />);
    expect(screen.getByText("Central Park Cafe")).toBeInTheDocument();

    const removeBtn = screen.getByRole("button", {
      name: "Remove Central Park Cafe from recently viewed",
    });
    fireEvent.click(removeBtn);

    expect(container.firstChild).toBeNull();
  });

  it("handles corrupted or invalid JSON in localStorage gracefully without crashing", () => {
    const consoleSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    localStorage.setItem(
      RECENTLY_VIEWED_STORAGE_KEY,
      "invalid-non-json-content{",
    );

    const { container } = render(<RecentlyViewedVenues />);
    expect(container.firstChild).toBeNull();
    consoleSpy.mockRestore();
  });
});

describe("RecentlyViewedTracker helper functions", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("getRecentlyViewedVenues retrieves stored venues", () => {
    expect(getRecentlyViewedVenues()).toEqual([]);

    localStorage.setItem(
      RECENTLY_VIEWED_STORAGE_KEY,
      JSON.stringify(mockVenues),
    );
    expect(getRecentlyViewedVenues()).toEqual(mockVenues);
  });

  it("removeRecentlyViewedVenue removes venue by id and returns updated list", () => {
    localStorage.setItem(
      RECENTLY_VIEWED_STORAGE_KEY,
      JSON.stringify(mockVenues),
    );

    const updated = removeRecentlyViewedVenue("venue-1");
    expect(updated).toHaveLength(1);
    expect(updated[0].id).toBe("venue-2");
    expect(JSON.parse(localStorage.getItem(RECENTLY_VIEWED_STORAGE_KEY)!)).toEqual(
      [mockVenues[1]],
    );
  });

  it("clearRecentlyViewedVenues removes storage key", () => {
    localStorage.setItem(
      RECENTLY_VIEWED_STORAGE_KEY,
      JSON.stringify(mockVenues),
    );
    clearRecentlyViewedVenues();
    expect(localStorage.getItem(RECENTLY_VIEWED_STORAGE_KEY)).toBeNull();
  });
});
