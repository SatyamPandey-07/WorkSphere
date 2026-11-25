import { describe, it, expect } from 'vitest';
import {
  AgentNegotiationProtocol,
  ConcessionStrategy,
  signAgreement,
  type AgentProfile,
  type NegotiationIssue,
} from '../../core/agents/AgentNegotiationProtocol';

describe('AgentNegotiationProtocol (Alternating-Offers Bargaining)', () => {
  const issues: NegotiationIssue[] = [
    {
      name: 'hourlyRate',
      min: 50,
      max: 150,
      weightA: 0.6,
      weightB: 0.6,
      preferenceA: 'MAX', // Seller wants higher rate
      preferenceB: 'MIN', // Buyer wants lower rate
    },
    {
      name: 'responseTimeHours',
      min: 1,
      max: 24,
      weightA: 0.4,
      weightB: 0.4,
      preferenceA: 'MAX', // Seller wants more time
      preferenceB: 'MIN', // Buyer wants faster response
    },
  ];

  const seller: AgentProfile = {
    agentId: 'agent_seller',
    reservationUtility: 0.3,
    strategy: ConcessionStrategy.LINEAR,
    privateSecret: 'seller_secret_key_1',
  };

  const buyer: AgentProfile = {
    agentId: 'agent_buyer',
    reservationUtility: 0.3,
    strategy: ConcessionStrategy.CONCEDER,
    privateSecret: 'buyer_secret_key_2',
  };

  describe('Utility & Concession Curves', () => {
    it('computes opposing utilities correctly', () => {
      const protocol = new AgentNegotiationProtocol('sess_01', seller, buyer, issues);

      // Max seller values: rate = 150, response = 24
      const bestForSeller = { hourlyRate: 150, responseTimeHours: 24 };
      expect(protocol.computeUtility('agent_seller', bestForSeller)).toBe(1.0);
      expect(protocol.computeUtility('agent_buyer', bestForSeller)).toBe(0.0);

      // Balanced values: rate = 100, response = 12.5
      const middle = { hourlyRate: 100, responseTimeHours: 12.5 };
      expect(protocol.computeUtility('agent_seller', middle)).toBeCloseTo(0.5, 1);
      expect(protocol.computeUtility('agent_buyer', middle)).toBeCloseTo(0.5, 1);
    });

    it('evaluates different concession strategies', () => {
      const protocol = new AgentNegotiationProtocol('sess_02', seller, buyer, issues);
      const boulwareAgent: AgentProfile = {
        agentId: 'boulware',
        reservationUtility: 0.2,
        strategy: ConcessionStrategy.BOULWARE,
        privateSecret: 's',
      };
      const concederAgent: AgentProfile = {
        agentId: 'conceder',
        reservationUtility: 0.2,
        strategy: ConcessionStrategy.CONCEDER,
        privateSecret: 's',
      };

      // In early round 2/20: Boulware stays much higher target utility than Conceder
      const targetBoulware = protocol.computeTargetUtility(boulwareAgent, 2);
      const targetConceder = protocol.computeTargetUtility(concederAgent, 2);
      expect(targetBoulware).toBeGreaterThan(targetConceder);
    });
  });

  describe('Negotiation Session & Cryptographic Signatures', () => {
    it('successfully reaches agreement and generates mutual cryptographic signatures', () => {
      const protocol = new AgentNegotiationProtocol('sess_agree', seller, buyer, issues, 15);
      const outcome = protocol.runNegotiation();

      expect(outcome.status).toBe('AGREEMENT');
      expect(outcome.agreement).toBeDefined();
      expect(outcome.totalRounds).toBeLessThanOrEqual(15);

      const ag = outcome.agreement!;
      expect(ag.utilityA).toBeGreaterThanOrEqual(seller.reservationUtility);
      expect(ag.utilityB).toBeGreaterThanOrEqual(buyer.reservationUtility);

      // Verify mutual cryptographic signatures
      const expectedSigA = signAgreement(
        seller.agentId,
        'sess_agree',
        ag.agreedValues,
        seller.privateSecret
      );
      const expectedSigB = signAgreement(
        buyer.agentId,
        'sess_agree',
        ag.agreedValues,
        buyer.privateSecret
      );

      expect(ag.signatureA).toBe(expectedSigA);
      expect(ag.signatureB).toBe(expectedSigB);
    });

    it('terminates in disagreement when reservation points are mutually impossible', () => {
      const stubbornSeller: AgentProfile = {
        agentId: 'stubborn_seller',
        reservationUtility: 0.9,
        strategy: ConcessionStrategy.BOULWARE,
        privateSecret: 'sec_s',
      };
      const stubbornBuyer: AgentProfile = {
        agentId: 'stubborn_buyer',
        reservationUtility: 0.9,
        strategy: ConcessionStrategy.BOULWARE,
        privateSecret: 'sec_b',
      };

      const protocol = new AgentNegotiationProtocol(
        'sess_disagree',
        stubbornSeller,
        stubbornBuyer,
        issues,
        6
      );
      const outcome = protocol.runNegotiation();

      expect(outcome.status).toBe('DISAGREEMENT');
      expect(outcome.agreement).toBeUndefined();
    });

    it('computes Nash Bargaining Solution (NBS) maximizing surplus', () => {
      const protocol = new AgentNegotiationProtocol('sess_nbs', seller, buyer, issues);
      const nbs = protocol.computeNashBargainingSolution();

      expect(nbs.nashProduct).toBeGreaterThan(0);
      expect(nbs.optimalValues.hourlyRate).toBeDefined();
    });
  });
});
