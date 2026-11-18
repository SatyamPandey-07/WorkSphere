import { describe, it, expect } from 'vitest';
import { VerifiableThresholdRandomBeaconProver } from '../../core/zkp/VerifiableThresholdRandomBeaconProver';

describe('VerifiableThresholdRandomBeaconProver', () => {
  const beacon = new VerifiableThresholdRandomBeaconProver();

  it('produces identical deterministic randomness regardless of which t-of-n subset participates', () => {
    const setup = beacon.setupCommittee('ws-beacon-2026', 3, [1, 2, 3, 4, 5]);
    const prevHex = 'a'.repeat(64);

    const subsetA = [setup.shares[0], setup.shares[2], setup.shares[4]].map((s) =>
      beacon.producePartialBeacon(setup.beaconId, 1, prevHex, s)
    );
    const subsetB = [setup.shares[1], setup.shares[2], setup.shares[3]].map((s) =>
      beacon.producePartialBeacon(setup.beaconId, 1, prevHex, s)
    );

    const resA = beacon.aggregateBeaconPulse(setup, 1, prevHex, subsetA);
    const resB = beacon.aggregateBeaconPulse(setup, 1, prevHex, subsetB);

    // Threshold uniqueness: completely different 3-of-5 subsets MUST produce the EXACT SAME randomness!
    expect(resA.pulse.aggregatedSigma).toBe(resB.pulse.aggregatedSigma);
    expect(resA.pulse.randomnessHex).toBe(resB.pulse.randomnessHex);
    expect(beacon.verifyBeaconPulse(setup, resA.pulse).valid).toBe(true);
    expect(beacon.verifyBeaconPulse(setup, resB.pulse).valid).toBe(true);
  });

  it('isolates faulty partial beacon shares and verifies multi-round chained beacons', () => {
    const setup = beacon.setupCommittee('ws-beacon-fault', 2, [1, 2, 3, 4]);
    const prevHex = 'b'.repeat(64);

    const p1 = beacon.producePartialBeacon(setup.beaconId, 1, prevHex, setup.shares[0]);
    const p2Bad = {
      ...beacon.producePartialBeacon(setup.beaconId, 1, prevHex, setup.shares[1]),
      partialSigma: 99999n,
    };
    const p3 = beacon.producePartialBeacon(setup.beaconId, 1, prevHex, setup.shares[2]);

    const { pulse, faultyNodeIds } = beacon.aggregateBeaconPulse(setup, 1, prevHex, [p1, p2Bad, p3]);
    expect(faultyNodeIds).toEqual([2]);
    expect(beacon.verifyBeaconPulse(setup, pulse).valid).toBe(true);

    const chain = beacon.generateChainedBeacon(setup, 'genesis-2026', 4);
    expect(chain).toHaveLength(4);
    expect(beacon.verifyChainedBeacon(setup, 'genesis-2026', chain)).toBe(true);
    expect(beacon.verifyChainedBeacon(setup, 'wrong-genesis', chain)).toBe(false);
  });

  it('samples unbiased bounded indices and round-trips JSON pulse serialization', () => {
    const setup = beacon.setupCommittee('ws-beacon-ser', 2, [1, 2, 3]);
    const chain = beacon.generateChainedBeacon(setup, 'seed-lottery', 2);
    const pulse = chain[1];

    const idx = beacon.sampleUnbiasedIndex(pulse, 12, 'reviewer-slot');
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(idx).toBeLessThan(12);
    expect(idx).toBe(beacon.sampleUnbiasedIndex(pulse, 12, 'reviewer-slot'));

    const json = beacon.serializePulse(pulse);
    const restored = beacon.deserializePulse(json);
    expect(restored).toEqual(pulse);
    expect(beacon.verifyBeaconPulse(setup, restored).valid).toBe(true);
  });
});
