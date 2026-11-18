import { RingSignatureLinkableProver } from '../../core/zkp/RingSignatureLinkableProver';

describe('RingSignatureLinkableProver', () => {
  it('verifies anonymous LSAG ring signatures and links double-signing by the same member', () => {
    const lsag = new RingSignatureLinkableProver();
    const members = ['alice', 'bob', 'carol', 'dave', 'eve'].map((id) => lsag.generateKeyPair(id));
    const ring = members.map((m) => m.publicPoint);

    const sig1 = lsag.sign(members[2], ring, '0xvote_ballot_1', 'nonce-1');
    const sig2 = lsag.sign(members[2], ring, '0xvote_ballot_2', 'nonce-2');
    const sigOther = lsag.sign(members[4], ring, '0xvote_ballot_3', 'nonce-3');

    expect(lsag.verify(sig1).isValid).toBe(true);
    expect(lsag.verify(sig2).isValid).toBe(true);
    expect(lsag.verify(sigOther).isValid).toBe(true);

    const dupCheck = lsag.checkLinkability(sig1, sig2);
    expect(dupCheck.bothSignaturesValid).toBe(true);
    expect(dupCheck.linked).toBe(true);
    expect(dupCheck.sharedKeyImage).toBe(members[2].keyImage);

    const distinctCheck = lsag.checkLinkability(sig1, sigOther);
    expect(distinctCheck.bothSignaturesValid).toBe(true);
    expect(distinctCheck.linked).toBe(false);
  });

  it('rejects tampered messages, broken challenge rings, and forged key images', () => {
    const lsag = new RingSignatureLinkableProver();
    const members = ['u1', 'u2', 'u3'].map((id) => lsag.generateKeyPair(id));
    const ring = members.map((m) => m.publicPoint);
    const sig = lsag.sign(members[1], ring, '0xmsg_orig', 'n0');

    expect(lsag.verify({ ...sig, messageDigest: '0xmsg_forged' }).isValid).toBe(false);
    expect(lsag.verify({ ...sig, initialChallengeC0: sig.initialChallengeC0 + 1n }).isValid).toBe(false);
    expect(lsag.verify({ ...sig, keyImage: members[0].keyImage }).isValid).toBe(false);
  });
});
