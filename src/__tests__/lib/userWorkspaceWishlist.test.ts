/**
 * Tests for user workspace wishlist (saved venues to try).
 */

interface WishlistItem {
  venueId: string;
  userId: string;
  addedAt: number;
  note: string;
  priority: "low" | "medium" | "high";
  visited: boolean;
  visitedAt: number | null;
}

function addToWishlist(
  wishlist: WishlistItem[],
  item: WishlistItem
): WishlistItem[] {
  if (wishlist.some((w) => w.venueId === item.venueId && w.userId === item.userId)) {
    return wishlist; // already in wishlist
  }
  return [...wishlist, item];
}

function removeFromWishlist(
  wishlist: WishlistItem[],
  userId: string,
  venueId: string
): WishlistItem[] {
  return wishlist.filter((w) => !(w.userId === userId && w.venueId === venueId));
}

function markVisited(
  wishlist: WishlistItem[],
  userId: string,
  venueId: string,
  nowMs: number
): WishlistItem[] {
  return wishlist.map((w) =>
    w.userId === userId && w.venueId === venueId && !w.visited
      ? { ...w, visited: true, visitedAt: nowMs }
      : w
  );
}

function priorityItems(
  wishlist: WishlistItem[],
  userId: string,
  priority: WishlistItem["priority"]
): WishlistItem[] {
  return wishlist.filter((w) => w.userId === userId && w.priority === priority && !w.visited);
}

function wishlistStats(wishlist: WishlistItem[], userId: string) {
  const userItems = wishlist.filter((w) => w.userId === userId);
  return {
    total: userItems.length,
    visited: userItems.filter((w) => w.visited).length,
    pending: userItems.filter((w) => !w.visited).length,
  };
}

const NOW = 1_700_000_000_000;
const WISHLIST: WishlistItem[] = [
  { venueId: "v1", userId: "u1", addedAt: NOW - 7200_000, note: "Great reviews", priority: "high",   visited: false, visitedAt: null },
  { venueId: "v2", userId: "u1", addedAt: NOW - 3600_000, note: "Near office",    priority: "medium", visited: true,  visitedAt: NOW - 1000 },
  { venueId: "v3", userId: "u2", addedAt: NOW - 1000,     note: "Rooftop!",       priority: "high",   visited: false, visitedAt: null },
];

describe("User workspace wishlist", () => {
  it("addToWishlist: adds new item", () => {
    const newItem: WishlistItem = { venueId: "v4", userId: "u1", addedAt: NOW, note: "", priority: "low", visited: false, visitedAt: null };
    expect(addToWishlist(WISHLIST, newItem)).toHaveLength(4);
  });

  it("addToWishlist: duplicate → no change", () => {
    expect(addToWishlist(WISHLIST, WISHLIST[0])).toHaveLength(3);
  });

  it("removeFromWishlist: removes v1 for u1", () => {
    const updated = removeFromWishlist(WISHLIST, "u1", "v1");
    expect(updated.some((w) => w.venueId === "v1" && w.userId === "u1")).toBe(false);
  });

  it("markVisited: sets visited and visitedAt", () => {
    const updated = markVisited(WISHLIST, "u1", "v1", NOW);
    const item = updated.find((w) => w.venueId === "v1" && w.userId === "u1")!;
    expect(item.visited).toBe(true);
    expect(item.visitedAt).toBe(NOW);
  });

  it("priorityItems: u1 high priority unvisited = v1", () => {
    const high = priorityItems(WISHLIST, "u1", "high");
    expect(high.map((w) => w.venueId)).toContain("v1");
  });

  it("wishlistStats: u1 has 2 total, 1 visited", () => {
    const stats = wishlistStats(WISHLIST, "u1");
    expect(stats.total).toBe(2);
    expect(stats.visited).toBe(1);
    expect(stats.pending).toBe(1);
  });
});
