import { describe, it, expect } from 'vitest';
import {
  VerifiableMultiPartyAggregation,
  MPAFieldMath,
  MPA_PRIME,
} from '../../core/crypto/VerifiableMultiPartyAggregation';

describe('VerifiableMultiPartyAggregation', () => {
  const aggregator = new VerifiableMultiPartyAggregation();
  const { privateKey, publicKey } = aggregator.generateKeypair();

  it('performs accurate modular arithmetic', () => {
    const a = 123456789n;
    const invA = MPAFieldMath.inv(a);
    expect(MPAFieldMath.mul(a, invA)).toBe(1n);
  });

  it('encrypts inputs, verifies NIZK proofs, homomorphically aggregates, and verifies sum', () => {
    // 3 participants with private votes/metrics: 15, 25, 60 -> Sum = 100
    const values = [15n, 25n, 60n];
    const inputs = values.map((val, idx) =>
      aggregator.encryptInput(`user_${idx + 1}`, val, publicKey)
    );

    // Verify all individual NIZK proofs
    for (const input of inputs) {
      expect(aggregator.verifyParticipantInput(input, publicKey)).toBe(true);
    }

    // Aggregator computes homomorphic sum
    const aggregate = aggregator.aggregateCiphertexts(inputs, publicKey);
    expect(aggregate.participantCount).toBe(3);

    // Decrypt and verify against claimedSum = 100
    const result = aggregator.decryptAndVerifyAggregate(aggregate, privateKey, 100n);
    expect(result.isValid).toBe(true);
    expect(result.claimedSum).toBe(100n);
  });

  it('rejects participant inputs with tampered zero-knowledge proofs', () => {
    const input = aggregator.encryptInput('user_bad', 42n, publicKey);

    const tamperedInput = {
      ...input,
      proof: {
        ...input.proof,
        responseX: MPAFieldMath.add(input.proof.responseX, 1n),
      },
    };

    expect(aggregator.verifyParticipantInput(tamperedInput, publicKey)).toBe(false);
  });

  it('rejects false aggregate claims', () => {
    const inputs = [
      aggregator.encryptInput('u1', 10n, publicKey),
      aggregator.encryptInput('u2', 20n, publicKey),
    ];
    const aggregate = aggregator.aggregateCiphertexts(inputs, publicKey);

    // Actual sum is 30, test with false claim 99
    const result = aggregator.decryptAndVerifyAggregate(aggregate, privateKey, 99n);
    expect(result.isValid).toBe(false);
  });
});
