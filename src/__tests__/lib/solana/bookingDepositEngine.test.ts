import {
  resolveCancellationTier,
  settleBookingDeposit,
} from '@/lib/solana/bookingDepositEngine';

describe('Booking Deposit Hold, Tiered Slashing & BigInt Ledger', () => {
  const baseStartMs = 1_700_010_000_000;

  it('resolves cancellation tiers across exact boundary windows', () => {
    expect(resolveCancellationTier(120)).toEqual({
      tier: 'full_refund',
      slashBasisPoints: 0,
    });
    expect(resolveCancellationTier(119.99)).toEqual({
      tier: 'partial_slash',
      slashBasisPoints: 2_500,
    });
    expect(resolveCancellationTier(30)).toEqual({
      tier: 'partial_slash',
      slashBasisPoints: 2_500,
    });
    expect(resolveCancellationTier(29.99)).toEqual({
      tier: 'full_slash',
      slashBasisPoints: 10_000,
    });
    expect(resolveCancellationTier(-15)).toEqual({
      tier: 'full_slash',
      slashBasisPoints: 10_000,
    });
  });

  it('conserves exact BigInt lamports across full refund, 25% slash, and 100% no-show slash', () => {
    const primeLamports = 1_000_000_007n;

    const earlyCancel = settleBookingDeposit({
      bookingId: 'bk-early',
      depositLamports: primeLamports,
      sessionStartUnixMs: baseStartMs,
      cancelledAtUnixMs: baseStartMs - 180 * 60_000,
    });
    expect(earlyCancel.tier).toBe('full_refund');
    expect(earlyCancel.refundLamports).toBe(primeLamports);
    expect(earlyCancel.hostPayoutLamports).toBe(0n);
    expect(earlyCancel.protocolFeeLamports).toBe(0n);
    expect(
      earlyCancel.refundLamports +
        earlyCancel.hostPayoutLamports +
        earlyCancel.protocolFeeLamports
    ).toBe(primeLamports);

    const midCancel = settleBookingDeposit({
      bookingId: 'bk-mid',
      depositLamports: primeLamports,
      sessionStartUnixMs: baseStartMs,
      cancelledAtUnixMs: baseStartMs - 45 * 60_000,
      protocolFeeBps: 333,
    });
    expect(midCancel.tier).toBe('partial_slash');
    expect(
      midCancel.refundLamports +
        midCancel.hostPayoutLamports +
        midCancel.protocolFeeLamports
    ).toBe(primeLamports);

    const noShow = settleBookingDeposit({
      bookingId: 'bk-noshow',
      depositLamports: primeLamports,
      sessionStartUnixMs: baseStartMs,
      cancelledAtUnixMs: baseStartMs + 10 * 60_000,
      protocolFeeBps: 500,
    });
    expect(noShow.tier).toBe('full_slash');
    expect(noShow.refundLamports).toBe(0n);
    expect(
      noShow.refundLamports +
        noShow.hostPayoutLamports +
        noShow.protocolFeeLamports
    ).toBe(primeLamports);
    expect(noShow.ledgerEntries).toHaveLength(4);
  });

  it('handles zero-minute sessions safely and rejects negative or invalid inputs', () => {
    const zeroMin = settleBookingDeposit({
      bookingId: 'bk-zero',
      depositLamports: 500_000_000n,
      sessionStartUnixMs: baseStartMs,
      cancelledAtUnixMs: baseStartMs,
      sessionDurationMinutes: 0,
    });
    expect(zeroMin.tier).toBe('full_slash');
    expect(zeroMin.minutesBeforeStart).toBe(0);
    expect(
      zeroMin.refundLamports +
        zeroMin.hostPayoutLamports +
        zeroMin.protocolFeeLamports
    ).toBe(500_000_000n);

    expect(() =>
      settleBookingDeposit({
        bookingId: 'bk-neg',
        depositLamports: -1n,
        sessionStartUnixMs: baseStartMs,
        cancelledAtUnixMs: baseStartMs - 60_000,
      })
    ).toThrow(RangeError);

    expect(() =>
      settleBookingDeposit({
        bookingId: 'bk-neg-num',
        depositLamports: -100,
        sessionStartUnixMs: baseStartMs,
        cancelledAtUnixMs: baseStartMs - 60_000,
      })
    ).toThrow(RangeError);
  });
});
