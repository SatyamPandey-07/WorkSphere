/**
 * @file AgentNegotiationProtocol.ts
 * @description Decentralized multi-agent negotiation protocol with alternating offers (Rubinstein bargaining),
 * monotonic concession curves (Boulware/Conceder), Nash bargaining solutions, and cryptographic agreement signatures.
 */

import { createHash } from 'crypto';

/**
 * Concession strategy curve profiles.
 */
export const ConcessionStrategy = {
  BOULWARE: 'BOULWARE', // beta < 1: firm initially, concedes late
  LINEAR: 'LINEAR', // beta = 1: uniform concession
  CONCEDER: 'CONCEDER', // beta > 1: concedes rapidly upfront
} as const;

export type ConcessionStrategy = typeof ConcessionStrategy[keyof typeof ConcessionStrategy];

/**
 * Negotiation issue definition (continuous numerical dimension).
 */
export interface NegotiationIssue {
  readonly name: string;
  readonly min: number;
  readonly max: number;
  readonly weightA: number; // Importance weight to Agent A (sums to 1.0)
  readonly weightB: number; // Importance weight to Agent B (sums to 1.0)
  readonly preferenceA: 'MAX' | 'MIN'; // Desired direction for Agent A
  readonly preferenceB: 'MAX' | 'MIN'; // Desired direction for Agent B
}

/**
 * Agent configuration profile.
 */
export interface AgentProfile {
  readonly agentId: string;
  readonly reservationUtility: number; // Walk-away threshold d_i (e.g., 0.25)
  readonly strategy: ConcessionStrategy;
  readonly privateSecret: string;
}

/**
 * Discrete proposal offer exchanged between agents.
 */
export interface NegotiationOffer {
  readonly round: number;
  readonly proposerId: string;
  readonly values: Record<string, number>; // issueName -> proposed value
  readonly timestamp: number;
}

/**
 * Signed agreement contract.
 */
export interface NegotiationAgreement {
  readonly sessionId: string;
  readonly round: number;
  readonly agreedValues: Record<string, number>;
  readonly utilityA: number;
  readonly utilityB: number;
  readonly signatureA: string;
  readonly signatureB: string;
  readonly timestamp: number;
}

/**
 * Outcome of a negotiation exchange.
 */
export interface NegotiationOutcome {
  readonly sessionId: string;
  readonly status: 'AGREEMENT' | 'DISAGREEMENT';
  readonly totalRounds: number;
  readonly agreement?: NegotiationAgreement;
  readonly history: readonly NegotiationOffer[];
}

/**
 * Computes deterministic agreement signature.
 */
export function signAgreement(
  agentId: string,
  sessionId: string,
  values: Record<string, number>,
  secret: string
): string {
  const sortedValues = Object.keys(values)
    .sort()
    .map((k) => `${k}=${values[k].toFixed(4)}`)
    .join(';');

  return createHash('sha256')
    .update(agentId)
    .update(sessionId)
    .update(sortedValues)
    .update(secret)
    .digest('hex');
}

/**
 * Decentralized Multi-Agent Negotiation Protocol Coordinator.
 */
export class AgentNegotiationProtocol {
  public readonly sessionId: string;
  public readonly agentA: AgentProfile;
  public readonly agentB: AgentProfile;
  public readonly issues: readonly NegotiationIssue[];
  public readonly maxRounds: number;

  private readonly history: NegotiationOffer[];
  private currentRound: number;

  constructor(
    sessionId: string,
    agentA: AgentProfile,
    agentB: AgentProfile,
    issues: readonly NegotiationIssue[],
    maxRounds: number = 20
  ) {
    this.sessionId = sessionId;
    this.agentA = agentA;
    this.agentB = agentB;
    this.issues = [...issues];
    this.maxRounds = maxRounds;
    this.history = [];
    this.currentRound = 0;
  }

  /**
   * Computes normalized utility for an agent given proposed issue values.
   * Returns a value in [0.0, 1.0].
   */
  public computeUtility(agentId: string, values: Record<string, number>): number {
    const isAgentA = agentId === this.agentA.agentId;
    let utility = 0;

    for (const issue of this.issues) {
      const val = values[issue.name];
      if (val === undefined) {
        throw new Error(`computeUtility: Missing value for issue "${issue.name}"`);
      }

      const clamped = Math.max(issue.min, Math.min(issue.max, val));
      const range = issue.max - issue.min;
      const normalized = range > 0 ? (clamped - issue.min) / range : 1.0;

      const pref = isAgentA ? issue.preferenceA : issue.preferenceB;
      const weight = isAgentA ? issue.weightA : issue.weightB;
      const score = pref === 'MAX' ? normalized : 1.0 - normalized;

      utility += weight * score;
    }

    return Math.max(0, Math.min(1, utility));
  }

  /**
   * Computes target utility for an agent at round t based on concession curve.
   */
  public computeTargetUtility(agent: AgentProfile, round: number): number {
    const tNorm = Math.min(1.0, round / this.maxRounds);
    let beta = 1.0;

    if (agent.strategy === ConcessionStrategy.BOULWARE) {
      beta = 0.2; // Firm, concedes late
    } else if (agent.strategy === ConcessionStrategy.CONCEDER) {
      beta = 2.5; // Concedes early
    } else {
      beta = 1.0; // Linear
    }

    const alpha = Math.pow(tNorm, beta);
    // Target moves from 1.0 down to reservationUtility
    return 1.0 - (1.0 - agent.reservationUtility) * alpha;
  }

  /**
   * Generates proposal offer for an agent targeted at its current concession level.
   */
  public generateOffer(proposerId: string, round: number): NegotiationOffer {
    const isAgentA = proposerId === this.agentA.agentId;
    const agent = isAgentA ? this.agentA : this.agentB;
    const targetU = this.computeTargetUtility(agent, round);

    const values: Record<string, number> = {};

    for (const issue of this.issues) {
      const pref = isAgentA ? issue.preferenceA : issue.preferenceB;
      const range = issue.max - issue.min;

      // Interpolate between optimal extreme and reservation bound
      const interp = pref === 'MAX' ? issue.min + targetU * range : issue.max - targetU * range;

      values[issue.name] = Number(interp.toFixed(2));
    }

    return {
      round,
      proposerId,
      values,
      timestamp: Date.now(),
    };
  }

  /**
   * Runs complete alternating-offers negotiation session to completion.
   */
  public runNegotiation(): NegotiationOutcome {
    let currentProposer = this.agentA;
    let currentResponder = this.agentB;

    for (let r = 1; r <= this.maxRounds; r++) {
      this.currentRound = r;
      const offer = this.generateOffer(currentProposer.agentId, r);
      this.history.push(offer);

      const responderUtility = this.computeUtility(currentResponder.agentId, offer.values);
      const responderTarget = this.computeTargetUtility(currentResponder, r);

      // Check if responder accepts the offer
      if (responderUtility >= responderTarget || responderUtility >= 0.85) {
        // Agreement reached!
        const utilityA = this.computeUtility(this.agentA.agentId, offer.values);
        const utilityB = this.computeUtility(this.agentB.agentId, offer.values);

        const sigA = signAgreement(
          this.agentA.agentId,
          this.sessionId,
          offer.values,
          this.agentA.privateSecret
        );
        const sigB = signAgreement(
          this.agentB.agentId,
          this.sessionId,
          offer.values,
          this.agentB.privateSecret
        );

        const agreement: NegotiationAgreement = {
          sessionId: this.sessionId,
          round: r,
          agreedValues: offer.values,
          utilityA,
          utilityB,
          signatureA: sigA,
          signatureB: sigB,
          timestamp: Date.now(),
        };

        return {
          sessionId: this.sessionId,
          status: 'AGREEMENT',
          totalRounds: r,
          agreement,
          history: [...this.history],
        };
      }

      // Alternate roles
      const temp = currentProposer;
      currentProposer = currentResponder;
      currentResponder = temp;
    }

    return {
      sessionId: this.sessionId,
      status: 'DISAGREEMENT',
      totalRounds: this.maxRounds,
      history: [...this.history],
    };
  }

  /**
   * Computes the theoretical Nash Bargaining Solution (NBS) maximizing product of surplus.
   */
  public computeNashBargainingSolution(): {
    optimalValues: Record<string, number>;
    nashProduct: number;
  } {
    let bestProduct = -1;
    let bestValues: Record<string, number> = {};

    // Grid search over issue parameter space
    const steps = 20;
    const testPoints: Record<string, number>[] = [];

    // Simple 2-issue combinatorial grid
    const i1 = this.issues[0];
    const i2 = this.issues.length > 1 ? this.issues[1] : null;

    for (let s1 = 0; s1 <= steps; s1++) {
      const v1 = i1.min + (s1 / steps) * (i1.max - i1.min);
      if (i2) {
        for (let s2 = 0; s2 <= steps; s2++) {
          const v2 = i2.min + (s2 / steps) * (i2.max - i2.min);
          testPoints.push({ [i1.name]: v1, [i2.name]: v2 });
        }
      } else {
        testPoints.push({ [i1.name]: v1 });
      }
    }

    for (const pt of testPoints) {
      const uA = this.computeUtility(this.agentA.agentId, pt);
      const uB = this.computeUtility(this.agentB.agentId, pt);

      const surplusA = uA - this.agentA.reservationUtility;
      const surplusB = uB - this.agentB.reservationUtility;

      if (surplusA > 0 && surplusB > 0) {
        const prod = surplusA * surplusB;
        if (prod > bestProduct) {
          bestProduct = prod;
          bestValues = pt;
        }
      }
    }

    return {
      optimalValues: bestValues,
      nashProduct: Math.max(0, bestProduct),
    };
  }
}
