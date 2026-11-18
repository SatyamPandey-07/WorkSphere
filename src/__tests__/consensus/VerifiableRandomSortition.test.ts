import { describe, it, expect } from 'vitest';
import {
  VerifiableRandomSortition,
  SortitionFieldMath,
} from '../../core/consensus/VerifiableRandomSortition';

describe('VerifiableRandomSortition', () => {
  const sortition = new VerifiableRandomSortition();

  it('produces deterministic VRF outputs and valid O(1) verifiable sortition tickets', () => {
    const holder = sortition.createStakeHolder('validator-alpha', 500, 123456789n);
    const ticket1 = sortition.runSortition(holder, 'epoch_seed_42', 'PROPOSER', 1000, 100);
    const ticket2 = sortition.runSortition(holder, 'epoch_seed_42', 'PROPOSER', 1000, 100);

    // VRF output must be deterministic for identical key, seed, and role
    expect(ticket1.proof.vrfHashHex).toBe(ticket2.proof.vrfHashHex);
    expect(ticket1.selectedSeats).toBe(ticket2.selectedSeats);
    expect(ticket1.selectedSeats).toBeGreaterThan(0);

    const verifyRes = sortition.verifySortitionTicket(ticket1, holder.publicKey, 1000, 100);
    expect(verifyRes.isValid).toBe(true);
    expect(verifyRes.selectedSeats).toBe(ticket1.selectedSeats);
  });

  it('rejects forged seat counts and tampered VRF proofs', () => {
    const holder = sortition.createStakeHolder('validator-beta', 200, 987654321n);
    const ticket = sortition.runSortition(holder, 'seed_99', 'COMMITTEE', 1000, 50);

    // Forged seat count
    const forgedSeats = { ...ticket, selectedSeats: ticket.selectedSeats + 1 };
    expect(sortition.verifySortitionTicket(forgedSeats, holder.publicKey, 1000, 50).isValid).toBe(false);

    // Tampered gamma in VRF proof
    const tamperedProof = {
      ...ticket,
      proof: { ...ticket.proof, gamma: SortitionFieldMath.add(ticket.proof.gamma, 1n) },
    };
    expect(sortition.verifySortitionTicket(tamperedProof, holder.publicKey, 1000, 50).isValid).toBe(false);
  });
});
