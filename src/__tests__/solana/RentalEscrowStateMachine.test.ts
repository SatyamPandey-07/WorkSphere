import { describe, it, expect, beforeEach } from 'vitest';
import {
  RentalEscrowStateMachine,
  EscrowState,
  ESCROW_ACCOUNT_SIZE,
} from '../../core/solana/RentalEscrowStateMachine';
import type { RentalEscrowAccount } from '../../core/solana/RentalEscrowStateMachine';

describe('RentalEscrowStateMachine - Solana Program Derived Address Escrow', () => {
  let sm: RentalEscrowStateMachine;

  const renter = 'renter_pubkey_111111111111111111';
  const venue = 'venue_pubkey_222222222222222222';
  const arbiter = 'arbiter_pubkey_33333333333333333';

  beforeEach(() => {
    sm = new RentalEscrowStateMachine(150); // 1.5% protocol fee
  });

  describe('Binary Anchor Serialization & Deserialization', () => {
    it('serializes to exactly 165 bytes and reconstitutes with bitwise accuracy', () => {
      const account: RentalEscrowAccount = {
        renterPubkey: renter,
        venuePubkey: venue,
        arbiterPubkey: arbiter,
        rentalFeeLamports: 5_000_000_000n, // 5 SOL
        securityDepositLamports: 1_000_000_000n, // 1 SOL
        rentalStartTimestamp: 1700000000n,
        rentalDurationSeconds: 86400n,
        state: EscrowState.ACTIVE_RENTAL,
        bumpSeed: 254,
      };

      const bytes = sm.serialize(account);
      expect(bytes.length).toBe(ESCROW_ACCOUNT_SIZE);

      const deserialized = sm.deserialize(bytes);
      expect(deserialized.rentalFeeLamports).toBe(5_000_000_000n);
      expect(deserialized.securityDepositLamports).toBe(1_000_000_000n);
      expect(deserialized.rentalStartTimestamp).toBe(1700000000n);
      expect(deserialized.rentalDurationSeconds).toBe(86400n);
      expect(deserialized.state).toBe(EscrowState.ACTIVE_RENTAL);
      expect(deserialized.bumpSeed).toBe(254);
      expect(deserialized.renterPubkey).toBe(renter);
    });

    it('throws error when deserializing buffer with invalid discriminator', () => {
      const badBuffer = new Uint8Array(ESCROW_ACCOUNT_SIZE);
      expect(() => {
        sm.deserialize(badBuffer);
      }).toThrow('Invalid account discriminator');
    });
  });

  describe('Lifecycle State Machine Transitions', () => {
    it('initializes, activates, and settles normal rental with fee routing', () => {
      const account = sm.initializeEscrow({
        renterPubkey: renter,
        venuePubkey: venue,
        arbiterPubkey: arbiter,
        rentalFeeLamports: 10_000_000_000n, // 10 SOL
        securityDepositLamports: 2_000_000_000n, // 2 SOL
        rentalDurationSeconds: 3600n,
      });

      expect(account.state).toBe(EscrowState.FUNDS_DEPOSITED);

      const active = sm.activateRental(account, 1700000500);
      expect(active.state).toBe(EscrowState.ACTIVE_RENTAL);
      expect(active.rentalStartTimestamp).toBe(1700000500n);

      const settlement = sm.settleRental(active, 1700004100);
      expect(settlement.account.state).toBe(EscrowState.SETTLED);
      // 1.5% fee on 10 SOL = 0.15 SOL = 150,000,000 lamports
      expect(settlement.protocolFeeLamports).toBe(150_000_000n);
      // Venue gets 10 SOL - 0.15 SOL = 9.85 SOL = 9,850,000,000 lamports
      expect(settlement.venuePayoutLamports).toBe(9_850_000_000n);
      // Renter gets full 2 SOL deposit returned
      expect(settlement.renterRefundLamports).toBe(2_000_000_000n);
    });

    it('handles cancellation and full refund from FUNDS_DEPOSITED', () => {
      const account = sm.initializeEscrow({
        renterPubkey: renter,
        venuePubkey: venue,
        arbiterPubkey: arbiter,
        rentalFeeLamports: 4_000_000_000n,
        securityDepositLamports: 1_000_000_000n,
        rentalDurationSeconds: 1800n,
      });

      const refund = sm.refundRental(account);
      expect(refund.account.state).toBe(EscrowState.REFUNDED);
      expect(refund.renterRefundLamports).toBe(5_000_000_000n); // Full 5 SOL
      expect(refund.venuePayoutLamports).toBe(0n);
    });
  });

  describe('2-of-3 Multi-Sig Dispute Resolution', () => {
    it('locks into DISPUTED and resolves with 2-of-3 quorum', () => {
      const account = sm.initializeEscrow({
        renterPubkey: renter,
        venuePubkey: venue,
        arbiterPubkey: arbiter,
        rentalFeeLamports: 6_000_000_000n,
        securityDepositLamports: 2_000_000_000n,
        rentalDurationSeconds: 7200n,
      });
      const active = sm.activateRental(account);

      const disputed = sm.disputeRental(active, renter);
      expect(disputed.state).toBe(EscrowState.DISPUTED);

      // Attempt resolve with single signature -> Fails
      expect(() => {
        sm.resolveDispute(disputed, [arbiter], 4_000_000_000n);
      }).toThrow('Insufficient multi-sig quorum');

      // Resolve with 2 signatures (arbiter + venue) awarding 4 SOL to venue
      const res = sm.resolveDispute(disputed, [arbiter, venue], 4_000_000_000n);
      expect(res.account.state).toBe(EscrowState.SETTLED);
      // Total was 8 SOL; 4 SOL awarded to venue, remaining 4 SOL refunded to renter
      expect(res.renterRefundLamports).toBe(4_000_000_000n);
      // Fee on 4 SOL award: 1.5% = 60,000,000 lamports
      expect(res.protocolFeeLamports).toBe(60_000_000n);
      expect(res.venuePayoutLamports).toBe(3_940_000_000n);
    });
  });

  describe('PDA Derivation', () => {
    it('derives deterministic PDA and bump seed', () => {
      const pda1 = sm.deriveEscrowPDA('prog_worksphere_escrow', renter, venue, 'lease_001');
      const pda2 = sm.deriveEscrowPDA('prog_worksphere_escrow', renter, venue, 'lease_001');

      expect(pda1.pda).toBe(pda2.pda);
      expect(pda1.bump).toBe(pda2.bump);
      expect(pda1.pda).toContain('escrow_');
    });
  });
});
