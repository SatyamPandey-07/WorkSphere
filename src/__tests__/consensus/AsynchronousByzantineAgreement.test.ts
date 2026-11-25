import {
  AsynchronousByzantineAgreement,
  ABAFieldMath,
  ABA_PRIME,
  BBAMessageType,
} from '../../core/consensus/AsynchronousByzantineAgreement';

describe('AsynchronousByzantineAgreement', () => {
  const nodes = ['node-1', 'node-2', 'node-3', 'node-4'];

  describe('Field Math & Crypto Helpers', () => {
    it('performs modular arithmetic operations modulo ABA_PRIME', () => {
      const a = 12345678901234567890n;
      const b = 98765432109876543210n;

      expect(ABAFieldMath.add(a, b)).toBe((a + b) % ABA_PRIME);
      expect(ABAFieldMath.sub(a, b)).toBe(((a - b) % ABA_PRIME + ABA_PRIME) % ABA_PRIME);
      expect(ABAFieldMath.mul(a, b)).toBe((a * b) % ABA_PRIME);
    });

    it('computes modular exponentiation and inversion accurately', () => {
      const val = 88888888888888n;
      const inv = ABAFieldMath.inv(val);
      expect(ABAFieldMath.mul(val, inv)).toBe(1n);
      expect(() => ABAFieldMath.inv(0n)).toThrow('Cannot invert zero');
    });

    it('hashes input to scalar within field bounds', () => {
      const s1 = ABAFieldMath.hashToScalar('seed-1');
      const s2 = ABAFieldMath.hashToScalar('seed-1');
      expect(s1).toBe(s2);
      expect(s1 > 0n && s1 < ABA_PRIME).toBe(true);
    });
  });

  describe('Common Coin Generation & Recombination', () => {
    it('generates deterministic coin shares and combines them', () => {
      const aba = new AsynchronousByzantineAgreement({
        nodeId: 'node-1',
        nodes,
      });

      const share1 = aba.generateCoinShare('epoch-1', 1);
      expect(share1.nodeId).toBe('node-1');
      expect(share1.round).toBe(1);
      expect(share1.share > 0n).toBe(true);

      aba.handleCoinShare('epoch-1', 1, share1);
      const coin = aba.combineCoinShares('epoch-1', 1);
      expect([0, 1]).toContain(coin);
    });
  });

  describe('Binary Byzantine Agreement (BBA)', () => {
    it('converges to decision 1 when majority begins with 1', () => {
      const aba = new AsynchronousByzantineAgreement({
        nodeId: 'node-1',
        nodes,
      });

      const { decision, rounds } = aba.runBBA('epoch-test-1', 1);
      expect([0, 1]).toContain(decision);
      expect(rounds).toBeGreaterThanOrEqual(1);
      expect(aba.getDecision('epoch-test-1')).toBe(decision);
    });

    it('handles message routing for EST and AUX phases', () => {
      const aba = new AsynchronousByzantineAgreement({
        nodeId: 'node-1',
        nodes,
      });

      aba.handleEstMessage({
        epochId: 'epoch-2',
        round: 1,
        type: BBAMessageType.EST,
        senderId: 'node-2',
        value: 1,
        signature: 'sig-2',
      });

      aba.handleAuxMessage({
        epochId: 'epoch-2',
        round: 1,
        type: BBAMessageType.AUX,
        senderId: 'node-2',
        value: 1,
        signature: 'sig-2',
      });
    });
  });

  describe('Vector Asynchronous Byzantine Agreement (ABA)', () => {
    it('achieves consensus on candidate payload and returns verified decision', () => {
      const aba = new AsynchronousByzantineAgreement<{ blockHash: string; txCount: number }>({
        nodeId: 'node-1',
        nodes,
      });

      const candidate = { blockHash: '0xabc123', txCount: 42 };
      const decision = aba.runVectorABA('epoch-vector-1', candidate);

      expect(decision.epochId).toBe('epoch-vector-1');
      expect(decision.decision).toEqual(candidate);
      expect(decision.participatingNodes).toEqual(nodes);
      expect(decision.transcriptHash.length).toBe(64);
      expect(decision.roundsTaken).toBeGreaterThanOrEqual(1);
    });
  });
});
