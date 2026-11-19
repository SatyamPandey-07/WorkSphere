export async function confirmSeatPayment(seatId: string) {
  // Optimistic concurrency check: ensure status is PENDING and not expired before confirming
 feat/cron-backup-db

 feat/realtime-sync-backoff-heartbeat
 main
  const query = 
    UPDATE seat_holds 
    SET status = 'CONFIRMED' 
    WHERE seat_id =  AND status = 'PENDING' AND expires_at > NOW()
    RETURNING *;
  ;
  console.log(🔒 [Seat Service] Executing atomic confirmation check for seat );
  return query;
 feat/cron-backup-db
}

}

  const query = `
    UPDATE seat_holds 
    SET status = 'CONFIRMED' 
    WHERE seat_id = '${seatId}' AND status = 'PENDING' AND expires_at > NOW()
    RETURNING *;
  `;
  console.log(`🔒 [Seat Service] Executing atomic confirmation check for seat ${seatId}`);
  return query;
}
 main
 main
