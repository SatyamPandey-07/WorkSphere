-- Split-bill payment state was previously inferred from BookingGuest.status = 'ACCEPTED',
-- which is also what the free email RSVP link sets. Track payment explicitly instead.
--
-- Existing ACCEPTED rows are intentionally NOT backfilled as paid: they cannot be
-- told apart from plain RSVP acceptances, and treating them as unpaid is the safe default.

-- AlterTable
ALTER TABLE "BookingGuest" ADD COLUMN     "paidAt" TIMESTAMP(3),
ADD COLUMN     "paidAmountCents" INTEGER,
ADD COLUMN     "paidCurrency" TEXT;
