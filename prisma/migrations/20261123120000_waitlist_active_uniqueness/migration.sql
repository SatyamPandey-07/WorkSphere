-- Issue #9688: Enforce atomic waitlist duplicate prevention and seat ownership
--
-- 1. Deterministic reconciliation: If any duplicate active waitlist entries exist
-- for the same (userId, venueId, date, time), preserve the earliest valid FIFO record
-- and mark redundant active/notified entries as CANCELLED (non-destructive).
WITH duplicate_entries AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY "userId", "venueId", "date", "time"
      ORDER BY "createdAt" ASC, "id" ASC
    ) as rnum
  FROM "VenueSeatWaitlist"
  WHERE "status" IN ('ACTIVE', 'NOTIFIED')
)
UPDATE "VenueSeatWaitlist"
SET "status" = 'CANCELLED'
WHERE id IN (
  SELECT id FROM duplicate_entries WHERE rnum > 1
);

-- 2. Partial unique index to enforce that a user can have at most one ACTIVE or NOTIFIED
-- waitlist entry for a given venue, date, and time slot.
-- Maintained via PostgreSQL partial unique index rather than Prisma schema-level @@unique
-- so that terminal statuses (CANCELLED, CLAIMED, EXPIRED) do not block future waitlist entries.
CREATE UNIQUE INDEX IF NOT EXISTS "VenueSeatWaitlist_active_uniqueness_idx"
  ON "VenueSeatWaitlist" ("userId", "venueId", "date", "time")
  WHERE "status" IN ('ACTIVE', 'NOTIFIED');
