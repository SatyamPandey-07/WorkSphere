import { describe, it, expect } from 'vitest';
import { VerifiableRandomBeaconChainProver, SAFE_PRIME_P, SUBGROUP_Q } from '../../core/zkp/VerifiableRandomBeaconChainProver';

describe('VerifiableRandomBeaconChainProver', () => {
  const beacon = new VerifiableRandomBeaconChainProver();

  it('produces deterministic unbiasable chained threshold beacon pulses and isolates faulty nodes', () => {
    const committee = beacon.setupCommittee('drand-worksphere-2026', 3, [1, 2, 3, 4, 5]);

    const badP2 = { ...beacon.producePartialSignature(committee, committee.nodes[1], 1, committee.genesisSeed), response: 42n };
    const r1QuorumA = beacon.aggregatePulse(committee, 1, committee.genesisSeed, [
      beacon.producePartialSignature(committee, committee.nodes[0], 1, committee.genesisSeed),
      badP2,
      beacon.producePartialSignature(committee, committee.nodes[2], 1, committee.genesisSeed),
      beacon.producePartialSignature(committee, committee.nodes[4], 1, committee.genesisSeed),
    ]);
    expect(r1QuorumA.pulse).not.toBeNull();
    expect(r1QuorumA.faultyNodes).toEqual([2]);

    const r1QuorumB = beacon.aggregatePulse(committee, 1, committee.genesisSeed, [
      beacon.producePartialSignature(committee, committee.nodes[1], 1, committee.genesisSeed),
      beacon.producePartialSignature(committee, committee.nodes[3], 1, committee.genesisSeed),
      beacon.producePartialSignature(committee, committee.nodes[4], 1, committee.genesisSeed),
    ]);
    expect(r1QuorumB.pulse!.randomnessHex).toBe(r1QuorumA.pulse!.randomnessHex);

    const r2 = beacon.aggregatePulse(committee, 2, r1QuorumA.pulse!.randomnessHex, [
      beacon.producePartialSignature(committee, committee.nodes[0], 2, r1QuorumA.pulse!.randomnessHex),
      beacon.producePartialSignature(committee, committee.nodes[2], 2, r1QuorumA.pulse!.randomnessHex),
      beacon.producePartialSignature(committee, committee.nodes[3], 2, r1QuorumA.pulse!.randomnessHex),
    ]);
    expect(r2.pulse).not.toBeNull();

    expect(beacon.verifyBeaconChain(committee, [r1QuorumA.pulse!, r2.pulse!])).toBe(true);
    expect(beacon.verifyBeaconChain(committee, [r1QuorumA.pulse!, { ...r2.pulse!, randomnessHex: '00'.repeat(32) }])).toBe(false);

    const json = JSON.parse(beacon.serializePulse(r2.pulse!)) as { round: number; quorumSize: number };
    expect(json.round).toBe(2);
    expect(json.quorumSize).toBe(3);
  });

  it('chains 5 consecutive beacon rounds and rejects insufficient quorums, duplicates, and tampered pulses', () => {
    expect(() => beacon.setupCommittee('bad', 1, [1, 2])).toThrow();
    expect(() => beacon.setupCommittee('bad', 4, [1, 2, 3])).toThrow();

    const committee = beacon.setupCommittee('drand-5-rounds', 2, [10, 20, 30, 40], 'custom-genesis-seed');
    const pulses = [];
    let prev = committee.genesisSeed;

    for (let r = 1; r <= 5; r++) {
      const pA = beacon.producePartialSignature(committee, committee.nodes[r % 4], r, prev);
      const pB = beacon.producePartialSignature(committee, committee.nodes[(r + 1) % 4], r, prev);
      const res = beacon.aggregatePulse(committee, r, prev, [pA, pB]);
      expect(res.pulse).not.toBeNull();
      expect(beacon.verifyPulse(committee, res.pulse!)).toBe(true);
      pulses.push(res.pulse!);
      prev = res.pulse!.randomnessHex;
    }

    expect(beacon.verifyBeaconChain(committee, pulses)).toBe(true);
    expect(new Set(pulses.map((p) => p.randomnessHex)).size).toBe(5);

    // Duplicate partial from same node does not meet threshold
    const pOnly1 = beacon.producePartialSignature(committee, committee.nodes[0], 6, prev);
    const dupFail = beacon.aggregatePulse(committee, 6, prev, [pOnly1, pOnly1]);
    expect(dupFail.pulse).toBeNull();
    expect(dupFail.faultyNodes).toEqual([10]);

    // Wrong round partial rejected
    const wrongRound = beacon.producePartialSignature(committee, committee.nodes[1], 7, prev);
    const wrongRes = beacon.aggregatePulse(committee, 6, prev, [pOnly1, wrongRound]);
    expect(wrongRes.pulse).toBeNull();
    expect(wrongRes.faultyNodes).toEqual([20]);

    // Tampered pulse checks
    const p3 = pulses[2];
    expect(beacon.verifyPulse(committee, { ...p3, chainId: 'other' })).toBe(false);
    expect(beacon.verifyPulse(committee, { ...p3, messagePoint: (p3.messagePoint * 4n) % SAFE_PRIME_P })).toBe(false);
    expect(beacon.verifyPulse(committee, { ...p3, thresholdSignature: (p3.thresholdSignature * 4n) % SAFE_PRIME_P })).toBe(false);
    expect(beacon.verifyPulse(committee, { ...p3, verifiedPartials: [p3.verifiedPartials[0]] })).toBe(false);
    expect(
      beacon.verifyPulse(committee, {
        ...p3,
        verifiedPartials: [
          { ...p3.verifiedPartials[0], challenge: (p3.verifiedPartials[0].challenge + 1n) % SUBGROUP_Q },
          p3.verifiedPartials[1],
        ],
      }),
    ).toBe(false);

    // Broken chain (skipping round 2) must fail
    expect(beacon.verifyBeaconChain(committee, [pulses[0], pulses[2]])).toBe(false);
  });
});
