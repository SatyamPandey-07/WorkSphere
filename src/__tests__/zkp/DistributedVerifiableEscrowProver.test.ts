import { describe, it, expect } from 'vitest';
import { DistributedVerifiableEscrowProver } from '../../core/zkp/DistributedVerifiableEscrowProver';

describe('DistributedVerifiableEscrowProver', () => {
  const escrow = new DistributedVerifiableEscrowProver();

  it('executes trustless adaptor-signature fair exchange and atomically unlocks the escrowed asset', () => {
    const buyer = escrow.generatePartyKey('buyer-alice');
    const secretPayload = 'LICENSE-KEY-WORKSPHERE-ENTERPRISE-2026';
    const locked = escrow.lockSecretAsset('asset-001', secretPayload);

    const preSig = escrow.createPreSignature('escrow-01', buyer, locked.statementT, 'pay:buyer->seller:500');
    expect(escrow.verifyPreSignature(preSig)).toBe(true);

    const finalSig = escrow.adaptPreSignature(preSig, locked.secretT);
    expect(escrow.verifyFinalSignature(finalSig)).toBe(true);

    const unlocked = escrow.extractWitnessAndUnlockAsset(
      preSig,
      finalSig,
      locked.witnessId,
      locked.encryptedAssetHex,
      locked.assetMacHex
    );
    expect(unlocked.valid).toBe(true);
    expect(unlocked.extractedT).toBe(locked.secretT);
    expect(unlocked.decryptedAsset).toBe(secretPayload);
  });

  it('verifies two-way atomic swaps, rejects forged pre-signatures, and round-trips serialization', () => {
    const alice = escrow.generatePartyKey('alice');
    const bob = escrow.generatePartyKey('bob');
    const locked = escrow.lockSecretAsset('swap-secret', 'atomic-swap-token');

    const preA = escrow.createPreSignature('swap-A', alice, locked.statementT, 'leg-A:alice->bob');
    const preB = escrow.createPreSignature('swap-B', bob, locked.statementT, 'leg-B:bob->alice');
    const finA = escrow.adaptPreSignature(preA, locked.secretT);
    const finB = escrow.adaptPreSignature(preB, locked.secretT);

    const swapAudit = escrow.verifyAtomicSwapPair(
      { preSig: preA, finalSig: finA },
      { preSig: preB, finalSig: finB }
    );
    expect(swapAudit.valid).toBe(true);
    expect(swapAudit.sharedWitnessT).toBe(locked.secretT);

    expect(escrow.verifyPreSignature({ ...preA, sHat: preA.sHat + 1n })).toBe(false);
    expect(() => escrow.adaptPreSignature(preA, locked.secretT + 1n)).toThrow();

    const json = escrow.serializePreSignature(preA);
    const restored = escrow.deserializePreSignature(json);
    expect(restored).toEqual(preA);
    expect(escrow.verifyPreSignature(restored)).toBe(true);
  });
});
