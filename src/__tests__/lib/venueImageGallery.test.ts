/**
 * Tests for venue image gallery management.
 */

interface GalleryImage {
  id: string;
  url: string;
  altText: string;
  isPrimary: boolean;
  uploadedAt: number;
  sizeBytes: number;
}

function primaryImage(images: GalleryImage[]): GalleryImage | null {
  return images.find((img) => img.isPrimary) ?? null;
}

function sortByNewest(images: GalleryImage[]): GalleryImage[] {
  return [...images].sort((a, b) => b.uploadedAt - a.uploadedAt);
}

function filterByMaxSize(images: GalleryImage[], maxBytes: number): GalleryImage[] {
  return images.filter((img) => img.sizeBytes <= maxBytes);
}

function setPrimary(images: GalleryImage[], id: string): GalleryImage[] {
  return images.map((img) => ({ ...img, isPrimary: img.id === id }));
}

const BASE = 1_700_000_000_000;
const IMAGES: GalleryImage[] = [
  { id: "i1", url: "a.jpg", altText: "Front",  isPrimary: true,  uploadedAt: BASE,        sizeBytes: 500_000  },
  { id: "i2", url: "b.jpg", altText: "Interior", isPrimary: false, uploadedAt: BASE + 1000, sizeBytes: 1_500_000 },
  { id: "i3", url: "c.jpg", altText: "Roof",   isPrimary: false, uploadedAt: BASE + 2000, sizeBytes: 800_000  },
];

describe("Venue image gallery", () => {
  it("primaryImage returns the primary", () => {
    expect(primaryImage(IMAGES)!.id).toBe("i1");
  });

  it("primaryImage returns null when none set", () => {
    const noPrimary = IMAGES.map((i) => ({ ...i, isPrimary: false }));
    expect(primaryImage(noPrimary)).toBeNull();
  });

  it("sortByNewest: most recent first", () => {
    const sorted = sortByNewest(IMAGES);
    expect(sorted[0].id).toBe("i3");
  });

  it("sortByNewest does not mutate original", () => {
    const order = IMAGES.map((i) => i.id);
    sortByNewest(IMAGES);
    expect(IMAGES.map((i) => i.id)).toEqual(order);
  });

  it("filterByMaxSize excludes oversized images", () => {
    const filtered = filterByMaxSize(IMAGES, 1_000_000);
    expect(filtered.map((i) => i.id)).not.toContain("i2");
  });

  it("filterByMaxSize keeps exactly-fitting image", () => {
    const filtered = filterByMaxSize(IMAGES, 800_000);
    expect(filtered.map((i) => i.id)).toContain("i3");
  });

  it("setPrimary changes primary to given id", () => {
    const updated = setPrimary(IMAGES, "i2");
    expect(updated.find((i) => i.id === "i2")!.isPrimary).toBe(true);
    expect(updated.find((i) => i.id === "i1")!.isPrimary).toBe(false);
  });
});
