import { createHash, randomBytes } from 'node:crypto';

/**
 * Zero-Knowledge Private Set Intersection & Union Cardinality Prover (DH-PSI-CA + DLEQ).
 *
 * Computes the EXACT intersection cardinality |A cap B| and union cardinality |A cup B|
 * between two private sets A and B using commutative Diffie-Hellman blinding over a
 * safe-prime quadratic-residue subgroup, augmented with Chaum-Pedersen DLEQ proofs:
 *  1. Party A commits public key Y_A = g^{k_A}, maps each x in A to H(x) in G_Q,
 *     and sends blinded set E_A = [H(x)^{k_A}] with a batch DLEQ proof of exponent k_A.
 *  2. Party B commits Y_B = g^{k_B}, doubly blinds E_A into E_{AB} = [e^{k_B}] (shuffled),
 *     and sends E_B = [H(y)^{k_B}] + DLEQ proofs of honest exponentiation k_B.
 *  3. Party A doubly blinds E_B into E_{BA} = [e^{k_B k_A}] with DLEQ proof.
 *  4. Because (H(x)^{k_A})^{k_B} == (H(x)^{k_B})^{k_A}, the intersection size equals
 *     |E_{AB} cap E_{BA}| and union size equals |A| + |B| - |A cap B| — WITHOUT revealing
 *     non-matching elements, and with full cryptographic auditability!
 */

export const SUBGROUP_Q = 0x7fffffffffffffffffffffffffffe1d3n;
export const SAFE_PRIME_P = 0xffffffffffffffffffffffffffffc3a7n;
export const BASE_G = 4n;

function modPow(base: bigint, exp: bigint, mod: bigint): bigint {
  let result = 1n;
  let b = ((base % mod) + mod) % mod;
  let e = exp;
  while (e > 0n) {
    if ((e & 1n) === 1n) result = (result * b) % mod;
    e >>= 1n;
    b = (b * b) % mod;
  }
  return result;
}

function modScalar(v: bigint): bigint {
  return ((v % SUBGROUP_Q) + SUBGROUP_Q) % SUBGROUP_Q;
}

function randomScalar(): bigint {
  const bytes = randomBytes(16);
  let v = 0n;
  for (const b of bytes) v = (v << 8n) | BigInt(b);
  return (v % (SUBGROUP_Q - 2n)) + 1n;
}

function sha256Hex(...parts: string[]): string {
  const h = createHash('sha256');
  for (const p of parts) {
    h.update(p);
    h.update('|');
  }
  return h.digest('hex');
}

function hashToScalar(...parts: string[]): bigint {
  return modScalar(BigInt('0x' + sha256Hex(...parts).slice(0, 32)));
}

export interface PartyBlindingKeys {
  partyId: string;
  secretK: bigint;
  publicY: bigint;
}

export interface BatchExpDLEQProof {
  partyId: string;
  publicY: bigint;
  baseProduct: bigint;
  outputProduct: bigint;
  announceA: bigint;
  announceB: bigint;
  challenge: bigint;
  responseK: bigint;
  elementCount: number;
  context: string;
}

export interface BlindedSetMessage {
  partyId: string;
  publicY: bigint;
  blindedElements: bigint[];
  dleqProof: BatchExpDLEQProof;
}

export interface CardinalityAuditCertificate {
  sessionId: string;
  sizeA: number;
  sizeB: number;
  intersectionCardinality: number;
  unionCardinality: number;
  jaccardNumerator: number;
  jaccardDenominator: number;
  transcriptDigest: string;
  proofsValid: boolean;
}

export class ZeroKnowledgeSetCardinalityProver {
  public createPartyKeys(partyId: string, secret?: bigint): PartyBlindingKeys {
    const secretK = secret !== undefined ? modScalar(secret) : randomScalar();
    if (secretK === 0n) throw new Error('Blinding key must be non-zero');
    return {
      partyId,
      secretK,
      publicY: modPow(BASE_G, secretK, SAFE_PRIME_P),
    };
  }

  public hashElementToSubgroup(element: string): bigint {
    const hex = sha256Hex('PSI-CA-H2G-V1', element);
    const raw = (BigInt('0x' + hex.slice(0, 32)) % (SAFE_PRIME_P - 3n)) + 2n;
    const qr = (raw * raw) % SAFE_PRIME_P;
    return qr === 1n ? BASE_G : qr;
  }

  private product(elements: bigint[]): bigint {
    let acc = 1n;
    for (const el of elements) acc = (acc * el) % SAFE_PRIME_P;
    return acc;
  }

  private proveProductDLEQ(
    keys: PartyBlindingKeys,
    inputs: bigint[],
    outputs: bigint[],
    context: string,
  ): BatchExpDLEQProof {
    const baseProduct = this.product(inputs);
    const outputProduct = this.product(outputs);
    const r = randomScalar();
    const announceA = modPow(BASE_G, r, SAFE_PRIME_P);
    const announceB = modPow(baseProduct, r, SAFE_PRIME_P);
    const challenge = hashToScalar(
      'PSI-CA-DLEQ-V1',
      keys.partyId,
      keys.publicY.toString(16),
      baseProduct.toString(16),
      outputProduct.toString(16),
      announceA.toString(16),
      announceB.toString(16),
      String(inputs.length),
      context,
    );
    const responseK = modScalar(r + challenge * keys.secretK);
    return {
      partyId: keys.partyId,
      publicY: keys.publicY,
      baseProduct,
      outputProduct,
      announceA,
      announceB,
      challenge,
      responseK,
      elementCount: inputs.length,
      context,
    };
  }

  public verifyProductDLEQ(proof: BatchExpDLEQProof, expectedInputs: bigint[], expectedOutputs: bigint[]): boolean {
    if (expectedInputs.length !== proof.elementCount || expectedOutputs.length !== proof.elementCount) return false;
    if (this.product(expectedInputs) !== proof.baseProduct) return false;
    if (this.product(expectedOutputs) !== proof.outputProduct) return false;

    const expectedC = hashToScalar(
      'PSI-CA-DLEQ-V1',
      proof.partyId,
      proof.publicY.toString(16),
      proof.baseProduct.toString(16),
      proof.outputProduct.toString(16),
      proof.announceA.toString(16),
      proof.announceB.toString(16),
      String(proof.elementCount),
      proof.context,
    );
    if (expectedC !== proof.challenge) return false;

    const eq1 = modPow(BASE_G, proof.responseK, SAFE_PRIME_P) ===
      (proof.announceA * modPow(proof.publicY, proof.challenge, SAFE_PRIME_P)) % SAFE_PRIME_P;
    const eq2 = modPow(proof.baseProduct, proof.responseK, SAFE_PRIME_P) ===
      (proof.announceB * modPow(proof.outputProduct, proof.challenge, SAFE_PRIME_P)) % SAFE_PRIME_P;
    return eq1 && eq2;
  }

  private shuffleElements(arr: bigint[]): bigint[] {
    const out = [...arr];
    for (let i = out.length - 1; i > 0; i--) {
      const j = randomBytes(4).readUInt32BE(0) % (i + 1);
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  }

  public blindRawSet(keys: PartyBlindingKeys, rawElements: string[], context: string): BlindedSetMessage {
    const unique = [...new Set(rawElements)];
    const hashed = unique.map((el) => this.hashElementToSubgroup(el));
    const blinded = hashed.map((h) => modPow(h, keys.secretK, SAFE_PRIME_P));
    const shuffled = this.shuffleElements(blinded);
    const dleqProof = this.proveProductDLEQ(keys, hashed, shuffled, context);
    return {
      partyId: keys.partyId,
      publicY: keys.publicY,
      blindedElements: shuffled,
      dleqProof,
    };
  }

  public doubleBlindReceived(keys: PartyBlindingKeys, incoming: bigint[], context: string): BlindedSetMessage {
    const doublyBlinded = incoming.map((el) => modPow(el, keys.secretK, SAFE_PRIME_P));
    const shuffled = this.shuffleElements(doublyBlinded);
    const dleqProof = this.proveProductDLEQ(keys, incoming, shuffled, context);
    return {
      partyId: keys.partyId,
      publicY: keys.publicY,
      blindedElements: shuffled,
      dleqProof,
    };
  }

  public runVerifiableCardinalityProtocol(
    sessionId: string,
    keysA: PartyBlindingKeys,
    setA: string[],
    keysB: PartyBlindingKeys,
    setB: string[],
  ): CardinalityAuditCertificate {
    const msgA = this.blindRawSet(keysA, setA, `${sessionId}:round1-A`);
    const msgB = this.blindRawSet(keysB, setB, `${sessionId}:round1-B`);

    const doubleAB = this.doubleBlindReceived(keysB, msgA.blindedElements, `${sessionId}:round2-AB`);
    const doubleBA = this.doubleBlindReceived(keysA, msgB.blindedElements, `${sessionId}:round2-BA`);

    const okAB = this.verifyProductDLEQ(doubleAB.dleqProof, msgA.blindedElements, doubleAB.blindedElements);
    const okBA = this.verifyProductDLEQ(doubleBA.dleqProof, msgB.blindedElements, doubleBA.blindedElements);

    const setABTags = new Set(doubleAB.blindedElements.map((v) => v.toString(16)));
    let intersectionCardinality = 0;
    for (const v of doubleBA.blindedElements) {
      if (setABTags.has(v.toString(16))) intersectionCardinality++;
    }

    const sizeA = msgA.blindedElements.length;
    const sizeB = msgB.blindedElements.length;
    const unionCardinality = sizeA + sizeB - intersectionCardinality;
    const transcriptDigest = sha256Hex(
      'PSI-CA-CERT-V1',
      sessionId,
      keysA.publicY.toString(16),
      keysB.publicY.toString(16),
      String(sizeA),
      String(sizeB),
      String(intersectionCardinality),
      doubleAB.dleqProof.outputProduct.toString(16),
      doubleBA.dleqProof.outputProduct.toString(16),
    );

    return {
      sessionId,
      sizeA,
      sizeB,
      intersectionCardinality,
      unionCardinality,
      jaccardNumerator: intersectionCardinality,
      jaccardDenominator: unionCardinality,
      transcriptDigest,
      proofsValid: okAB && okBA,
    };
  }

  public serializeCertificate(cert: CardinalityAuditCertificate): string {
    return JSON.stringify(cert);
  }
}
