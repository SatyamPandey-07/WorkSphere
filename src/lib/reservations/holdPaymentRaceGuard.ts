export const FIFTEEN_MINUTE_HOLD_MS = 15 * 60 * 1000;

export type ReservationHoldStatus =
  | 'HELD'
  | 'CONFIRMED'
  | 'EXPIRED'
  | 'LATE_PAYMENT_FLAGGED';

export type RaceOutcome =
  | 'PAYMENT_WON_PRIORITY'
  | 'PAYMENT_COMMITTED_ACTIVE'
  | 'EXPIRED_BEFORE_PAYMENT'
  | 'HOLD_EXPIRED_CLEANLY'
  | 'LOCK_CONTENTION_RETRY';

export interface ReservationHoldRow {
  id: string;
  deskId: string;
  slotWindow: string;
  status: ReservationHoldStatus;
  holdExpiresAt: number;
  paymentId?: string;
  updatedAt: number;
}

export interface RaceAuditEntry {
  id: string;
  reservationId: string;
  paymentId?: string;
  outcome: RaceOutcome;
  previousStatus: ReservationHoldStatus;
  resultingStatus: ReservationHoldStatus;
  reason: string;
  recordedAt: number;
}

export interface PostgresTxClient {
  query<TRow = Record<string, unknown>>(
    sql: string,
    params?: unknown[]
  ): Promise<{ rows: TRow[] }>;
}

export interface PostgresPoolLike {
  withTransaction<T>(fn: (tx: PostgresTxClient) => Promise<T>): Promise<T>;
}

export interface HoldRaceGuardDependencies {
  db: PostgresPoolLike;
  now?: () => number;
}

export interface RaceResolutionResult {
  ok: boolean;
  outcome: RaceOutcome;
  reservation?: ReservationHoldRow;
  auditEntry: RaceAuditEntry;
}

export const SELECT_HOLD_FOR_UPDATE_NOWAIT_SQL = `
SELECT
  id,
  desk_id AS "deskId",
  slot_window AS "slotWindow",
  status,
  hold_expires_at AS "holdExpiresAt",
  payment_id AS "paymentId",
  updated_at AS "updatedAt"
FROM desk_reservation_holds
WHERE id = $1
FOR UPDATE NOWAIT
`;

const UPDATE_HOLD_STATUS_SQL = `
UPDATE desk_reservation_holds
SET status = $2,
    payment_id = COALESCE($3, payment_id),
    updated_at = $4
WHERE id = $1
RETURNING
  id,
  desk_id AS "deskId",
  slot_window AS "slotWindow",
  status,
  hold_expires_at AS "holdExpiresAt",
  payment_id AS "paymentId",
  updated_at AS "updatedAt"
`;

const INSERT_AUDIT_LOG_SQL = `
INSERT INTO reservation_race_audit_logs (
  id,
  reservation_id,
  payment_id,
  outcome,
  previous_status,
  resulting_status,
  reason,
  recorded_at
)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
RETURNING
  id,
  reservation_id AS "reservationId",
  payment_id AS "paymentId",
  outcome,
  previous_status AS "previousStatus",
  resulting_status AS "resultingStatus",
  reason,
  recorded_at AS "recordedAt"
`;

function isLockNotAvailableError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { code?: string; message?: string };
  return (
    e.code === '55P03' ||
    (e.message ?? '').toLowerCase().includes('could not obtain lock') ||
    (e.message ?? '').toLowerCase().includes('nowait')
  );
}

function buildAuditId(prefix: string, ts: number): string {
  return `${prefix}_${ts}_${Math.random().toString(36).slice(2, 8)}`;
}

export class ReservationHoldRaceGuard {
  private readonly db: PostgresPoolLike;
  private readonly now: () => number;

  constructor(deps: HoldRaceGuardDependencies) {
    this.db = deps.db;
    this.now = deps.now ?? (() => Date.now());
  }

  public async processPaymentWebhook(
    reservationId: string,
    paymentId: string
  ): Promise<RaceResolutionResult> {
    const ts = this.now();

    try {
      return await this.db.withTransaction(async (tx) => {
        const { rows } = await tx.query<ReservationHoldRow>(
          SELECT_HOLD_FOR_UPDATE_NOWAIT_SQL,
          [reservationId]
        );
        const hold = rows[0];

        if (!hold) {
          const auditEntry = await this.writeAudit(tx, {
            id: buildAuditId('aud', ts),
            reservationId,
            paymentId,
            outcome: 'EXPIRED_BEFORE_PAYMENT',
            previousStatus: 'EXPIRED',
            resultingStatus: 'EXPIRED',
            reason: 'Reservation hold row not found during webhook processing',
            recordedAt: ts,
          });
          return { ok: false, outcome: 'EXPIRED_BEFORE_PAYMENT', auditEntry };
        }

        if (hold.status === 'HELD') {
          const wasAtOrPastExpiry = ts >= hold.holdExpiresAt;
          const outcome: RaceOutcome = wasAtOrPastExpiry
            ? 'PAYMENT_WON_PRIORITY'
            : 'PAYMENT_COMMITTED_ACTIVE';
          const reason = wasAtOrPastExpiry
            ? 'Payment confirmed during expiration boundary; payment granted reservation priority'
            : 'Payment confirmed while hold was active within 15-minute window';

          const updatedRows = await tx.query<ReservationHoldRow>(
            UPDATE_HOLD_STATUS_SQL,
            [reservationId, 'CONFIRMED', paymentId, ts]
          );
          const updated = updatedRows.rows[0];
          const auditEntry = await this.writeAudit(tx, {
            id: buildAuditId('aud', ts),
            reservationId,
            paymentId,
            outcome,
            previousStatus: hold.status,
            resultingStatus: 'CONFIRMED',
            reason,
            recordedAt: ts,
          });

          return { ok: true, outcome, reservation: updated, auditEntry };
        }

        if (hold.status === 'EXPIRED') {
          const flaggedRows = await tx.query<ReservationHoldRow>(
            UPDATE_HOLD_STATUS_SQL,
            [reservationId, 'LATE_PAYMENT_FLAGGED', paymentId, ts]
          );
          const flagged = flaggedRows.rows[0] ?? hold;
          const auditEntry = await this.writeAudit(tx, {
            id: buildAuditId('aud', ts),
            reservationId,
            paymentId,
            outcome: 'EXPIRED_BEFORE_PAYMENT',
            previousStatus: hold.status,
            resultingStatus: flagged.status,
            reason: 'Hold had already committed EXPIRED before payment lock acquired; flagged payment to prevent orphan state',
            recordedAt: ts,
          });

          return {
            ok: false,
            outcome: 'EXPIRED_BEFORE_PAYMENT',
            reservation: flagged,
            auditEntry,
          };
        }

        const auditEntry = await this.writeAudit(tx, {
          id: buildAuditId('aud', ts),
          reservationId,
          paymentId,
          outcome: 'PAYMENT_COMMITTED_ACTIVE',
          previousStatus: hold.status,
          resultingStatus: hold.status,
          reason: `Reservation already in state ${hold.status}`,
          recordedAt: ts,
        });

        return {
          ok: hold.status === 'CONFIRMED',
          outcome: 'PAYMENT_COMMITTED_ACTIVE',
          reservation: hold,
          auditEntry,
        };
      });
    } catch (err) {
      if (isLockNotAvailableError(err)) {
        const auditEntry: RaceAuditEntry = {
          id: buildAuditId('aud', ts),
          reservationId,
          paymentId,
          outcome: 'LOCK_CONTENTION_RETRY',
          previousStatus: 'HELD',
          resultingStatus: 'HELD',
          reason: 'FOR UPDATE NOWAIT encountered active row lock; deferring to retry',
          recordedAt: ts,
        };
        return { ok: false, outcome: 'LOCK_CONTENTION_RETRY', auditEntry };
      }
      throw err;
    }
  }

  public async expireHoldIfDue(reservationId: string): Promise<RaceResolutionResult> {
    const ts = this.now();

    try {
      return await this.db.withTransaction(async (tx) => {
        const { rows } = await tx.query<ReservationHoldRow>(
          SELECT_HOLD_FOR_UPDATE_NOWAIT_SQL,
          [reservationId]
        );
        const hold = rows[0];

        if (!hold) {
          const auditEntry = await this.writeAudit(tx, {
            id: buildAuditId('aud', ts),
            reservationId,
            outcome: 'EXPIRED_BEFORE_PAYMENT',
            previousStatus: 'EXPIRED',
            resultingStatus: 'EXPIRED',
            reason: 'Hold row missing during expiration sweep',
            recordedAt: ts,
          });
          return { ok: false, outcome: 'EXPIRED_BEFORE_PAYMENT', auditEntry };
        }

        if (hold.status === 'CONFIRMED') {
          const auditEntry = await this.writeAudit(tx, {
            id: buildAuditId('aud', ts),
            reservationId,
            paymentId: hold.paymentId,
            outcome: 'PAYMENT_WON_PRIORITY',
            previousStatus: hold.status,
            resultingStatus: 'CONFIRMED',
            reason: 'Expiration skipped because payment confirmation already took priority',
            recordedAt: ts,
          });
          return {
            ok: true,
            outcome: 'PAYMENT_WON_PRIORITY',
            reservation: hold,
            auditEntry,
          };
        }

        if (hold.status === 'HELD' && ts >= hold.holdExpiresAt) {
          const updatedRows = await tx.query<ReservationHoldRow>(
            UPDATE_HOLD_STATUS_SQL,
            [reservationId, 'EXPIRED', null, ts]
          );
          const updated = updatedRows.rows[0];
          const auditEntry = await this.writeAudit(tx, {
            id: buildAuditId('aud', ts),
            reservationId,
            outcome: 'HOLD_EXPIRED_CLEANLY',
            previousStatus: hold.status,
            resultingStatus: 'EXPIRED',
            reason: '15-minute reservation hold elapsed with no confirmed payment',
            recordedAt: ts,
          });
          return {
            ok: true,
            outcome: 'HOLD_EXPIRED_CLEANLY',
            reservation: updated,
            auditEntry,
          };
        }

        const auditEntry = await this.writeAudit(tx, {
          id: buildAuditId('aud', ts),
          reservationId,
          outcome: 'HOLD_EXPIRED_CLEANLY',
          previousStatus: hold.status,
          resultingStatus: hold.status,
          reason: 'Hold not yet expired or no longer in HELD state',
          recordedAt: ts,
        });
        return {
          ok: false,
          outcome: 'HOLD_EXPIRED_CLEANLY',
          reservation: hold,
          auditEntry,
        };
      });
    } catch (err) {
      if (isLockNotAvailableError(err)) {
        const auditEntry: RaceAuditEntry = {
          id: buildAuditId('aud', ts),
          reservationId,
          outcome: 'LOCK_CONTENTION_RETRY',
          previousStatus: 'HELD',
          resultingStatus: 'HELD',
          reason: 'FOR UPDATE NOWAIT encountered active row lock during expiration; skipping/retrying',
          recordedAt: ts,
        };
        return { ok: false, outcome: 'LOCK_CONTENTION_RETRY', auditEntry };
      }
      throw err;
    }
  }

  private async writeAudit(
    tx: PostgresTxClient,
    entry: RaceAuditEntry
  ): Promise<RaceAuditEntry> {
    const res = await tx.query<RaceAuditEntry>(INSERT_AUDIT_LOG_SQL, [
      entry.id,
      entry.reservationId,
      entry.paymentId ?? null,
      entry.outcome,
      entry.previousStatus,
      entry.resultingStatus,
      entry.reason,
      entry.recordedAt,
    ]);
    return res.rows[0] ?? entry;
  }
}