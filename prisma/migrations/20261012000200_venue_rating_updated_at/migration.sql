-- Offline review sync compares a review's last-modified time against the
-- client's base version to detect conflicts; reviews are edited in place, so
-- "createdAt" alone cannot tell an edited review from an untouched one.
ALTER TABLE "VenueRating" ADD COLUMN "updatedAt" TIMESTAMP(3);

UPDATE "VenueRating" SET "updatedAt" = "createdAt";

ALTER TABLE "VenueRating"
  ALTER COLUMN "updatedAt" SET NOT NULL,
  ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;
