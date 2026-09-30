/**
 * Tests for venue photo moderation queue.
 */

type ModerationStatus = "pending" | "approved" | "rejected";

interface PhotoSubmission {
  photoId: string;
  venueId: string;
  submittedBy: string;
  status: ModerationStatus;
  submittedAt: number;
  reviewedAt?: number;
  rejectionReason?: string;
}

function pendingPhotos(photos: PhotoSubmission[]): PhotoSubmission[] {
  return photos.filter((p) => p.status === "pending");
}

function approvePhoto(photo: PhotoSubmission, nowMs: number): PhotoSubmission {
  return { ...photo, status: "approved", reviewedAt: nowMs };
}

function rejectPhoto(
  photo: PhotoSubmission,
  reason: string,
  nowMs: number
): PhotoSubmission {
  return { ...photo, status: "rejected", reviewedAt: nowMs, rejectionReason: reason };
}

function moderationTurnaround(photo: PhotoSubmission): number | null {
  if (!photo.reviewedAt) return null;
  return photo.reviewedAt - photo.submittedAt;
}

const NOW = 1_700_000_000_000;
const PHOTOS: PhotoSubmission[] = [
  { photoId: "p1", venueId: "v1", submittedBy: "u1", status: "pending",  submittedAt: NOW - 3600_000 },
  { photoId: "p2", venueId: "v1", submittedBy: "u2", status: "approved", submittedAt: NOW - 7200_000, reviewedAt: NOW - 3600_000 },
  { photoId: "p3", venueId: "v2", submittedBy: "u3", status: "pending",  submittedAt: NOW - 1800_000 },
];

describe("Venue photo moderation", () => {
  it("pendingPhotos returns only pending", () => {
    expect(pendingPhotos(PHOTOS)).toHaveLength(2);
  });

  it("approvePhoto sets status to approved", () => {
    const approved = approvePhoto(PHOTOS[0], NOW);
    expect(approved.status).toBe("approved");
  });

  it("approvePhoto sets reviewedAt", () => {
    const approved = approvePhoto(PHOTOS[0], NOW);
    expect(approved.reviewedAt).toBe(NOW);
  });

  it("approvePhoto is immutable", () => {
    approvePhoto(PHOTOS[0], NOW);
    expect(PHOTOS[0].status).toBe("pending");
  });

  it("rejectPhoto sets status to rejected", () => {
    const rejected = rejectPhoto(PHOTOS[0], "blurry", NOW);
    expect(rejected.status).toBe("rejected");
    expect(rejected.rejectionReason).toBe("blurry");
  });

  it("moderationTurnaround for reviewed photo", () => {
    expect(moderationTurnaround(PHOTOS[1])).toBe(3_600_000);
  });

  it("moderationTurnaround for pending photo → null", () => {
    expect(moderationTurnaround(PHOTOS[0])).toBeNull();
  });
});
