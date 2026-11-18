import {
  BatchedPoseidonTranscript,
  TranscriptFieldMath,
  POSEIDON_TRANSCRIPT_PRIME,
} from '../../core/zkp/BatchedPoseidonTranscript';

describe('BatchedPoseidonTranscript', () => {
  let transcript: BatchedPoseidonTranscript;

  beforeEach(() => {
    transcript = new BatchedPoseidonTranscript('Test_Transcript');
  });

  describe('Field Math & Quintic S-Box', () => {
    it('performs modular arithmetic mod POSEIDON_TRANSCRIPT_PRIME', () => {
      const a = 12345678901234567890n;
      const b = 98765432109876543210n;
      expect(TranscriptFieldMath.add(a, b)).toBe((a + b) % POSEIDON_TRANSCRIPT_PRIME);
      expect(TranscriptFieldMath.sub(a, b)).toBe(((a - b) % POSEIDON_TRANSCRIPT_PRIME + POSEIDON_TRANSCRIPT_PRIME) % POSEIDON_TRANSCRIPT_PRIME);
      expect(TranscriptFieldMath.mul(a, b)).toBe((a * b) % POSEIDON_TRANSCRIPT_PRIME);
    });

    it('evaluates quintic S-box x^5 accurately', () => {
      const x = 3n;
      // 3^5 = 243
      expect(TranscriptFieldMath.sbox(x)).toBe(243n);
    });
  });

  describe('Duplex Sponge Absorb & Squeeze Operations', () => {
    it('absorbs scalars and squeezes deterministic challenges', () => {
      const t1 = new BatchedPoseidonTranscript('Session_A');
      t1.absorb(12345n);
      t1.absorb(67890n);
      const ch1 = t1.squeeze();

      const t2 = new BatchedPoseidonTranscript('Session_A');
      t2.absorb(12345n);
      t2.absorb(67890n);
      const ch2 = t2.squeeze();

      expect(ch1).toBe(ch2);
      expect(ch1).toBeGreaterThan(0n);
    });

    it('produces distinct challenges for differing domain labels', () => {
      const t1 = new BatchedPoseidonTranscript('Label_Alpha');
      t1.absorb(100n);
      const c1 = t1.squeeze();

      const t2 = new BatchedPoseidonTranscript('Label_Beta');
      t2.absorb(100n);
      const c2 = t2.squeeze();

      expect(c1).not.toBe(c2);
    });

    it('absorbs batches and points properly', () => {
      transcript.absorbBatch([1n, 2n, 3n, 4n, 5n]);
      transcript.absorbPoint(10n, 20n);
      const challenges = transcript.squeezeBatch(3);

      expect(challenges.length).toBe(3);
      for (const ch of challenges) {
        expect(ch).toBeGreaterThan(0n);
        expect(ch).toBeLessThan(POSEIDON_TRANSCRIPT_PRIME);
      }
    });

    it('forks transcript state for branched proofs', () => {
      transcript.absorb(42n);
      const forked = transcript.fork();

      // Branch 1
      transcript.absorb(100n);
      const chMain = transcript.squeeze();

      // Branch 2
      forked.absorb(200n);
      const chFork = forked.squeeze();

      expect(chMain).not.toBe(chFork);
    });
  });
});
