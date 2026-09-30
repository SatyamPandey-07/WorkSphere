/**
 * Tests for venue gallery image ordering and cover selection.
 */

interface GalleryEntry {
  id: string;
  url: string;
  displayOrder: number;
  isCover: boolean;
  approvedAt: number;
}

function sortedGallery(entries: GalleryEntry[]): GalleryEntry[] {
  return [...entries].sort((a, b) => a.displayOrder - b.displayOrder);
}

function coverImage(entries: GalleryEntry[]): GalleryEntry | null {
  return entries.find((e) => e.isCover) ?? null;
}

function setCover(entries: GalleryEntry[], id: string): GalleryEntry[] {
  return entries.map((e) => ({ ...e, isCover: e.id === id }));
}

function reorder(
  entries: GalleryEntry[],
  id: string,
  newOrder: number
): GalleryEntry[] {
  return entries.map((e) => (e.id === id ? { ...e, displayOrder: newOrder } : e));
}

function approvedEntries(entries: GalleryEntry[]): GalleryEntry[] {
  return entries.filter((e) => e.approvedAt > 0);
}

const NOW = 1_700_000_000_000;
const GALLERY: GalleryEntry[] = [
  { id: "g1", url: "a.jpg", displayOrder: 2, isCover: false, approvedAt: NOW - 1000 },
  { id: "g2", url: "b.jpg", displayOrder: 1, isCover: true,  approvedAt: NOW - 2000 },
  { id: "g3", url: "c.jpg", displayOrder: 3, isCover: false, approvedAt: 0 }, // pending
];

describe("Venue gallery ordering", () => {
  it("sortedGallery: ascending by displayOrder", () => {
    const sorted = sortedGallery(GALLERY);
    expect(sorted[0].id).toBe("g2");
    expect(sorted[2].id).toBe("g3");
  });

  it("sortedGallery is immutable", () => {
    const original = GALLERY.map((e) => e.id);
    sortedGallery(GALLERY);
    expect(GALLERY.map((e) => e.id)).toEqual(original);
  });

  it("coverImage: returns isCover=true entry", () => {
    expect(coverImage(GALLERY)!.id).toBe("g2");
  });

  it("coverImage: none set → null", () => {
    const noCover = GALLERY.map((e) => ({ ...e, isCover: false }));
    expect(coverImage(noCover)).toBeNull();
  });

  it("setCover: sets exactly one cover", () => {
    const updated = setCover(GALLERY, "g1");
    expect(updated.filter((e) => e.isCover)).toHaveLength(1);
    expect(updated.find((e) => e.id === "g1")!.isCover).toBe(true);
    expect(updated.find((e) => e.id === "g2")!.isCover).toBe(false);
  });

  it("reorder: updates displayOrder", () => {
    const updated = reorder(GALLERY, "g3", 0);
    expect(updated.find((e) => e.id === "g3")!.displayOrder).toBe(0);
  });

  it("approvedEntries: excludes approvedAt=0", () => {
    expect(approvedEntries(GALLERY)).toHaveLength(2);
  });
});
