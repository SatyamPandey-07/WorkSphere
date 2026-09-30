/**
 * Tests for check-in photo timestamp validation.
 */

interface CheckinPhoto {
  photoId: string;
  userId: string;
  venueId: string;
  takenAt: number;     // ms timestamp
  uploadedAt: number;
  coordinates?: { lat: number; lng: number };
}

function isPhotoRecent(photo: CheckinPhoto, nowMs: number, windowMs = 3_600_000): boolean {
  return nowMs - photo.takenAt <= windowMs;
}

function isUploadDelayed(photo: CheckinPhoto, maxDelayMs = 300_000): boolean {
  return photo.uploadedAt - photo.takenAt > maxDelayMs;
}

function hasLocation(photo: CheckinPhoto): boolean {
  return photo.coordinates !== undefined;
}

function photosInWindow(
  photos: CheckinPhoto[],
  userId: string,
  nowMs: number,
  windowMs: number
): CheckinPhoto[] {
  return photos.filter(
    (p) => p.userId === userId && nowMs - p.takenAt <= windowMs
  );
}

const NOW = 1_700_000_000_000;
const PHOTO: CheckinPhoto = {
  photoId: "ph1", userId: "u1", venueId: "v1",
  takenAt: NOW - 60_000, uploadedAt: NOW - 30_000,
  coordinates: { lat: 40.0, lng: -74.0 },
};

describe("Check-in photo timestamp validation", () => {
  it("recent photo within 1h window", () => {
    expect(isPhotoRecent(PHOTO, NOW)).toBe(true);
  });

  it("old photo outside window", () => {
    expect(isPhotoRecent(PHOTO, NOW + 4_000_000)).toBe(false);
  });

  it("upload within 5 min → not delayed", () => {
    expect(isUploadDelayed(PHOTO)).toBe(false);
  });

  it("delayed upload detected", () => {
    const delayed: CheckinPhoto = { ...PHOTO, uploadedAt: NOW + 600_000 };
    expect(isUploadDelayed(delayed)).toBe(true);
  });

  it("photo with coordinates has location", () => {
    expect(hasLocation(PHOTO)).toBe(true);
  });

  it("photo without coordinates has no location", () => {
    const noCoords: CheckinPhoto = { ...PHOTO, coordinates: undefined };
    expect(hasLocation(noCoords)).toBe(false);
  });

  it("photosInWindow returns matching photos", () => {
    const photos: CheckinPhoto[] = [
      PHOTO,
      { ...PHOTO, photoId: "ph2", takenAt: NOW - 7_200_000 },
    ];
    expect(photosInWindow(photos, "u1", NOW, 3_600_000)).toHaveLength(1);
  });

  it("photosInWindow: wrong user → empty", () => {
    expect(photosInWindow([PHOTO], "u99", NOW, 3_600_000)).toHaveLength(0);
  });
});
