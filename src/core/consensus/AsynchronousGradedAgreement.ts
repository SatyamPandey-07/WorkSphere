/**
 * @file AsynchronousGradedAgreement.ts
 * @description Asynchronous Graded Agreement (Gradecast) Consensus Primitive.
 * Implements Feldman-Micali / Canetti-Rabin style Graded Agreement for networks of n = 3f + 1
 * nodes tolerating up to f Byzantine faults without clock synchronization. Every honest node
 * outputs a (value, grade) tuple with grade in {0, 1, 2} satisfying Validity and Consistency.
 */

export type GradeLevel = 0 | 1 | 2;

export interface GradedNode {
  id: string;
  isByzantine?: boolean;
}

export interface GradedMessage {
  roundId: string;
  phase: 'ECHO' | 'CONFIRM';
  senderId: string;
  value: string;
  timestamp: number;
}

export interface GradedOutput {
  nodeId: string;
  value: string | null;
  grade: GradeLevel;
  confirmCount: number;
}

export interface GradedInvariantCheck {
  isValid: boolean;
  validitySatisfied: boolean;
  consistencySatisfied: boolean;
  violations: string[];
}

/**
 * Per-node Gradecast state machine coordinated across an asynchronous BFT network.
 */
export class AsynchronousGradedAgreement {
  public readonly roundId: string;
  public readonly nodeIds: string[];
  public readonly n: number;
  public readonly f: number;

  // receiverId -> senderId -> value (enforces single echo/confirm per sender)
  private echoesReceived: Map<string, Map<string, string>> = new Map();
  private confirmsReceived: Map<string, Map<string, string>> = new Map();
  private equivocators: Set<string> = new Set();
  private outputs: Map<string, GradedOutput> = new Map();

  constructor(roundId: string, nodes: GradedNode[]) {
    if (nodes.length < 4) {
      throw new Error(`Graded Agreement requires at least 4 nodes (3f + 1); got ${nodes.length}`);
    }
    this.roundId = roundId;
    this.nodeIds = nodes.map((n) => n.id);
    this.n = nodes.length;
    this.f = Math.floor((this.n - 1) / 3);

    for (const id of this.nodeIds) {
      this.echoesReceived.set(id, new Map());
      this.confirmsReceived.set(id, new Map());
    }
  }

  public getQuorumThreshold(): number {
    return this.n - this.f;
  }

  public getWeakThreshold(): number {
    return this.f + 1;
  }

  public getEquivocators(): string[] {
    return Array.from(this.equivocators);
  }

  /**
   * Broadcasts an initial Phase-1 ECHO proposal from senderId to all nodes (or specified recipients).
   */
  public submitInitialProposal(
    senderId: string,
    value: string,
    recipients?: string[]
  ): { deliveredCount: number; promotedReceivers: string[] } {
    if (!this.echoesReceived.has(senderId)) {
      throw new Error(`Unknown sender node ${senderId}`);
    }

    const targets = recipients ?? this.nodeIds;
    const promotedReceivers: string[] = [];
    let deliveredCount = 0;

    for (const receiverId of targets) {
      const res = this.processEcho(receiverId, senderId, value);
      if (res.accepted) deliveredCount++;
      if (res.promotedToConfirm) promotedReceivers.push(receiverId);
    }

    return { deliveredCount, promotedReceivers };
  }

  /**
   * Processes a Phase-1 ECHO message at a specific receiver node.
   * Rejects duplicate conflicting echoes from the same sender (Byzantine equivocation).
   */
  public processEcho(
    receiverId: string,
    senderId: string,
    value: string
  ): { accepted: boolean; promotedToConfirm: boolean; promotedValue: string | null } {
    const rxMap = this.echoesReceived.get(receiverId);
    if (!rxMap || !this.echoesReceived.has(senderId)) {
      return { accepted: false, promotedToConfirm: false, promotedValue: null };
    }

    const existing = rxMap.get(senderId);
    if (existing !== undefined) {
      if (existing !== value) {
        this.equivocators.add(senderId);
      }
      return { accepted: false, promotedToConfirm: false, promotedValue: null };
    }

    rxMap.set(senderId, value);

    // Count matching echoes for this value
    let count = 0;
    for (const v of rxMap.values()) {
      if (v === value) count++;
    }

    const promoted = count >= this.getQuorumThreshold();
    return {
      accepted: true,
      promotedToConfirm: promoted,
      promotedValue: promoted ? value : null,
    };
  }

  /**
   * Broadcasts a Phase-2 CONFIRM message from senderId to all nodes (or specified recipients).
   */
  public broadcastConfirm(
    senderId: string,
    value: string,
    recipients?: string[]
  ): { deliveredCount: number } {
    if (!this.confirmsReceived.has(senderId)) {
      throw new Error(`Unknown sender node ${senderId}`);
    }

    const targets = recipients ?? this.nodeIds;
    let deliveredCount = 0;

    for (const receiverId of targets) {
      if (this.processConfirm(receiverId, senderId, value).accepted) {
        deliveredCount++;
      }
    }

    return { deliveredCount };
  }

  /**
   * Processes a Phase-2 CONFIRM message at a specific receiver node.
   */
  public processConfirm(
    receiverId: string,
    senderId: string,
    value: string
  ): { accepted: boolean; confirmCount: number } {
    const rxMap = this.confirmsReceived.get(receiverId);
    if (!rxMap || !this.confirmsReceived.has(senderId)) {
      return { accepted: false, confirmCount: 0 };
    }

    const existing = rxMap.get(senderId);
    if (existing !== undefined) {
      if (existing !== value) {
        this.equivocators.add(senderId);
      }
      return { accepted: false, confirmCount: 0 };
    }

    rxMap.set(senderId, value);

    let count = 0;
    for (const v of rxMap.values()) {
      if (v === value) count++;
    }

    return { accepted: true, confirmCount: count };
  }

  /**
   * Evaluates and records the Gradecast output (value, grade) for a given node.
   * - Grade 2: value received >= n - f CONFIRM messages
   * - Grade 1: value received >= f + 1 CONFIRM messages
   * - Grade 0: no value reached f + 1 CONFIRM messages
   */
  public finalizeNodeOutput(nodeId: string): GradedOutput {
    const rxMap = this.confirmsReceived.get(nodeId);
    if (!rxMap) {
      throw new Error(`Unknown node ${nodeId}`);
    }

    const tally = new Map<string, number>();
    for (const v of rxMap.values()) {
      tally.set(v, (tally.get(v) ?? 0) + 1);
    }

    let topValue: string | null = null;
    let topCount = 0;
    for (const [val, cnt] of tally.entries()) {
      if (cnt > topCount) {
        topCount = cnt;
        topValue = val;
      }
    }

    let grade: GradeLevel = 0;
    let decidedValue: string | null = null;

    if (topValue !== null && topCount >= this.getQuorumThreshold()) {
      grade = 2;
      decidedValue = topValue;
    } else if (topValue !== null && topCount >= this.getWeakThreshold()) {
      grade = 1;
      decidedValue = topValue;
    }

    const output: GradedOutput = {
      nodeId,
      value: decidedValue,
      grade,
      confirmCount: topCount,
    };

    this.outputs.set(nodeId, output);
    return output;
  }

  /**
   * Verifies Gradecast Validity and Consistency invariants across honest node outputs.
   */
  public static verifyGradedInvariants(
    honestOutputs: GradedOutput[],
    unanimousHonestInput?: string
  ): GradedInvariantCheck {
    const violations: string[] = [];
    let validitySatisfied = true;
    let consistencySatisfied = true;

    // 1. Validity: If all honest nodes had the same input, all must output (input, grade 2)
    if (unanimousHonestInput !== undefined) {
      for (const out of honestOutputs) {
        if (out.value !== unanimousHonestInput || out.grade !== 2) {
          validitySatisfied = false;
          violations.push(
            `Validity violated at node ${out.nodeId}: expected (${unanimousHonestInput}, 2), got (${out.value}, ${out.grade})`
          );
        }
      }
    }

    // 2. Consistency: If any honest node outputs (v, 2), EVERY honest node must output (v, grade >= 1)
    const grade2Values = new Set(
      honestOutputs.filter((o) => o.grade === 2 && o.value !== null).map((o) => o.value!)
    );

    if (grade2Values.size > 1) {
      consistencySatisfied = false;
      violations.push(`Conflicting grade-2 values decided: ${Array.from(grade2Values).join(', ')}`);
    } else if (grade2Values.size === 1) {
      const consensusVal = Array.from(grade2Values)[0];
      for (const out of honestOutputs) {
        if (out.grade < 1 || out.value !== consensusVal) {
          consistencySatisfied = false;
          violations.push(
            `Consistency violated at node ${out.nodeId}: grade-2 value ${consensusVal} existed, but node output (${out.value}, ${out.grade})`
          );
        }
      }
    }

    return {
      isValid: validitySatisfied && consistencySatisfied,
      validitySatisfied,
      consistencySatisfied,
      violations,
    };
  }
}
