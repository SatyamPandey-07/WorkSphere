import { describe, it, expect } from 'vitest';
import {
  AsynchronousGradedAgreement,
  GradedNode,
} from '../../core/consensus/AsynchronousGradedAgreement';

describe('AsynchronousGradedAgreement', () => {
  const nodes: GradedNode[] = [
    { id: 'n1' },
    { id: 'n2' },
    { id: 'n3' },
    { id: 'n4', isByzantine: true },
  ];
  // n = 4, f = 1, quorum = n - f = 3, weak = f + 1 = 2

  it('converges unanimously to grade 2 despite f Byzantine faults', () => {
    const ga = new AsynchronousGradedAgreement('round-1', nodes);
    expect(ga.getQuorumThreshold()).toBe(3);
    expect(ga.getWeakThreshold()).toBe(2);

    // Honest nodes n1, n2, n3 propose 'BLOCK_A'; Byzantine n4 proposes 'FORK_X'
    ga.submitInitialProposal('n1', 'BLOCK_A');
    ga.submitInitialProposal('n2', 'BLOCK_A');
    const r3 = ga.submitInitialProposal('n3', 'BLOCK_A');
    ga.submitInitialProposal('n4', 'FORK_X');

    // All honest nodes reached 3 echoes for BLOCK_A -> broadcast CONFIRM
    expect(r3.promotedReceivers).toContain('n1');
    expect(r3.promotedReceivers).toContain('n2');
    expect(r3.promotedReceivers).toContain('n3');

    ga.broadcastConfirm('n1', 'BLOCK_A');
    ga.broadcastConfirm('n2', 'BLOCK_A');
    ga.broadcastConfirm('n3', 'BLOCK_A');
    ga.broadcastConfirm('n4', 'FORK_X');

    const honestOutputs = ['n1', 'n2', 'n3'].map((id) => ga.finalizeNodeOutput(id));
    for (const out of honestOutputs) {
      expect(out.value).toBe('BLOCK_A');
      expect(out.grade).toBe(2);
    }

    const inv = AsynchronousGradedAgreement.verifyGradedInvariants(honestOutputs, 'BLOCK_A');
    expect(inv.isValid).toBe(true);
    expect(inv.validitySatisfied).toBe(true);
    expect(inv.consistencySatisfied).toBe(true);
  });

  it('preserves consistency when honest nodes observe partial confirms (grade 2 vs grade 1)', () => {
    const ga = new AsynchronousGradedAgreement('round-split', nodes);

    // n1 and n2 confirm VAL_Z to everyone; Byzantine n4 sends confirm VAL_Z only to n1
    ga.broadcastConfirm('n1', 'VAL_Z');
    ga.broadcastConfirm('n2', 'VAL_Z');
    ga.broadcastConfirm('n4', 'VAL_Z', ['n1']);

    const out1 = ga.finalizeNodeOutput('n1'); // 3 confirms -> grade 2
    const out2 = ga.finalizeNodeOutput('n2'); // 2 confirms -> grade 1
    const out3 = ga.finalizeNodeOutput('n3'); // 2 confirms -> grade 1

    expect(out1.grade).toBe(2);
    expect(out2.grade).toBe(1);
    expect(out3.grade).toBe(1);

    const inv = AsynchronousGradedAgreement.verifyGradedInvariants([out1, out2, out3]);
    expect(inv.isValid).toBe(true);
    expect(inv.consistencySatisfied).toBe(true);
  });

  it('detects Byzantine equivocation when a node sends conflicting echoes', () => {
    const ga = new AsynchronousGradedAgreement('round-eq', nodes);
    ga.processEcho('n1', 'n4', 'VAL_1');
    const second = ga.processEcho('n1', 'n4', 'VAL_2');

    expect(second.accepted).toBe(false);
    expect(ga.getEquivocators()).toContain('n4');
  });
});
