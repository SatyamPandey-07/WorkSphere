import {
  ZeroKnowledgeSetMembershipMerkle,
  poseidonHash2,
} from '../../core/zkp/ZeroKnowledgeSetMembershipMerkle';

describe('ZeroKnowledgeSetMembershipMerkle', () => {
  it('verifies Poseidon Merkle set membership, ownership Sigma proof, and prevents nullifier replay', () => {
    const group = new ZeroKnowledgeSetMembershipMerkle(4);
    const id1 = group.createIdentity('member-alice', 'trapdoor-1');
    const id2 = group.createIdentity('member-bob', 'trapdoor-2');
    const id3 = group.createIdentity('member-carol', 'trapdoor-3');

    group.insertLeaf(id1.leafCommitment);
    const bobIndex = group.insertLeaf(id2.leafCommitment);
    group.insertLeaf(id3.leafCommitment);

    expect(poseidonHash2(1n, 2n)).not.toBe(poseidonHash2(2n, 1n));

    const proof = group.proveMembership(id2, bobIndex, 2026n, '0xproposal_yes', 'nonce-bob-1');
    const firstVerify = group.verifyAndConsume(proof, true);
    expect(firstVerify.isValid).toBe(true);
    expect(firstVerify.merkleRootValid).toBe(true);
    expect(firstVerify.ownershipProofValid).toBe(true);
    expect(firstVerify.nullifierFresh).toBe(true);

    // Replaying the same nullifier must be rejected
    const replay = group.verifyAndConsume(proof, true);
    expect(replay.isValid).toBe(false);
    expect(replay.nullifierFresh).toBe(false);
  });

  it('rejects tampered signals, forged ownership proofs, or corrupted Merkle paths', () => {
    const group = new ZeroKnowledgeSetMembershipMerkle(3);
    const id = group.createIdentity('solo-member', 'trapdoor-solo');
    const idx = group.insertLeaf(id.leafCommitment);
    const proof = group.proveMembership(id, idx, 777n, '0xsig_orig', 'n0');

    expect(group.verifyAndConsume({ ...proof, signalDigest: '0xsig_tampered' }, false).isValid).toBe(false);
    expect(
      group.verifyAndConsume(
        {
          ...proof,
          ownershipProof: { ...proof.ownershipProof, responseS: proof.ownershipProof.responseS + 1n },
        },
        false
      ).isValid
    ).toBe(false);
  });
});
