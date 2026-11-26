export type CancellationTier = 'full_refund' | 'partial_slash' | 'full_slash';

export type LedgerEntryType =
  | 'deposit_hold'
  | 'nomad_refund'
  | 'host_payout'
  | 'protocol_fee';

export interface BookingLedgerLineItem {
  entryId: string;
  bookingId: string;
  type: LedgerEntryType;
  lamports: bigint;
  recipient: 'nomad' | 'host' | 'treasury' | 'escrow';
  memo: string;
}

export interface DepositSettlementInput {
  bookingId: string;
  depositLamports: bigint | number;
  sessionStartUnixMs: number;
  cancelledAtUnixMs: number;
  sessionDurationMinutes?: number;
  protocolFeeBps?: number;
}

export interface DepositSettlementResult {
  bookingId: string;
  tier: CancellationTier;
  slashBasisPoints: number;
  minutesBeforeStart: number;
  depositLamports: bigint;
  slashedLamports: bigint;
  refundLamports: bigint;
  hostPayoutLamports: bigint;
  protocolFeeLamports: bigint;
  ledgerEntries: BookingLedgerLineItem[];
}

const BPS_DENOMINATOR = 10_000n;

function normalizeNonNegativeBigInt(
  value: bigint | number,
  fieldName: string
): bigint {
  if (typeof value === 'bigint') {
    if (value < 0n) {
      throw new RangeError(`${fieldName} must be non-negative`);
    }
    return value;
  }

  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new RangeError(`${fieldName} must be a finite non-negative number`);
  }

  return BigInt(Math.floor(value));
}

export function resolveCancellationTier(minutesBeforeStart: number): {
  tier: CancellationTier;
  slashBasisPoints: number;
} {
  if (!Number.isFinite(minutesBeforeStart)) {
    return { tier: 'full_slash', slashBasisPoints: 10_000 };
  }

  if (minutesBeforeStart >= 120) {
    return { tier: 'full_refund', slashBasisPoints: 0 };
  }

  if (minutesBeforeStart >= 30) {
    return { tier: 'partial_slash', slashBasisPoints: 2_500 };
  }

  return { tier: 'full_slash', slashBasisPoints: 10_000 };
}

export function settleBookingDeposit(
  input: DepositSettlementInput
): DepositSettlementResult {
  if (!input.bookingId || typeof input.bookingId !== 'string') {
    throw new Error('bookingId is required');
  }

  const depositLamports = normalizeNonNegativeBigInt(
    input.depositLamports,
    'depositLamports'
  );

  if (
    !Number.isFinite(input.sessionStartUnixMs) ||
    !Number.isFinite(input.cancelledAtUnixMs)
  ) {
    throw new RangeError('Timestamps must be finite numbers');
  }

  const safeDurationMinutes =
    input.sessionDurationMinutes === undefined
      ? 60
      : Number.isFinite(input.sessionDurationMinutes) &&
        input.sessionDurationMinutes >= 0
      ? input.sessionDurationMinutes
      : 0;

  const safeFeeBps =
    input.protocolFeeBps === undefined
      ? 500
      : Number.isFinite(input.protocolFeeBps) &&
        input.protocolFeeBps >= 0 &&
        input.protocolFeeBps <= 10_000
      ? Math.floor(input.protocolFeeBps)
      : 0;

  const rawMinutesBeforeStart =
    safeDurationMinutes === 0
      ? 0
      : (input.sessionStartUnixMs - input.cancelledAtUnixMs) / 60_000;
  const minutesBeforeStart = Math.round(rawMinutesBeforeStart * 100) / 100;

  const { tier, slashBasisPoints } =
    resolveCancellationTier(minutesBeforeStart);

  const slashBpsBig = BigInt(slashBasisPoints);
  const feeBpsBig = BigInt(safeFeeBps);

  const slashedLamports = (depositLamports * slashBpsBig) / BPS_DENOMINATOR;
  const refundLamports = depositLamports - slashedLamports;

  const protocolFeeLamports = (slashedLamports * feeBpsBig) / BPS_DENOMINATOR;
  const hostPayoutLamports = slashedLamports - protocolFeeLamports;

  const ledgerEntries: BookingLedgerLineItem[] = [
    {
      entryId: `${input.bookingId}:hold`,
      bookingId: input.bookingId,
      type: 'deposit_hold',
      lamports: depositLamports,
      recipient: 'escrow',
      memo: `Initial deposit hold (${tier})`,
    },
    {
      entryId: `${input.bookingId}:refund`,
      bookingId: input.bookingId,
      type: 'nomad_refund',
      lamports: refundLamports,
      recipient: 'nomad',
      memo: `Nomad refund (${slashBasisPoints} bps slashed)`,
    },
    {
      entryId: `${input.bookingId}:host`,
      bookingId: input.bookingId,
      type: 'host_payout',
      lamports: hostPayoutLamports,
      recipient: 'host',
      memo: `Host cancellation/no-show payout`,
    },
    {
      entryId: `${input.bookingId}:fee`,
      bookingId: input.bookingId,
      type: 'protocol_fee',
      lamports: protocolFeeLamports,
      recipient: 'treasury',
      memo: `Protocol fee (${safeFeeBps} bps on slashed amount)`,
    },
  ];

  return {
    bookingId: input.bookingId,
    tier,
    slashBasisPoints,
    minutesBeforeStart,
    depositLamports,
    slashedLamports,
    refundLamports,
    hostPayoutLamports,
    protocolFeeLamports,
    ledgerEntries,
  };
}
