import { describe, it, expect } from 'vitest';
import { VerifiableRollupFraudBisectionProver, SUBGROUP_Q } from '../../core/zkp/VerifiableRollupFraudBisectionProver';

describe('VerifiableRollupFraudBisectionProver', () => {
  const engine = new VerifiableRollupFraudBisectionProver();

  it('pinpoints a single fraudulent execution step in a 64-step trace in exactly 6 O(log N) bisection rounds', () => {
    const asserter = engine.generateParty('sequencer-a');
    const challenger = engine.generateParty('watcher-b');
    const ops = Array.from({ length: 64 }, (_, i) => ({
      stepIndex: i,
      opcode: (['ADD', 'MUL', 'XOR_HASH', 'TRANSFER'] as const)[i % 4],
      operand: `val-${i * 7}`,
    }));

    const genesis = 'genesis-state-root-2026';
    const honestTrace = engine.computeFullTrace(genesis, ops);
    const fraudTrace = engine.computeCorruptedTrace(genesis, ops, 41); // sequencer lies at step 41

    // Case 1: Malicious asserter vs honest challenger -> challenger wins, asserter slashed
    const transcript1 = engine.runInteractiveBisection('disp-41', ops, asserter, fraudTrace, challenger, honestTrace);
    expect(transcript1.rounds.length).toBe(6); // log2(64) = 6
    expect(transcript1.disputedStepIndex).toBe(41);

    const verdict1 = engine.adjudicateOnChain(transcript1);
    expect(verdict1.transcriptValid).toBe(true);
    expect(verdict1.winner).toBe('CHALLENGER');
    expect(verdict1.slashedParty).toBe('ASSERTER');
    expect(verdict1.disputedStepIndex).toBe(41);

    // Case 2: Honest asserter vs false challenger -> asserter wins, challenger slashed
    const transcript2 = engine.runInteractiveBisection('disp-false', ops, asserter, honestTrace, challenger, fraudTrace);
    const verdict2 = engine.adjudicateOnChain(transcript2);
    expect(verdict2.transcriptValid).toBe(true);
    expect(verdict2.winner).toBe('ASSERTER');
    expect(verdict2.slashedParty).toBe('CHALLENGER');

    // Tampered bisection signature fails on-chain adjudication
    const badRounds = transcript1.rounds.map((r, i) => (i === 2 ? { ...r, asserterSigS: (r.asserterSigS + 1n) % SUBGROUP_Q } : r));
    expect(engine.adjudicateOnChain({ ...transcript1, rounds: badRounds }).transcriptValid).toBe(false);

    // Identical final states cannot start dispute
    expect(() => engine.runInteractiveBisection('no-disp', ops, asserter, honestTrace, challenger, honestTrace)).toThrow();

    const json = JSON.parse(engine.serializeTranscript(transcript1)) as { totalSteps: number; bisectionRounds: number; disputedStepIndex: number };
    expect(json).toEqual({ disputeId: 'disp-41', totalSteps: 64, bisectionRounds: 6, disputedStepIndex: 41 });
  });
});
