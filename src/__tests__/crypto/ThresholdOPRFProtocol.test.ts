import { describe, it, expect } from 'vitest';
import {
  ThresholdOPRFProtocol,
  TOPRFFieldMath,
} from '../../core/crypto/ThresholdOPRFProtocol';

describe('ThresholdOPRFProtocol', () => {
  const masterKey = 314159265358979n;
  const threshold = 3;
  const totalServers = 5;

  const { secretShares, publicKeys } = ThresholdOPRFProtocol.generateCommitteeShares(
    masterKey,
    threshold,
    totalServers
  );

  const protocol = new ThresholdOPRFProtocol({
    threshold,
    totalServers,
    serverPublicKeys: publicKeys,
  });

  it('produces identical deterministic OPRF digests across distinct blinded queries and server subsets', () => {
    const secretPassword = 'correct-horse-battery-staple';
    const expectedDigest = protocol.evaluateDirectlyWithMasterKey(masterKey, secretPassword);

    // Query 1 evaluated by servers [1, 2, 3]
    const q1 = protocol.blindInput(secretPassword, 'q1');
    const p1 = [1, 2, 3].map((idx) =>
      protocol.evaluatePartial(idx, secretShares.get(idx)!, q1.blindedElement, q1.queryId)
    );
    const out1 = protocol.finalizeOutput(p1, q1.blindingScalar, secretPassword, q1.blindedElement);

    // Query 2 evaluated by servers [2, 4, 5] with fresh blinding
    const q2 = protocol.blindInput(secretPassword, 'q2');
    expect(q1.blindedElement).not.toBe(q2.blindedElement); // Obliviousness!

    const p2 = [2, 4, 5].map((idx) =>
      protocol.evaluatePartial(idx, secretShares.get(idx)!, q2.blindedElement, q2.queryId)
    );
    const out2 = protocol.finalizeOutput(p2, q2.blindingScalar, secretPassword, q2.blindedElement);

    expect(out1.prfDigestHex).toBe(expectedDigest);
    expect(out2.prfDigestHex).toBe(expectedDigest);
    expect(out1.unblindedPoint).toBe(out2.unblindedPoint);
  });

  it('rejects malicious partial evaluations with forged DLEQ proofs', () => {
    const q = protocol.blindInput('sensitive-token', 'q-bad');
    const partial = protocol.evaluatePartial(1, secretShares.get(1)!, q.blindedElement, q.queryId);

    const forged = {
      ...partial,
      evaluatedElement: TOPRFFieldMath.add(partial.evaluatedElement, 1n),
    };

    expect(protocol.verifyPartialEvaluation(forged, q.blindedElement)).toBe(false);
  });
});
