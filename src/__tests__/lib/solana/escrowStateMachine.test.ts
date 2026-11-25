import {
  calculateProratedLamportSplit,
  calculateSessionOutageSplit,
  EscrowTransitionError,
  isAutoRefundEligible,
  transitionEscrowRecord,
  type EscrowRecord,
} from '@/lib/solana/escrowStateMachine';
import { SolanaEscrowClient } from '@/lib/solana/escrowClient';

describe('Solana Escrow State Machine & Idempotent Settlement', () => {
  const baseEscrow: EscrowRecord = {
    escrowId: 'escrow-901',
    state: 'funded',
    totalLamports: 1_000_000_003n,
    nomadRefundLamports: 0n,
    venuePayoutLamports: 0n,
    fundedAtUnixSeconds: 1_700_000_000,
    gracePeriodSeconds: 900,
    hostCheckedIn: false,
    updatedAtUnixSeconds: 1_700_000_000,
  };

  it('enforces valid state transitions and throws EscrowTransitionError on illegal transitions', () => {
    const disputed = transitionEscrowRecord(baseEscrow, 'disputed', {
      disputeReason: 'Venue router offline',
    });
    expect(disputed.state).toBe('disputed');

    const partial = transitionEscrowRecord(disputed, 'partially_refunded', {
      refundBasisPoints: 4_000,
    });
    expect(partial.state).toBe('partially_refunded');

    expect(() => transitionEscrowRecord(partial, 'released')).toThrow(
      EscrowTransitionError
    );
    expect(() => transitionEscrowRecord(baseEscrow, 'partially_refunded')).toThrow(
      EscrowTransitionError
    );
  });

  it('conserves exact lamports using BigInt arithmetic with zero rounding drift', () => {
    const split = calculateProratedLamportSplit(1_000_000_003n, 3_333);
    expect(split.nomadRefundLamports + split.venuePayoutLamports).toBe(
      1_000_000_003n
    );

    const outageSplit = calculateSessionOutageSplit(2_500_000_001n, 240, 95);
    expect(
      outageSplit.nomadRefundLamports + outageSplit.venuePayoutLamports
    ).toBe(2_500_000_001n);
  });

  it('evaluates time-locked grace-period auto-refund eligibility accurately', () => {
    expect(
      isAutoRefundEligible({
        state: 'funded',
        fundedAtUnixSeconds: 1_700_000_000,
        gracePeriodSeconds: 900,
        hostCheckedIn: false,
        nowUnixSeconds: 1_700_000_899,
      })
    ).toBe(false);

    expect(
      isAutoRefundEligible({
        state: 'funded',
        fundedAtUnixSeconds: 1_700_000_000,
        gracePeriodSeconds: 900,
        hostCheckedIn: false,
        nowUnixSeconds: 1_700_000_900,
      })
    ).toBe(true);

    expect(
      isAutoRefundEligible({
        state: 'funded',
        fundedAtUnixSeconds: 1_700_000_000,
        gracePeriodSeconds: 900,
        hostCheckedIn: true,
        nowUnixSeconds: 1_700_001_500,
      })
    ).toBe(false);
  });

  it('deduplicates repeated settlement calls via idempotencyKey', async () => {
    const submitSettlement = jest
      .fn()
      .mockResolvedValue({ txSignature: '5xSolanaSignature123' });

    const client = new SolanaEscrowClient({ submitSettlement }, [baseEscrow]);

    client.openDispute('escrow-901', 'Power outage');

    const first = await client.settleEscrow({
      escrowId: 'escrow-901',
      targetState: 'partially_refunded',
      refundBasisPoints: 5_000,
      idempotencyKey: 'idem-key-001',
    });

    const second = await client.settleEscrow({
      escrowId: 'escrow-901',
      targetState: 'partially_refunded',
      refundBasisPoints: 5_000,
      idempotencyKey: 'idem-key-001',
    });

    expect(submitSettlement).toHaveBeenCalledTimes(1);
    expect(first.deduplicated).toBe(false);
    expect(second.deduplicated).toBe(true);
    expect(second.txSignature).toBe('5xSolanaSignature123');
    expect(
      second.escrow.nomadRefundLamports + second.escrow.venuePayoutLamports
    ).toBe(baseEscrow.totalLamports);
  });
});
