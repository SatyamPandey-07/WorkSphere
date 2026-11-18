import { describe, it, expect } from 'vitest';
import {
  ThresholdBlindSignatures,
  BlindFieldMath,
  BLIND_PRIME,
  BLIND_GENERATOR,
} from '../../core/crypto/ThresholdBlindSignatures';

describe('ThresholdBlindSignatures', () => {
  // Setup (3, 5) threshold blind signing committee
  const threshold = 3;
  const totalSigners = 5;

  // Master secret key S = 888888n
  const masterSecret = 888888n;
  const a1 = 12345n;
  const a2 = 67890n;

  // Polynomial f(X) = masterSecret + a1*X + a2*X^2 mod p
  const f = (x: bigint) => {
    return BlindFieldMath.add(
      masterSecret,
      BlindFieldMath.add(
        BlindFieldMath.mul(a1, x, BLIND_PRIME),
        BlindFieldMath.mul(a2, BlindFieldMath.mul(x, x, BLIND_PRIME), BLIND_PRIME),
        BLIND_PRIME
      ),
      BLIND_PRIME
    );
  };

  const secretShares = new Map<number, bigint>();
  const signerPublicKeys = new Map<number, bigint>();

  for (let i = 1; i <= totalSigners; i++) {
    const s_i = f(BigInt(i));
    secretShares.set(i, s_i);
    signerPublicKeys.set(i, BlindFieldMath.mul(s_i, BLIND_GENERATOR, BLIND_PRIME));
  }

  const groupPublicKey = BlindFieldMath.mul(masterSecret, BLIND_GENERATOR, BLIND_PRIME);

  const coordinator = new ThresholdBlindSignatures({
    threshold,
    totalSigners,
    groupPublicKey,
    signerPublicKeys,
  });

  it('blinds message, issues partial blind signature shares, verifies DLEQ, and unblinds valid signature', () => {
    const message = 'ANONYMOUS_BALLOT_VOTE_CANDIDATE_A';

    // 1. Client blinds message
    const blindRequest = coordinator.blind(message, 'vote_req_01');
    expect(blindRequest.blindedMessage).toBeDefined();
    expect(blindRequest.blindingFactor).toBeDefined();

    // 2. Signers 1, 2, 4 issue blind signature shares with DLEQ proof
    const activeSigners = [1, 2, 4];
    const shares = activeSigners.map((idx) => {
      const s_i = secretShares.get(idx)!;
      return coordinator.signBlindShare(idx, s_i, blindRequest.blindedMessage, blindRequest.requestId);
    });

    // 3. Client verifies each blind share against signer's PK
    for (const share of shares) {
      const isValid = coordinator.verifyBlindShare(share, blindRequest.blindedMessage);
      expect(isValid).toBe(true);
    }

    // 4. Client recombines threshold shares and unblinds signature
    const unblindedSig = coordinator.recombineAndUnblind(
      shares,
      blindRequest.blindingFactor,
      message
    );

    expect(unblindedSig.message).toBe(message);

    // 5. Anyone verifies unblinded signature under group public key
    const isSigValid = coordinator.verifyUnblindedSignature(unblindedSig);
    expect(isSigValid).toBe(true);
  });

  it('rejects tampered partial blind shares', () => {
    const message = 'TOKEN_MINT_REQUEST';
    const req = coordinator.blind(message, 'mint_req_01');
    const share = coordinator.signBlindShare(1, secretShares.get(1)!, req.blindedMessage, req.requestId);

    // Tamper with blind share
    const tamperedShare = {
      ...share,
      blindShare: BlindFieldMath.add(share.blindShare, 1n),
    };

    expect(coordinator.verifyBlindShare(tamperedShare, req.blindedMessage)).toBe(false);
  });

  it('rejects unblinded signatures when message is modified', () => {
    const message = 'ORIGINAL_PROPOSAL';
    const req = coordinator.blind(message, 'prop_01');
    const shares = [1, 3, 5].map((idx) =>
      coordinator.signBlindShare(idx, secretShares.get(idx)!, req.blindedMessage, req.requestId)
    );

    const unblindedSig = coordinator.recombineAndUnblind(shares, req.blindingFactor, message);

    // Tamper with message in unblinded signature
    const tamperedSig = {
      ...unblindedSig,
      message: 'FORGED_PROPOSAL',
    };

    expect(coordinator.verifyUnblindedSignature(tamperedSig)).toBe(false);
  });
});
