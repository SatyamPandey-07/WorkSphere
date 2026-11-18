-- Database-level backstop for concurrent seat reservations (#7573).
--
-- The booking route serializes reservations with `SELECT ... FOR UPDATE NOWAIT`
-- and re-checks for overlaps inside the transaction. This partial unique index
-- closes the remaining race where two transactions pass the availability check
-- at the same instant for the exact same (venue, seat, date, time) slot.
--
-- Only active bookings participate, so cancelled/completed rows are free to
-- reuse the slot. Overlapping *ranges* (e.g. 10:00-11:00 vs 10:30-11:30) are
-- still detected transactionally by hasBookingConflict() under the seat row
-- lock; this index is the final guard for identical-slot races.
CREATE UNIQUE INDEX "Booking_active_seat_slot_key"
  ON "Booking" (
    "venueId",
    COALESCE("seatId", "seatNumber"),
    "date",
    "time"
  )
  WHERE "status" IN ('CONFIRMED', 'PENDING', 'CHECKED_IN');
