import { ZKInclusionAccumulator } from '../../core/zkp/ZKInclusionAccumulator';

describe('ZKInclusionAccumulator', () => {
  it('generates, incrementally updates, and verifies constant-size membership and batch proofs', () => {
    const acc = new ZKInclusionAccumulator();
    acc.addBatch(['alice@ws', 'bob@ws', 'carol@ws']);

    const wAlice = acc.createMembershipWitness('alice@ws');
    expect(acc.verifyMembership(wAlice)).toBe(true);

    // Dynamic insertion + O(1) incremental witness update
    const { newAccumulator } = acc.addElement('dave@ws');
    const updatedAlice = acc.updateWitnessOnInsertion(wAlice, 'dave@ws', newAccumulator);
    expect(acc.verifyMembership(updatedAlice)).toBe(true);

    const batchProof = acc.createBatchMembershipProof(['bob@ws', 'dave@ws']);
    expect(acc.verifyBatchMembership(batchProof)).toBe(true);
  });

  it('proves and verifies Bezout non-membership witnesses and rejects forged proofs', () => {
    const acc = new ZKInclusionAccumulator();
    acc.addBatch(['tx-100', 'tx-200', 'tx-300']);

    const nonMem = acc.createNonMembershipWitness('tx-999');
    expect(acc.verifyNonMembership(nonMem)).toBe(true);
    expect(() => acc.createNonMembershipWitness('tx-200')).toThrow();

    expect(acc.verifyNonMembership({ ...nonMem, bezoutB: nonMem.bezoutB + 1n })).toBe(false);

    const w100 = acc.createMembershipWitness('tx-100');
    expect(acc.verifyMembership({ ...w100, witnessValue: w100.witnessValue + 1n })).toBe(false);
  });
});
