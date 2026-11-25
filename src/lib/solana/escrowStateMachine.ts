export type EscrowLifecycleState =
  | 'pending'
  | 'funded'
  | 'disputed'
  | 'partially_refunded'
  | 'released'
  | 'refunded';

export const ALLOWED_ESCROW_TRANSITIONS: Record<
  EscrowLifecycleState,
  readonly EscrowLifecycleState[]
> = {
  pending: ['funded', 'refunded'],
  funded: ['disputed', 'released', 'refunded'],
  disputed: ['partially_refunded', 'released', 'refunded'],
  partially_refunded: [],
  released: [],
  refunded: [],
};

export class EscrowTransitionError extends Error {
  public readonly fromState: EscrowLifecycleState;
  public readonly toState: EscrowLifecycleState;
  public readonly code = 'ILLEGAL_ESCROW_TRANSITION';

  constructor(
    fromState: EscrowLifecycleState,
    toState: EscrowLifecycleState,
    message?: string
  ) {
    super(
      message ??
        `Illegal escrow state transition from "${fromState}" to "${toState}"`
    );
    this.name = 'EscrowTransitionError';
    this.fromState = fromState;
    this.toState = toState;
  }
}

export function canTransitionEscrow(
  fromState: EscrowLifecycleState,
  toState: EscrowLifecycleState
): boolean {
  return ALLOWED_ESCROW_TRANSITIONS[fromState].includes(toState);
}

export function assertEscrowTransition(
  fromState: EscrowLifecycleState,
  toState: EscrowLifecycleState
): void {
  if (!canTransitionEscrow(fromState, toState)) {
    throw new EscrowTransitionError(fromState, toState);
  }
}

export interface LamportSplitResult {
  totalLamports: bigint;
  nomadRefundLamports: bigint;
  venuePayoutLamports: bigint;
  refundBasisPoints: number;
}

export function calculateProratedLamportSplit(
  totalLamportsInput: bigint | number,
  refundBasisPoints: number
): LamportSplitResult {
  const totalLamports =
    typeof totalLamportsInput === 'bigint'
      ? totalLamportsInput
      : BigInt(Math.max(0, Math.floor(totalLamportsInput)));

  if (totalLamports < 0n) {
    throw new RangeError('totalLamports cannot be negative');
  }

  if (
    !Number.isFinite(refundBasisPoints) ||
    refundBasisPoints < 0 ||
    refundBasisPoints > 10_000
  ) {
    throw new RangeError('refundBasisPoints must be between 0 and 10000');
  }

  const bpsBig = BigInt(Math.floor(refundBasisPoints));
  const nomadRefundLamports = (totalLamports * bpsBig) / 10_000n;
  const venuePayoutLamports = totalLamports - nomadRefundLamports;

  return {
    totalLamports,
    nomadRefundLamports,
    venuePayoutLamports,
    refundBasisPoints: Number(bpsBig),
  };
}

export function calculateSessionOutageSplit(
  totalLamportsInput: bigint | number,
  totalSessionMinutes: number,
  unusedOrInterruptedMinutes: number
): LamportSplitResult {
  if (!Number.isFinite(totalSessionMinutes) || totalSessionMinutes <= 0) {
    return calculateProratedLamportSplit(totalLamportsInput, 10_000);
  }
  const clampedUnused = Math.min(
    totalSessionMinutes,
    Math.max(0, unusedOrInterruptedMinutes)
  );
  const bps = Math.floor((clampedUnused * 10_000) / totalSessionMinutes);
  return calculateProratedLamportSplit(totalLamportsInput, bps);
}

export interface AutoRefundCheckInput {
  state: EscrowLifecycleState;
  fundedAtUnixSeconds: number;
  gracePeriodSeconds: number;
  hostCheckedIn: boolean;
  nowUnixSeconds?: number;
}

export function isAutoRefundEligible(input: AutoRefundCheckInput): boolean {
  if (input.state !== 'funded') return false;
  if (input.hostCheckedIn) return false;
  const nowSec = input.nowUnixSeconds ?? Math.floor(Date.now() / 1000);
  const deadlineSec =
    input.fundedAtUnixSeconds + Math.max(0, input.gracePeriodSeconds);
  return nowSec >= deadlineSec;
}

export interface EscrowRecord {
  escrowId: string;
  state: EscrowLifecycleState;
  totalLamports: bigint;
  nomadRefundLamports: bigint;
  venuePayoutLamports: bigint;
  fundedAtUnixSeconds: number;
  gracePeriodSeconds: number;
  hostCheckedIn: boolean;
  disputeReason?: string;
  updatedAtUnixSeconds: number;
}

export function transitionEscrowRecord(
  record: EscrowRecord,
  nextState: EscrowLifecycleState,
  options: {
    refundBasisPoints?: number;
    disputeReason?: string;
    nowUnixSeconds?: number;
  } = {}
): EscrowRecord {
  assertEscrowTransition(record.state, nextState);

  const nowSec = options.nowUnixSeconds ?? Math.floor(Date.now() / 1000);
  let nomadRefundLamports = record.nomadRefundLamports;
  let venuePayoutLamports = record.venuePayoutLamports;

  if (nextState === 'refunded') {
    const split = calculateProratedLamportSplit(record.totalLamports, 10_000);
    nomadRefundLamports = split.nomadRefundLamports;
    venuePayoutLamports = split.venuePayoutLamports;
  } else if (nextState === 'released') {
    const split = calculateProratedLamportSplit(record.totalLamports, 0);
    nomadRefundLamports = split.nomadRefundLamports;
    venuePayoutLamports = split.venuePayoutLamports;
  } else if (nextState === 'partially_refunded') {
    const split = calculateProratedLamportSplit(
      record.totalLamports,
      options.refundBasisPoints ?? 5_000
    );
    nomadRefundLamports = split.nomadRefundLamports;
    venuePayoutLamports = split.venuePayoutLamports;
  }

  return {
    ...record,
    state: nextState,
    nomadRefundLamports,
    venuePayoutLamports,
    disputeReason: options.disputeReason ?? record.disputeReason,
    updatedAtUnixSeconds: nowSec,
  };
}
