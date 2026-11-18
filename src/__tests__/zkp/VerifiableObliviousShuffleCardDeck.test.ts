import { describe, it, expect } from 'vitest';
import { VerifiableObliviousShuffleCardDeck } from '../../core/zkp/VerifiableObliviousShuffleCardDeck';

describe('VerifiableObliviousShuffleCardDeck', () => {
  const sra = new VerifiableObliviousShuffleCardDeck();

  it('executes a 3-party commutative SRA shuffle and reveals cards in arbitrary peeling orders', () => {
    const cards = ['SLOT-A1', 'SLOT-A2', 'SLOT-B1', 'SLOT-B2', 'SLOT-C1', 'SLOT-C2'];
    const encoded = sra.encodeDeck('desk-lottery-2026', cards);
    const players = ['alice', 'bob', 'carol'].map((id) => sra.generatePlayerKey(id));

    const { finalMaskedDeck, shuffleTranscript } = sra.executeMultiPartyShuffle(
      encoded.map((c) => c.encodedElement),
      players
    );

    // Commutativity check: peeling in forward order [A, B, C] vs reverse order [C, B, A] yields the EXACT same card!
    const revForward = sra.revealCardCooperatively(encoded, finalMaskedDeck, 0, players);
    const revReverse = sra.revealCardCooperatively(encoded, finalMaskedDeck, 0, [...players].reverse());
    expect(revForward.cardId).not.toBeNull();
    expect(revForward.cardId).toBe(revReverse.cardId);

    const audit = sra.auditPostGameTranscript(encoded, shuffleTranscript, players);
    expect(audit.valid).toBe(true);
    expect(audit.cheatingPlayers).toEqual([]);
    expect([...audit.recoveredOriginalCards].sort()).toEqual([...cards].sort());
  });

  it('catches cheating shufflers duplicating cards and round-trips step serialization', () => {
    const encoded = sra.encodeDeck('cheat-deck', ['c1', 'c2', 'c3', 'c4']);
    const p1 = sra.generatePlayerKey('honest');
    const p2 = sra.generatePlayerKey('cheater');

    const { shuffleTranscript } = sra.executeMultiPartyShuffle(
      encoded.map((c) => c.encodedElement),
      [p1, p2]
    );

    // Cheater duplicates card 0 into position 1
    const tamperedStep = {
      ...shuffleTranscript[1],
      outputDeck: [shuffleTranscript[1].outputDeck[0], shuffleTranscript[1].outputDeck[0], ...shuffleTranscript[1].outputDeck.slice(2)],
    };
    const verdict = sra.auditPostGameTranscript(encoded, [shuffleTranscript[0], tamperedStep], [p1, p2]);
    expect(verdict.valid).toBe(false);
    expect(verdict.cheatingPlayers).toEqual(['cheater']);

    const json = sra.serializeShuffleStep(shuffleTranscript[0]);
    const restored = sra.deserializeShuffleStep(json);
    expect(restored).toEqual(shuffleTranscript[0]);
  });
});
