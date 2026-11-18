import { SuccinctZKStateRollupProver } from '../../core/zkp/SuccinctZKStateRollupProver';

describe('SuccinctZKStateRollupProver', () => {
  it('proves and verifies batched L2 Merkle state transitions with ZK Pedersen balance conservation', () => {
    const rollup = new SuccinctZKStateRollupProver(4);
    const alice = rollup.generateKeyPair('alice', 'seed-a');
    const bob = rollup.generateKeyPair('bob', 'seed-b');
    const carol = rollup.generateKeyPair('carol', 'seed-c');

    rollup.registerAccount(0, 'alice', alice.publicPoint, 1000n);
    rollup.registerAccount(1, 'bob', bob.publicPoint, 500n);
    rollup.registerAccount(2, 'carol', carol.publicPoint, 250n);

    const tx1 = rollup.signTransfer(alice, 0, 1, 300n, 0, 'n1');
    const tx2 = rollup.signTransfer(bob, 1, 2, 450n, 0, 'n2');
    const tx3 = rollup.signTransfer(alice, 0, 2, 200n, 1, 'n3');

    const proof = rollup.proveBatch('batch-2000', [tx1, tx2, tx3], 'bn-01');
    const verified = rollup.verifyBatch(proof);

    expect(verified.isValid).toBe(true);
    expect(verified.verifiedTransfers).toBe(3);
    expect(verified.conservationValid).toBe(true);
    expect(rollup.getAccount(0)?.balance).toBe(500n);
    expect(rollup.getAccount(1)?.balance).toBe(350n);
    expect(rollup.getAccount(2)?.balance).toBe(900n);
  });

  it('rejects overdrafts, unauthorized transfers, nonce replays, and balance inflation attempts', () => {
    const rollup = new SuccinctZKStateRollupProver(3);
    const alice = rollup.generateKeyPair('alice', 'sa');
    const bob = rollup.generateKeyPair('bob', 'sb');
    rollup.registerAccount(0, 'alice', alice.publicPoint, 100n);
    rollup.registerAccount(1, 'bob', bob.publicPoint, 100n);

    // Overdraft must throw
    const overdraft = rollup.signTransfer(alice, 0, 1, 500n, 0, 'ov');
    expect(() => rollup.proveBatch('b-ov', [overdraft], 'n-ov')).toThrow();

    // Forged signature must throw
    const validTx = rollup.signTransfer(alice, 0, 1, 40n, 0, 'ok');
    expect(() =>
      rollup.proveBatch('b-forged', [{ ...validTx, sigResponseS: validTx.sigResponseS + 1n }], 'nf')
    ).toThrow();

    const proof = rollup.proveBatch('b-ok', [validTx], 'n-ok');
    expect(
      rollup.verifyBatch({
        ...proof,
        conservationProof: {
          ...proof.conservationProof,
          schnorrResponseS: proof.conservationProof.schnorrResponseS + 1n,
        },
      }).isValid
    ).toBe(false);
  });
});
