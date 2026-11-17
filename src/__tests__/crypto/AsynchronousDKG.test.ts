import {
  AsynchronousDKGNode,
  AsynchronousDKGCluster,
  ADKGFieldMath,
  ADKG_PRIME,
} from '../../core/crypto/AsynchronousDKG';

describe('AsynchronousDKG', () => {
  describe('Field Math & Polynomial Share Generation', () => {
    it('performs modular arithmetic mod ADKG_PRIME', () => {
      const a = 12345678901234567890n;
      const b = 98765432109876543210n;
      expect(ADKGFieldMath.add(a, b)).toBe((a + b) % ADKG_PRIME);
      expect(ADKGFieldMath.sub(a, b)).toBe(((a - b) % ADKG_PRIME + ADKG_PRIME) % ADKG_PRIME);
      expect(ADKGFieldMath.mul(a, b)).toBe((a * b) % ADKG_PRIME);
    });

    it('generates verifiable dealer contribution and validates shares', () => {
      const node = new AsynchronousDKGNode(1, 4, 2);
      const contrib = node.generateContribution();

      expect(contrib.dealerId).toBe(1);
      expect(contrib.commitments.length).toBe(2);
      expect(contrib.shares.length).toBe(4);

      // Verify share for self
      expect(node.verifyShare(contrib.shares[0], contrib.commitments)).toBe(true);

      // Verify share for peer
      const peer = new AsynchronousDKGNode(2, 4, 2);
      expect(peer.verifyShare(contrib.shares[1], contrib.commitments)).toBe(true);
    });

    it('rejects tampered or forged shares', () => {
      const node1 = new AsynchronousDKGNode(1, 4, 2);
      const node2 = new AsynchronousDKGNode(2, 4, 2);

      const contrib = node1.generateContribution();
      const tampered = {
        ...contrib.shares[1],
        shareS: contrib.shares[1].shareS + 1n,
      };

      expect(node2.verifyShare(tampered, contrib.commitments)).toBe(false);
    });
  });

  describe('Leaderless Asynchronous DKG Protocol Execution', () => {
    it('successfully runs A-DKG across 4 nodes with threshold 2', () => {
      const cluster = new AsynchronousDKGCluster(4, 2);
      const result = cluster.runDKG();

      expect(result.totalNodes).toBe(4);
      expect(result.threshold).toBe(2);
      expect(result.coreDealers.length).toBe(3); // n - f = 4 - 1 = 3
      expect(result.nodeShares.size).toBe(4);

      // Reconstruct master secret from subset 1 (nodes 1 & 2)
      const subset1 = [result.nodeShares.get(1)!, result.nodeShares.get(2)!];
      const rec1 = cluster.reconstructMasterSecret(subset1, 2);

      // Reconstruct master secret from subset 2 (nodes 2 & 4)
      const subset2 = [result.nodeShares.get(2)!, result.nodeShares.get(4)!];
      const rec2 = cluster.reconstructMasterSecret(subset2, 2);

      expect(rec1.secret).toBe(rec2.secret);
      expect(rec1.blinding).toBe(rec2.blinding);

      // Verify commitment match: masterPublicKey == secret * G + blinding * H
      const expectedPK = ADKGFieldMath.add(
        ADKGFieldMath.mul(rec1.secret, cluster.nodes.get(1)!.g, ADKG_PRIME),
        ADKGFieldMath.mul(rec1.blinding, cluster.nodes.get(1)!.h, ADKG_PRIME),
        ADKG_PRIME
      );
      expect(result.masterPublicKey).toBe(expectedPK);
    });
  });
});
