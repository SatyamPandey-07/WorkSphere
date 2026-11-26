import { describe, it, expect } from 'vitest';
import {
  ThresholdDecryptionVerifiableBuffer,
  BufferFieldMath,
  BUFFER_PRIME,
  BUFFER_GENERATOR,
} from '../../core/crypto/ThresholdDecryptionVerifiableBuffer';

describe('ThresholdDecryptionVerifiableBuffer', () => {
  // Setup (3, 5) threshold parameters
  const threshold = 3;
  const totalParties = 5;

  // Polynomial f(x) = s + a1 * x + a2 * x^2 (mod p)
  const masterSecret = 133742n;
  const a1 = 54321n;
  const a2 = 98765n;

  const f = (x: bigint) => {
    return BufferFieldMath.add(
      masterSecret,
      BufferFieldMath.add(
        BufferFieldMath.mul(a1, x, BUFFER_PRIME),
        BufferFieldMath.mul(a2, BufferFieldMath.mul(x, x, BUFFER_PRIME), BUFFER_PRIME),
        BUFFER_PRIME
      ),
      BUFFER_PRIME
    );
  };

  const secretShares = new Map<number, bigint>();
  const partyPublicKeys = new Map<number, bigint>();

  for (let i = 1; i <= totalParties; i++) {
    const s_i = f(BigInt(i));
    secretShares.set(i, s_i);
    partyPublicKeys.set(i, BufferFieldMath.mul(s_i, BUFFER_GENERATOR, BUFFER_PRIME));
  }

  const networkPublicKey = BufferFieldMath.mul(masterSecret, BUFFER_GENERATOR, BUFFER_PRIME);

  const bufferEngine = new ThresholdDecryptionVerifiableBuffer({
    threshold,
    totalParties,
    networkPublicKey,
    partyPublicKeys,
  });

  it('correctly enqueues encrypted transactions', () => {
    // Encrypt message M = 999999n with ephemeral random r = 888n
    const m = 999999n;
    const r = 888n;
    const c1 = BufferFieldMath.mul(r, BUFFER_GENERATOR, BUFFER_PRIME);
    const c2 = BufferFieldMath.add(m, BufferFieldMath.mul(r, networkPublicKey, BUFFER_PRIME), BUFFER_PRIME);

    const entry = bufferEngine.enqueueEncryptedEntry('tx-001', c1, c2, 1, 10);
    expect(entry.entryId).toBe('tx-001');
    expect(entry.isDecrypted).toBe(false);
  });

  it('generates, verifies DLEQ proofs, and reconstructs decrypted payload', () => {
    const m = 555666777n;
    const r = 777111n;
    const c1 = BufferFieldMath.mul(r, BUFFER_GENERATOR, BUFFER_PRIME);
    const c2 = BufferFieldMath.add(m, BufferFieldMath.mul(r, networkPublicKey, BUFFER_PRIME), BUFFER_PRIME);

    bufferEngine.enqueueEncryptedEntry('tx-002', c1, c2, 1, 5);

    // Collect shares from parties 1, 3, 5 (threshold = 3)
    const activeParties = [1, 3, 5];
    for (let idx = 0; idx < activeParties.length; idx++) {
      const pIdx = activeParties[idx];
      const s_i = secretShares.get(pIdx)!;
      const share = bufferEngine.createDecryptionShare(pIdx, s_i, 'tx-002', c1);

      const submitRes = bufferEngine.submitDecryptionShare('tx-002', share);
      expect(submitRes.success).toBe(true);

      if (idx < threshold - 1) {
        expect(submitRes.canDecrypt).toBe(false);
      } else {
        expect(submitRes.canDecrypt).toBe(true);
      }
    }

    const decrypted = bufferEngine.reconstructDecryptedPayload('tx-002');
    expect(decrypted).toBe(m);
  });

  it('rejects shares with invalid DLEQ proofs', () => {
    const c1 = 12345n;
    const c2 = 67890n;
    bufferEngine.enqueueEncryptedEntry('tx-bad', c1, c2, 1, 1);

    const share = bufferEngine.createDecryptionShare(1, secretShares.get(1)!, 'tx-bad', c1);

    // Tamper with response
    const tamperedShare = {
      ...share,
      proof: {
        ...share.proof,
        response: BufferFieldMath.add(share.proof.response, 1n),
      },
    };

    const res = bufferEngine.submitDecryptionShare('tx-bad', tamperedShare);
    expect(res.success).toBe(false);
    expect(res.reason).toContain('Invalid DLEQ');
  });

  it('drains decrypted entries in strict sequence order', () => {
    const drained = bufferEngine.drainDecryptedBuffer(1);
    expect(drained.length).toBeGreaterThanOrEqual(1);
    expect(drained[0].entryId).toBe('tx-002');
    expect(drained[0].sequenceNumber).toBe(5);
  });
});
