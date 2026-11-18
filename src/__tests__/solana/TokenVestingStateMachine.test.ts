import { describe, it, expect, beforeEach } from 'vitest';
import {
  TokenVestingStateMachine,
  VestingState,
  VestingCurve,
} from '../../core/solana/TokenVestingStateMachine';

describe('TokenVestingStateMachine - Solana PDA Verifiable Token Vesting', () => {
  let vesting: TokenVestingStateMachine;
  const START = 1700000000000;
  const CLIFF = START + 30 * 24 * 60 * 60 * 1000; // 30 days
  const END = START + 120 * 24 * 60 * 60 * 1000; // 120 days
  const TOTAL = 120_000n * 1_000_000n; // 120k tokens

  beforeEach(() => {
    vesting = new TokenVestingStateMachine({
      scheduleId: 'grant_nomad_dev_01',
      granterAddress: 'dao_treasury_pubkey_112233',
      beneficiaryAddress: 'contributor_alice_pubkey_445566',
      tokenMintAddress: 'work_token_mint_778899',
      totalAmount: TOTAL,
      startTimestamp: START,
      cliffTimestamp: CLIFF,
      endTimestamp: END,
      isRevocable: true,
      curveType: VestingCurve.LINEAR,
    });
  });

  describe('Initialization & PDA Seed Derivation', () => {
    it('initializes schedule and computes deterministic PDA address', () => {
      expect(vesting.pdaAddress).toMatch(/^pda_[a-f0-9]{32}$/);
      expect(vesting.state).toBe(VestingState.ACTIVE);
      expect(vesting.claimedAmount).toBe(0n);
      expect(vesting.clawbackAmount).toBe(0n);
    });

    it('rejects invalid timeline parameters', () => {
      expect(
        () =>
          new TokenVestingStateMachine({
            scheduleId: 'bad_schedule',
            granterAddress: 'g',
            beneficiaryAddress: 'b',
            tokenMintAddress: 'm',
            totalAmount: TOTAL,
            startTimestamp: END, // start > end
            cliffTimestamp: CLIFF,
            endTimestamp: START,
            isRevocable: true,
          })
      ).toThrowError(/startTimestamp must be strictly before endTimestamp/i);
    });
  });

  describe('Cliff & Linear Vesting Progression', () => {
    it('returns 0 vested tokens before cliff timestamp', () => {
      const beforeCliff = START + 15 * 24 * 60 * 60 * 1000; // Day 15
      expect(vesting.getVestedAmount(beforeCliff)).toBe(0n);
      expect(vesting.getClaimableAmount(beforeCliff)).toBe(0n);
    });

    it('unlocks 50% of tokens at midpoint (Day 60)', () => {
      const midpoint = START + 60 * 24 * 60 * 60 * 1000;
      const vested = vesting.getVestedAmount(midpoint);
      expect(vested).toBe(TOTAL / 2n);
      expect(vesting.getClaimableAmount(midpoint)).toBe(TOTAL / 2n);
    });

    it('unlocks 100% of tokens at or after end timestamp', () => {
      expect(vesting.getVestedAmount(END)).toBe(TOTAL);
      expect(vesting.getVestedAmount(END + 100000)).toBe(TOTAL);
    });
  });

  describe('Claim Execution & Access Control', () => {
    it('allows beneficiary to claim unlocked tokens and updates state', () => {
      const midpoint = START + 60 * 24 * 60 * 60 * 1000;
      const receipt = vesting.claim({
        callerAddress: 'contributor_alice_pubkey_445566',
        timestamp: midpoint,
      });

      expect(receipt.claimedAmount).toBe(TOTAL / 2n);
      expect(vesting.claimedAmount).toBe(TOTAL / 2n);
      expect(vesting.getClaimableAmount(midpoint)).toBe(0n);
    });

    it('rejects claim attempts by unauthorized callers', () => {
      const midpoint = START + 60 * 24 * 60 * 60 * 1000;
      expect(() =>
        vesting.claim({
          callerAddress: 'unauthorized_attacker_pubkey',
          timestamp: midpoint,
        })
      ).toThrowError(/not authorized/i);
    });

    it('allows delegated claimer after authorization', () => {
      const midpoint = START + 60 * 24 * 60 * 60 * 1000;
      vesting.addDelegate('contributor_alice_pubkey_445566', 'delegate_manager_pubkey');

      const receipt = vesting.claim({
        callerAddress: 'delegate_manager_pubkey',
        timestamp: midpoint,
      });

      expect(receipt.claimedAmount).toBe(TOTAL / 2n);
    });
  });

  describe('Revocation & Clawback Invariants', () => {
    it('allows granter to revoke schedule, securing accrued tokens and clawing back remainder', () => {
      const midpoint = START + 60 * 24 * 60 * 60 * 1000;
      const receipt = vesting.revoke('dao_treasury_pubkey_112233', midpoint);

      expect(receipt.vestedForBeneficiary).toBe(TOTAL / 2n);
      expect(receipt.clawbackToGranter).toBe(TOTAL / 2n);
      expect(vesting.state).toBe(VestingState.REVOKED);
      expect(vesting.verifyMathematicalInvariant(midpoint)).toBe(true);

      // Beneficiary can still claim their vested portion
      const claimReceipt = vesting.claim({
        callerAddress: 'contributor_alice_pubkey_445566',
        timestamp: midpoint + 1000,
      });
      expect(claimReceipt.claimedAmount).toBe(TOTAL / 2n);
    });
  });
});
