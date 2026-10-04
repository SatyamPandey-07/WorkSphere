/**
 * Tests for venue photo gallery management utilities.
 */

type PhotoCategory = "exterior" | "interior" | "capacity" | "amenities" | "floor_plan" | "event_setup";

interface VenuePhoto {
  id: string;
  venueId: string;
  category: PhotoCategory;
  url: string;
  altText: string;
  width: number;
  height: number;
  fileSizeKb: number;
  isPrimary: boolean;
  uploadedAt: number;
  tags: string[];
}

function aspectRatio(photo: VenuePhoto): number {
  if (photo.height === 0) return 0;
  return Math.round((photo.width / photo.height) * 100) / 100;
}

function isLandscape(photo: VenuePhoto): boolean {
  return photo.width > photo.height;
}

function primaryPhoto(photos: VenuePhoto[]): VenuePhoto | null {
  return photos.find((p) => p.isPrimary) ?? null;
}

function photosByCategory(photos: VenuePhoto[], category: PhotoCategory): VenuePhoto[] {
  return photos.filter((p) => p.category === category);
}

function totalStorageKb(photos: VenuePhoto[]): number {
  return photos.reduce((s, p) => s + p.fileSizeKb, 0);
}

function coverageScore(photos: VenuePhoto[]): number {
  const categories: PhotoCategory[] = ["exterior", "interior", "capacity", "amenities", "floor_plan", "event_setup"];
  const covered = categories.filter((c) => photos.some((p) => p.category === c)).length;
  return Math.round((covered / categories.length) * 100);
}

function recentPhotos(photos: VenuePhoto[], nowMs: number, days = 30): VenuePhoto[] {
  return photos.filter((p) => nowMs - p.uploadedAt <= days * 86_400_000);
}

const NOW = 1_700_000_000_000;
const PHOTOS: VenuePhoto[] = [
  { id: "p1", venueId: "v1", category: "exterior",  url: "https://x.com/p1.jpg", altText: "Front view",   width: 1920, height: 1080, fileSizeKb: 500, isPrimary: true,  uploadedAt: NOW - 5 * 86_400_000, tags: ["outdoor"] },
  { id: "p2", venueId: "v1", category: "interior",  url: "https://x.com/p2.jpg", altText: "Main hall",    width: 1080, height: 1920, fileSizeKb: 450, isPrimary: false, uploadedAt: NOW - 50 * 86_400_000, tags: ["indoor"] },
  { id: "p3", venueId: "v1", category: "amenities", url: "https://x.com/p3.jpg", altText: "Conference AV", width: 800,  height: 600,  fileSizeKb: 200, isPrimary: false, uploadedAt: NOW - 2 * 86_400_000, tags: ["tech"] },
];

describe("Photo gallery management", () => {
  it("aspectRatio: 1920x1080 = 1.78", () => {
    expect(aspectRatio(PHOTOS[0])).toBe(1.78);
  });

  it("isLandscape: 1920x1080 → true", () => {
    expect(isLandscape(PHOTOS[0])).toBe(true);
  });

  it("isLandscape: 1080x1920 → false (portrait)", () => {
    expect(isLandscape(PHOTOS[1])).toBe(false);
  });

  it("primaryPhoto: returns the primary photo", () => {
    expect(primaryPhoto(PHOTOS)?.id).toBe("p1");
  });

  it("totalStorageKb: 1150 KB total", () => {
    expect(totalStorageKb(PHOTOS)).toBe(1150);
  });

  it("coverageScore: 3 of 6 categories = 50%", () => {
    expect(coverageScore(PHOTOS)).toBe(50);
  });

  it("recentPhotos: 2 photos within last 30 days", () => {
    expect(recentPhotos(PHOTOS, NOW).length).toBe(2);
  });
});
