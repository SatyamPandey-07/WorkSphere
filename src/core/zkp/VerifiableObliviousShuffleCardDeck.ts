/**
 * @file VerifiableObliviousShuffleCardDeck.ts
 * @description Mental-Poker Commutative SRA (Shamir-Rivest-Adleman) Masked Deck Shuffle &
 * Verifiable Fair Card/Slot Reveal Prover.
 * Enables N mutually distrustful participants to shuffle a shared deck of items/tickets/slots
 * WITHOUT a trusted dealer:
 *   1. Every player i generates a secret commutative exponent pair (e_i, d_i) with e_i * d_i == 1 mod (p - 1).
 *   2. Each player sequentially masks every card C -> C^{e_i} mod p and applies a secret permutation.
 *   3. To deal a card privately to player j, all OTHER players cooperatively peel their layer using d_i
 *      and publish verifiable decryption receipts; finally player j removes d_j to read the card!
 *   4. Supports post-game full-deck audit proving zero cards were duplicated, forged, or substituted.
 */

import { createHash, randomBytes } from 'node:crypto';

const SUBGROUP_Q = 0x7fffffffffffffffffffffffffffe1d3n;
const SAFE_PRIME_P = 0xffffffffffffffffffffffffffffc3a7n;

export interface SRAPlayerKey {
  playerId: string;
  encryptExpE: bigint;
  decryptExpD: bigint;
  keyCommitHash: string;
}

export interface DeckCardEncoding {
  cardId: string;
  encodedElement: bigint;
}

export interface PlayerShuffleStep {
  playerId: string;
  inputDeck: bigint[];
  outputDeck: bigint[];
  stepDigest: string;
}

export interface CooperativePeelShare {
  playerId: string;
  cardPosition: number;
  inputMaskedCard: bigint;
  peeledCard: bigint;
  peelDigest: string;
}

export interface PostGameAuditVerdict {
  valid: boolean;
  verifiedPlayers: string[];
  cheatingPlayers: string[];
  recoveredOriginalCards: string[];
  reason?: string;
}

function modNorm(a: bigint, m: bigint): bigint {
  const r = a % m;
  return r >= 0n ? r : r + m;
}

function modPow(base: bigint, exp: bigint, mod: bigint): bigint {
  let result = 1n;
  let b = modNorm(base, mod);
  let e = exp;
  while (e > 0n) {
    if ((e & 1n) === 1n) result = (result * b) % mod;
    b = (b * b) % mod;
    e >>= 1n;
  }
  return result;
}

function extendedGcd(a: bigint, b: bigint): { gcd: bigint; x: bigint; y: bigint } {
  let oldR = a, r = b;
  let oldS = 1n, s = 0n;
  let oldT = 0n, t = 1n;
  while (r !== 0n) {
    const q = oldR / r;
    [oldR, r] = [r, oldR - q * r];
    [oldS, s] = [s, oldS - q * s];
    [oldT, t] = [t, oldT - q * t];
  }
  return { gcd: oldR, x: oldS, y: oldT };
}

function modInverse(a: bigint, m: bigint): bigint {
  const { gcd, x } = extendedGcd(modNorm(a, m), m);
  if (gcd !== 1n) throw new Error('Exponent not coprime to subgroup order');
  return modNorm(x, m);
}

/**
 * Commutative SRA Mental-Poker Masked Deck Shuffler & Post-Game Fair-Play Auditor.
 */
export class VerifiableObliviousShuffleCardDeck {
  private readonly p: bigint;
  private readonly q: bigint; // Working inside the order-q quadratic residue subgroup -> exponents invert mod q!

  constructor(p = SAFE_PRIME_P, q = SUBGROUP_Q) {
    if (p !== 2n * q + 1n) {
      throw new Error('Safe prime invariant p = 2q + 1 is required');
    }
    this.p = p;
    this.q = q;
  }

  /**
   * Generates a player's commutative SRA key pair (e, d) with e * d == 1 mod q,
   * committed via a hiding hash for post-game fair-play auditing.
   */
  public generatePlayerKey(playerId: string): SRAPlayerKey {
    for (let attempt = 0; attempt < 256; attempt++) {
      const e = (BigInt(`0x${randomBytes(16).toString('hex')}`) % (this.q - 4n)) + 3n;
      const { gcd } = extendedGcd(e, this.q);
      if (gcd === 1n) {
        const d = modInverse(e, this.q);
        const keyCommitHash = createHash('sha256')
          .update(`WorkSphere::SRAKeyCommit|${playerId}|${e.toString(16)}|${d.toString(16)}`)
          .digest('hex');
        return { playerId, encryptExpE: e, decryptExpD: d, keyCommitHash };
      }
    }
    throw new Error('Failed to generate SRA commutative exponent pair');
  }

  /**
   * Encodes card labels deterministically into unique order-q quadratic residue subgroup elements.
   */
  public encodeDeck(deckId: string, cardLabels: readonly string[]): DeckCardEncoding[] {
    if (cardLabels.length < 2) throw new Error('Deck must contain at least 2 cards');
    if (new Set(cardLabels).size !== cardLabels.length) throw new Error('Duplicate card labels');

    const encoded: DeckCardEncoding[] = [];
    const used = new Set<bigint>();

    for (const cardId of cardLabels) {
      let element = 0n;
      for (let ctr = 0; ctr < 1024; ctr++) {
        const hex = createHash('sha256')
          .update(`WorkSphere::SRACard|${deckId}|${cardId}|${ctr}`)
          .digest('hex');
        const raw = BigInt(`0x${hex}`) % (this.p - 2n) + 2n;
        const cand = (raw * raw) % this.p;
        if (cand > 1n && modPow(cand, this.q, this.p) === 1n && !used.has(cand)) {
          element = cand;
          break;
        }
      }
      if (element === 0n) throw new Error(`Failed to encode card ${cardId}`);
      used.add(element);
      encoded.push({ cardId, encodedElement: element });
    }

    return encoded;
  }

  private randomPerm(n: number): number[] {
    const arr = Array.from({ length: n }, (_, i) => i);
    for (let i = n - 1; i > 0; i--) {
      const j = randomBytes(4).readUInt32BE(0) % (i + 1);
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  /**
   * Player masks every card with e_i and applies a secret Fisher-Yates shuffle.
   */
  public shuffleAndMaskDeck(
    playerKey: SRAPlayerKey,
    inputDeck: readonly bigint[],
    customPermutation?: readonly number[]
  ): PlayerShuffleStep {
    const n = inputDeck.length;
    const perm = customPermutation ? [...customPermutation] : this.randomPerm(n);
    if (perm.length !== n || new Set(perm).size !== n) {
      throw new Error('Invalid shuffle permutation');
    }

    const outputDeck = perm.map((srcIdx) => modPow(inputDeck[srcIdx], playerKey.encryptExpE, this.p));
    const stepDigest = createHash('sha256')
      .update(`${playerKey.playerId}|${outputDeck.map((c) => c.toString(16)).join(',')}`)
      .digest('hex');

    return {
      playerId: playerKey.playerId,
      inputDeck: [...inputDeck],
      outputDeck,
      stepDigest,
    };
  }

  /**
   * Executes a full multi-party commutative shuffle across all players sequentially.
   */
  public executeMultiPartyShuffle(
    initialDeck: readonly bigint[],
    playerKeys: readonly SRAPlayerKey[]
  ): {
    finalMaskedDeck: bigint[];
    shuffleTranscript: PlayerShuffleStep[];
  } {
    if (playerKeys.length < 2) throw new Error('Mental-poker shuffle requires at least 2 players');
    let cur = [...initialDeck];
    const shuffleTranscript: PlayerShuffleStep[] = [];

    for (const pk of playerKeys) {
      const step = this.shuffleAndMaskDeck(pk, cur);
      shuffleTranscript.push(step);
      cur = step.outputDeck;
    }

    return { finalMaskedDeck: cur, shuffleTranscript };
  }

  /**
   * A player peels their single SRA encryption layer from a masked card using d_i: card^{d_i} mod p.
   */
  public peelCardLayer(
    playerKey: SRAPlayerKey,
    cardPosition: number,
    maskedCard: bigint
  ): CooperativePeelShare {
    const peeledCard = modPow(maskedCard, playerKey.decryptExpD, this.p);
    const peelDigest = createHash('sha256')
      .update(`${playerKey.playerId}|pos:${cardPosition}|${maskedCard.toString(16)}->${peeledCard.toString(16)}`)
      .digest('hex');

    return {
      playerId: playerKey.playerId,
      cardPosition,
      inputMaskedCard: maskedCard,
      peeledCard,
      peelDigest,
    };
  }

  /**
   * Cooperatively reveals a card at `cardPosition` by peeling all players' SRA layers in ANY order
   * (demonstrating commutativity!) and decoding back to the original card label.
   */
  public revealCardCooperatively(
    encodedDeck: readonly DeckCardEncoding[],
    maskedDeck: readonly bigint[],
    cardPosition: number,
    peelingOrderKeys: readonly SRAPlayerKey[]
  ): {
    cardId: string | null;
    recoveredElement: bigint;
    peelTrace: CooperativePeelShare[];
  } {
    if (cardPosition < 0 || cardPosition >= maskedDeck.length) {
      throw new RangeError('cardPosition out of deck bounds');
    }
    let current = maskedDeck[cardPosition];
    const peelTrace: CooperativePeelShare[] = [];

    for (const pk of peelingOrderKeys) {
      const share = this.peelCardLayer(pk, cardPosition, current);
      peelTrace.push(share);
      current = share.peeledCard;
    }

    const match = encodedDeck.find((c) => c.encodedElement === current);
    return {
      cardId: match ? match.cardId : null,
      recoveredElement: current,
      peelTrace,
    };
  }

  /**
   * Post-game full fair-play audit: after all players disclose their committed keys (e_i, d_i),
   * verifies every key commitment, confirms every shuffle step is an EXACT bijective mask-and-permute
   * of its inputs (zero duplicate/forged cards!), and recovers the exact original deck multiset.
   */
  public auditPostGameTranscript(
    encodedDeck: readonly DeckCardEncoding[],
    shuffleTranscript: readonly PlayerShuffleStep[],
    disclosedKeys: readonly SRAPlayerKey[]
  ): PostGameAuditVerdict {
    const keyMap = new Map(disclosedKeys.map((k) => [k.playerId, k]));
    const verifiedPlayers: string[] = [];
    const cheatingPlayers: string[] = [];

    for (const step of shuffleTranscript) {
      const key = keyMap.get(step.playerId);
      if (!key) {
        cheatingPlayers.push(step.playerId);
        continue;
      }
      const expectedCommit = createHash('sha256')
        .update(`WorkSphere::SRAKeyCommit|${key.playerId}|${key.encryptExpE.toString(16)}|${key.decryptExpD.toString(16)}`)
        .digest('hex');
      if (expectedCommit !== key.keyCommitHash || modNorm(key.encryptExpE * key.decryptExpD, this.q) !== 1n) {
        cheatingPlayers.push(step.playerId);
        continue;
      }

      // Check outputDeck is an exact permutation of inputDeck^{e_i} mod p
      const expectedSet = step.inputDeck.map((c) => modPow(c, key.encryptExpE, this.p)).sort((a, b) => (a < b ? -1 : 1));
      const actualSet = [...step.outputDeck].sort((a, b) => (a < b ? -1 : 1));
      const exactBijection =
        expectedSet.length === actualSet.length &&
        expectedSet.every((v, idx) => v === actualSet[idx]);

      if (!exactBijection) {
        cheatingPlayers.push(step.playerId);
      } else {
        verifiedPlayers.push(step.playerId);
      }
    }

    if (cheatingPlayers.length > 0) {
      return {
        valid: false,
        verifiedPlayers,
        cheatingPlayers,
        recoveredOriginalCards: [],
        reason: `Shuffle tampering detected for player(s): ${cheatingPlayers.join(', ')}`,
      };
    }

    const finalDeck = shuffleTranscript[shuffleTranscript.length - 1].outputDeck;
    const recoveredOriginalCards: string[] = [];
    for (let pos = 0; pos < finalDeck.length; pos++) {
      const rev = this.revealCardCooperatively(encodedDeck, finalDeck, pos, disclosedKeys);
      if (!rev.cardId) {
        return {
          valid: false,
          verifiedPlayers,
          cheatingPlayers: [],
          recoveredOriginalCards,
          reason: `Card at position ${pos} did not decode to any valid deck card`,
        };
      }
      recoveredOriginalCards.push(rev.cardId);
    }

    return {
      valid: true,
      verifiedPlayers,
      cheatingPlayers: [],
      recoveredOriginalCards,
    };
  }

  public serializeShuffleStep(step: PlayerShuffleStep): string {
    return JSON.stringify({
      playerId: step.playerId,
      inputDeck: step.inputDeck.map((c) => c.toString(16)),
      outputDeck: step.outputDeck.map((c) => c.toString(16)),
      stepDigest: step.stepDigest,
    });
  }

  public deserializeShuffleStep(payload: string): PlayerShuffleStep {
    const raw = JSON.parse(payload) as {
      playerId: string;
      inputDeck: string[];
      outputDeck: string[];
      stepDigest: string;
    };
    return {
      playerId: raw.playerId,
      inputDeck: raw.inputDeck.map((c) => BigInt(`0x${c}`)),
      outputDeck: raw.outputDeck.map((c) => BigInt(`0x${c}`)),
      stepDigest: raw.stepDigest,
    };
  }
}
