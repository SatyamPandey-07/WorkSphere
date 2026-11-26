import { describe, it, expect } from 'vitest';
import { DistributedDKGComplaintVerifier } from '../../core/zkp/DistributedDKGComplaintVerifier';

describe('DistributedDKGComplaintVerifier', () => {
  const dkg = new DistributedDKGComplaintVerifier();

  it('runs a clean (3, 5) Joint-Feldman DKG session and verifies Lagrange public key consistency', () => {
    const participants = [1, 2, 3, 4, 5];
    const deals = participants.map((id) =>
      dkg.generateDealerContribution('dkg-session-1', id, 3, participants)
    );

    for (const deal of deals) {
      expect(dkg.verifyDealerProofOfPossession('dkg-session-1', deal)).toBe(true);
    }

    const summary = dkg.finalizeDKGSession('dkg-session-1', 3, participants, deals);
    expect(summary.qualifiedDealers).toEqual([1, 2, 3, 4, 5]);
    expect(summary.disqualifiedDealers).toEqual([]);
    expect(summary.resolutions).toHaveLength(0);

    // Any 3-subset of participant public key shares must interpolate to the exact groupPublicKey
    expect(dkg.verifyPublicKeyConsistency(summary, [1, 2, 3])).toBe(true);
    expect(dkg.verifyPublicKeyConsistency(summary, [2, 4, 5])).toBe(true);
    expect(dkg.verifyPublicKeyConsistency(summary, [1, 3, 5])).toBe(true);
    expect(dkg.verifyPublicKeyConsistency(summary, [1, 2])).toBe(false);
  });

  it('disqualifies malicious dealers sending corrupted shares while preserving group key consistency', () => {
    const participants = [1, 2, 3, 4, 5];
    const deals = participants.map((id) =>
      dkg.generateDealerContribution('dkg-session-2', id, 3, participants)
    );

    // Corrupt dealer 2's share sent to participant 4
    const badDeal = deals[1];
    badDeal.shares.set(4, (badDeal.shares.get(4) ?? 0n) + 13n);

    // Corrupt dealer 5's Proof-of-Possession
    deals[4] = {
      ...deals[4],
      proofOfPossession: {
        ...deals[4].proofOfPossession,
        response: deals[4].proofOfPossession.response + 1n,
      },
    };

    const summary = dkg.finalizeDKGSession('dkg-session-2', 3, participants, deals);
    expect(summary.qualifiedDealers).toEqual([1, 3, 4]);
    expect(summary.disqualifiedDealers).toEqual([2, 5]);
    expect(summary.resolutions).toHaveLength(1);
    expect(summary.resolutions[0].complaintUpheld).toBe(true);
    expect(summary.resolutions[0].dealerDisqualified).toBe(true);
    expect(dkg.verifyPublicKeyConsistency(summary, [1, 4, 5])).toBe(true);
  });

  it('allows an accused dealer to cure a transport-corrupted share via public defense share', () => {
    const participants = [1, 2, 3, 4];
    const deals = participants.map((id) =>
      dkg.generateDealerContribution('dkg-session-cure', id, 2, participants)
    );

    const honestShare = deals[0].shares.get(3)!;
    deals[0].shares.set(3, honestShare + 99n);

    const defenses = new Map<string, bigint>([['1:3', honestShare]]);
    const summary = dkg.finalizeDKGSession('dkg-session-cure', 2, participants, deals, defenses);

    expect(summary.qualifiedDealers).toEqual([1, 2, 3, 4]);
    expect(summary.disqualifiedDealers).toEqual([]);
    expect(summary.resolutions).toHaveLength(1);
    expect(summary.resolutions[0].complaintUpheld).toBe(true);
    expect(summary.resolutions[0].dealerDisqualified).toBe(false);
    expect(dkg.verifyPublicKeyConsistency(summary, [2, 3])).toBe(true);

    const transcript = JSON.parse(dkg.serializePublicTranscript(summary)) as {
      qualifiedDealers: number[];
      transcriptDigest: string;
    };
    expect(transcript.qualifiedDealers).toEqual([1, 2, 3, 4]);
    expect(transcript.transcriptDigest).toBe(summary.transcriptDigest);
  });
});
