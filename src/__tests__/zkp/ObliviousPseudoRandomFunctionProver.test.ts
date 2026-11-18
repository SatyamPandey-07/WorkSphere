import { describe, it, expect } from 'vitest';
import { ObliviousPseudoRandomFunctionProver } from '../../core/zkp/ObliviousPseudoRandomFunctionProver';

describe('ObliviousPseudoRandomFunctionProver', () => {
  const voprf = new ObliviousPseudoRandomFunctionProver();

  it('produces identical oblivious and direct VOPRF outputs with verified DLEQ proofs', () => {
    const serverKey = voprf.generateServerKey('voprf-key-2026', 888777666n);
    const input = 'user-rate-limit-token:alice@worksphere.io';

    const clientState = voprf.blind(input);
    const evaluation = voprf.blindEvaluate(serverKey, clientState.blindedElement);

    expect(voprf.verifyEvaluationProof(evaluation, serverKey.publicKey)).toBe(true);

    const finalized = voprf.finalizeClient(clientState, evaluation, serverKey.publicKey);
    const direct = voprf.evaluateDirect(serverKey, input);

    expect(finalized.valid).toBe(true);
    expect(finalized.outputHex).toBe(direct);

    // Independent blinding on same input yields identical final VOPRF output
    const clientState2 = voprf.blind(input);
    expect(clientState2.blindedElement).not.toBe(clientState.blindedElement);
    const eval2 = voprf.blindEvaluate(serverKey, clientState2.blindedElement);
    expect(voprf.finalizeClient(clientState2, eval2, serverKey.publicKey).outputHex).toBe(direct);
  });

  it('rejects wrong server keys and tampered evaluation proofs', () => {
    const honestKey = voprf.generateServerKey('honest');
    const rogueKey = voprf.generateServerKey('rogue');
    const state = voprf.blind('secret-password-seed');

    const rogueEval = voprf.blindEvaluate(rogueKey, state.blindedElement);
    expect(voprf.finalizeClient(state, rogueEval, honestKey.publicKey).valid).toBe(false);

    const honestEval = voprf.blindEvaluate(honestKey, state.blindedElement);
    expect(
      voprf.finalizeClient(
        state,
        { ...honestEval, responseS: honestEval.responseS + 1n },
        honestKey.publicKey
      ).valid
    ).toBe(false);
  });

  it('executes RFC-9497 batched composite DLEQ evaluation and round-trips serialization', () => {
    const serverKey = voprf.generateServerKey('batch-key-1');
    const inputs = ['tok-1', 'tok-2', 'tok-3', 'tok-4'];
    const states = inputs.map((x) => voprf.blind(x));

    const batchEval = voprf.blindEvaluateBatch(
      serverKey,
      states.map((s) => s.blindedElement)
    );
    const res = voprf.verifyAndFinalizeBatch(states, batchEval, serverKey.publicKey);
    expect(res.valid).toBe(true);
    expect(res.outputs).toEqual(inputs.map((x) => voprf.evaluateDirect(serverKey, x)));

    // Tampering with one evaluated element invalidates the composite DLEQ proof
    const tamperedBatch = {
      ...batchEval,
      evaluatedElements: [
        batchEval.evaluatedElements[0],
        batchEval.evaluatedElements[1] + 1n,
        batchEval.evaluatedElements[2],
        batchEval.evaluatedElements[3],
      ],
    };
    expect(voprf.verifyAndFinalizeBatch(states, tamperedBatch, serverKey.publicKey).valid).toBe(false);

    const json = voprf.serializeBatchEvaluation(batchEval);
    const restored = voprf.deserializeBatchEvaluation(json);
    expect(restored).toEqual(batchEval);
    expect(voprf.verifyAndFinalizeBatch(states, restored, serverKey.publicKey).valid).toBe(true);
  });
});
