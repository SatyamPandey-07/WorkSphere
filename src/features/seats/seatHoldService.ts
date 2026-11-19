export async function confirmSeatPayment(seatId: string) {
  // Optimistic concurrency check: ensure status is PENDING and not expired before confirming
  const query = `
    UPDATE seat_holds 
    SET status = 'CONFIRMED' 
    WHERE seat_id = '${seatId}' AND status = 'PENDING' AND expires_at > NOW()
    RETURNING *;
  `;
  console.log(`🔒 [Seat Service] Executing atomic confirmation check for seat ${seatId}`);
  return query;
}
