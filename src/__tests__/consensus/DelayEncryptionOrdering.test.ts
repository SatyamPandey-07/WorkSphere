import { describe, it, expect } from 'vitest';
import {
  DelayEncryptionOrdering,
} from '../../core/consensus/DelayEncryptionOrdering';

describe('DelayEncryptionOrdering', () => {
  const pipeline = new DelayEncryptionOrdering(32);

  it('encrypts and solves time-lock payload with verified Wesolowski VDF proof', () => {
    const txId = 'tx-order-001';
    const plaintext = JSON.stringify({ action: 'SWAP', amount: 1000, recipient: '0xabc' });

    const encrypted = pipeline.encryptPayload(txId, plaintext, 1);
    expect(encrypted.txId).toBe(txId);
    expect(encrypted.ciphertext).toBeDefined();

    const proof = pipeline.solveAndProve(encrypted);
    expect(proof.txId).toBe(txId);
    expect(proof.decryptedPayload).toBe(plaintext);

    const execResult = pipeline.verifyAndExecute(encrypted, proof);
    expect(execResult.verified).toBe(true);
    expect(execResult.decryptedPayload).toBe(plaintext);
    expect(execResult.sequenceNumber).toBe(1);
  });

  it('rejects tampered proofs with invalid VDF outputs', () => {
    const txId = 'tx-tamper';
    const plaintext = 'TRANSFER 500 ETH';
    const encrypted = pipeline.encryptPayload(txId, plaintext, 5);

    const proof = pipeline.solveAndProve(encrypted);

    // Tamper with output Y
    const tamperedProof = {
      ...proof,
      outputY: (BigInt('0x' + proof.outputY) + 1n).toString(16),
    };

    const res = pipeline.verifyAndExecute(encrypted, tamperedProof);
    expect(res.verified).toBe(false);
  });

  it('processes batches in strictly monotonic sequence order', () => {
    const p1 = pipeline.encryptPayload('tx-1', 'PAYLOAD 1', 10);
    const p2 = pipeline.encryptPayload('tx-2', 'PAYLOAD 2', 20);
    const p3 = pipeline.encryptPayload('tx-3', 'PAYLOAD 3', 30);

    const proof1 = pipeline.solveAndProve(p1);
    const proof2 = pipeline.solveAndProve(p2);
    const proof3 = pipeline.solveAndProve(p3);

    // Pass in reverse sequence order
    const batchResults = pipeline.processOrderedBatch([p3, p1, p2], [proof1, proof2, proof3]);

    expect(batchResults.length).toBe(3);
    expect(batchResults[0].txId).toBe('tx-1');
    expect(batchResults[0].sequenceNumber).toBe(10);
    expect(batchResults[0].verified).toBe(true);

    expect(batchResults[1].txId).toBe('tx-2');
    expect(batchResults[1].sequenceNumber).toBe(20);

    expect(batchResults[2].txId).toBe('tx-3');
    expect(batchResults[2].sequenceNumber).toBe(30);
  });
});
