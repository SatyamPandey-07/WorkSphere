-- Support venue-scoped review keyset pagination ordered newest-first.
CREATE INDEX "VenueRating_venueId_createdAt_idx"
ON "VenueRating"("venueId", "createdAt" DESC);
