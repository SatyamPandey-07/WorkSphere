import {
  FIFTEEN_MINUTE_HOLD_MS,
  ReservationHoldRaceGuard,
  SELECT_HOLD_FOR_UPDATE_NOWAIT_SQL,
  type PostgresPoolLike,
  type PostgresTxClient,
  type RaceAuditEntry,
  type ReservationHoldRow,
} from '@/lib/reservations/holdPaymentRaceGuard';

function createTransactionalMockDb(initialHold: ReservationHoldRow) {
  const holds = new Map<string, ReservationHoldRow>([[initialHold.id, { ...initialHold }]]);
  const auditLogs: RaceAuditEntry[] = [];
  let lockedRowId: string | null = null;
  const executedSql: string[] = [];

  const db: PostgresPoolLike = {
    async withTransaction<T>(fn: (tx: PostgresTxClient) => Promise<T>): Promise<T> {
      const tx: PostgresTxClient = {
        async query<TRow = Record<string, unknown>>(
          sql: string,
          params: unknown[] = []
        ): Promise<{ rows: TRow[] }> {
          executedSql.push(sql.trim());

          if (sql.includes('FOR UPDATE NOWAIT')) {
            const id = String(params[0]);
            if (lockedRowId === id) {
              const lockErr = Object.assign(
                new Error('could not obtain lock on relation "desk_reservation_holds"'),
                { code: '55P03' }
              );
              throw lockErr;
            }
            lockedRowId = id;
            const current = holds.get(id);
            return { rows: (current ? [{ ...current }] : []) as unknown as TRow[] };
          }

          if (sql.includes('UPDATE desk_reservation_holds')) {
            const [id, nextStatus, paymentId, updatedAt] = params as [
              string,
              ReservationHoldRow['status'],
              string | null,
              number,
            ];
            const existing = holds.get(id);
            if (!existing) return { rows: [] };
            const updated: ReservationHoldRow = {
              ...existing,
              status: nextStatus,
              paymentId: paymentId ?? existing.paymentId,
              updatedAt,
            };
            holds.set(id, updated);
            return { rows: [{ ...updated }] as unknown as TRow[] };
          }

          if (sql.includes('INSERT INTO reservation_race_audit_logs')) {
            const [
              id,
              reservationId,
              paymentId,
              outcome,
              previousStatus,
              resultingStatus,
              reason,
              recordedAt,
            ] = params as [
              string,
              string,
              string | null,
              RaceAuditEntry['outcome'],
              ReservationHoldRow['status'],
              ReservationHoldRow['status'],
              string,
              number,
            ];
            const entry: RaceAuditEntry = {
              id,
              reservationId,
              paymentId: paymentId ?? undefined,
              outcome,
              previousStatus,
              resultingStatus,
              reason,
              recordedAt,
            };
            auditLogs.push(entry);
            return { rows: [entry] as unknown as TRow[] };
          }

          return { rows: [] };
        },
      };

      try {
        return await fn(tx);
      } finally {
        lockedRowId = null;
      }
    },
  };

  return {
    db,
    holds,
    auditLogs,
    executedSql,
  };
}

describe('ReservationHoldRaceGuard integration: concurrent expiration & payment webhook', () => {
  it('uses SELECT ... FOR UPDATE NOWAIT and grants priority to payment at the 15-minute boundary', async () => {
    const acquiredAt = 1_700_000_000_000;
    const exactExpiry = acquiredAt + FIFTEEN_MINUTE_HOLD_MS;

    const { db, holds, auditLogs, executedSql } = createTransactionalMockDb({
      id: 'hold-mum-101',
      deskId: 'desk-bhandup-04',
      slotWindow: '11:00-12:00',
      status: 'HELD',
      holdExpiresAt: exactExpiry,
      updatedAt: acquiredAt,
    });

    const guard = new ReservationHoldRaceGuard({
      db,
      now: () => exactExpiry,
    });

    const [webhookRes, cronRes] = await Promise.all([
      guard.processPaymentWebhook('hold-mum-101', 'pay_rzp_789'),
      guard.expireHoldIfDue('hold-mum-101'),
    ]);

    expect(
      executedSql.some((s) => s.includes(SELECT_HOLD_FOR_UPDATE_NOWAIT_SQL.trim()))
    ).toBe(true);

    const finalHold = holds.get('hold-mum-101');
    expect(finalHold?.status).toBe('CONFIRMED');
    expect(finalHold?.paymentId).toBe('pay_rzp_789');

    const outcomes = new Set([webhookRes.outcome, cronRes.outcome]);
    expect(
      outcomes.has('PAYMENT_WON_PRIORITY') ||
        outcomes.has('PAYMENT_COMMITTED_ACTIVE') ||
        outcomes.has('LOCK_CONTENTION_RETRY')
    ).toBe(true);
    expect(auditLogs.length).toBe(2);
  });

  it('flags late payment when hold was already marked EXPIRED before payment transaction ran', async () => {
    const acquiredAt = 1_700_000_000_000;
    const expiry = acquiredAt + FIFTEEN_MINUTE_HOLD_MS;

    const { db, holds, auditLogs } = createTransactionalMockDb({
      id: 'hold-mum-102',
      deskId: 'desk-bhandup-09',
      slotWindow: '13:00-14:00',
      status: 'HELD',
      holdExpiresAt: expiry,
      updatedAt: acquiredAt,
    });

    const guard = new ReservationHoldRaceGuard({
      db,
      now: () => expiry + 500,
    });

    const expiredFirst = await guard.expireHoldIfDue('hold-mum-102');
    expect(expiredFirst.outcome).toBe('HOLD_EXPIRED_CLEANLY');
    expect(holds.get('hold-mum-102')?.status).toBe('EXPIRED');

    const latePayment = await guard.processPaymentWebhook('hold-mum-102', 'pay_rzp_late_1');
    expect(latePayment.ok).toBe(false);
    expect(latePayment.outcome).toBe('EXPIRED_BEFORE_PAYMENT');
    expect(holds.get('hold-mum-102')?.status).toBe('LATE_PAYMENT_FLAGGED');
    expect(holds.get('hold-mum-102')?.paymentId).toBe('pay_rzp_late_1');
    expect(auditLogs).toHaveLength(2);
  });
});