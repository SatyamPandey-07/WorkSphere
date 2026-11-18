import { describe, it, expect } from 'vitest';
import { VerifiableCommitRevealLotteryProver } from '../../core/zkp/VerifiableCommitRevealLotteryProver';

describe('VerifiableCommitRevealLotteryProver', () => {
  const lottery = new VerifiableCommitRevealLotteryProver();

  it('settles a fair commit-reveal lottery, slashes non-revealers/cheaters, and audits receipts', () => {
    const p1 = lottery.createCommitment('lot-1', 'alice', 100n);
    const p2 = lottery.createCommitment('lot-1', 'bob', 150n);
    const p3 = lottery.createCommitment('lot-1', 'carol', 200n);
    const p4 = lottery.createCommitment('lot-1', 'dave-aborts', 300n);
    const p5 = lottery.createCommitment('lot-1', 'eve-cheats', 250n);

    const commits = [p1, p2, p3, p4, p5].map((p) => p.publicCommit);
    const reveals = [
      lottery.createReveal(p1.secret),
      lottery.createReveal(p2.secret),
      lottery.createReveal(p3.secret),
      // dave-aborts withholds reveal
      { ...lottery.createReveal(p5.secret), secretSeedHex: 'ff'.repeat(32) }, // eve-cheats alters seed
    ];

    const receipt = lottery.settleLotteryRound('lot-1', commits, reveals, 2);
    expect(receipt.honestParticipants).toEqual(['alice', 'bob', 'carol']);
    expect(receipt.slashedParticipants).toHaveLength(2);
    expect(receipt.totalSlashedPool).toBe(550n);
    expect(receipt.selectedWinners).toHaveLength(2);
    expect(lottery.verifySettlementReceipt(receipt, commits, reveals, 2)).toBe(true);
    expect(lottery.verifySettlementReceipt({ ...receipt, totalSlashedPool: 500n }, commits, reveals, 2)).toBe(false);

    const json = lottery.serializeReceipt(receipt);
    const restored = lottery.deserializeReceipt(json);
    expect(restored).toEqual(receipt);
    expect(lottery.verifySettlementReceipt(restored, commits, reveals, 2)).toBe(true);
  });
});
