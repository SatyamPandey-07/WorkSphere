import { BLSPoPAggregator } from '../../core/zkp/BLSPoPAggregator';

describe('BLSPoPAggregator', () => {
  it('registers signers via PoP and verifies aggregate signatures across weighted quorum', () => {
    const agg = new BLSPoPAggregator();
    const scalars = [111111n, 222222n, 333333n];
    const ids = ['node-1', 'node-2', 'node-3'];
    const weights = [40n, 35n, 25n];

    const registered = ids.map((id, i) => {
      const pop = agg.createProofOfPossession(id, scalars[i], `reg-${i}`);
      return agg.registerSigner(pop, weights[i]);
    });

    const msgDigest = '0xblock_digest_9001';
    const nonces = ids.map((id, i) => agg.computeNonceCommitment(id, msgDigest, `sess-${i}`));

    const P = 0xffffffffffffffffffffffffffffc3a7n;
    const aggR = nonces.reduce((acc, n) => (acc * n.noncePointR) % P, 1n);
    const aggPub = registered.reduce((acc, r) => (acc * r.publicPoint) % P, 1n);

    const partials = ids.map((id, i) =>
      agg.createPartialSignature(id, scalars[i], nonces[i].nonceScalar, msgDigest, aggR, aggPub)
    );

    const bundle = agg.aggregateSignatures(msgDigest, partials);
    const verified = agg.verifyAggregate(bundle, 75n);
    expect(verified.isValid).toBe(true);
    expect(verified.verifiedSigners).toBe(3);
    expect(verified.totalWeight).toBe(100n);
  });

  it('rejects rogue-key registration with forged Proof-of-Possession', () => {
    const agg = new BLSPoPAggregator();
    const validPop = agg.createProofOfPossession('honest-1', 77777n, 'r0');
    agg.registerSigner(validPop, 50n);

    const forgedPop = {
      ...agg.createProofOfPossession('rogue-1', 88888n, 'r1'),
      responseS: 12345n,
    };
    expect(agg.verifyProofOfPossession(forgedPop)).toBe(false);
    expect(() => agg.registerSigner(forgedPop, 50n)).toThrow();
  });

  it('rejects tampered aggregate signature response', () => {
    const agg = new BLSPoPAggregator();
    const pop = agg.createProofOfPossession('solo-1', 55555n, 'r0');
    const reg = agg.registerSigner(pop, 10n);
    const msg = '0xmsg_01';
    const n = agg.computeNonceCommitment('solo-1', msg, 's0');
    const part = agg.createPartialSignature('solo-1', 55555n, n.nonceScalar, msg, n.noncePointR, reg.publicPoint);
    const bundle = agg.aggregateSignatures(msg, [part]);

    const bad = agg.verifyAggregate({ ...bundle, aggregateResponseS: bundle.aggregateResponseS + 1n });
    expect(bad.isValid).toBe(false);
  });
});
